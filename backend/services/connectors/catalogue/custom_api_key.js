/**
 * Custom API-key connector — ADR-0028 §3.1.
 *
 * For services that auth via static header (Authorization: Bearer X-API-Key, etc.).
 * `api_key` goes encrypted, `header_name` / `header_format` go in custom_definition.
 *
 * `header_format` is a template containing `{key}` which the consumer replaces
 * with the decrypted api_key at call time. Default = `Bearer {key}` for compat
 * with most APIs.
 */

const custom_api_key = {
  slug: 'custom_api_key',
  display_name: 'Custom API Key',
  icon: '🔑',
  auth_kind: 'api_key',
  scopes_default: [],
  scopes_choices: [],
  fields: [
    { key: 'api_key', label: 'API Key', type: 'password', required: true },
    { key: 'header_name', label: 'Header name', type: 'text', required: false },
    { key: 'header_format', label: 'Header value template (use {key})', type: 'text', required: false },
  ],
  refresh_supported: false,

  /**
   * Body shape:
   *   {
   *     fields: { api_key, header_name?, header_format? },
   *     custom_definition?: { header_name?, header_format? }   // populated by route
   *   }
   *
   * The route is responsible for splitting fields into encrypted_payload (api_key)
   * vs custom_definition (header_name, header_format). This validator only checks
   * that api_key is supplied and custom_definition exists.
   */
  validateBody(body) {
    const fields = body?.fields;
    if (!fields || !fields.api_key || typeof fields.api_key !== 'string') {
      return { ok: false, error: 'fields.api_key is required for custom_api_key' };
    }
    return { ok: true };
  },

  async extractAccountInfo() {
    return {};
  },

  async test() {
    // Cannot test generically — caller could add `test_url` field in Phase 5.
    return { ok: true };
  },
};

export default custom_api_key;
