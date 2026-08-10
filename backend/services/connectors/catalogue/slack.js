/**
 * Slack OAuth2 connector — ADR-0028 §3.1.
 *
 * Slack v2 OAuth: workspace-level install. The token response carries
 * `team` and `authed_user` blocks; we use `team.name` as account_label.
 *
 * Slack does NOT issue refresh_tokens by default for non-rotation apps —
 * `refresh_supported: false` so the refresh job skips this type. Re-connect
 * is the renewal path. Apps with token rotation enabled return `refresh_token`
 * + `expires_in` and refresh_supported can be flipped per-row later.
 *
 * Authorize: https://slack.com/oauth/v2/authorize
 * Token:     https://slack.com/api/oauth.v2.access
 * Revoke:    POST https://slack.com/api/auth.revoke (Bearer)
 */

import axios from 'axios';

const slack = {
  slug: 'slack',
  display_name: 'Slack',
  icon: '💬',
  auth_kind: 'oauth2',
  authorize_url: 'https://slack.com/oauth/v2/authorize',
  token_url: 'https://slack.com/api/oauth.v2.access',
  scopes_default: ['chat:write', 'channels:read'],
  scopes_choices: [
    { label: 'Send messages (chat:write)', value: 'chat:write' },
    { label: 'Read channels (channels:read)', value: 'channels:read' },
    { label: 'Read messages (channels:history)', value: 'channels:history' },
    { label: 'Read users (users:read)', value: 'users:read' },
    { label: 'Read user emails (users:read.email)', value: 'users:read.email' },
    { label: 'Upload files (files:write)', value: 'files:write' },
  ],
  client_env: { id: 'SLACK_CLIENT_ID', secret: 'SLACK_CLIENT_SECRET' },
  fields: [],
  refresh_supported: false,

  buildAuthorizeUrl({ state, redirect_uri, client_id, scopes }) {
    const u = new URL(slack.authorize_url);
    u.searchParams.set('client_id', client_id);
    u.searchParams.set('redirect_uri', redirect_uri);
    u.searchParams.set('state', state);
    if (Array.isArray(scopes) && scopes.length) {
      // Slack uses comma-separated scopes (NOT space-separated) on `scope=`.
      u.searchParams.set('scope', scopes.join(','));
    }
    return u.toString();
  },

  /**
   * Slack's `oauth.v2.access` returns `{ ok: true, access_token, team: {...},
   * authed_user: {...}, scope, ... }` on success, or `{ ok: false, error }`
   * with HTTP 200 on failure. We normalize so the route's error handler trips
   * on `!access_token`.
   */
  async exchangeCode({ code, redirect_uri, env }) {
    const { data } = await axios.post(
      slack.token_url,
      new URLSearchParams({
        client_id: env.client_id,
        client_secret: env.client_secret,
        code,
        redirect_uri,
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        timeout: 10_000,
      }
    );
    if (!data?.ok) {
      const err = new Error(`slack_oauth_error:${data?.error || 'unknown'}`);
      err.response = { status: 400, data };
      throw err;
    }
    return data;
  },

  async extractAccountInfo(tokenResponse) {
    const result = {};
    const teamName = tokenResponse?.team?.name;
    const userId = tokenResponse?.authed_user?.id;
    if (teamName && userId) {
      result.account_label = `${teamName} · ${userId}`;
    } else if (teamName) {
      result.account_label = teamName;
    }
    if (typeof tokenResponse?.scope === 'string') {
      result.scopes_granted = tokenResponse.scope.split(',').filter(Boolean);
    }
    return result;
  },

  async test(decrypted) {
    try {
      const access = decrypted?.access_token;
      if (!access) return { ok: false, error: 'no_access_token' };
      const { data } = await axios.post(
        'https://slack.com/api/auth.test',
        null,
        {
          headers: { Authorization: `Bearer ${access}` },
          timeout: 8000,
          validateStatus: () => true,
        }
      );
      return data?.ok ? { ok: true } : { ok: false, error: data?.error || 'auth_test_failed' };
    } catch (err) {
      return { ok: false, error: err?.message || 'request_failed' };
    }
  },

  async revoke(decrypted) {
    try {
      const access = decrypted?.access_token;
      if (!access) return { ok: false, error: 'no_token' };
      const { data } = await axios.post(
        'https://slack.com/api/auth.revoke',
        null,
        {
          headers: { Authorization: `Bearer ${access}` },
          timeout: 8000,
          validateStatus: () => true,
        }
      );
      return data?.ok ? { ok: true } : { ok: false, error: data?.error || 'revoke_failed' };
    } catch (err) {
      return { ok: false, error: err?.message || 'request_failed' };
    }
  },
};

export default slack;
