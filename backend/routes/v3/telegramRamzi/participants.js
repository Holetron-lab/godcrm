import crypto from 'node:crypto';
import { dbAll, dbGet, dbRun, withTransactionAsync } from '../../../database/connection.js';

function codeHash(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function hashesEqual(actual, expected) {
  const left = Buffer.from(String(actual || ''), 'hex');
  const right = Buffer.from(String(expected || ''), 'hex');
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

export async function getRamziParticipant(telegramUserId) {
  return dbGet(`
    SELECT telegram_user_id, label, role, status, invited_by, messages_day, messages_today, created_at, revoked_at
    FROM telegram_ramzi_participants WHERE telegram_user_id = $1
  `, [String(telegramUserId)]);
}

export async function ensureRamziOwnerParticipant(owner) {
  return withTransactionAsync(async (trx) => {
    await trx.run(`
      UPDATE telegram_ramzi_participants
      SET status = 'revoked', revoked_at = NOW()
      WHERE role = 'owner' AND telegram_user_id <> $1 AND status = 'active'
    `, [String(owner.telegram_user_id)]);
    await trx.run(`
      INSERT INTO telegram_ramzi_participants
        (telegram_user_id, label, role, status, invited_by, created_at)
      VALUES ($1, $2, 'owner', 'active', $3, NOW())
      ON CONFLICT (telegram_user_id) DO UPDATE SET
        label = EXCLUDED.label, role = 'owner', status = 'active', invited_by = EXCLUDED.invited_by, revoked_at = NULL
      RETURNING telegram_user_id AS id
    `, [String(owner.telegram_user_id), owner.name || 'Владелец', owner.id]);
    return {
      telegram_user_id: String(owner.telegram_user_id),
      label: owner.name || 'Владелец', role: 'owner', status: 'active',
    };
  });
}

export async function issueRamziInvite(label, createdBy) {
  const code = crypto.randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  const inserted = await dbRun(`
    INSERT INTO telegram_ramzi_invites (code_hash, label, created_by, expires_at, created_at)
    VALUES ($1, $2, $3, $4, NOW()) RETURNING id
  `, [codeHash(code), label, createdBy, expiresAt]);
  return { id: inserted.lastInsertRowid, code, expiresAt };
}

export async function consumeRamziInvite(code, telegramUserId, invitedBy) {
  return withTransactionAsync(async (trx) => {
    const invite = await trx.get(`
      SELECT id, code_hash, label, expires_at, used_by, used_at, revoked_at
      FROM telegram_ramzi_invites WHERE code_hash = $1 FOR UPDATE
    `, [codeHash(code)]);
    if (!invite || !hashesEqual(invite.code_hash, codeHash(code))) return null;
    if (Date.parse(invite.expires_at) <= Date.now() || invite.used_by !== null && invite.used_by !== undefined
      || invite.used_at || invite.revoked_at) return null;

    const existing = await trx.get(
      'SELECT telegram_user_id FROM telegram_ramzi_participants WHERE telegram_user_id = $1 FOR UPDATE',
      [String(telegramUserId)]
    );
    if (existing) return null;

    await trx.run(`
      INSERT INTO telegram_ramzi_participants
        (telegram_user_id, label, role, status, invited_by, created_at)
      VALUES ($1, $2, 'guest', 'active', $3, NOW())
      RETURNING telegram_user_id AS id
    `, [String(telegramUserId), invite.label, invitedBy]);
    await trx.run(`
      UPDATE telegram_ramzi_invites SET used_by = $1, used_at = NOW()
      WHERE id = $2 AND used_by IS NULL AND revoked_at IS NULL
    `, [String(telegramUserId), invite.id]);
    return {
      telegram_user_id: String(telegramUserId), label: invite.label, role: 'guest', status: 'active',
    };
  });
}

export async function listRamziInvites() {
  return dbAll(`
    SELECT id, label, created_by, created_at, expires_at, used_by, used_at, revoked_at
    FROM telegram_ramzi_invites ORDER BY id DESC
  `);
}

export async function revokeRamziInvite(id) {
  const invite = await dbGet('SELECT id, revoked_at, used_by FROM telegram_ramzi_invites WHERE id = $1', [id]);
  if (!invite || invite.revoked_at || invite.used_by !== null && invite.used_by !== undefined) return null;
  await dbRun('UPDATE telegram_ramzi_invites SET revoked_at = NOW() WHERE id = $1', [id]);
  return { id: invite.id };
}

export async function listRamziParticipants() {
  return dbAll(`
    SELECT telegram_user_id, label, role, status, invited_by, messages_day, messages_today, created_at, revoked_at
    FROM telegram_ramzi_participants ORDER BY created_at ASC, telegram_user_id ASC
  `);
}

export async function revokeRamziParticipant(telegramUserId) {
  const participant = await getRamziParticipant(telegramUserId);
  if (!participant) return {};
  if (participant.role === 'owner') return { error: 'OWNER_REQUIRED' };
  if (participant.status === 'revoked') return { participant };
  await dbRun(`
    UPDATE telegram_ramzi_participants SET status = 'revoked', revoked_at = NOW()
    WHERE telegram_user_id = $1 AND role = 'guest'
  `, [String(telegramUserId)]);
  return { participant: { ...participant, status: 'revoked' } };
}

export async function forgetRamziGuest(telegramUserId) {
  return withTransactionAsync(async (trx) => {
    const participant = await trx.get(`
      SELECT telegram_user_id, role, status FROM telegram_ramzi_participants
      WHERE telegram_user_id = $1 FOR UPDATE
    `, [String(telegramUserId)]);
    if (!participant || participant.role !== 'guest' || participant.status !== 'active') return false;
    await trx.run('DELETE FROM telegram_ramzi_profiles WHERE telegram_user_id = $1', [String(telegramUserId)]);
    await trx.run(`
      UPDATE telegram_ramzi_participants SET status = 'revoked', revoked_at = NOW()
      WHERE telegram_user_id = $1
    `, [String(telegramUserId)]);
    return true;
  });
}

export async function consumeRamziGuestDailyLimit(telegramUserId, options = {}) {
  const guestLimit = options.guestLimit ?? Number(process.env.RAMZI_GUEST_DAILY_LIMIT || 60);
  const totalLimit = options.totalLimit ?? Number(process.env.RAMZI_TOTAL_DAILY_LIMIT || 300);
  return withTransactionAsync(async (trx) => {
    await trx.get("SELECT pg_advisory_xact_lock(hashtext('telegram_ramzi_daily_limit'))");
    await trx.run(`
      UPDATE telegram_ramzi_participants SET messages_day = CURRENT_DATE, messages_today = 0
      WHERE messages_day IS DISTINCT FROM CURRENT_DATE
    `);
    const total = await trx.get(`
      SELECT COALESCE(SUM(messages_today), 0)::int AS count FROM telegram_ramzi_participants
      WHERE role = 'guest' AND status = 'active' AND messages_day = CURRENT_DATE
    `);
    if (total.count >= totalLimit) return false;

    const allowed = await trx.run(`
      UPDATE telegram_ramzi_participants
      SET messages_day = CURRENT_DATE, messages_today = messages_today + 1
      WHERE telegram_user_id = $1 AND role = 'guest' AND status = 'active'
        AND messages_day = CURRENT_DATE AND messages_today < $2
      RETURNING telegram_user_id
    `, [String(telegramUserId), guestLimit]);
    return allowed.changes === 1;
  });
}
