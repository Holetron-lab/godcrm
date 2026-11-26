import { z } from 'zod';
import { dbAll, dbGet, dbRun, isPostgres, safeJsonParse } from '../../database/connection.js';
import { parseAttachments } from '../../routes/v3/chat/parseAttachments.js';
import { canAdminister } from '../EffectiveRoleService.js';
import { minIntervalMinutes, nextRun, validateCron } from './recurrence.js';

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const scheduleInputSchema = z.object({
  content: z.string().optional(),
  content_type: z.string().optional(),
  mentions: z.array(z.unknown()).optional(),
  attachments: z.array(z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  scheduled_at: z.union([z.string(), z.date()]).optional(),
  recurrence_cron: z.string().nullish(),
  timezone: z.string().optional(),
  max_runs: z.number().int().nullish(),
}).passthrough();

export class ScheduledMessageError extends Error {
  constructor(message, code = 'INVALID_SCHEDULE', statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function resolveSchedule(input, { senderType = 'human', current = null, now = new Date() } = {}) {
  const parsed = scheduleInputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ScheduledMessageError(`${issue.path.join('.') || 'input'}: ${issue.message}`);
  }
  input = parsed.data;
  const content = hasOwn(input, 'content') ? input.content : current?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new ScheduledMessageError('content is required');
  }

  const recurrenceCron = (hasOwn(input, 'recurrence_cron') ? input.recurrence_cron : current?.recurrence_cron) || null;
  if (recurrenceCron !== null && !validateCron(recurrenceCron)) {
    throw new ScheduledMessageError('Invalid recurrence_cron');
  }

  const timezone = (hasOwn(input, 'timezone') ? input.timezone : current?.timezone) || 'Europe/Moscow';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(now);
  } catch {
    throw new ScheduledMessageError('Invalid IANA timezone');
  }

  const maxRuns = hasOwn(input, 'max_runs') ? input.max_runs : current?.max_runs ?? null;
  if (maxRuns !== null && (!Number.isInteger(maxRuns) || maxRuns < 1)) {
    throw new ScheduledMessageError('max_runs must be an integer greater than or equal to 1');
  }
  if (!recurrenceCron && maxRuns !== null) {
    throw new ScheduledMessageError('max_runs requires recurrence_cron');
  }

  let scheduledAt;
  const scheduleChanged = Boolean(current && recurrenceCron && (hasOwn(input, 'recurrence_cron') || hasOwn(input, 'timezone')));
  const computeNext = recurrenceCron && (current ? scheduleChanged || !current.scheduled_at : !hasOwn(input, 'scheduled_at'));
  if (computeNext) {
    scheduledAt = nextRun(recurrenceCron, timezone, now)?.toISOString();
  } else {
    scheduledAt = hasOwn(input, 'scheduled_at') ? input.scheduled_at : current?.scheduled_at;
  }

  if (!scheduledAt) throw new ScheduledMessageError('scheduled_at is required for one-time messages');
  const scheduledDate = new Date(scheduledAt);
  if (Number.isNaN(scheduledDate.getTime())) throw new ScheduledMessageError('Invalid scheduled_at date');
  if (scheduledDate.getTime() <= now.getTime()) throw new ScheduledMessageError('scheduled_at must be in the future');

  if (recurrenceCron) {
    const minimum = senderType === 'agent' ? 15 : 5;
    if (minIntervalMinutes(recurrenceCron, timezone) < minimum) {
      throw new ScheduledMessageError(
        `Recurrence interval must be at least ${minimum} minutes for ${senderType === 'agent' ? 'agents' : 'humans'}`,
        'RECURRENCE_TOO_FREQUENT'
      );
    }
  }

  return {
    content,
    recurrenceCron,
    timezone,
    maxRuns,
    scheduledAt: scheduledDate.toISOString(),
  };
}

export function formatScheduledMessage(row) {
  return {
    ...row,
    id: Number(row.id),
    conversation_id: Number(row.conversation_id),
    sender_id: Number(row.sender_id),
    agent_id: row.agent_id == null ? null : Number(row.agent_id),
    mentions: safeJsonParse(row.mentions, []) || [],
    attachments: parseAttachments(row.attachments),
    metadata: safeJsonParse(row.metadata, {}) || {},
    next_run_at: row.scheduled_at,
  };
}

