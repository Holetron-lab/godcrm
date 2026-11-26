import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { dbGet } from '../../database/connection.js';

const ISSUER = 'https://id.godcrm.ai';
const AUDIENCE = 'https://admin.sixtynine.ru/api/oauth/token-exchange';
const KEY_ID = 'godcrm-oidc-key-1';
const TTL_SECONDS = 60;
const privateKeyPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../config/keys/oidc-private.pem');
const runtimeSchema = z.object({
  jobId: z.number().int().positive().safe(),
  agentId: z.number().int().positive().safe(),
  spaceId: z.literal(35),
}).strict();

export async function createLevelSubjectAssertion(context) {
  const parsed = runtimeSchema.safeParse(context);
  if (!parsed.success) throw new Error('LEVEL_JOB_FORBIDDEN');
  const { jobId, agentId, spaceId } = parsed.data;
  const job = await dbGet(`
    SELECT j.job_id, j.agent_row_id, j.trigger_user_id
    FROM agent_jobs j
    JOIN conversations c ON c.id = j.conversation_id
    JOIN users u ON u.id = j.trigger_user_id
      AND COALESCE(u.user_type, 'human') = 'human'
      AND COALESCE(u.status, 'active') = 'active'
    JOIN conversation_participants human ON human.conversation_id = c.id AND human.user_id = u.id
    JOIN conversation_participants agent ON agent.conversation_id = c.id AND agent.user_id = j.agent_user_id
    WHERE j.id = ? AND j.agent_row_id = ? AND c.space_id = ? AND j.status = 'processing'
  `, [jobId, agentId, spaceId]);
  if (!job) throw new Error('LEVEL_JOB_FORBIDDEN');

  let privateKey;
  try {
    privateKey = fs.readFileSync(privateKeyPath, 'utf8');
  } catch {
    throw new Error('LEVEL_OIDC_RS256_UNAVAILABLE');
  }
  if (!privateKey) throw new Error('LEVEL_OIDC_RS256_UNAVAILABLE');

  const iat = Math.floor(Date.now() / 1000);
  const claims = {
    iss: ISSUER,
    sub: String(job.trigger_user_id),
    aud: AUDIENCE,
    space_id: 35,
    crm_job_id: String(job.job_id),
    crm_agent_id: String(job.agent_row_id),
    iat,
    nbf: iat,
    exp: iat + TTL_SECONDS,
    jti: randomUUID(),
  };
  try {
    return jwt.sign(claims, privateKey, { algorithm: 'RS256', header: { kid: KEY_ID } });
  } catch {
    throw new Error('LEVEL_ASSERTION_SIGNING_FAILED');
  }
}
