/**
 * Shared imap/smtp connector resolution for the mail module.
 *
 * Extracted from routes/v3/mail.js so the scheduled-send worker resolves and
 * decrypts a mailbox's creds through the exact same path the routes use —
 * one source of truth for the CredentialVault decrypt.
 */

import { dbGet } from '../../database/connection.js';
import credentialVault from '../connectors/CredentialVault.js';
import { apiLogger as log } from '../../utils/logger.js';

/**
 * Resolve an `imap` connector for the space and return its decrypted creds.
 * `connectorId` picks a specific mailbox (account switcher); otherwise the most
 * recent active imap connector is used. Returns null if none / decrypt fails.
 * @returns {Promise<null | { id:number, creds:object }>}
 */
export async function loadImapConnector(spaceId, connectorId) {
  const row = connectorId
    ? await dbGet(
        `SELECT id, encrypted_payload FROM space_connectors
          WHERE id = ? AND space_id = ? AND type_slug = 'imap' AND status <> 'revoked'`,
        [connectorId, spaceId]
      )
    : await dbGet(
        `SELECT id, encrypted_payload FROM space_connectors
          WHERE space_id = ? AND type_slug = 'imap' AND status = 'active'
          ORDER BY id DESC LIMIT 1`,
        [spaceId]
      );
  if (!row) return null;
  try {
    const payload =
      typeof row.encrypted_payload === 'string'
        ? JSON.parse(row.encrypted_payload)
        : row.encrypted_payload;
    const creds = credentialVault.decrypt(payload);
    return { id: row.id, creds };
  } catch (err) {
    log.error({ err, connectorId: row.id }, 'mail: imap connector decrypt failed');
    return null;
  }
}

export default { loadImapConnector };
