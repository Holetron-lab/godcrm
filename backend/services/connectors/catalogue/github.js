/**
 * GitHub OAuth2 connector — ADR-0028 §3.1.
 *
 * Standard GitHub OAuth Apps (NOT GitHub Apps). Tokens never expire by default
 * — `refresh_supported: false`. (GitHub Apps with user-to-server tokens DO
 * support refresh; that's a separate connector type for a future phase.)
 *
 * Authorize: https://github.com/login/oauth/authorize
 * Token:     https://github.com/login/oauth/access_token (returns form-encoded
 *            unless Accept: application/json is sent)
 * Identity:  GET https://api.github.com/user  (Bearer)
 * Revoke:    DELETE https://api.github.com/applications/{client_id}/grant
 *            (Basic auth: client_id:client_secret + body { access_token })
 */

import axios from 'axios';

const github = {
  slug: 'github',
  display_name: 'GitHub',
  icon: '🐙',
  auth_kind: 'oauth2',
  authorize_url: 'https://github.com/login/oauth/authorize',
  token_url: 'https://github.com/login/oauth/access_token',
  scopes_default: ['read:user'],
  scopes_choices: [
    { label: 'Read user profile (read:user)', value: 'read:user' },
    { label: 'User email (user:email)', value: 'user:email' },
    { label: 'Public repos (public_repo)', value: 'public_repo' },
    { label: 'All repos (repo)', value: 'repo' },
    { label: 'Read org (read:org)', value: 'read:org' },
    { label: 'Workflow (workflow)', value: 'workflow' },
  ],
  client_env: { id: 'GITHUB_CLIENT_ID', secret: 'GITHUB_CLIENT_SECRET' },
  fields: [],
  refresh_supported: false,

  buildAuthorizeUrl({ state, redirect_uri, client_id, scopes }) {
    const u = new URL(github.authorize_url);
    u.searchParams.set('client_id', client_id);
    u.searchParams.set('redirect_uri', redirect_uri);
    u.searchParams.set('state', state);
    if (Array.isArray(scopes) && scopes.length) {
      // GitHub uses space-separated scopes.
      u.searchParams.set('scope', scopes.join(' '));
    }
    return u.toString();
  },

  /**
   * GitHub returns `application/x-www-form-urlencoded` by default.
   * Forcing `Accept: application/json` for clean parsing.
   */
  async exchangeCode({ code, redirect_uri, env }) {
    const { data } = await axios.post(
      github.token_url,
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
    if (data?.error) {
      const err = new Error(`github_oauth_error:${data.error}`);
      err.response = { status: 400, data };
      throw err;
    }
    return data;
  },

  async extractAccountInfo(tokenResponse) {
    try {
      const access = tokenResponse?.access_token;
      if (!access) return {};
      const { data } = await axios.get('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${access}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'godcrm-connectors',
        },
        timeout: 8000,
      });
      const result = {};
      if (data?.login) {
        result.account_label = data.email ? `${data.login} <${data.email}>` : data.login;
      }
      return result;
    } catch {
      return {};
    }
  },

  async test(decrypted) {
    try {
      const access = decrypted?.access_token;
      if (!access) return { ok: false, error: 'no_access_token' };
      const res = await axios.get('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${access}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'godcrm-connectors',
        },
        timeout: 8000,
        validateStatus: () => true,
      });
      return res.status === 200 ? { ok: true } : { ok: false, error: `http_${res.status}` };
    } catch (err) {
      return { ok: false, error: err?.message || 'request_failed' };
    }
  },

  /**
   * Revoke requires Basic auth with client_id:client_secret. The route passes
   * the resolved oauthEnv as second arg so we can build the header.
   */
  async revoke(decrypted, oauthEnv) {
    try {
      const access = decrypted?.access_token;
      const id = oauthEnv?.client_id;
      const secret = oauthEnv?.client_secret;
      if (!access || !id || !secret) return { ok: false, error: 'missing_creds' };
      const basic = Buffer.from(`${id}:${secret}`).toString('base64');
      const res = await axios.delete(
        `https://api.github.com/applications/${id}/grant`,
        {
          headers: {
            Authorization: `Basic ${basic}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'godcrm-connectors',
          },
          data: { access_token: access },
          timeout: 8000,
          validateStatus: () => true,
        }
      );
      return res.status === 204 ? { ok: true } : { ok: false, error: `http_${res.status}` };
    } catch (err) {
      return { ok: false, error: err?.message || 'request_failed' };
    }
  },
};

export default github;
