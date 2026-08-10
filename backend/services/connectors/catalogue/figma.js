/**
 * Figma OAuth2 connector — ADR-0028 §3.1.
 *
 * Authorize: https://www.figma.com/oauth
 * Token:     https://api.figma.com/v1/oauth/token
 * Identity:  GET https://api.figma.com/v1/me  (Bearer)
 */

import axios from 'axios';

const figma = {
  slug: 'figma',
  display_name: 'Figma',
  icon: '🎨',
  auth_kind: 'oauth2',
  authorize_url: 'https://www.figma.com/oauth',
  token_url: 'https://api.figma.com/v1/oauth/token',
  scopes_default: ['file_read'],
  scopes_choices: [{ label: 'Read files', value: 'file_read' }],
  client_env: { id: 'FIGMA_CLIENT_ID', secret: 'FIGMA_CLIENT_SECRET' },
  fields: [],
  refresh_supported: true,

  /**
   * Pull account_label from Figma identity API.
   * Defensive — never throws; returns {} on failure.
   */
  async extractAccountInfo(tokenResponse) {
    try {
      const access = tokenResponse?.access_token;
      if (!access) return {};
      const { data } = await axios.get('https://api.figma.com/v1/me', {
        headers: { Authorization: `Bearer ${access}` },
        timeout: 8000,
      });
      const result = {};
      if (data?.email) result.account_label = data.email;
      return result;
    } catch {
      return {};
    }
  },

  /**
   * Connectivity test. Decrypted payload carries access_token.
   */
  async test(decrypted) {
    try {
      const access = decrypted?.access_token;
      if (!access) return { ok: false, error: 'no_access_token' };
      const res = await axios.get('https://api.figma.com/v1/me', {
        headers: { Authorization: `Bearer ${access}` },
        timeout: 8000,
        validateStatus: () => true,
      });
      return res.status === 200 ? { ok: true } : { ok: false, error: `http_${res.status}` };
    } catch (err) {
      return { ok: false, error: err?.message || 'request_failed' };
    }
  },
};

export default figma;
