import { z } from 'zod';
import vault from '../secrets/SecretsVault.js';

export const LEVEL_AGENT_SECRET_REF = 'level_godcrm_agent_client_secret';
export const LEVEL_HTTP_TIMEOUT_MS = 5000;

const DEFAULT_ORIGIN = 'https://admin.sixtynine.ru';
const CLIENT_ID = 'godcrm-agent';
const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token';
const scopeSchema = z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);
const assertionSchema = z.string().max(8192).regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
const delegatedTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const tokenResponseSchema = z.object({
  access_token: delegatedTokenSchema,
  issued_token_type: z.literal(ACCESS_TOKEN_TYPE),
  token_type: z.literal('Bearer'),
  expires_in: z.number().int().min(1).max(60),
  scope: z.string().min(1),
}).strict();

function endpoint(origin, pathname) {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('invalid origin');
    }
    return new URL(pathname, url).toString();
  } catch {
    throw new Error('LEVEL_CONNECTOR_CONFIG_INVALID');
  }
}

function configuredScopes() {
  return (process.env.LEVEL_AGENT_ALLOWED_SCOPES || '').split(/[\s,]+/).filter(Boolean);
}

function normalizeScopes(scopes, allowedScopes) {
  if (!Array.isArray(scopes) || scopes.length === 0 || !Array.isArray(allowedScopes)) {
    throw new Error('LEVEL_SCOPE_FORBIDDEN');
  }
  const allowed = new Set(allowedScopes);
  const requested = [...new Set(scopes)];
  if (requested.some((scope) => !scopeSchema.safeParse(scope).success || !allowed.has(scope))) {
    throw new Error('LEVEL_SCOPE_FORBIDDEN');
  }
  return requested;
}

async function readClientSecret(getSecret) {
  const secret = await getSecret(LEVEL_AGENT_SECRET_REF, { spaceId: 11 });
  if (typeof secret !== 'string' || !secret) throw new Error('LEVEL_AGENT_CREDENTIALS_UNAVAILABLE');
  return secret;
}

export function createLevelDelegatedConnector({
  fetchImpl = globalThis.fetch,
  getSecret = (key, options) => vault.getSecret(key, options),
  allowedScopes = configuredScopes(),
  origin = DEFAULT_ORIGIN,
  timeoutMs = LEVEL_HTTP_TIMEOUT_MS,
} = {}) {
  async function post(pathname, body, operation) {
    const url = endpoint(origin, pathname);
    const secret = await readClientSecret(getSecret);
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        body: body.toString(),
        headers: {
          Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${secret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'Cache-Control': 'no-store',
        },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new Error(`LEVEL_${operation}_UNAVAILABLE`);
    }
    if (response.status !== 200) throw new Error(`LEVEL_${operation}_HTTP_${response.status}`);
    return response;
  }

  return {
    async exchange({ subjectToken, scopes } = {}) {
      if (!assertionSchema.safeParse(subjectToken).success) throw new Error('LEVEL_ASSERTION_INVALID');
      const requested = normalizeScopes(scopes, allowedScopes);
      const response = await post('/api/oauth/token-exchange', new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        subject_token: subjectToken,
        subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
        requested_token_type: ACCESS_TOKEN_TYPE,
        audience: 'level-api',
        scope: requested.join(' '),
      }), 'EXCHANGE');
      try {
        const data = tokenResponseSchema.parse(await response.json());
        const granted = normalizeScopes(data.scope.split(' '), allowedScopes);
        if (granted.some((scope) => !requested.includes(scope))) throw new Error('scope escalation');
        return data;
      } catch {
        throw new Error('LEVEL_TOKEN_RESPONSE_INVALID');
      }
    },

    async revoke(token) {
      if (!delegatedTokenSchema.safeParse(token).success) throw new Error('LEVEL_TOKEN_INVALID');
      await post('/api/oauth/revoke', new URLSearchParams({
        token,
        token_type_hint: 'access_token',
      }), 'REVOCATION');
    },
  };
}
