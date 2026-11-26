import { dbAll, dbRun, safeJsonParse, sqlNow, withTransactionAsync } from '../../database/connection.js';
import { generateBaseId } from '../../utils/baseId.js';
import { apiLogger } from '../../utils/logger.js';
import { relationTargetId } from '../module-blueprint/columnMapping.js';
import { occurrencesBetween } from '../scheduled-messages/recurrence.js';

const TIMEZONE = 'Europe/Moscow';
const MAX_OCCURRENCES = 500;
const CACHE_TTL_MS = 60_000;
const eventsTableCache = new Map();

export function clearTicketOccurrencesCache() {
  eventsTableCache.clear();
}

async function resolveEventsTableId(ticketsTableId, read = dbAll) {
  const key = Number(ticketsTableId);
  const cached = eventsTableCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.eventsTableId;

  const candidates = await read(
    `SELECT t.id, c.config
     FROM universal_tables t
     JOIN table_columns c ON c.table_id = t.id
     WHERE t.table_type = 'ticket_events' AND c.column_name = 'ticket_id' AND c.type = 'relation'`,
  );
  const match = candidates.find((candidate) => Number(relationTargetId(candidate.config)) === key);
  const eventsTableId = match ? Number(match.id) : null;
  eventsTableCache.set(key, { eventsTableId, expiresAt: Date.now() + CACHE_TTL_MS });
  return eventsTableId;
}

function parseBoundary(value, endOfDay = false) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    const normalized = value.trim().replace(' ', 'T');
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      return new Date(`${normalized}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+03:00`);
    }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(normalized)) {
      return new Date(`${normalized}+03:00`);
    }
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function ticketDurationMinutes(ticket, fallback = null) {
  const value = ticket.duration;
  const minutes = (typeof value === 'number' || typeof value === 'string') && String(value).trim() !== ''
    ? Number(value)
    : NaN;
  return Number.isFinite(minutes) && minutes > 0 ? minutes : fallback;
}

function hasTimeOfDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value.trim());
}

async function initialStateId(eventsTableId, trx) {
  const stateColumn = await trx.get(
    "SELECT config FROM table_columns WHERE table_id = ? AND column_name = 'state'",
    [eventsTableId],
  );
  const statesTableId = relationTargetId(stateColumn?.config);
  if (!statesTableId) {
    const options = safeJsonParse(stateColumn?.config, {})?.options;
    const first = Array.isArray(options) ? options[0] : null;
    return typeof first === 'object' && first !== null ? first.value ?? first.label ?? null : first ?? null;
  }
  const states = await trx.all('SELECT id, data FROM table_rows WHERE table_id = ?', [statesTableId]);
  states.sort((left, right) => {
    const orderDiff = (Number(safeJsonParse(left.data, {}).order) || Number.MAX_SAFE_INTEGER)
      - (Number(safeJsonParse(right.data, {}).order) || Number.MAX_SAFE_INTEGER);
    return orderDiff || left.id - right.id;
  });
  return states[0]?.id ?? null;
}

function isPristine(occurrence, firstStateId) {
  const stateIsInitial = occurrence.state === null
    || occurrence.state === undefined
    || occurrence.state === ''
    || String(occurrence.state) === String(firstStateId);
  return stateIsInitial
    && occurrence.start_datetime === occurrence.original_start
    && occurrence.status === 'confirmed'
    && !occurrence.event_id;
}

export async function reconcileTicketOccurrences(ticketsTableId, ticketRowId) {
  return withTransactionAsync(async (trx) => {
    const ticketRow = await trx.get(
      'SELECT id, data FROM table_rows WHERE id = ? AND table_id = ? FOR UPDATE',
      [ticketRowId, ticketsTableId],
    );
    if (!ticketRow) return { inserted: 0, updated: 0, deleted: 0 };

    const eventsTableId = await resolveEventsTableId(ticketsTableId, trx.all);
    if (!eventsTableId) return { inserted: 0, updated: 0, deleted: 0 };

    const ticket = safeJsonParse(ticketRow.data, {}) || {};
    const eventRows = await trx.all(
      "SELECT id, data FROM table_rows WHERE table_id = ? AND data->>'ticket_id' = ?",
      [eventsTableId, String(ticketRowId)],
    );
    const occurrences = eventRows
      .map((row) => ({ id: row.id, ...safeJsonParse(row.data, {}) }))
      .filter((row) => row.original_start);
    const firstStateId = await initialStateId(eventsTableId, trx);

    const from = parseBoundary(ticket.scheduled_date);
    const to = parseBoundary(ticket.due_date, true);
    const repeat = typeof ticket.repeat === 'string' ? ticket.repeat.trim() : '';
    const lengthMinutes = ticketDurationMinutes(ticket, repeat ? 60 : null);
    const slots = repeat && from && to
      ? occurrencesBetween(repeat, TIMEZONE, from, to, MAX_OCCURRENCES)
      : !repeat && lengthMinutes && hasTimeOfDay(ticket.scheduled_date) && from
        ? [from]
        : [];
    if (repeat && slots.length === 0) {
      apiLogger.warn({ ticketsTableId, ticketRowId, repeat }, '[TicketOccurrences] No occurrences generated');
    }
    const slotStarts = new Set(slots.map((slot) => slot.toISOString()));
    const retainedStarts = new Set();
    let inserted = 0;
    let updated = 0;
    let deleted = 0;

    for (const occurrence of occurrences) {
      if (slotStarts.has(occurrence.original_start)) {
        retainedStarts.add(occurrence.original_start);
        if (isPristine(occurrence, firstStateId)) {
          const endDatetime = new Date(new Date(occurrence.start_datetime).getTime() + lengthMinutes * 60_000).toISOString();
          if (occurrence.title !== ticket.what || occurrence.end_datetime !== endDatetime) {
            const { id, ...currentData } = occurrence;
            await trx.run(`UPDATE table_rows SET data = ?, updated_at = ${sqlNow()} WHERE id = ? AND table_id = ?`, [
              JSON.stringify({ ...currentData, title: ticket.what, end_datetime: endDatetime }),
              id,
              eventsTableId,
            ]);
            updated++;
          }
        }
      } else if (isPristine(occurrence, firstStateId)) {
        await trx.run('DELETE FROM table_rows WHERE id = ? AND table_id = ?', [occurrence.id, eventsTableId]);
        deleted++;
      }
    }

    for (const start of slotStarts) {
      if (retainedStarts.has(start)) continue;
      const end = new Date(new Date(start).getTime() + lengthMinutes * 60_000).toISOString();
      await trx.run(
        `INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
         VALUES (?, ?, ?, ${sqlNow()}, ${sqlNow()})`,
        [eventsTableId, generateBaseId(), JSON.stringify({
          ticket_id: Number(ticketRowId),
          state: repeat ? firstStateId : null,
          original_start: start,
          start_datetime: start,
          end_datetime: end,
          is_all_day: false,
          timezone: TIMEZONE,
          title: ticket.what,
          status: 'confirmed',
        })],
      );
      inserted++;
    }

    return { inserted, updated, deleted };
  });
}

export async function deleteTicketOccurrences(ticketsTableId, ticketRowIds) {
  const eventsTableId = await resolveEventsTableId(ticketsTableId);
  if (!eventsTableId) return 0;
  const ids = (Array.isArray(ticketRowIds) ? ticketRowIds : [ticketRowIds])
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const result = await dbRun(
    `DELETE FROM table_rows WHERE table_id = ? AND data->>'ticket_id' IN (${placeholders})`,
    [eventsTableId, ...ids.map(String)],
  );
  return result.changes;
}
