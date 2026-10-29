import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { mkdir, lstat, open } from 'node:fs/promises';
import { z } from 'zod';
import { withTransactionAsync } from '../../database/connection.js';
import vault from '../secrets/SecretsVault.js';

export const penpotActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('inspect') }).strict(),
  ...['rotate', 'disable', 'enable'].map((action) => z.object({ action: z.literal(action),
    request_id: z.string().uuid(), expected_revision: z.string().regex(/^[a-f0-9]{64}$/) }).strict()),
]);
const input = z.object({ actor: z.number().int().positive(), data: penpotActionSchema }).strict();
const CALLBACK = 'https://design.godcrm.ai/api/auth/oidc/callback';
const BACKUPS = '/root/backups/temp/oidc-penpot';
const REF = /^oidc_penpot_[a-f0-9]{32}$/;
const columns = {
  oidc_clients: { id: 'integer', client_id: 'text', client_secret: 'text', secret_ref: 'text',
    redirect_uris: 'text', allowed_scopes: 'text', is_active: 'integer', token_endpoint_auth_method: 'text',
    updated_at: 'timestamp without time zone' },
  _secrets: { key: 'text', encrypted_payload: 'jsonb', description: 'text', created_by: 'integer',
    space_id: 'integer', created_at: 'timestamp with time zone', updated_at: 'timestamp with time zone' },
  audit_log: { user_id: 'integer', action: 'text', entity_type: 'text', entity_id: 'text', details: 'text' },
};

