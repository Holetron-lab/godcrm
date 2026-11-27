import axios from 'axios';
import { z } from 'zod';

const fieldsSchema = z.object({
  access_token: z.string().trim().min(1).max(256),
  default_chat_id: z.union([z.string().trim().min(1).max(256), z.number().int()]).optional(),
}).strict();

const botSchema = z.object({
  id: z.number().int(),
  first_name: z.string(),
  username: z.string().optional(),
}).passthrough();

const telegram = {
  slug: 'telegram',
  display_name: 'Telegram Bot',
  icon: '✈️',
  auth_kind: 'api_key',
  scopes_default: [],
  scopes_choices: [],
  fields: [
    { key: 'access_token', label: 'Bot token (from @BotFather)', type: 'password', required: true },
    { key: 'default_chat_id', label: 'Default chat ID or @channel (optional)', type: 'text', required: false },
  ],
  refresh_supported: false,

  validateBody(body) {
    const parsed = fieldsSchema.safeParse(body?.fields);
    return parsed.success
      ? { ok: true }
      : { ok: false, error: 'Provide a Telegram bot token; default_chat_id must be a non-empty chat ID or @channel username.' };
  },

  async test(decrypted) {
    const accessToken = decrypted?.access_token?.trim();
    if (!accessToken) return { ok: false, error: 'no_access_token' };
    try {
      const { data } = await axios.post(`https://api.telegram.org/bot${accessToken}/getMe`, {}, {
        timeout: 10_000,
        validateStatus: () => true,
      });
      if (!data?.ok) return { ok: false, error: data?.description || 'telegram_getMe_failed' };
      const parsed = botSchema.safeParse(data.result);
      if (!parsed.success) return { ok: false, error: 'telegram_invalid_response' };
      return {
        ok: true,
        account_label: parsed.data.username ? `@${parsed.data.username}` : parsed.data.first_name,
      };
    } catch {
      return { ok: false, error: 'telegram_request_failed' };
    }
  },
};

export default telegram;
