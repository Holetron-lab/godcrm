/**
 * Restore deleted Google Calendar events from trash
 *
 * Google Calendar keeps deleted events for 30 days with status "cancelled".
 * This script finds them and restores by patching status back to "confirmed".
 *
 * Usage: node --experimental-modules scripts/restore-google-calendar-events.js [--dry-run]
 */

import { google } from 'googleapis';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import CryptoJS from 'crypto-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Config paths (same as GoogleCalendarService)
const CALENDAR_CONFIG_PATH = path.resolve(__dirname, '../google-calendar-config.json');
const FALLBACK_CONFIG_PATH = path.resolve(__dirname, '../google-oauth-config.json');
const CONFIG_PATH = fs.existsSync(CALENDAR_CONFIG_PATH) ? CALENDAR_CONFIG_PATH : FALLBACK_CONFIG_PATH;
const TOKENS_PATH = path.resolve(__dirname, '../google-calendar-tokens.json');

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || 'dev_jwt_secret_change_in_production';

const DRY_RUN = process.argv.includes('--dry-run');

// ── Helpers ──────────────────────────────────────────────────────────────────

function decrypt(ciphertext) {
  const bytes = CryptoJS.AES.decrypt(ciphertext, ENCRYPTION_KEY);
  return bytes.toString(CryptoJS.enc.Utf8);
}

function loadConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  const config = JSON.parse(raw);
  let clientSecret = config.clientSecret;
  if (clientSecret && clientSecret.startsWith('U2F')) {
    clientSecret = decrypt(clientSecret);
  }
  return { clientId: config.clientId, clientSecret, redirectUri: config.redirectUri };
}

function loadTokens() {
  const raw = fs.readFileSync(TOKENS_PATH, 'utf-8');
  return JSON.parse(raw);
}

function saveTokens(tokens) {
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2), 'utf-8');
}

// ── Auth ─────────────────────────────────────────────────────────────────────

async function getAuthClient(userId) {
  const config = loadConfig();
  const tokens = loadTokens();
  const userTokens = tokens[`user_${userId}`];

  if (!userTokens) throw new Error(`No tokens for user ${userId}`);

  const oauth2Client = new google.auth.OAuth2(config.clientId, config.clientSecret);

  let accessToken = userTokens.access_token;
  const refreshToken = userTokens.refresh_token ? decrypt(userTokens.refresh_token) : null;

  // Always refresh to get a fresh token
  if (refreshToken) {
    console.log('🔄 Refreshing access token...');
    const response = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
    accessToken = response.data.access_token;
    const newExpiry = new Date(Date.now() + (response.data.expires_in || 3600) * 1000).toISOString();

    tokens[`user_${userId}`] = {
      ...userTokens,
      access_token: accessToken,
      token_expiry: newExpiry,
    };
    saveTokens(tokens);
    console.log('✅ Token refreshed, expires:', newExpiry);
  }

  oauth2Client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
  return oauth2Client;
}

// ── Main Logic ───────────────────────────────────────────────────────────────

