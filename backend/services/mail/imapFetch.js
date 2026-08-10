/**
 * IMAP fetch — ADR-160 (the bridge slice for the Mail module).
 *
 * Pulls the newest N messages of a logical folder from an IMAP mailbox and
 * normalizes them to the `mail_messages` row shape (mig 075). The route upserts
 * the returned rows; this module owns *only* the network + parse, no DB.
 *
 * Creds are the vault-decrypted `imap` connector payload (catalogue/imap.js):
 *   { imap_host, imap_port?, username, password, use_tls? }
 *
 * imapflow + mailparser are imported lazily so the rest of the mail route (e.g.
 * sending, which only needs nodemailer) keeps working on a host where the IMAP
 * deps aren't installed yet — the failure is contained to a sync call.
 */

// Logical folder id (frontend MailFolderId) → IMAP special-use flag. We resolve
// the actual mailbox path from the server's LIST so dovecot's `Sent` vs
// `INBOX.Sent` naming doesn't matter. INBOX has no special-use flag — it's named.
const SPECIAL_USE = {
  sent: '\\Sent',
  drafts: '\\Drafts',
  archive: '\\Archive',
  trash: '\\Trash',
};

function firstAddress(list) {
  const a = Array.isArray(list) && list.length ? list[0] : null;
  return { name: a?.name || null, address: a?.address || null };
}

function toPreview(text, html) {
  const src = (text || '').trim() || stripHtml(html || '');
  return src.replace(/\s+/g, ' ').slice(0, 140);
}

function stripHtml(html) {
  return String(html).replace(/<[^>]+>/g, ' ');
}

/**
 * Resolve a logical folder id to a concrete IMAP mailbox path.
 * @returns {Promise<string>} mailbox path (defaults to 'INBOX')
 */
async function resolveMailbox(client, folder) {
  if (!folder || folder === 'inbox') return 'INBOX';
  const flag = SPECIAL_USE[folder];
  if (!flag) return 'INBOX';
  try {
    const boxes = await client.list();
    const hit = boxes.find((b) => b.specialUse === flag);
    return hit ? hit.path : 'INBOX';
  } catch {
    return 'INBOX';
  }
}

/**
 * Fetch + normalize the newest messages of a folder.
 *
 * @param {object}  args
 * @param {object}  args.creds   decrypted imap connector fields
 * @param {string} [args.folder='inbox']
 * @param {number} [args.limit=50]
 * @returns {Promise<Array<object>>} normalized mail_messages rows (no DB ids)
 */
export async function imapFetch({ creds, folder = 'inbox', limit = 50 }) {
  if (!creds?.imap_host || !creds?.username || !creds?.password) {
    throw new Error('imap creds incomplete: imap_host, username, password required');
  }
  const { ImapFlow } = await import('imapflow');
  const { simpleParser } = await import('mailparser');

  const port = Number(creds.imap_port) || 993;
  const secure = creds.use_tls != null ? !!creds.use_tls : port === 993;
  const client = new ImapFlow({
    host: creds.imap_host,
    port,
    secure,
    auth: { user: creds.username, pass: creds.password },
    logger: false,
    tls: { rejectUnauthorized: false },
  });

  const rows = [];
  await client.connect();
  try {
    const mailbox = await resolveMailbox(client, folder);
    const status = await client.mailboxOpen(mailbox);
    const exists = status.exists || 0;
    if (exists === 0) return rows;

    // Newest N by sequence number; ask for the parsed envelope, flags and the
    // raw source so mailparser can extract body/preview in one pass.
    const start = Math.max(1, exists - Math.max(1, limit) + 1);
    for await (const msg of client.fetch(`${start}:*`, {
      uid: true,
      envelope: true,
      flags: true,
      source: true,
    })) {
      const parsed = await simpleParser(msg.source).catch(() => ({}));
      const env = msg.envelope || {};
      const from = firstAddress(env.from);
      const text = parsed.text || null;
      const html = parsed.html || null;
      rows.push({
        imap_uid: msg.uid,
        message_id: env.messageId || parsed.messageId || null,
        from_name: from.name,
        from_address: from.address,
        to_addresses: (env.to || []).map((a) => a.address).filter(Boolean),
        subject: env.subject || parsed.subject || null,
        preview: toPreview(text, html),
        body_text: text,
        body_html: html || null,
        date: env.date || parsed.date || null,
        is_read: msg.flags ? msg.flags.has('\\Seen') : false,
      });
    }
  } finally {
    try { await client.logout(); } catch { /* best-effort */ }
  }

  // Newest first for the UI.
  rows.sort((a, b) => (new Date(b.date || 0)) - (new Date(a.date || 0)));
  return rows;
}

export default { imapFetch };
