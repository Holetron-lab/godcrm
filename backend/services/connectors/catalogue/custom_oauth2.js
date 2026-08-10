/**
 * Custom OAuth2 connector — ADR-0028 §3.1.
 *
 * Universal escape hatch for any OAuth2 provider not in the branded catalogue.
 * Caller supplies authorize_url / token_url / client_id / scopes via
 * `custom_definition` (non-secret) and client_secret via the `fields.client_secret`
 * (encrypted into payload). The route uses `custom_definition` instead of
 * the static `authorize_url`/`token_url` properties below.
 */

const custom_oauth2 = {
  slug: 'custom_oauth2',
  display_name: 'Custom OAuth2',
  icon: '🔌',
  auth_kind: 'oauth2',
  // No baked-in authorize_url / token_url / client_env — caller supplies.
  scopes_default: [],
  scopes_choices: [],
  fields: [
    { key: 'client_id', label: 'Client ID', type: 'text', required: true },
    { key: 'client_secret', label: 'Client Secret', type: 'password', required: true },
    { key: 'authorize_url', label: 'Authorize URL', type: 'url', required: true },
    { key: 'token_url', label: 'Token URL', type: 'url', required: true },
    { key: 'scopes', label: 'Scopes (comma-separated)', type: 'scopes', required: false },
  ],
  refresh_supported: true,

  /**
   * Body shape:
   *   {
   *     custom_definition: { authorize_url, token_url, client_id, scopes? },
   *     fields: { client_secret }
   *   }
   *
   * Returns { ok, error? } — error is a user-facing string.
   */
  validateBody(body) {
    const cd = body?.custom_definition;
    if (!cd || typeof cd !== 'object') {
      return { ok: false, error: 'custom_definition is required for custom_oauth2' };
    }
    const required = ['client_id', 'authorize_url', 'token_url'];
    for (const k of required) {
      if (!cd[k] || typeof cd[k] !== 'string') {
        return { ok: false, error: `custom_definition.${k} is required` };
      }
    }
    try {
      // eslint-disable-next-line no-new
      new URL(cd.authorize_url);
      // eslint-disable-next-line no-new
      new URL(cd.token_url);
    } catch {
      return { ok: false, error: 'custom_definition.authorize_url and token_url must be valid URLs' };
    }
    const fields = body?.fields;
    if (!fields || !fields.client_secret || typeof fields.client_secret !== 'string') {
      return { ok: false, error: 'fields.client_secret is required for custom_oauth2' };
    }
    return { ok: true };
  },

  // No identity endpoint — caller can rename the row's display_name post-hoc.
  async extractAccountInfo() {
    return {};
  },

  // No generic test possible without a known provider endpoint.
  async test() {
    return { ok: true };
  },
};

export default custom_oauth2;