async function findDeletedEvents(calendar, calendarId) {
  const deletedEvents = [];
  let pageToken = null;

  // Look back 60 days to catch all recent deletions
  const timeMin = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

  do {
    const params = {
      calendarId,
      showDeleted: true,
      timeMin,
      maxResults: 250,
      singleEvents: false, // Get recurring event masters too
    };
    if (pageToken) params.pageToken = pageToken;

    const res = await calendar.events.list(params);
    const events = res.data.items || [];

    for (const event of events) {
      if (event.status === 'cancelled') {
        deletedEvents.push(event);
      }
    }

    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return deletedEvents;
}

async function restoreEvent(calendar, calendarId, event) {
  try {
    // For recurring event instances (have recurringEventId), we need special handling
    if (event.recurringEventId) {
      // This is a cancelled instance of a recurring event
      // We need to check if the parent recurring event still exists
      try {
        const parent = await calendar.events.get({
          calendarId,
          eventId: event.recurringEventId,
        });

        if (parent.data.status === 'cancelled') {
          // Parent is also deleted - restore parent first
          console.log(`  ↳ Parent recurring event ${event.recurringEventId} also deleted, restoring parent...`);
          if (!DRY_RUN) {
            await calendar.events.patch({
              calendarId,
              eventId: event.recurringEventId,
              requestBody: { status: 'confirmed' },
            });
          }
          return { success: true, note: 'Restored via parent recurring event' };
        } else {
          // Parent exists and is confirmed - restore this instance
          if (!DRY_RUN) {
            await calendar.events.patch({
              calendarId,
              eventId: event.id,
              requestBody: { status: 'confirmed' },
            });
          }
          return { success: true, note: 'Restored recurring instance' };
        }
      } catch (parentErr) {
        // Parent not found or error
        console.log(`  ↳ Could not access parent ${event.recurringEventId}: ${parentErr.message}`);
        // Try direct restore anyway
        if (!DRY_RUN) {
          try {
            await calendar.events.patch({
              calendarId,
              eventId: event.id,
              requestBody: { status: 'confirmed' },
            });
            return { success: true, note: 'Direct restore of recurring instance' };
          } catch (directErr) {
            return { success: false, error: directErr.message };
          }
        }
        return { success: true, note: 'Would attempt direct restore (dry-run)' };
      }
    }

    // Regular (non-recurring) event - simple restore
    if (!DRY_RUN) {
      await calendar.events.patch({
        calendarId,
        eventId: event.id,
        requestBody: { status: 'confirmed' },
      });
    }
    return { success: true, note: 'Restored' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('  Google Calendar Event Restoration Tool');
  console.log(DRY_RUN ? '  MODE: DRY RUN (no changes will be made)' : '  MODE: LIVE (will restore events!)');
  console.log('='.repeat(70));
  console.log();

  const userId = 1;
  const auth = await getAuthClient(userId);
  const calendar = google.calendar({ version: 'v3', auth });

  // Get list of calendars
  const calListRes = await calendar.calendarList.list();
  const calendars = calListRes.data.items || [];

  console.log(`📅 Found ${calendars.length} calendars:\n`);
  calendars.forEach(c => console.log(`  - ${c.summary} (${c.id})`));
  console.log();

  // Target calendars (the ones that had deletions)
  const targetCalendars = [
    'bogolepovavikos@gmail.com',
    'geramonnn@gmail.com',
  ];

  let totalFound = 0;
  let totalRestored = 0;
  let totalFailed = 0;
  const results = [];

  for (const calId of targetCalendars) {
    const calInfo = calendars.find(c => c.id === calId);
    const calName = calInfo ? calInfo.summary : calId;

    console.log(`\n${'─'.repeat(70)}`);
    console.log(`📅 Calendar: ${calName} (${calId})`);
    console.log('─'.repeat(70));

    const deleted = await findDeletedEvents(calendar, calId);
    console.log(`\n  Found ${deleted.length} deleted events:\n`);
    totalFound += deleted.length;

    if (deleted.length === 0) {
      console.log('  (none)');
      continue;
    }

    // Group: recurring instances vs standalone
    const standalone = deleted.filter(e => !e.recurringEventId);
    const recurring = deleted.filter(e => !!e.recurringEventId);

    // Track unique parent recurring events to avoid double-restoring
    const restoredParents = new Set();

    // Restore standalone events first
    if (standalone.length > 0) {
      console.log(`  📌 Standalone deleted events: ${standalone.length}`);
      for (const event of standalone) {
        const title = event.summary || '(no title)';
        const start = event.start?.dateTime || event.start?.date || '?';
        console.log(`    → [${event.id}] "${title}" @ ${start}`);

        const result = await restoreEvent(calendar, calId, event);
        if (result.success) {
          totalRestored++;
          console.log(`      ✅ ${DRY_RUN ? 'Would restore' : 'Restored'}: ${result.note}`);
        } else {
          totalFailed++;
          console.log(`      ❌ Failed: ${result.error}`);
        }
        results.push({ calendar: calName, id: event.id, title, start, ...result });
      }
    }

    // Restore recurring event instances
    if (recurring.length > 0) {
      console.log(`\n  🔁 Cancelled recurring instances: ${recurring.length}`);

      // Group by parent recurring event
      const byParent = {};
      for (const event of recurring) {
        if (!byParent[event.recurringEventId]) {
          byParent[event.recurringEventId] = [];
        }
        byParent[event.recurringEventId].push(event);
      }

      for (const [parentId, instances] of Object.entries(byParent)) {
        console.log(`\n    Parent: ${parentId} (${instances.length} cancelled instances)`);

        // First try restoring the parent if it's deleted
        if (!restoredParents.has(parentId)) {
          try {
            const parentEvent = await calendar.events.get({
              calendarId: calId,
              eventId: parentId,
            });

            if (parentEvent.data.status === 'cancelled') {
              console.log(`    ↳ Parent event is also cancelled, restoring parent...`);
              if (!DRY_RUN) {
                await calendar.events.patch({
                  calendarId: calId,
                  eventId: parentId,
                  requestBody: { status: 'confirmed' },
                });
              }
              console.log(`    ✅ Parent restored`);
              restoredParents.add(parentId);
            }
          } catch (err) {
            console.log(`    ⚠️ Could not check parent: ${err.message}`);
          }
        }

        // Now restore each instance
        for (const event of instances) {
          const title = event.summary || '(from recurring)';
          const start = event.originalStartTime?.dateTime || event.originalStartTime?.date || event.start?.dateTime || event.start?.date || '?';
          console.log(`    → Instance @ ${start}`);

          const result = await restoreEvent(calendar, calId, event);
          if (result.success) {
            totalRestored++;
            console.log(`      ✅ ${DRY_RUN ? 'Would restore' : 'Restored'}: ${result.note}`);
          } else {
            totalFailed++;
            console.log(`      ❌ Failed: ${result.error}`);
          }
          results.push({ calendar: calName, id: event.id, title, start, ...result });
        }
      }
    }
  }

  // Summary
  console.log(`\n${'='.repeat(70)}`);
  console.log('  SUMMARY');
  console.log('='.repeat(70));
  console.log(`  Total deleted events found: ${totalFound}`);
  console.log(`  ${DRY_RUN ? 'Would restore' : 'Restored'}:          ${totalRestored}`);
  console.log(`  Failed:                     ${totalFailed}`);
  console.log(DRY_RUN ? '\n  ⚠️  This was a DRY RUN. Run without --dry-run to actually restore.' : '\n  ✅ Restoration complete!');
  console.log('='.repeat(70));
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
