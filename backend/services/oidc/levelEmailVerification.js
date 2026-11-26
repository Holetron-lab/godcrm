import { networkInterfaces } from 'node:os';
import { z } from 'zod';
import { withTransactionAsync } from '../../database/connection.js';
import { ISSUER } from '../../config/oidc.config.js';

const inputSchema = z.object({
  actor: z.number().int().positive(),
  user_id: z.literal(6),
  request_id: z.string().uuid(),
}).strict();

export async function verifyLevelPilotEmail(raw) {
  const { actor, user_id, request_id } = inputSchema.parse(raw);
  if (ISSUER !== 'https://id.godcrm.ai' || !Object.values(networkInterfaces()).flat()
    .some((entry) => entry?.address === '<PROD_IP>')) throw new Error('WRONG_MASTER');

  return withTransactionAsync(async (trx) => {
    const targetDb = await trx.get('SELECT current_database() AS database, inet_server_addr()::text AS address');
    if (targetDb.database !== 'godcrm_prod' || !['127.0.0.1/32', '::1/128', '<PROD_IP>/32'].includes(targetDb.address)) {
      throw new Error('WRONG_DATABASE');
    }
    await trx.run("SET LOCAL lock_timeout = '3s'");
    const owner = await trx.get('SELECT owner_id FROM public.spaces WHERE id = $1 FOR SHARE', [11]);
    if (owner?.owner_id !== actor) throw new Error('OWNER_REQUIRED');

    const target = await trx.get(`SELECT id, email_verified, status, user_type FROM public.users
      WHERE id = $1 FOR UPDATE`, [user_id]);
    if (!target) throw new Error('TARGET_NOT_FOUND');
    if (target.status !== 'active' || target.user_type !== 'human') throw new Error('TARGET_NOT_ELIGIBLE');

    const receipt = await trx.get(`SELECT details FROM public.audit_log
      WHERE action = $1 AND entity_type = 'user' AND entity_id = $2 AND details LIKE $3 LIMIT 1`,
    ['oidc.level.email_verified', String(user_id), `%"request_id":"${request_id}"%`]);
    if (receipt) return { user_id, email_verified: true, changed: false, replayed: true };

    const changed = target.email_verified !== 1 && target.email_verified !== true;
    if (changed) {
      await trx.run('UPDATE public.users SET email_verified = 1, updated_at = NOW() WHERE id = $1', [user_id]);
    }
    await trx.run(`INSERT INTO public.audit_log (user_id, action, entity_type, entity_id, details)
      VALUES ($1, $2, 'user', $3, $4)`, [actor, 'oidc.level.email_verified', String(user_id),
      JSON.stringify({ request_id, changed })]);
    return { user_id, email_verified: true, changed, replayed: false };
  });
}
