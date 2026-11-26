import { Router } from 'express';
import { z } from 'zod';
import { apiLogger } from '../../../utils/logger.js';
import { requireAuth } from '../auth/authShared.js';
import {
  RAMZI_OWNER_CRM_USER_ID,
  claimTelegramUpdate,
  createTelegramRamziService,
  getRamziBotToken,
  getRamziWebhookSecret,
  issueBindingCode,
  secretsEqual,
} from './service.js';
import {
  issueRamziInvite,
  listRamziInvites,
  listRamziParticipants,
  revokeRamziInvite,
  revokeRamziParticipant,
} from './participants.js';

const inviteSchema = z.object({
  label: z.string().trim().min(1).max(80),
});
const inviteIdSchema = z.coerce.number().int().positive();
const telegramUserIdSchema = z.string().regex(/^\d{1,20}$/);

const updateSchema = z.object({
  update_id: z.number().int().nonnegative(),
  message: z.object({
    message_id: z.number().int().nonnegative().optional(),
    from: z.object({ id: z.union([z.number(), z.string()]) }).passthrough(),
    chat: z.object({
      id: z.union([z.number(), z.string()]),
      type: z.string(),
    }).passthrough(),
    text: z.string().max(10_000).optional(),
  }).passthrough().optional(),
  callback_query: z.object({
    id: z.string().min(1).max(64),
    from: z.object({ id: z.union([z.number(), z.string()]) }).passthrough(),
    data: z.string().max(64),
    message: z.object({
      chat: z.object({
        id: z.union([z.number(), z.string()]),
        type: z.string(),
      }).passthrough(),
    }).passthrough(),
  }).passthrough().optional(),
}).passthrough();

function ownerOnly(req, res, next) {
  if (Number(req.user?.id) !== RAMZI_OWNER_CRM_USER_ID) {
    return res.status(403).json({ success: false, error: 'OWNER_REQUIRED' });
  }
  next();
}

async function telegramRequest(token, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: payload ? 'POST' : 'GET',
    headers: payload ? { 'Content-Type': 'application/json' } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.description || `Telegram ${method} failed`);
  return data.result;
}

