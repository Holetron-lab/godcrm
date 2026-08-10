/**
 * Notion OAuth2 connector — ADR-0028 §3.1.
 *
 * Notion quirks:
 *  - Authorize URL requires `owner=user` query param.
 *  - Token endpoint uses HTTP Basic (base64(client_id:client_secret)).
 *  - We expose buildAuthorizeUrl/exchangeCode overrides for the route to call;
 *    the route falls back to generic OAuth2 logic if overrides are absent.
 */

import axios from 'axios';

const NOTION_API_VERSION = '2022-06-28';

const notion = {
  slug: 'notion',
  display_name: 'Notion',
  icon: '🗒️',
  auth_kind: 'oauth2',
  authorize_url: 'https://api.notion.com/v1/oauth/authorize',
  token_url: 'https://api.notion.com/v1/oauth/token',
  scopes_default: [],
  scopes_choices: [],
  client_env: { id: 'NOTION_CLIENT_ID', secret: 'NOTION_CLIENT_SECRET' },
  fields: [],
  refresh_supported: false,

  /**
   * Notion authorize URL needs `owner=user` and uses `redirect_uri`,
   * `client_id`, `state`, `response_type=code`. Returns a fully-formed URL.
   *
   * @param {{state: string, redirect_uri: string, client_id: string, scopes?: string[]}} params
   */
  buildAuthorizeUrl({ state, redirect_uri, client_id }) {
    const u = new URL(notion.authorize_url);
    u.searchParams.set('client_id', client_id);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('redirect_uri', redirect_uri);
    u.searchParams.set('state', state);
    u.searchParams.set('owner', 'user');
    return u.toString();
  },

  /**
   * Exchange code → token using Basic auth.
   * `env` is { client_id, client_secret } resolved by the route.
   */
  async exchangeCode({ code, redirect_uri, env }) {
    const basic = Buffer.from(`${env.client_id}:${env.client_secret}`).toString('base64');
    const { data } = await axios.post(
      notion.token_url,
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri,
      },
      {
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        timeout: 10_000,
      }
    );
    return data;
  },

  /**
   * Notion returns workspace_name and owner.user.person.email at exchange time.
   * Defensive optional chaining — Notion may return owner.workspace=true with no email.
   */
  async extractAccountInfo(tokenResponse) {
    const result = {};
    const wsName = tokenResponse?.workspace_name;
    const email = tokenResponse?.owner?.user?.person?.email;
    if (email) {
      result.account_label = email;
    } else if (wsName) {
      result.account_label = wsName;
    }
    return result;
  },

  async test(decrypted) {
    try {
      const access = decrypted?.access_token;
      if (!access) return { ok: false, error: 'no_access_token' };
      const res = await axios.get('https://api.notion.com/v1/users/me', {
        headers: {
          Authorization: `Bearer ${access}`,
          'Notion-Version': NOTION_API_VERSION,
        },
        timeout: 8000,
        validateStatus: () => true,
      });
      return res.status === 200 ? { ok: true } : { ok: false, error: `http_${res.status}` };
    } catch (err) {
      return { ok: false, error: err?.message || 'request_failed' };
    }
  },
};

export default notion;