/** Fixed master-A client; registry, vault and idempotency receipt commit together. */
export async function changePenpotClient(raw) {
  const { actor: rawActor, ...data } = raw;
  const { actor, data: { action, request_id, expected_revision } } = input.parse({ actor: rawActor, data });
  if (!Object.values(networkInterfaces()).flat().some((entry) => entry?.address === '<PROD_IP>')) {
    throw new Error('WRONG_MASTER');
  }
  return withTransactionAsync(async (trx) => {
    const target = await trx.get('SELECT current_database() AS database, inet_server_addr()::text AS address');
    if (target.database !== 'godcrm_prod' || !['127.0.0.1/32', '::1/128', '<PROD_IP>/32'].includes(target.address)) {
      throw new Error('WRONG_DATABASE');
    }
    await trx.run("SET LOCAL lock_timeout = '3s'");
    const owner = await trx.get('SELECT owner_id FROM public.spaces WHERE id = $1 FOR SHARE', [11]);
    if (owner?.owner_id !== actor) throw new Error('OWNER_REQUIRED');
    // There is no unique client_id constraint. Match Forgejo's lock order.
    await trx.run('LOCK TABLE public.oidc_clients, public._secrets IN SHARE ROW EXCLUSIVE MODE');
    const schema = await trx.all(`SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY($1::text[])`, [Object.keys(columns)]);
    for (const [table, fields] of Object.entries(columns)) {
      for (const [name, type] of Object.entries(fields)) {
        if (!schema.some((col) => col.table_name === table && col.column_name === name && col.data_type === type)) {
          throw new Error('SCHEMA_MISMATCH');
        }
      }
      // Only vault/audit INSERTs need every required field; the client is updated in place.
      if (table !== 'oidc_clients' && schema.some((col) => col.table_name === table && col.is_nullable === 'NO'
        && col.column_default == null && !(col.column_name in fields))) throw new Error('SCHEMA_REQUIRED_COLUMN');
    }
    if (schema.some((col) => col.table_name === 'oidc_clients' && col.column_name === 'client_secret'
      && col.is_nullable !== 'YES')) throw new Error('SCHEMA_MISMATCH');

    const rows = await trx.all(`SELECT * FROM public.oidc_clients WHERE client_id = $1
      OR starts_with(secret_ref, $2) OR secret_ref IN (SELECT secret_ref FROM public.oidc_clients WHERE client_id = $1)`,
    ['penpot', 'oidc_penpot_']);
    if (!rows.length) throw new Error('CLIENT_NOT_FOUND');
    const current = rows[0];
    if (rows.length !== 1 || current.client_id !== 'penpot' || ![0, 1].includes(current.is_active)
      || !['client_secret_post', 'client_secret_basic'].includes(current.token_endpoint_auth_method)
      || (current.secret_ref && !REF.test(current.secret_ref))) throw new Error('CLIENT_CONFLICT');
    let callbacks, scopes;
    try {
      callbacks = z.array(z.string().url()).parse(JSON.parse(current.redirect_uris));
      scopes = z.array(z.string()).parse(JSON.parse(current.allowed_scopes));
    } catch { throw new Error('CLIENT_CONFLICT'); }
    if (!callbacks.includes(CALLBACK)) throw new Error('CLIENT_CONFLICT');
    const nextRef = request_id ? `oidc_penpot_${request_id.replaceAll('-', '').toLowerCase()}` : null;
    const secrets = await trx.all('SELECT * FROM public._secrets WHERE key = ANY($1::text[]) AND space_id = $2 ORDER BY key',
      [[current.secret_ref, nextRef].filter(Boolean), 11]);
    const metadata = () => ({ client_id: 'penpot', is_active: current.is_active, redirect_uris: callbacks,
      allowed_scopes: scopes, secret_ref: current.secret_ref, has_legacy_secret: Boolean(current.client_secret),
      revision: createHash('sha256').update(JSON.stringify({ current,
        secret: secrets.find((row) => row.key === current.secret_ref)?.encrypted_payload ?? null })).digest('hex') });
    if (action === 'inspect') return metadata();
    const receipt = await trx.get(`SELECT action, details FROM public.audit_log
      WHERE entity_type = $1 AND entity_id = $2 AND details LIKE $3 LIMIT 1`,
    ['oidc_client', 'penpot', `%"request_id":"${request_id}"%`]);
    if (receipt) {
      if (receipt.action !== `oidc.penpot.${action}` || JSON.parse(receipt.details).expected_revision !== expected_revision) {
        throw new Error('IDEMPOTENCY_CONFLICT');
      }
      return { ...metadata(), changed: false, replayed: true };
    }
    if (metadata().revision !== expected_revision) throw new Error('REVISION_CONFLICT');
    if (action === 'rotate' && secrets.some((row) => row.key === nextRef)) throw new Error('CLIENT_CONFLICT');
    if (action !== 'disable') {
      if (!vault.health().ok || !vault.health().hasKey) throw new Error('SECRET_VAULT_UNAVAILABLE');
      if (action === 'enable' && (!current.secret_ref || current.client_secret
        || !await vault.getSecret(current.secret_ref, { transaction: trx }))) throw new Error('SECRET_UNAVAILABLE');
    }
    const changed = action === 'rotate' || current.is_active !== (action === 'enable' ? 1 : 0);
    // Confidential recovery evidence can contain the legacy credential; never return or log contents.
    await mkdir(BACKUPS, { recursive: true, mode: 0o700 });
    const stat = await lstat(BACKUPS);
    if (!stat.isDirectory() || (stat.mode & 0o077) || stat.uid !== process.getuid()) throw new Error('BACKUP_PERMISSIONS');
    const contents = JSON.stringify({ target, schema, clients: rows, secrets, request_id, at: new Date().toISOString() });
    const backup = { file: `${BACKUPS}/${randomUUID()}.json`, sha256: createHash('sha256').update(contents).digest('hex') };
    const file = await open(backup.file, 'wx+', 0o600);
    try {
      await file.writeFile(contents);
      await file.sync();
    } finally { await file.close(); }
    const check = await open(backup.file, 'r');
    try {
      if (createHash('sha256').update(await check.readFile()).digest('hex') !== backup.sha256) throw new Error('BACKUP_MISMATCH');
    } finally { await check.close(); }

    if (action === 'rotate') {
      const secret = randomBytes(32).toString('base64url');
      await vault.putSecret(nextRef, secret, { actor, spaceId: 11, transaction: trx, description: 'Penpot OIDC client' });
      if (await vault.getSecret(nextRef, { transaction: trx }) !== secret) throw new Error('SECRET_READBACK_FAILED');
      await trx.run('UPDATE public.oidc_clients SET client_secret = NULL, secret_ref = $1, updated_at = NOW() WHERE id = $2 AND client_id = $3',
        [nextRef, current.id, 'penpot']);
    } else if (changed) {
      await trx.run('UPDATE public.oidc_clients SET is_active = $1, updated_at = NOW() WHERE id = $2 AND client_id = $3',
        [action === 'enable' ? 1 : 0, current.id, 'penpot']);
    }
    await trx.run(`INSERT INTO public.audit_log (user_id, action, entity_type, entity_id, details)
      VALUES ($1, $2, $3, $4, $5)`, [actor, `oidc.penpot.${action}`, 'oidc_client', 'penpot',
      JSON.stringify({ request_id, expected_revision, changed, backup })]);
    // The next inspect reads the committed revision, including the DB-generated timestamp.
    return { client_id: 'penpot', changed, replayed: false, backup,
      secret_ref: action === 'rotate' ? nextRef : current.secret_ref,
      has_legacy_secret: action === 'rotate' ? false : Boolean(current.client_secret),
      is_active: action === 'rotate' ? current.is_active : action === 'enable' ? 1 : 0 };
  });
}
