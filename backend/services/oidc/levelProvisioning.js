import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { mkdir, lstat, open } from 'node:fs/promises';
import { z } from 'zod';
import { withTransactionAsync } from '../../database/connection.js';
import { ISSUER } from '../../config/oidc.config.js';
import vault from '../secrets/SecretsVault.js';

export const LEVEL_SECRET_REF = 'oidc_level_client_secret';
const LEGACY_SECRET_REF = 'oidc/level/client_secret';
const CALLBACK = 'https://sixtynine.ru/auth/social/godcrm/callback';
const ORIGIN = 'https://admin.sixtynine.ru';
const BACKUPS = '/root/backups/temp/oidc-level';
const ROTATED_REF = /^oidc_level_[a-f0-9]{32}$/;
const CLIENT = {
  client_id: 'level', name: 'Level Admin', client_secret: null, secret_ref: LEVEL_SECRET_REF,
  token_endpoint_auth_method: 'client_secret_basic', redirect_uris: JSON.stringify([CALLBACK]),
  allowed_scopes: JSON.stringify(['openid', 'profile', 'email']), allowed_origins: JSON.stringify([ORIGIN]),
  login_tier: 'oidc', space_id: 35, assistant_id: null, default_conversation: null,
};
export const levelActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('inspect') }).strict(),
  ...['provision', 'rotate', 'disable', 'enable'].map((action) => z.object({
    action: z.literal(action), request_id: z.string().uuid(), expected_revision: z.string().regex(/^[a-f0-9]{64}$/),
    dry_run: z.boolean().optional(),
  }).strict()),
]);
const input = z.object({ actor: z.number().int().positive(), data: levelActionSchema }).strict();
const columns = {
  oidc_clients: { id: 'integer', client_id: 'text', name: 'text', client_secret: 'text', secret_ref: 'text',
    redirect_uris: 'text', allowed_scopes: 'text', allowed_origins: 'jsonb', is_active: 'integer',
    token_endpoint_auth_method: 'text', login_tier: 'text', space_id: 'integer', assistant_id: 'integer',
    default_conversation: 'integer', updated_at: 'timestamp without time zone' },
  _secrets: { key: 'text', encrypted_payload: 'jsonb', description: 'text', created_by: 'integer',
    space_id: 'integer', created_at: 'timestamp with time zone', updated_at: 'timestamp with time zone' },
  audit_log: { user_id: 'integer', action: 'text', entity_type: 'text', entity_id: 'text', details: 'text' },
};

function parseList(value) {
  return z.array(z.string()).parse(typeof value === 'string' ? JSON.parse(value) : value);
}

