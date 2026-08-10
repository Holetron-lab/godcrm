/**
 * Google Calendar — Sync Operations
 *
 * syncFromGoogle, syncToGoogle, fullSync, syncAllAccounts
 */

import { dbGet, dbRun, dbAll, isPostgres, sqlNow, safeJsonParse } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';
import { fireRowCreateTriggers } from '../AutomationTriggerService.js';
import { generateBaseId, getUserTokens, loadTokens } from './helpers.js';
import { listCalendars, listEvents, createEvent, updateEvent, mapGoogleEventToCrm } from './operations.js';

// ---------------------------------------------------------------------------
// Sync Operations
// ---------------------------------------------------------------------------

export async function syncFromGoogle(userId, tableId) {
  const userTokens = getUserTokens(userId);
  if (!userTokens) {
    throw new Error(`No Google Calendar tokens found for user ${userId}`);
  }

  const counts = { synced: 0, created: 0, updated: 0, errors: 0, calendarsProcessed: 0 };

  // Time range: 30 days back to 90 days ahead
  const timeMin = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

  // Fetch ALL calendars the user has access to (including shared calendars)
  let allCalendars = [];
  const calendarMap = {};
  try {
    const calList = await listCalendars(userId);
    for (const cal of calList) {
      calendarMap[cal.id] = cal.summary || cal.id;
      allCalendars.push(cal.id);
    }
    apiLogger.info(`Found ${allCalendars.length} calendars for user ${userId}: ${allCalendars.map(id => calendarMap[id] || id).join(', ')}`);
  } catch (err) {
    apiLogger.warn('Could not fetch calendar list, falling back to primary', err);
    allCalendars = ['primary'];
  }

  // Use all discovered calendars (includes own + shared like girlfriend's)
  const calendars = allCalendars.length > 0 ? allCalendars : (userTokens.calendars || ['primary']);

  for (const calendarId of calendars) {
    try {
      const events = await listEvents(userId, calendarId, timeMin, timeMax);
      const calendarSummary = calendarMap[calendarId] || calendarId;

      for (const event of events) {
        try {
          const crmData = mapGoogleEventToCrm(event, calendarId, calendarSummary);
          const eventId = event.id;

          // Look for existing row with this event_id
          const existingRow = isPostgres()
            ? await dbGet(
                "SELECT id, data FROM table_rows WHERE table_id = ? AND data->>'event_id' = ?",
                [tableId, eventId]
              )
            : await dbGet(
                'SELECT id, data FROM table_rows WHERE table_id = ? AND data LIKE ?',
                [tableId, `%"event_id":"${eventId}"%`]
              );

          if (existingRow) {
            // Update existing row
            const existingData = safeJsonParse(existingRow.data) || {};
            const mergedData = { ...existingData, ...crmData };
            await dbRun(
              `UPDATE table_rows SET data = ?, updated_at = ${sqlNow()} WHERE id = ?`,
              [JSON.stringify(mergedData), existingRow.id]
            );
            counts.updated++;
          } else {
            // Create new row
            const baseId = generateBaseId();
            const insertResult = await dbRun(
              `INSERT INTO table_rows (table_id, base_id, data, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})`,
              [tableId, baseId, JSON.stringify(crmData), userId]
            );
            counts.created++;

            // Fire CRM automation triggers (row_create) — so automations
            // configured in CRM UI work without code changes or restarts
            const newRowId = insertResult.lastID || insertResult.lastInsertRowid;
            if (newRowId) {
              fireRowCreateTriggers(tableId, newRowId, crmData).catch(err => {
                apiLogger.warn({ err, tableId, rowId: newRowId }, 'Calendar sync: automation trigger failed (non-blocking)');
              });
            }
          }

          counts.synced++;
        } catch (eventErr) {
          apiLogger.error(`Error syncing event ${event.id} from Google`, eventErr);
          counts.errors++;
        }
      }
      counts.calendarsProcessed++;
    } catch (calErr) {
      apiLogger.error(`Error syncing calendar ${calendarId} from Google`, calErr);
      counts.errors++;
    }
  }

  apiLogger.info(`Google Calendar sync from Google complete for user ${userId} (${counts.calendarsProcessed} calendars)`, counts);
  return counts;
}

export async function syncToGoogle(userId, tableId, rowId) {
  const row = await dbGet(
    'SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?',
    [rowId, tableId]
  );

  if (!row) {
    throw new Error(`Row ${rowId} not found in table ${tableId}`);
  }

  const data = safeJsonParse(row.data) || {};
  const calendarId = data.calendar_id || 'primary';

  if (data.event_id) {
    // Update existing Google event
    const updatedEvent = await updateEvent(userId, calendarId, data.event_id, data);
    apiLogger.info(`Synced row ${rowId} -> updated Google event ${data.event_id}`);
    return { action: 'updated', eventId: data.event_id, event: updatedEvent };
  } else {
    // Create new Google event
    const createdEvent = await createEvent(userId, calendarId, data);
    // Save the event_id back to the CRM row
    data.event_id = createdEvent.id;
    data.link = createdEvent.htmlLink || '';
    await dbRun(
      `UPDATE table_rows SET data = ?, updated_at = ${sqlNow()} WHERE id = ?`,
      [JSON.stringify(data), rowId]
    );
    apiLogger.info(`Synced row ${rowId} -> created Google event ${createdEvent.id}`);
    return { action: 'created', eventId: createdEvent.id, event: createdEvent };
  }
}

export async function fullSync(userId, tableId) {
  apiLogger.info(`Starting full sync for user ${userId}, table ${tableId}`);

  // Pull from Google first
  const fromGoogle = await syncFromGoogle(userId, tableId);

  // Then push all rows that have event_id back to Google
  const rows = await dbAll(
    'SELECT id, data FROM table_rows WHERE table_id = ?',
    [tableId]
  );

  let pushedCount = 0;
  let pushErrors = 0;

  for (const row of rows) {
    const data = safeJsonParse(row.data) || {};
    // Only push rows that already have a Google event_id (to update them)
    if (data.event_id) {
      try {
        await syncToGoogle(userId, tableId, row.id);
        pushedCount++;
      } catch (err) {
        apiLogger.error(`Error pushing row ${row.id} to Google`, err);
        pushErrors++;
      }
    }
  }

  const result = {
    fromGoogle,
    toGoogle: { pushed: pushedCount, errors: pushErrors },
  };

  apiLogger.info(`Full sync complete for user ${userId}`, result);
  return result;
}

// ---------------------------------------------------------------------------
// Sync All Accounts (for scheduled sync)
// ---------------------------------------------------------------------------

export async function syncAllAccounts(tableId) {
  const eventsTableId = tableId || 2671; // Default: google_calendar_events table
  const tokens = loadTokens();
  const results = [];

  for (const key of Object.keys(tokens)) {
    if (!key.startsWith('user_')) continue;
    const userId = key.replace('user_', '');
    const userTokens = tokens[key];

    if (!userTokens || !userTokens.refresh_token) continue;

    try {
      const syncResult = await syncFromGoogle(userId, eventsTableId);
      results.push({ userId, status: 'success', ...syncResult });
    } catch (err) {
      apiLogger.error(`Scheduled sync failed for user ${userId}`, err);
      results.push({ userId, status: 'error', error: err.message });
    }
  }

  return results;
}