export function createTelegramRamziRouter(options = {}) {
  const router = Router();
  const service = createTelegramRamziService(options);

  router.post('/webhook', async (req, res) => {
    try {
      const expectedSecret = await getRamziWebhookSecret();
      if (!expectedSecret) return res.status(503).json({ success: false, error: 'BOT_NOT_CONFIGURED' });
      if (!secretsEqual(req.get('x-telegram-bot-api-secret-token'), expectedSecret)) {
        return res.status(401).json({ success: false, error: 'INVALID_WEBHOOK_SECRET' });
      }

      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: 'INVALID_UPDATE' });
      }
      const update = parsed.data;
      if (!await claimTelegramUpdate(update.update_id)) {
        return res.status(200).json({ ok: true, duplicate: true });
      }

      res.status(200).json({ ok: true });
      service.handleUpdate(update).catch((err) => {
        apiLogger.error({ updateId: update.update_id, error: err.message, stack: err.stack }, '[RamziBot] Update processing failed');
      });
    } catch (err) {
      apiLogger.error({ error: err.message }, '[RamziBot] Webhook admission failed');
      if (!res.headersSent) res.status(503).json({ success: false, error: 'WEBHOOK_UNAVAILABLE' });
    }
  });

  router.post('/binding-code', requireAuth, ownerOnly, async (_req, res) => {
    try {
      const binding = await issueBindingCode();
      res.json({ success: true, data: { code: binding.code, expires_at: binding.expiresAt } });
    } catch (err) {
      apiLogger.error({ error: err.message }, '[RamziBot] Failed to issue binding code');
      res.status(500).json({ success: false, error: 'BINDING_CODE_FAILED' });
    }
  });

  router.post('/invites', requireAuth, ownerOnly, async (req, res) => {
    const parsed = inviteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: 'INVALID_INVITE' });
    try {
      const invite = await issueRamziInvite(parsed.data.label, RAMZI_OWNER_CRM_USER_ID);
      res.json({ success: true, data: { id: invite.id, code: invite.code, expires_at: invite.expiresAt } });
    } catch (err) {
      apiLogger.error({ error: err.message }, '[RamziBot] Failed to issue guest invite');
      res.status(500).json({ success: false, error: 'INVITE_FAILED' });
    }
  });

  router.get('/invites', requireAuth, ownerOnly, async (_req, res) => {
    try {
      res.json({ success: true, data: await listRamziInvites() });
    } catch (err) {
      apiLogger.error({ error: err.message }, '[RamziBot] Failed to list guest invites');
      res.status(500).json({ success: false, error: 'INVITES_FAILED' });
    }
  });

  router.delete('/invites/:id', requireAuth, ownerOnly, async (req, res) => {
    const parsed = inviteIdSchema.safeParse(req.params.id);
    if (!parsed.success) return res.status(400).json({ success: false, error: 'INVALID_INVITE' });
    try {
      const invite = await revokeRamziInvite(parsed.data);
      if (!invite) return res.status(404).json({ success: false, error: 'INVITE_NOT_AVAILABLE' });
      res.json({ success: true, data: invite });
    } catch (err) {
      apiLogger.error({ error: err.message }, '[RamziBot] Failed to revoke guest invite');
      res.status(500).json({ success: false, error: 'INVITE_REVOKE_FAILED' });
    }
  });

  router.get('/participants', requireAuth, ownerOnly, async (_req, res) => {
    try {
      res.json({ success: true, data: await listRamziParticipants() });
    } catch (err) {
      apiLogger.error({ error: err.message }, '[RamziBot] Failed to list participants');
      res.status(500).json({ success: false, error: 'PARTICIPANTS_FAILED' });
    }
  });

  router.post('/participants/:telegramUserId/revoke', requireAuth, ownerOnly, async (req, res) => {
    const parsed = telegramUserIdSchema.safeParse(req.params.telegramUserId);
    if (!parsed.success) return res.status(400).json({ success: false, error: 'INVALID_PARTICIPANT' });
    try {
      const result = await revokeRamziParticipant(parsed.data);
      if (result.error) return res.status(400).json({ success: false, error: result.error });
      if (!result.participant) return res.status(404).json({ success: false, error: 'PARTICIPANT_NOT_FOUND' });
      res.json({ success: true, data: result.participant });
    } catch (err) {
      apiLogger.error({ error: err.message }, '[RamziBot] Failed to revoke participant');
      res.status(500).json({ success: false, error: 'PARTICIPANT_REVOKE_FAILED' });
    }
  });

  router.post('/setup', requireAuth, ownerOnly, async (_req, res) => {
    try {
      const token = await getRamziBotToken(true);
      if (!token) return res.status(503).json({ success: false, error: 'BOT_NOT_CONFIGURED' });
      const bot = await telegramRequest(token, 'getMe');
      const baseUrl = (process.env.PUBLIC_URL || 'https://app.godcrm.ai').replace(/\/$/, '');
      const webhookUrl = `${baseUrl}/api/v3/telegram/ramzi/webhook`;
      const secretToken = await getRamziWebhookSecret();
      await telegramRequest(token, 'setWebhook', {
        url: webhookUrl,
        secret_token: secretToken,
        allowed_updates: ['message', 'callback_query'],
      });
      res.json({ success: true, data: { bot: bot.username, webhook_url: webhookUrl } });
    } catch (err) {
      apiLogger.error({ error: err.message }, '[RamziBot] Webhook setup failed');
      res.status(502).json({ success: false, error: 'WEBHOOK_SETUP_FAILED' });
    }
  });

  router.get('/info', requireAuth, ownerOnly, async (_req, res) => {
    try {
      const token = await getRamziBotToken();
      if (!token) return res.status(503).json({ success: false, error: 'BOT_NOT_CONFIGURED' });
      const [bot, webhook] = await Promise.all([
        telegramRequest(token, 'getMe'),
        telegramRequest(token, 'getWebhookInfo'),
      ]);
      res.json({ success: true, data: { bot: bot.username, webhook } });
    } catch (err) {
      apiLogger.error({ error: err.message }, '[RamziBot] Webhook info failed');
      res.status(502).json({ success: false, error: 'WEBHOOK_INFO_FAILED' });
    }
  });

  return router;
}

export default createTelegramRamziRouter();