/** Owner-only, fixed-client provisioning. Registry, vault and audit commit together. */
export async function changeLevelClient(raw) {
  const { actor: rawActor, ...data } = raw;
  const { actor, data: actionData } = input.parse({ actor: rawActor, data });
  const { action, request_id, expected_revision, dry_run = false } = actionData;
  if (ISSUER !== 'https://id.godcrm.ai' || !Object.values(networkInterfaces()).flat()
    .some((entry) => entry?.address === '<PROD_IP>')) throw new Error('WRONG_MASTER');

  return withTransactionAsync(async (trx) => {
    const target = await trx.get('SELECT current_database() AS database, inet_server_addr()::text AS address');
    if (target.database !== 'godcrm_prod' || !['127.0.0.1/32', '::1/128', '<PROD_IP>/32'].includes(target.address)) {
      throw new Error('WRONG_DATABASE');
    }
    await trx.run("SET LOCAL lock_timeout = '3s'");
    const owner = await trx.get('SELECT owner_id FROM public.spaces WHERE id = $1 FOR SHARE', [11]);
    if (owner?.owner_id !== actor) throw new Error('OWNER_REQUIRED');
    await trx.run('LOCK TABLE public.oidc_clients, public._secrets IN SHARE ROW EXCLUSIVE MODE');
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

    const nextRef = action === 'rotate' ? `oidc_level_${request_id.replaceAll('-', '').toLowerCase()}` : null;
    const rows = await trx.all(`SELECT * FROM public.oidc_clients WHERE client_id = $1
      OR secret_ref = $2 OR starts_with(secret_ref, $3)
      OR secret_ref IN (SELECT secret_ref FROM public.oidc_clients WHERE client_id = $1)`,
    [CLIENT.client_id, LEVEL_SECRET_REF, 'oidc_level_']);
    const current = rows[0];
    if (rows.length > 1 || (current && current.client_id !== CLIENT.client_id)) throw new Error('CLIENT_CONFLICT');
    if (!current && !['inspect', 'provision'].includes(action)) throw new Error('CLIENT_NOT_FOUND');
    if (current && (![0, 1].includes(current.is_active)
      || (current.secret_ref && ![LEVEL_SECRET_REF, LEGACY_SECRET_REF].includes(current.secret_ref) && !ROTATED_REF.test(current.secret_ref))
      || Object.entries(CLIENT).some(([key, value]) => {
        if (['client_id', 'client_secret', 'secret_ref'].includes(key)) return false;
        if (['redirect_uris', 'allowed_scopes', 'allowed_origins'].includes(key)) {
          try {
            const parsed = parseList(current[key]);
            if (key === 'redirect_uris' && current.secret_ref === LEGACY_SECRET_REF
              && ['inspect', 'provision'].includes(action) && parsed.length === 1
              && parsed[0] === 'https://admin.sixtynine.ru/auth/social/godcrm/callback') return false;
            return JSON.stringify(parsed) !== value;
          } catch { return true; }
        }
        return current[key] !== value;
      }))) throw new Error('CLIENT_CONFLICT');

    const secretKeys = [current?.secret_ref, nextRef].filter(Boolean);
    if (!current || !current.secret_ref || current.secret_ref === LEGACY_SECRET_REF) secretKeys.push(LEVEL_SECRET_REF);
    const secrets = await trx.all(`SELECT * FROM public._secrets WHERE key = ANY($1::text[]) AND space_id = $2 ORDER BY key`,
      [secretKeys, 11]);
    if (secrets.length > new Set(secrets.map((row) => row.key)).size
      || (!current && secrets.length) || (nextRef && secrets.some((row) => row.key === nextRef))
      || (secretKeys.includes(LEVEL_SECRET_REF) && current?.secret_ref !== LEVEL_SECRET_REF
        && secrets.some((row) => row.key === LEVEL_SECRET_REF))) {
      throw new Error('CLIENT_CONFLICT');
    }
    let secretAvailable = false;
    if (current?.secret_ref && current.secret_ref !== LEGACY_SECRET_REF && vault.health().ok && vault.health().hasKey) {
      secretAvailable = Boolean(await vault.getSecret(current.secret_ref, { spaceId: 11, transaction: trx }));
    }
    const metadata = () => ({
      exists: Boolean(current), client_id: CLIENT.client_id, is_active: current?.is_active ?? null,
      secret_ref: current?.secret_ref ?? LEVEL_SECRET_REF, has_legacy_secret: Boolean(current?.client_secret),
      secret_available: secretAvailable,
      redirect_uris: current ? parseList(current.redirect_uris) : [CALLBACK],
      allowed_origins: current ? parseList(current.allowed_origins) : [ORIGIN],
      allowed_scopes: current ? parseList(current.allowed_scopes) : ['openid', 'profile', 'email'],
      login_tier: current?.login_tier ?? 'oidc', space_id: current?.space_id ?? 35,
      token_endpoint_auth_method: current?.token_endpoint_auth_method ?? 'client_secret_basic',
      revision: createHash('sha256').update(JSON.stringify({ current: current ?? null,
        secret: secrets.find((row) => row.key === current?.secret_ref)?.encrypted_payload ?? null })).digest('hex'),
    });
    if (action === 'inspect') return metadata();

    const receipt = await trx.get(`SELECT action, details FROM public.audit_log
      WHERE entity_type = $1 AND entity_id = $2 AND details LIKE $3 LIMIT 1`,
    ['oidc_client', CLIENT.client_id, `%"request_id":"${request_id}"%`]);
    if (receipt) {
      if (receipt.action !== `oidc.level.${action}` || JSON.parse(receipt.details).expected_revision !== expected_revision) {
        throw new Error('IDEMPOTENCY_CONFLICT');
      }
      return { ...metadata(), changed: false, replayed: true, dry_run: false };
    }
    if (metadata().revision !== expected_revision) throw new Error('REVISION_CONFLICT');
    if (action !== 'disable' && (!vault.health().hasKey || !vault.health().ok)) throw new Error('SECRET_VAULT_UNAVAILABLE');

    let targetRef = current?.secret_ref ?? LEVEL_SECRET_REF;
    let generateSecret = false;
    if (!current) generateSecret = true;
    if (action === 'rotate') { targetRef = nextRef; generateSecret = true; }
    if (action === 'provision' && current && (!current.secret_ref || current.secret_ref === LEGACY_SECRET_REF)) {
      targetRef = LEVEL_SECRET_REF;
      generateSecret = true;
    }
    if (action === 'enable' && (current.client_secret || current.secret_ref === LEGACY_SECRET_REF || !secretAvailable)) {
      throw new Error('SECRET_UNAVAILABLE');
    }
    if (action === 'provision' && current && !generateSecret && !secretAvailable) throw new Error('SECRET_UNAVAILABLE');
    const active = action === 'enable' ? 1 : action === 'disable' ? 0 : current?.is_active ?? 0;
    const changed = !current || action === 'rotate' || generateSecret
      || (action === 'provision' && Boolean(current.client_secret)) || current.is_active !== active;
    if (dry_run) {
      return { ...metadata(), changed, replayed: false, dry_run: true, is_active: active, secret_ref: targetRef,
        has_legacy_secret: ['provision', 'rotate'].includes(action) ? false : Boolean(current?.client_secret),
        secret_available: generateSecret || secretAvailable };
    }

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

    if (generateSecret) {
      const secret = randomBytes(32).toString('base64url');
      await vault.putSecret(targetRef, secret, { actor, spaceId: 11, transaction: trx, description: CLIENT.name });
      if (await vault.getSecret(targetRef, { spaceId: 11, transaction: trx }) !== secret) throw new Error('SECRET_READBACK_FAILED');
    }
    if (!current) {
      await trx.run(`INSERT INTO public.oidc_clients
        (client_id, name, client_secret, secret_ref, token_endpoint_auth_method, redirect_uris,
         allowed_scopes, allowed_origins, login_tier, space_id, assistant_id, default_conversation, is_active)
        VALUES ($1, $2, NULL, $3, $4, $5, $6, $7::jsonb, $8, $9, NULL, NULL, 0)`,
      [CLIENT.client_id, CLIENT.name, LEVEL_SECRET_REF, CLIENT.token_endpoint_auth_method,
        CLIENT.redirect_uris, CLIENT.allowed_scopes, CLIENT.allowed_origins, CLIENT.login_tier, CLIENT.space_id]);
    } else if (action === 'rotate' || generateSecret || (action === 'provision' && current.client_secret)) {
      await trx.run(`UPDATE public.oidc_clients SET client_secret = NULL, secret_ref = $1, redirect_uris = $4, updated_at = NOW()
        WHERE id = $2 AND client_id = $3`, [targetRef, current.id, CLIENT.client_id, CLIENT.redirect_uris]);
    }
    if (current && ['enable', 'disable'].includes(action) && changed) {
      await trx.run('UPDATE public.oidc_clients SET is_active = $1, updated_at = NOW() WHERE id = $2 AND client_id = $3',
        [active, current.id, CLIENT.client_id]);
    }
    await trx.run(`INSERT INTO public.audit_log (user_id, action, entity_type, entity_id, details)
      VALUES ($1, $2, $3, $4, $5)`, [actor, `oidc.level.${action}`, 'oidc_client', CLIENT.client_id,
      JSON.stringify({ request_id, expected_revision, changed, backup })]);
    return { exists: true, client_id: CLIENT.client_id, is_active: active, secret_ref: targetRef,
      has_legacy_secret: ['provision', 'rotate'].includes(action) ? false : Boolean(current?.client_secret),
      secret_available: generateSecret || secretAvailable, changed, replayed: false, dry_run: false, backup };
  });
}
