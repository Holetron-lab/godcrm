/**
 * Connector Type catalogue — ADR-0028 §3.1.
 *
 * Static registry. Explicit imports (no auto-glob — over-engineering for 4 modules).
 * Add new branded providers here as separate files + add to the Map below.
 *
 * @typedef {Object} ConnectorType
 * @property {string} slug
 * @property {string} display_name
 * @property {string} icon
 * @property {'oauth2'|'api_key'} auth_kind
 * @property {string} [authorize_url]                  - oauth2 branded only
 * @property {string} [token_url]                      - oauth2 branded only
 * @property {string[]} scopes_default
 * @property {{label:string, value:string}[]} [scopes_choices]
 * @property {{id:string, secret:string}} [client_env] - env var names for branded oauth2
 * @property {{key:string, label:string, type:string, required:boolean}[]} fields
 * @property {boolean} refresh_supported
 * @property {(body:object) => {ok:boolean, error?:string}} [validateBody]
 * @property {(params:object) => string} [buildAuthorizeUrl]   - override generic OAuth2 URL builder
 * @property {(args:{code:string, redirect_uri:string, env:object}) => Promise<object>} [exchangeCode]
 * @property {(tokenResponse:object) => Promise<{account_label?:string, scopes_granted?:string[]}>} [extractAccountInfo]
 * @property {(decrypted:object) => Promise<{ok:boolean, error?:string}>} [test]
 * @property {(decrypted:object, oauthEnv?:object) => Promise<{ok:boolean, error?:string}>} [revoke]
 */

import figma from './figma.js';
import notion from './notion.js';
import google from './google.js';
import slack from './slack.js';
import github from './github.js';
import imap from './imap.js';
import custom_oauth2 from './custom_oauth2.js';
import custom_api_key from './custom_api_key.js';

/** @type {Map<string, ConnectorType>} */
const CATALOGUE = new Map([
  [figma.slug, figma],
  [notion.slug, notion],
  [google.slug, google],
  [slack.slug, slack],
  [github.slug, github],
  [imap.slug, imap],
  [custom_oauth2.slug, custom_oauth2],
  [custom_api_key.slug, custom_api_key],
]);

/**
 * Look up a connector type by slug. Returns null if unknown.
 * @param {string} slug
 * @returns {ConnectorType|null}
 */
export function getConnectorType(slug) {
  if (typeof slug !== 'string') return null;
  return CATALOGUE.get(slug) || null;
}

/**
 * List all connector types (for UI catalogue / health checks).
 * Strips runtime-only function refs to keep the response JSON-safe.
 * @returns {Array<object>}
 */
export function listConnectorTypes() {
  return Array.from(CATALOGUE.values()).map((t) => ({
    slug: t.slug,
    display_name: t.display_name,
    icon: t.icon,
    auth_kind: t.auth_kind,
    authorize_url: t.authorize_url || null,
    token_url: t.token_url || null,
    scopes_default: t.scopes_default,
    scopes_choices: t.scopes_choices || [],
    client_env: t.client_env || null,
    fields: t.fields,
    refresh_supported: !!t.refresh_supported,
  }));
}

/**
 * Per-type body validation hook. Routes call this on /start and POST /connectors.
 * Returns { ok: true } when the type doesn't define a validator.
 *
 * @param {string} slug
 * @param {object} body
 * @returns {{ok:boolean, error?:string}}
 */
export function validateConnectorTypeBody(slug, body) {
  const type = getConnectorType(slug);
  if (!type) return { ok: false, error: `Unknown connector type: ${slug}` };
  if (typeof type.validateBody !== 'function') return { ok: true };
  try {
    const r = type.validateBody(body);
    if (!r || typeof r !== 'object') return { ok: false, error: 'validator returned non-object' };
    return r;
  } catch (err) {
    return { ok: false, error: err?.message || 'validator threw' };
  }
}
