import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { mkdir, lstat, open } from 'node:fs/promises';
import { z } from 'zod';
import { withTransactionAsync } from '../../database/connection.js';
import { ISSUER } from '../../config/oidc.config.js';
import vault from '../secrets/SecretsVault.js';

const CLIENT = {
  client_id: 'forgejo', name: 'Forgejo GOD CRM', client_secret: null,
  secret_ref: 'oidc_forgejo_client_secret', token_endpoint_auth_method: 'client_secret_post',
  redirect_uris: '["https://godcrm.ai/git/user/oauth2/GOD%20CRM/callback"]',
  allowed_scopes: '["openid","profile","email"]', login_tier: 'oidc',
  space_id: null, assistant_id: null, default_conversation: null,
};
const BACKUPS = '/srv/godcrm/shared/oidc-backups';
const input = z.object({ action: z.enum(['provision', 'disable', 'enable']), actor: z.number().int().positive() }).strict();
const columns = {
  oidc_clients: { id: 'integer', client_id: 'text', name: 'text', client_secret: 'text', secret_ref: 'text',
    redirect_uris: 'text', allowed_scopes: 'text', is_active: 'integer', token_endpoint_auth_method: 'text',
    login_tier: 'text', space_id: 'integer', assistant_id: 'integer', default_conversation: 'integer',
    updated_at: 'timestamp without time zone' },
  _secrets: { key: 'text', encrypted_payload: 'jsonb', description: 'text', created_by: 'integer',
    space_id: 'integer', created_at: 'timestamp with time zone', updated_at: 'timestamp with time zone' },
  audit_log: { user_id: 'integer', action: 'text', entity_type: 'text', entity_id: 'text', details: 'text' },
};

/** Owner-only, fixed-client provisioning. Registry, vault and audit commit together. */
export async function changeForgejoClient(raw) {
  const { action, actor } = input.parse(raw);
  if (ISSUER !== 'https://id.godcrm.ai' || !Object.values(networkInterfaces()).flat()
    .some((entry) => entry?.address === '<PROD_IP>')) throw new Error('WRONG_MASTER');

  return withTransactionAsync(async (trx) => {
    const target = await trx.get('SELECT current_database() AS database, inet_server_addr()::text AS address');
    if (target.database !== 'godcrm_prod' || !['127.0.0.1/32', '::1/128', '<PROD_IP>/32'].includes(target.address)) {
      throw new Error('WRONG_DATABASE');
    }
    // Identity check against the current owner, never a caller-supplied role.
    const owner = await trx.get('SELECT owner_id FROM public.spaces WHERE id = $1', [11]);
    if (owner?.owner_id !== actor) throw new Error('OWNER_REQUIRED');

    const schema = await trx.all(`SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [Object.keys(columns)]);
    for (const [table, fields] of Object.entries(columns)) {
      for (const [name, type] of Object.entries(fields)) {
        if (!schema.some((col) => col.table_name === table && col.column_name === name && col.data_type === type)) {
          throw new Error('SCHEMA_MISMATCH');
        }
      }
      if (schema.some((col) => col.table_name === table && col.is_nullable === 'NO'
        && col.column_default == null && !(col.column_name in fields))) throw new Error('SCHEMA_REQUIRED_COLUMN');
    }
    if (schema.some((col) => col.table_name === 'oidc_clients'
      && Object.hasOwn(CLIENT, col.column_name) && CLIENT[col.column_name] === null
      && col.is_nullable !== 'YES')) throw new Error('SCHEMA_MISMATCH');
    await trx.run("SET LOCAL lock_timeout = '3s'");
    // Migration 078 has no UNIQUE(client_id). Serialize even non-API SQL writers.
    await trx.run('LOCK TABLE public.oidc_clients, public._secrets IN SHARE ROW EXCLUSIVE MODE');
    const rows = await trx.all('SELECT * FROM public.oidc_clients WHERE client_id = $1 OR secret_ref = $2',
      [CLIENT.client_id, CLIENT.secret_ref]);
    const secrets = await trx.all('SELECT * FROM public._secrets WHERE key = $1 AND space_id = $2', [CLIENT.secret_ref, 11]);
    const current = rows[0];
    if (rows.length > 1 || secrets.length > 1 || (!current && secrets.length)
      || (current && (Object.entries(CLIENT).some(([key, value]) => {
        // JSON text can differ in whitespace while retaining the same contract.
        if (key === 'redirect_uris' || key === 'allowed_scopes') {
          try { return JSON.stringify(JSON.parse(current[key])) !== value; } catch { return true; }
        }
        return current[key] !== value;
      }) || ![0, 1].includes(current.is_active)))) throw new Error('CLIENT_CONFLICT');
    if (!current && action !== 'provision') throw new Error('CLIENT_NOT_FOUND');
    if (current?.is_active === 0 && action === 'provision') throw new Error('CLIENT_DISABLED_CONFLICT');
    if (action !== 'disable' && (!vault.health().hasKey || !vault.health().ok)) throw new Error('SECRET_VAULT_UNAVAILABLE');

    // A scoped, verified pre-change backup; no plaintext secrets in this snapshot.
    await mkdir(BACKUPS, { recursive: true, mode: 0o700 });
    const stat = await lstat(BACKUPS);
    if (!stat.isDirectory() || (stat.mode & 0o077)) throw new Error('BACKUP_PERMISSIONS');
    const contents = JSON.stringify({ target, schema, clients: rows, secrets, at: new Date().toISOString() });
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

    const active = action === 'disable' ? 0 : 1;
    const changed = !current || current.is_active !== active;
    if (!current) {
      const secret = randomBytes(32).toString('base64url');
      await vault.putSecret(CLIENT.secret_ref, secret, { actor, spaceId: 11, transaction: trx, description: CLIENT.name });
      if (await vault.getSecret(CLIENT.secret_ref, { transaction: trx }) !== secret) throw new Error('SECRET_READBACK_FAILED');
      await trx.run(`INSERT INTO public.oidc_clients
        (client_id, name, client_secret, secret_ref, token_endpoint_auth_method, redirect_uris,
         allowed_scopes, login_tier, space_id, assistant_id, default_conversation, is_active)
        VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, NULL, NULL, NULL, 1)`,
      [CLIENT.client_id, CLIENT.name, CLIENT.secret_ref, CLIENT.token_endpoint_auth_method,
        CLIENT.redirect_uris, CLIENT.allowed_scopes, CLIENT.login_tier]);
    } else {
      if (active && (!secrets.length || !await vault.getSecret(CLIENT.secret_ref, { transaction: trx }))) {
        throw new Error('SECRET_UNAVAILABLE');
      }
      if (changed) await trx.run('UPDATE public.oidc_clients SET is_active = $1, updated_at = NOW() WHERE id = $2 AND client_id = $3',
        [active, current.id, CLIENT.client_id]);
    }
    await trx.run(`INSERT INTO public.audit_log (user_id, action, entity_type, entity_id, details)
      VALUES ($1, $2, $3, $4, $5)`, [actor, `oidc.forgejo.${action}`, 'oidc_client', CLIENT.client_id,
      JSON.stringify({ changed, before: current?.is_active ?? null, after: active, backup })]);
    return { client_id: CLIENT.client_id, is_active: active, secret_ref: CLIENT.secret_ref, changed, backup };
  });
}
