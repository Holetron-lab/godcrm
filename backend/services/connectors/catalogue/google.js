/**
 * Google OAuth2 connector — ADR-0028 §3.1.
 *
 * Single Google OAuth app covers Drive + Calendar + Gmail (merged scopes per
 * ADR-0028 §2.1 — fork #3). User picks the subset they need at connect time.
 *
 * Authorize: https://accounts.google.com/o/oauth2/v2/auth
 * Token:     https://oauth2.googleapis.com/token
 * Identity:  GET https://openidconnect.googleapis.com/v1/userinfo  (Bearer)
 * Revoke:    POST https://oauth2.googleapis.com/revoke
 *
 * Refresh requires `access_type=offline` + `prompt=consent` on first authorize
 * — Google only returns refresh_token then.
 */

import axios from 'axios';

const google = {
  slug: 'google',
  display_name: 'Google',
  icon: '🔵',
  auth_kind: 'oauth2',
  authorize_url: 'https://accounts.google.com/o/oauth2/v2/auth',
  token_url: 'https://oauth2.googleapis.com/token',
  scopes_default: [
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/drive.readonly',
  ],
  scopes_choices: [
    { label: 'OpenID', value: 'openid' },
    { label: 'Email', value: 'email' },
    { label: 'Profile', value: 'profile' },
    { label: 'Drive (read-only)', value: 'https://www.googleapis.com/auth/drive.readonly' },
    { label: 'Drive (full)', value: 'https://www.googleapis.com/auth/drive' },
    { label: 'Calendar (read-only)', value: 'https://www.googleapis.com/auth/calendar.readonly' },
    { label: 'Calendar (events)', value: 'https://www.googleapis.com/auth/calendar.events' },
    { label: 'Gmail (read-only)', value: 'https://www.googleapis.com/auth/gmail.readonly' },
    { label: 'Gmail (send)', value: 'https://www.googleapis.com/auth/gmail.send' },
  ],
  client_env: { id: 'GOOGLE_CLIENT_ID', secret: 'GOOGLE_CLIENT_SECRET' },
  fields: [],
  refresh_supported: true,

  buildAuthorizeUrl({ state, redirect_uri, client_id, scopes }) {
    const u = new URL(google.authorize_url);
    u.searchParams.set('client_id', client_id);
    u.searchParams.set('redirect_uri', redirect_uri);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('state', state);
    u.searchParams.set('access_type', 'offline');
    u.searchParams.set('prompt', 'consent');
    u.searchParams.set('include_granted_scopes', 'true');
    if (Array.isArray(scopes) && scopes.length) {
      u.searchParams.set('scope', scopes.join(' '));
    }
    return u.toString();
  },

  async extractAccountInfo(tokenResponse) {
    try {
      const access = tokenResponse?.access_token;
      if (!access) return {};
      const { data } = await axios.get(
        'https://openidconnect.googleapis.com/v1/userinfo',
        {
          headers: { Authorization: `Bearer ${access}` },
          timeout: 8000,
        }
      );
      const result = {};
      if (data?.email) result.account_label = data.email;
      // OIDC identity block (ADR-159 §Schema). Google is the canonical shape:
      // sub/email/name/picture map 1:1 to the identity columns; the full
      // UserInfo payload rides verbatim in `profile` for future claim promotion.
      if (data?.sub) {
        result.identity = {
          sub: String(data.sub),
          email: data.email || null,
          name: data.name || null,
          picture: data.picture || null,
          profile: data,
        };
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
      const res = await axios.get(
        'https://openidconnect.googleapis.com/v1/userinfo',
        {
          headers: { Authorization: `Bearer ${access}` },
          timeout: 8000,
          validateStatus: () => true,
        }
      );
      return res.status === 200 ? { ok: true } : { ok: false, error: `http_${res.status}` };
    } catch (err) {
      return { ok: false, error: err?.message || 'request_failed' };
    }
  },

  async revoke(decrypted) {
    try {
      const tok = decrypted?.refresh_token || decrypted?.access_token;
      if (!tok) return { ok: false, error: 'no_token' };
      const res = await axios.post(
        'https://oauth2.googleapis.com/revoke',
        new URLSearchParams({ token: tok }).toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 8000,
          validateStatus: () => true,
        }
      );
      return res.status === 200 ? { ok: true } : { ok: false, error: `http_${res.status}` };
    } catch (err) {
      return { ok: false, error: err?.message || 'request_failed' };
    }
  },
};

export default google;