async function requireParticipant(conversationId, userId) {
  const participant = await dbGet(
    isPostgres()
      ? 'SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2'
      : 'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
    [conversationId, userId]
  );
  if (!participant) throw new ScheduledMessageError('Conversation not found', 'NOT_FOUND', 404);
}

async function getScheduledMessage(id) {
  const row = await dbGet(
    isPostgres() ? 'SELECT * FROM scheduled_messages WHERE id = $1' : 'SELECT * FROM scheduled_messages WHERE id = ?',
    [id]
  );
  if (!row) throw new ScheduledMessageError('Scheduled message not found', 'NOT_FOUND', 404);
  return row;
}

async function canManage(row, userId) {
  if (Number(row.sender_id) === Number(userId)) return true;
  const participant = await dbGet(
    isPostgres()
      ? 'SELECT role FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2'
      : 'SELECT role FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
    [row.conversation_id, userId]
  );
  if (['admin', 'owner'].includes(participant?.role)) return true;
  const conversation = await dbGet(
    isPostgres() ? 'SELECT space_id FROM conversations WHERE id = $1' : 'SELECT space_id FROM conversations WHERE id = ?',
    [row.conversation_id]
  );
  return conversation?.space_id ? canAdminister(Number(userId), { spaceId: conversation.space_id }) : false;
}

async function requireManager(row, userId) {
  if (!await canManage(row, userId)) {
    throw new ScheduledMessageError('Only the author, a conversation admin, or a space administrator can manage this scheduled message', 'FORBIDDEN', 403);
  }
}

