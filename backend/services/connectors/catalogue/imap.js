/**
 * IMAP / SMTP connector — ADR-160 §1 (api_key kind).
 *
 * The only connector type that can attach a plain mailbox (postfix/dovecot,
 * e.g. `geratron@godcrm.ai`) — host/port/user/pass, no OAuth. All fields are
 * vault-encrypted by the generic api_key path in POST /connectors; nothing here
 * is secret-in-code.
 *
 * Identity is *synthesized*, not fetched: there is no UserInfo endpoint, so the
 * connect form sends `identity: { sub: lower(email), email, name }` alongside
 * `fields`, and `deriveIdentity` populates the switcher columns. `sub` is stable
 * (the lowercased login), dedup-safe under the (space, type, account_sub) UNIQUE.
 *
 * `imapflow` is imported lazily inside test() so the catalogue (loaded at server
 * boot) never depends on the package being installed.
 */

const DEFAULT_IMAP_PORT = 993;
const DEFAULT_SMTP_PORT = 587;

const imap = {
  slug: 'imap',
  display_name: 'IMAP / SMTP',
  icon: '📬',
  auth_kind: 'api_key',
  scopes_default: [],
  scopes_choices: [],
  fields: [
    { key: 'imap_host', label: 'IMAP host', type: 'text', required: true },
    { key: 'imap_port', label: 'IMAP port', type: 'number', required: false },
    { key: 'smtp_host', label: 'SMTP host', type: 'text', required: true },
    { key: 'smtp_port', label: 'SMTP port', type: 'number', required: false },
    { key: 'username', label: 'Username / e-mail', type: 'text', required: true },
    { key: 'password', label: 'Password', type: 'password', required: true },
    { key: 'use_tls', label: 'Use TLS', type: 'checkbox', required: false },
  ],
  refresh_supported: false,

  /**
   * Body shape (route passes `{ custom_definition, fields }`):
   *   fields: { imap_host, imap_port?, smtp_host, smtp_port?, username, password, use_tls? }
   * The generic api_key path vault-encrypts ALL of `fields` into encrypted_payload.
   */
  validateBody(body) {
    const f = body?.fields;
    if (!f || typeof f !== 'object') {
      return { ok: false, error: 'fields object is required for imap' };
    }
    for (const key of ['imap_host', 'smtp_host', 'username', 'password']) {
      if (!f[key] || typeof f[key] !== 'string' || !f[key].trim()) {
        return { ok: false, error: `fields.${key} is required for imap` };
      }
    }
    for (const key of ['imap_port', 'smtp_port']) {
      if (f[key] != null && f[key] !== '' && !Number.isFinite(Number(f[key]))) {
        return { ok: false, error: `fields.${key} must be a number` };
      }
    }
    return { ok: true };
  },

  async extractAccountInfo() {
    // No UserInfo endpoint — identity is synthesized client-side and arrives in
    // the request body's `identity` envelope, handled by deriveIdentity.
    return {};
  },

  /**
   * Open an IMAP session and LOGIN with the decrypted creds. Proves the mailbox
   * is reachable + the password is valid before the row is trusted for fetch.
   * @param {object} decrypted - vault-decrypted payload (the `fields` object)
   * @returns {Promise<{ok:boolean, error?:string}>}
   */
  async test(decrypted) {
    const host = decrypted?.imap_host;
    const username = decrypted?.username;
    const password = decrypted?.password;
    if (!host || !username || !password) {
      return { ok: false, error: 'missing imap_host/username/password' };
    }
    let ImapFlow;
    try {
      ({ ImapFlow } = await import('imapflow'));
    } catch {
      return { ok: false, error: 'imapflow_not_installed' };
    }
    const port = Number(decrypted.imap_port) || DEFAULT_IMAP_PORT;
    const secure = decrypted.use_tls != null ? !!decrypted.use_tls : port === 993;
    const client = new ImapFlow({
      host,
      port,
      secure,
      auth: { user: username, pass: password },
      logger: false,
      // Mailbox uses a self-signable cert in dev; honour use_tls but don't hard-fail TLS chain.
      tls: { rejectUnauthorized: false },
    });
    try {
      await client.connect();
      await client.logout();
      return { ok: true };
    } catch (err) {
      try { await client.close(); } catch { /* already closed */ }
      return { ok: false, error: err?.message || 'imap_connect_failed' };
    }
  },
};

export default imap;
