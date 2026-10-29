import { z } from 'zod';
import { midjourneySettings, requestMidjourney } from '../midjourney.js';

const midjourney = {
  slug: 'midjourney',
  display_name: 'Midjourney Relay',
  icon: '⛵',
  auth_kind: 'api_key',
  scopes_default: [],
  scopes_choices: [],
  fields: [
    { key: 'url', label: 'Relay API URL (https://relay.example.com/mj)', type: 'url', required: true },
    // The existing connector executor injects access_token server-side.
    { key: 'access_token', label: 'Relay API secret (mj-api-secret)', type: 'password', required: true },
  ],
  refresh_supported: false,
  validateBody(body) {
    return midjourneySettings.safeParse(body?.fields).success
      ? { ok: true }
      : { ok: false, error: 'Provide a public HTTPS relay API URL and mj-api-secret. Discord credentials belong on the relay.' };
  },
  async test(settings) {
    try {
      await requestMidjourney(settings, '/task/queue', z.array(z.object({ id: z.string(), status: z.string() })));
      return { ok: true };
    } catch {
      return { ok: false, error_code: 'relay', error: 'Could not verify the Midjourney relay API. Check its URL and API secret.' };
    }
  },
};

export default midjourney;