export async function createScheduledMessage({ conversationId, input, author }) {
  await requireParticipant(conversationId, author.senderId);
  const schedule = resolveSchedule(input, { senderType: author.senderType });
  const contentType = input.content_type || 'text';
  const mentions = JSON.stringify(input.mentions || []);
  const attachments = JSON.stringify(input.attachments || []);
  const metadata = typeof author.metadata === 'string' ? author.metadata : JSON.stringify(author.metadata || input.metadata || {});
  const values = [
    conversationId, author.senderId, schedule.content, contentType, mentions, attachments, metadata,
    schedule.scheduledAt, schedule.recurrenceCron, schedule.timezone, schedule.maxRuns,
    author.senderType, author.agentId, author.defaultRole,
  ];
  const result = await dbRun(
    isPostgres()
      ? `INSERT INTO scheduled_messages (
           conversation_id, sender_id, content, content_type, mentions, attachments, metadata,
           scheduled_at, recurrence_cron, timezone, max_runs, sender_type, agent_id, role
         ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12, $13, $14)
         RETURNING id`
      : `INSERT INTO scheduled_messages (
           conversation_id, sender_id, content, content_type, mentions, attachments, metadata,
           scheduled_at, recurrence_cron, timezone, max_runs, sender_type, agent_id, role
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    values
  );
  return formatScheduledMessage(await getScheduledMessage(result.lastInsertRowid));
}

export async function listScheduledMessages(conversationId, userId) {
  await requireParticipant(conversationId, userId);
  const rows = await dbAll(
    isPostgres()
      ? `SELECT sm.*, u.name AS sender_name, u.avatar AS sender_avatar
         FROM scheduled_messages sm LEFT JOIN users u ON sm.sender_id = u.id
         WHERE sm.conversation_id = $1 AND sm.status IN ('pending', 'paused')
         ORDER BY sm.scheduled_at ASC`
      : `SELECT sm.*, u.name AS sender_name, u.avatar AS sender_avatar
         FROM scheduled_messages sm LEFT JOIN users u ON sm.sender_id = u.id
         WHERE sm.conversation_id = ? AND sm.status IN ('pending', 'paused')
         ORDER BY sm.scheduled_at ASC`,
    [conversationId]
  );
  return rows.map(formatScheduledMessage);
}

export async function updateScheduledMessage(id, userId, input) {
  const current = await getScheduledMessage(id);
  if (current.status !== 'pending') throw new ScheduledMessageError('Can only edit pending messages');
  if (Number(current.sender_id) !== Number(userId)) {
    throw new ScheduledMessageError('Can only edit your own scheduled messages', 'FORBIDDEN', 403);
  }
  if (Object.keys(input).length === 0) throw new ScheduledMessageError('No fields to update');
  const schedule = resolveSchedule(input, { senderType: current.sender_type || 'human', current });
  const mentions = JSON.stringify(hasOwn(input, 'mentions') ? input.mentions : safeJsonParse(current.mentions, []) || []);
  const attachments = JSON.stringify(hasOwn(input, 'attachments') ? input.attachments : safeJsonParse(current.attachments, []) || []);
  const metadata = JSON.stringify(hasOwn(input, 'metadata') ? input.metadata : safeJsonParse(current.metadata, {}) || {});
  const values = [
    schedule.content, input.content_type || current.content_type || 'text', mentions, attachments, metadata,
    schedule.scheduledAt, schedule.recurrenceCron, schedule.timezone, schedule.maxRuns, id,
  ];
  await dbRun(
    isPostgres()
      ? `UPDATE scheduled_messages SET content = $1, content_type = $2, mentions = $3::jsonb,
         attachments = $4::jsonb, metadata = $5::jsonb, scheduled_at = $6, recurrence_cron = $7,
         timezone = $8, max_runs = $9, updated_at = NOW() WHERE id = $10`
      : `UPDATE scheduled_messages SET content = ?, content_type = ?, mentions = ?, attachments = ?,
         metadata = ?, scheduled_at = ?, recurrence_cron = ?, timezone = ?, max_runs = ?,
         updated_at = datetime('now') WHERE id = ?`,
    values
  );
  return formatScheduledMessage(await getScheduledMessage(id));
}

export async function setScheduledMessageStatus(id, userId, targetStatus) {
  if (!['paused', 'pending'].includes(targetStatus)) {
    throw new ScheduledMessageError("status must be 'paused' or 'pending'");
  }
  const current = await getScheduledMessage(id);
  await requireManager(current, userId);
  if (targetStatus === 'paused' && current.status !== 'pending') {
    throw new ScheduledMessageError('Can only pause pending messages');
  }
  if (targetStatus === 'pending' && current.status !== 'paused') {
    throw new ScheduledMessageError('Can only resume paused messages');
  }

  if (targetStatus === 'paused') {
    await dbRun(
      isPostgres()
        ? "UPDATE scheduled_messages SET status = 'paused', updated_at = NOW() WHERE id = $1"
        : "UPDATE scheduled_messages SET status = 'paused', updated_at = datetime('now') WHERE id = ?",
      [id]
    );
  } else {
    const scheduledAt = current.recurrence_cron
      ? nextRun(current.recurrence_cron, current.timezone, new Date())?.toISOString()
      : current.scheduled_at;
    if (!scheduledAt || new Date(scheduledAt).getTime() <= Date.now()) {
      throw new ScheduledMessageError('scheduled_at must be in the future');
    }
    await dbRun(
      isPostgres()
        ? "UPDATE scheduled_messages SET status = 'pending', scheduled_at = $1, updated_at = NOW() WHERE id = $2"
        : "UPDATE scheduled_messages SET status = 'pending', scheduled_at = ?, updated_at = datetime('now') WHERE id = ?",
      [scheduledAt, id]
    );
  }
  return formatScheduledMessage(await getScheduledMessage(id));
}

export async function cancelScheduledMessage(id, userId) {
  const current = await getScheduledMessage(id);
  if (!['pending', 'paused'].includes(current.status)) {
    throw new ScheduledMessageError('Can only cancel pending or paused messages');
  }
  await requireManager(current, userId);
  await dbRun(
    isPostgres()
      ? "UPDATE scheduled_messages SET status = 'cancelled', updated_at = NOW() WHERE id = $1"
      : "UPDATE scheduled_messages SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?",
    [id]
  );
  return { cancelled: true, id: Number(id) };
}
