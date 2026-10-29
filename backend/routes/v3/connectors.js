/**
 * Space Connectors API — ADR-0028 §3.4.
 *
 * Two routers exported:
 *   - default (authedRouter)  — JWT-protected endpoints
 *   - callbackRouter          — unauthenticated /oauth/callback (state JWT carries identity)
 *
 * Mount in server.js:
 *   app.use('/api/v3/connectors', connectorsCallbackRouter);   // BEFORE authenticated mount
 *   app.use('/api/v3', authenticate, connectorsAuthedRouter);
 */

import express from 'express';
import { z } from 'zod';
import remoteConnectorsRouter from './remote-connectors.js';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import crypto from 'crypto';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

import { dbGet, dbAll, dbRun } from '../../database/connection.js';
import { checkUserSpaceAccess } from '../../services/space/access.js';
import credentialVault, { getSpaceConnector } from '../../services/connectors/CredentialVault.js';
import { runRefreshTick } from '../../services/connectors/refreshScheduler.js';
import {
  getConnectorType,
  listConnectorTypes,
  validateConnectorTypeBody,
} from '../../services/connectors/catalogue/index.js';
import { ensureMailSystemTableForSpace } from '../../services/SystemTablesCreator.js';
import { evaluateMcpAccess, buildMcpGateEnv, verifyMcpGateToken } from '../../services/connectors/mcpGate.js';
import { apiLogger } from '../../utils/logger.js';
import { success, created, error, badRequest, notFound, forbidden } from '../../utils/response.js';

const log = apiLogger.child({ module: 'connectors_api' });

const STATE_JWT_TTL = '10m';

// ─── Helpers ────────────────────────────────────────────────────────

function buildRedirectUri(req) {
  // Trust X-Forwarded-* (nginx in front of Express).
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}/api/v3/connectors/oauth/callback`;
}

async function loadSpaceOr404(spaceId, res) {
  const space = await dbGet('SELECT * FROM spaces WHERE id = ?', [spaceId]);
  if (!space) {
    notFound(res, 'Space');
    return null;
  }
  return space;
}

async function ensureSpaceAccess(req, res, spaceId) {
  const space = await loadSpaceOr404(spaceId, res);
  if (!space) return null;
  let accessControl = null;
  try {
    accessControl =
      typeof space.access_control === 'string'
        ? JSON.parse(space.access_control)
        : space.access_control;
  } catch {
    accessControl = null;
  }
  const allowed = await checkUserSpaceAccess(req.user.id, req.user.role, space, accessControl);
  if (!allowed) {
    forbidden(res, 'No access to space');
    return null;
  }
  return space;
}

async function audit({ userId, action, connectorId, spaceId, typeSlug, extra, req }) {
  try {
    const details = JSON.stringify({
      space_id: spaceId,
      type_slug: typeSlug,
      ...(extra || {}),
    });
    await dbRun(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userId || null,
        action,
        'space_connector',
        connectorId != null ? String(connectorId) : null,
        details,
        req?.ip || null,
        req?.get?.('user-agent') || null,
      ]
    );
  } catch (err) {
    log.warn({ err, action }, 'audit_log insert failed (non-blocking)');
  }
}

function scrubRow(row) {
  if (!row) return row;
  const { encrypted_payload, ...rest } = row;
  const out = {
    ...rest,
    has_payload: !!encrypted_payload && Object.keys(encrypted_payload).length > 0,
    enabled: row.status === 'active',
  };
  // mcp kinds carry no secret; what the UI needs is the server-side pin.
  const type = row.kind === 'mcp' ? getConnectorType(row.type_slug) : null;
  if (type && typeof type.describe === 'function') out.mcp = type.describe();
  return out;
}

// Column list every row-returning endpoint projects (never encrypted_payload
// itself — scrubRow() folds it into has_payload).
const ROW_COLUMNS = `id, space_id, type_slug, kind, display_name, status, scopes_requested,
            scopes_granted, account_label, account_sub, email, account_name, avatar_url, profile,
            custom_definition, expires_at, last_refresh_at, last_checked_at,
            last_error, created_by, created_at, updated_at, encrypted_payload`;

async function loadRow(id) {
  return dbGet(`SELECT ${ROW_COLUMNS} FROM space_connectors WHERE id = ?`, [id]);
}

// ─── ADR-159 §Schema: connected-account identity ────────────────────
//
// Map a provider's extractAccountInfo() output (or a synthesized IMAP envelope)
// onto the lean identity columns. Only sub/email/name/picture are promoted to
// columns; the full claim set rides in `profile` JSONB. Returns nulls when the
// provider supplied no identity (e.g. figma/notion) — the row inserts with a
// NULL account_sub, which the UNIQUE allows.
function deriveIdentity(info) {
  const id = info && typeof info === 'object' ? info.identity : null;
  if (!id || typeof id !== 'object') {
    return { account_sub: null, email: null, account_name: null, avatar_url: null, profile: null };
  }
  return {
    account_sub: id.sub != null ? String(id.sub) : null,
    email: id.email || null,
    account_name: id.name || null,
    avatar_url: id.picture || null,
    profile: id.profile && typeof id.profile === 'object' ? id.profile : null,
  };
}

// Module → compatible connector type_slugs. Drives the switcher's
// `?compatible_with=<module>` filter. Extend as modules land (ADR-159).
const MODULE_CONNECTOR_TYPES = {
  mail: ['google', 'microsoft', 'imap'],
};

// Resolve client_id/client_secret for a given type+row context.
//
// Precedence (n8n-style — paste in UI wins over env fallback):
//   1. custom_oauth2 → custom_definition + decrypted.client_secret (only path)
//   2. Branded type, decrypted payload carries `client_overrides` (per-row paste) → use those
//   3. Branded type → env vars (server-wide default)
function resolveOAuthEnv(type, customDefinition, decryptedPayload) {
  if (type.slug === 'custom_oauth2') {
    return {
      client_id: customDefinition?.client_id,
      client_secret: decryptedPayload?.client_secret,
      authorize_url: customDefinition?.authorize_url,
      token_url: customDefinition?.token_url,
    };
  }
  const overrides = decryptedPayload?.client_overrides;
  if (overrides && overrides.client_id && overrides.client_secret) {
    return {
      client_id: overrides.client_id,
      client_secret: overrides.client_secret,
      authorize_url: type.authorize_url,
      token_url: type.token_url,
    };
  }
  if (type.client_env) {
    return {
      client_id: process.env[type.client_env.id],
      client_secret: process.env[type.client_env.secret],
      authorize_url: type.authorize_url,
      token_url: type.token_url,
    };
  }
  return { client_id: null, client_secret: null, authorize_url: null, token_url: null };
}

// ─── Authed router ──────────────────────────────────────────────────

const authedRouter = express.Router();
authedRouter.use(remoteConnectorsRouter);

// Catalogue list (handy for UI).
authedRouter.get('/connectors/catalogue', (_req, res) => {
  return success(res, { types: listConnectorTypes() });
});

// Admin-only manual scheduler tick (testing aid — Phase 2 acceptance §1).
authedRouter.post('/connectors/admin/refresh-tick', async (req, res) => {
  if (req.user?.role !== 'admin') return forbidden(res, 'admin only');
  try {
    const stats = await runRefreshTick();
    return success(res, stats);
  } catch (err) {
    log.error({ err }, 'admin refresh-tick failed');
    return error(res, 'TICK_FAILED', err?.message || 'unknown', 500);
  }
});

// Rate limit /start: 10/min per user.
const startLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) => (req.user?.id != null ? `u:${req.user.id}` : `ip:${ipKeyGenerator(req, res)}`),
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many connector starts; wait a minute.' },
  },
});

// POST /spaces/:spaceId/connectors/start
authedRouter.post('/spaces/:spaceId/connectors/start', startLimiter, async (req, res) => {
  const spaceId = Number(req.params.spaceId);
  if (!Number.isFinite(spaceId)) return badRequest(res, 'Invalid spaceId');

  const space = await ensureSpaceAccess(req, res, spaceId);
  if (!space) return; // response already sent

  const { type_slug, display_name, scopes, custom_definition, fields, client_overrides } =
    req.body || {};
  if (!type_slug || !display_name) {
    return badRequest(res, 'type_slug and display_name are required');
  }
  const type = getConnectorType(type_slug);
  if (!type) return badRequest(res, `Unknown connector type: ${type_slug}`);
  if (type.auth_kind !== 'oauth2') {
    return badRequest(res, 'Use POST /spaces/:spaceId/connectors for api_key kinds');
  }

  // Type-specific body validation (custom_oauth2 requires custom_definition).
  const validation = validateConnectorTypeBody(type_slug, { custom_definition, fields });
  if (!validation.ok) return badRequest(res, validation.error);

  // Per-row UI-paste override for branded providers (n8n-style). Both fields
  // must be present together, otherwise treat as "no override".
  const hasOverride =
    type.slug !== 'custom_oauth2' &&
    client_overrides &&
    typeof client_overrides === 'object' &&
    typeof client_overrides.client_id === 'string' &&
    client_overrides.client_id.trim() &&
    typeof client_overrides.client_secret === 'string' &&
    client_overrides.client_secret.trim();

  // Resolve client creds + URLs.
  const oauthEnv = resolveOAuthEnv(
    type,
    custom_definition,
    type.slug === 'custom_oauth2'
      ? { client_secret: fields?.client_secret }
      : hasOverride
        ? {
            client_overrides: {
              client_id: client_overrides.client_id.trim(),
              client_secret: client_overrides.client_secret.trim(),
            },
          }
        : null
  );
  if (!oauthEnv.client_id || !oauthEnv.client_secret || !oauthEnv.authorize_url) {
    return error(
      res,
      'CONNECTOR_NOT_CONFIGURED',
      type.slug === 'custom_oauth2'
        ? 'custom_oauth2 requires client_id, client_secret, authorize_url, token_url'
        : `Missing env: ${type.client_env?.id}/${type.client_env?.secret} ` +
            '(or paste client_id/client_secret in the Add modal advanced section)',
      503
    );
  }

  if (!process.env.JWT_SECRET) {
    return error(res, 'JWT_SECRET_MISSING', 'JWT_SECRET not configured', 500);
  }

  const redirect_uri = buildRedirectUri(req);
  const nonce = crypto.randomBytes(16).toString('hex');

  // For custom_oauth2 we vault-encrypt the user-supplied client_secret. For
  // branded providers with paste-in-UI override, we vault-encrypt the
  // client_id+secret pair so they ride inside the state JWT without leaking
  // plaintext outside the vault, and get persisted into the row's payload
  // post-callback so refresh works without re-paste.
  let encrypted_user_fields = null;
  if (type.slug === 'custom_oauth2') {
    try {
      encrypted_user_fields = credentialVault.encrypt({ client_secret: fields.client_secret });
    } catch (err) {
      log.error({ err }, '/start vault encrypt failed');
      return error(res, 'VAULT_NOT_CONFIGURED', err.message, 503);
    }
  } else if (hasOverride) {
    try {
      encrypted_user_fields = credentialVault.encrypt({
        client_overrides: {
          client_id: client_overrides.client_id.trim(),
          client_secret: client_overrides.client_secret.trim(),
        },
      });
    } catch (err) {
      log.error({ err }, '/start vault encrypt (client_overrides) failed');
      return error(res, 'VAULT_NOT_CONFIGURED', err.message, 503);
    }
  }

  const scopes_requested = Array.isArray(scopes) && scopes.length ? scopes : type.scopes_default || [];

  const statePayload = {
    space_id: spaceId,
    type_slug,
    display_name,
    nonce,
    redirect_uri,
    scopes_requested,
    custom_definition: custom_definition || null,
    encrypted_user_fields,
    user_id: req.user.id,
  };
  const state = jwt.sign(statePayload, process.env.JWT_SECRET, { expiresIn: STATE_JWT_TTL });

  // Build authorize URL — module override or generic.
  let authorize_url;
  if (typeof type.buildAuthorizeUrl === 'function') {
    authorize_url = type.buildAuthorizeUrl({
      state,
      redirect_uri,
      client_id: oauthEnv.client_id,
      scopes: scopes_requested,
    });
  } else {
    const u = new URL(oauthEnv.authorize_url);
    u.searchParams.set('client_id', oauthEnv.client_id);
    u.searchParams.set('redirect_uri', redirect_uri);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('state', state);
    if (scopes_requested.length) {
      u.searchParams.set('scope', scopes_requested.join(' '));
    }
    authorize_url = u.toString();
  }

  await audit({
    userId: req.user.id,
    action: 'connector.start',
    connectorId: null,
    spaceId,
    typeSlug: type_slug,
    extra: { display_name, scopes: scopes_requested },
    req,
  });

  return success(res, { authorize_url, state });
});

// POST /spaces/:spaceId/connectors  (api_key kind only)
authedRouter.post('/spaces/:spaceId/connectors', async (req, res) => {
  const spaceId = Number(req.params.spaceId);
  if (!Number.isFinite(spaceId)) return badRequest(res, 'Invalid spaceId');

  const space = await ensureSpaceAccess(req, res, spaceId);
  if (!space) return;

  const { type_slug, display_name, fields, scopes, custom_definition, identity } = req.body || {};
  if (!type_slug || !display_name) {
    return badRequest(res, 'type_slug and display_name are required');
  }
  const type = getConnectorType(type_slug);
  if (!type) return badRequest(res, `Unknown connector type: ${type_slug}`);
  if (type.auth_kind === 'mcp') return createMcpConnector(req, res, { space, spaceId, type, display_name });
  if (type.auth_kind !== 'api_key') {
    return badRequest(res, 'POST /connectors is for api_key types; oauth2 → POST /connectors/start');
  }

  const validation = validateConnectorTypeBody(type_slug, { custom_definition, fields });
  if (!validation.ok) return badRequest(res, validation.error);

  // Build payload + custom_definition split for custom_api_key.
  let payload;
  let final_custom_definition;
  if (type.slug === 'custom_api_key') {
    payload = { api_key: fields.api_key };
    final_custom_definition = {
      header_name: fields.header_name || 'Authorization',
      header_format: fields.header_format || 'Bearer {key}',
    };
  } else {
    // Generic api_key: dump all fields into payload, no custom_definition.
    payload = { ...fields };
    final_custom_definition = null;
  }

  let encrypted;
  try {
    encrypted = credentialVault.encrypt(payload);
  } catch (err) {
    log.error({ err }, 'POST /connectors vault encrypt failed');
    return error(res, 'VAULT_NOT_CONFIGURED', err.message, 503);
  }

  const scopes_requested = Array.isArray(scopes) ? scopes : [];

  // Optional identity envelope (ADR-159 §Schema). Lets api_key-kind providers
  // that DO have an identity — notably IMAP, which synthesizes sub=lower(email)
  // from the connect form — populate the switcher columns. Generic api_key types
  // pass nothing → NULL identity, plain insert.
  const ident = deriveIdentity({ identity });

  const result = await dbRun(
    `INSERT INTO space_connectors
       (space_id, type_slug, kind, display_name, status, scopes_requested, scopes_granted,
        account_sub, email, account_name, avatar_url, profile,
        encrypted_payload, custom_definition, created_by)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb, ?)
     ON CONFLICT ON CONSTRAINT space_connectors_account_uq DO UPDATE SET
          status = 'active',
          scopes_requested = EXCLUDED.scopes_requested,
          scopes_granted = EXCLUDED.scopes_granted,
          email = EXCLUDED.email,
          account_name = EXCLUDED.account_name,
          avatar_url = EXCLUDED.avatar_url,
          profile = EXCLUDED.profile,
          encrypted_payload = EXCLUDED.encrypted_payload,
          last_error = NULL,
          updated_at = now()
     RETURNING id`,
    [
      spaceId,
      type_slug,
      type.auth_kind,
      display_name,
      scopes_requested,
      scopes_requested,
      ident.account_sub,
      ident.email,
      ident.account_name,
      ident.avatar_url,
      ident.profile ? JSON.stringify(ident.profile) : null,
      JSON.stringify(encrypted),
      final_custom_definition ? JSON.stringify(final_custom_definition) : null,
      req.user.id,
    ]
  );
  const newId = result.lastInsertRowid;

  await audit({
    userId: req.user.id,
    action: 'connector.create_api_key',
    connectorId: newId,
    spaceId,
    typeSlug: type_slug,
    extra: { display_name },
    req,
  });

  // ADR-158 §P3 — a space's first mailbox provisions the read-only Mail system
  // table so mail_messages shows up in the space's tables. Best-effort +
  // idempotent: a failure here must never fail connector creation.
  if (type_slug === 'imap') {
    try {
      await ensureMailSystemTableForSpace(spaceId);
    } catch (err) {
      apiLogger.warn({ err, spaceId }, 'ADR-158 §P3: mail system-table provision failed (non-fatal)');
    }
  }

  return created(res, { connector: scrubRow(await loadRow(newId)) });
});

// mcp kind (blender_mcp): no credentials, one live row per type per space, and
// only in the space the server pins — the request body never chooses scope.
async function createMcpConnector(req, res, { spaceId, type, display_name }) {
  const cfg = type.config();
  if (!cfg.configured) {
    return error(res, 'CONNECTOR_NOT_CONFIGURED', `${type.slug} is not configured on this server`, 503);
  }
  if (cfg.allowed_space_id !== spaceId) {
    return error(res, 'MCP_SPACE_NOT_ALLOWED', `${type.slug} is pinned to another space`, 403);
  }
  const live = await dbGet(
    `SELECT id FROM space_connectors WHERE space_id = ? AND type_slug = ? AND status <> 'revoked'`,
    [spaceId, type.slug]
  );
  if (live) return error(res, 'CONNECTOR_EXISTS', `${type.slug} already exists in this space (#${live.id})`, 409);

  const result = await dbRun(
    `INSERT INTO space_connectors (space_id, type_slug, kind, display_name, status, created_by)
     VALUES (?, ?, 'mcp', ?, 'active', ?) RETURNING id`,
    [spaceId, type.slug, display_name, req.user.id]
  );
  const newId = result.lastInsertRowid;
  await audit({
    userId: req.user.id,
    action: 'connector.create_mcp',
    connectorId: newId,
    spaceId,
    typeSlug: type.slug,
    extra: { display_name, allowed_agent_id: cfg.allowed_agent_id },
    req,
  });
  return created(res, { connector: scrubRow(await loadRow(newId)) });
}

// PATCH /spaces/:spaceId/connectors/:id  { enabled?, display_name? }
// The owner's switch. 'disabled' is a status of its own so every
// `status = 'active'` reader (refresh scheduler, mail, mcp gate) honours it.
authedRouter.patch('/spaces/:spaceId/connectors/:id', async (req, res) => {
  const spaceId = Number(req.params.spaceId);
  const id = Number(req.params.id);
  if (!Number.isFinite(spaceId) || !Number.isFinite(id)) return badRequest(res, 'Invalid id');
  const parsed = z.object({ enabled: z.boolean().optional(), display_name: z.string().trim().min(1).max(120).optional() })
    .strict().refine((v) => v.enabled !== undefined || v.display_name !== undefined).safeParse(req.body);
  if (!parsed.success) return badRequest(res, 'Provide enabled and/or display_name (1–120 characters)');
  const { enabled, display_name } = parsed.data;

  const space = await ensureSpaceAccess(req, res, spaceId);
  if (!space) return;

  const row = await dbGet(`SELECT id, status, type_slug FROM space_connectors WHERE id = ? AND space_id = ?`, [id, spaceId]);
  if (!row) return notFound(res, 'Connector');
  if (row.status === 'revoked') return error(res, 'CONNECTOR_REVOKED', 'A revoked connector cannot be switched', 409);

  const sets = [];
  const values = [];
  if (enabled !== undefined) { sets.push('status = ?'); values.push(enabled ? 'active' : 'disabled'); }
  if (display_name !== undefined) { sets.push('display_name = ?'); values.push(display_name); }
  await dbRun(`UPDATE space_connectors SET ${sets.join(', ')}, updated_at = now()
    WHERE id = ? AND space_id = ? AND status <> 'revoked'`, [...values, id, spaceId]);
  await audit({
    userId: req.user.id,
    action: enabled === undefined ? 'connector.rename' : enabled ? 'connector.enable' : 'connector.disable',
    connectorId: id,
    spaceId,
    typeSlug: row.type_slug,
    extra: { from: row.status },
    req,
  });
  return success(res, { connector: scrubRow(await loadRow(id)) });
});

// POST /spaces/:spaceId/connectors/:id/test — real connection check.
// mcp: launches the MCP exactly as an agent turn would and runs the handshake;
// a disabled connector is never launched. Other kinds: the type's test() with
// the decrypted payload. Outcome is persisted (last_checked_at + last_error)
// and never changes `status` — the switch belongs to the owner.
authedRouter.post('/spaces/:spaceId/connectors/:id/test', async (req, res) => {
  const spaceId = Number(req.params.spaceId);
  const id = Number(req.params.id);
  if (!Number.isFinite(spaceId) || !Number.isFinite(id)) return badRequest(res, 'Invalid id');

  const space = await ensureSpaceAccess(req, res, spaceId);
  if (!space) return;

  const row = await dbGet(`SELECT * FROM space_connectors WHERE id = ? AND space_id = ?`, [id, spaceId]);
  if (!row) return notFound(res, 'Connector');
  const type = getConnectorType(row.type_slug);
  if (!type || typeof type.test !== 'function') {
    return badRequest(res, `Connector type ${row.type_slug} does not support a connection check`, 'TEST_NOT_SUPPORTED');
  }

  let check;
  if (row.status !== 'active') {
    check = { ok: false, error_code: 'disabled', error: `Connector is ${row.status}; not launched` };
  } else if (type.auth_kind === 'mcp') {
    // Launch under the same gate env an agent turn gets: the wrapper opens the
    // upstream only with a token minted for this row. Without one it answers
    // as an empty MCP server, which type.test() reports as a 'gate' failure.
    const agentId = type.config().allowed_agent_id;
    const verdict = evaluateMcpAccess({ row, agentId, spaceId });
    check = verdict.allowed
      ? await type.test({ env: await buildMcpGateEnv({ agentId, spaceId, jobId: `connector-test:${id}` }) })
      : { ok: false, error_code: 'gate', error: `Gate denies this connector: ${verdict.reason}` };
  } else {
    try {
      const blob = typeof row.encrypted_payload === 'string' ? JSON.parse(row.encrypted_payload) : row.encrypted_payload;
      check = await type.test(blob && blob.v ? credentialVault.decrypt(blob) : {});
    } catch (err) {
      check = { ok: false, error_code: 'exception', error: err?.message || 'test threw' };
    }
  }
  check.checked_at = new Date().toISOString();

  if (check.error_code !== 'disabled') {
    await dbRun(`UPDATE space_connectors SET last_checked_at = now(), last_error = ?, updated_at = now() WHERE id = ?`, [
      check.ok ? null : `${check.error_code || 'failed'}: ${check.error || ''}`.slice(0, 500),
      id,
    ]);
  }
  await audit({
    userId: req.user.id,
    action: check.ok ? 'connector.test' : 'connector.test_failed',
    connectorId: id,
    spaceId,
    typeSlug: row.type_slug,
    extra: { ok: check.ok, error_code: check.error_code || null, tool_count: check.tool_count ?? null },
    req,
  });
  return success(res, { connector: scrubRow(await loadRow(id)), check });
});

// GET /spaces/:spaceId/connectors
authedRouter.get('/spaces/:spaceId/connectors', async (req, res) => {
  const spaceId = Number(req.params.spaceId);
  if (!Number.isFinite(spaceId)) return badRequest(res, 'Invalid spaceId');

  const space = await ensureSpaceAccess(req, res, spaceId);
  if (!space) return;

  // Switcher mode (ADR-159): `?compatible_with=<module>` returns the accounts
  // usable by that module, filtered to the module's compatible provider types
  // and excluding revoked rows. Same scrubbed row shape as the settings view:
  // the identity columns (account_name / email / avatar_url) are UserInfo
  // claims promoted 1:1, and the switcher + mail account settings also read
  // `display_name` / `account_label` off the row.
  const compatibleWith =
    typeof req.query.compatible_with === 'string' ? req.query.compatible_with.trim() : null;
  if (compatibleWith) {
    const types = MODULE_CONNECTOR_TYPES[compatibleWith];
    if (!types) {
      return badRequest(
        res,
        `Unknown module '${compatibleWith}'. Known modules: ${Object.keys(MODULE_CONNECTOR_TYPES).join(', ')}`
      );
    }
    const switcherRows = await dbAll(
      `SELECT ${ROW_COLUMNS}
         FROM space_connectors
        WHERE space_id = ? AND type_slug = ANY(?) AND status <> 'revoked'
        ORDER BY id DESC`,
      [spaceId, types]
    );
    return success(res, { connectors: switcherRows.map(scrubRow) });
  }

  const rows = await dbAll(
    `SELECT ${ROW_COLUMNS}
       FROM space_connectors
      WHERE space_id = ?
      ORDER BY id DESC`,
    [spaceId]
  );
  return success(res, { connectors: rows.map(scrubRow) });
});

// GET /spaces/:spaceId/connectors/:id
authedRouter.get('/spaces/:spaceId/connectors/:id', async (req, res) => {
  const spaceId = Number(req.params.spaceId);
  const id = Number(req.params.id);
  if (!Number.isFinite(spaceId) || !Number.isFinite(id)) return badRequest(res, 'Invalid id');

  const space = await ensureSpaceAccess(req, res, spaceId);
  if (!space) return;

  const row = await dbGet(
    `SELECT ${ROW_COLUMNS}
       FROM space_connectors
      WHERE id = ? AND space_id = ?`,
    [id, spaceId]
  );
  if (!row) return notFound(res, 'Connector');
  return success(res, { connector: scrubRow(row) });
});

// POST /spaces/:spaceId/connectors/:id/refresh
authedRouter.post('/spaces/:spaceId/connectors/:id/refresh', async (req, res) => {
  const spaceId = Number(req.params.spaceId);
  const id = Number(req.params.id);
  if (!Number.isFinite(spaceId) || !Number.isFinite(id)) return badRequest(res, 'Invalid id');

  const space = await ensureSpaceAccess(req, res, spaceId);
  if (!space) return;

  const row = await dbGet(
    `SELECT * FROM space_connectors WHERE id = ? AND space_id = ?`,
    [id, spaceId]
  );
  if (!row) return notFound(res, 'Connector');

  const type = getConnectorType(row.type_slug);
  if (!type) return badRequest(res, `Unknown connector type: ${row.type_slug}`);
  if (!type.refresh_supported) {
    return badRequest(res, `Connector type ${row.type_slug} does not support refresh`);
  }

  let decrypted;
  try {
    const blob = typeof row.encrypted_payload === 'string'
      ? JSON.parse(row.encrypted_payload)
      : row.encrypted_payload;
    decrypted = credentialVault.decrypt(blob);
  } catch (err) {
    log.error({ err, id }, 'refresh decrypt failed');
    return error(res, 'VAULT_DECRYPT_FAILED', err.message, 500);
  }

  if (!decrypted.refresh_token) {
    return badRequest(res, 'No refresh_token stored for this connector');
  }

  // Resolve client creds.
  const oauthEnv = resolveOAuthEnv(type, row.custom_definition, decrypted);
  if (!oauthEnv.client_id || !oauthEnv.client_secret || !oauthEnv.token_url) {
    return error(res, 'CONNECTOR_NOT_CONFIGURED', 'Client creds missing for refresh', 503);
  }

  try {
    const tokenRes = await axios.post(
      oauthEnv.token_url,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: decrypted.refresh_token,
        client_id: oauthEnv.client_id,
        client_secret: oauthEnv.client_secret,
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        timeout: 10_000,
      }
    );
    const tok = tokenRes.data || {};
    const newPayload = {
      ...decrypted,
      access_token: tok.access_token || decrypted.access_token,
      refresh_token: tok.refresh_token || decrypted.refresh_token,
    };
    const expires_at = tok.expires_in
      ? new Date(Date.now() + Number(tok.expires_in) * 1000)
      : null;

    const enc = credentialVault.encrypt(newPayload);
    await dbRun(
      `UPDATE space_connectors
          SET encrypted_payload = ?::jsonb,
              status = 'active',
              expires_at = ?,
              last_refresh_at = now(),
              last_error = NULL,
              updated_at = now()
        WHERE id = ?`,
      [JSON.stringify(enc), expires_at, id]
    );

    await audit({
      userId: req.user.id,
      action: 'connector.refresh',
      connectorId: id,
      spaceId,
      typeSlug: row.type_slug,
      extra: { ok: true },
      req,
    });

    return success(res, { connector: scrubRow(await loadRow(id)) });
  } catch (err) {
    const status = err?.response?.status;
    const errStr = `refresh_failed${status ? `:${status}` : ''}`;
    await dbRun(
      `UPDATE space_connectors
          SET status = CASE WHEN ? BETWEEN 400 AND 499 THEN 'expired' ELSE status END,
              last_error = ?,
              updated_at = now()
        WHERE id = ?`,
      [status || 0, errStr, id]
    );
    await audit({
      userId: req.user.id,
      action: 'connector.refresh_failed',
      connectorId: id,
      spaceId,
      typeSlug: row.type_slug,
      extra: { error: errStr },
      req,
    });
    return error(res, 'REFRESH_FAILED', errStr, 502);
  }
});

// DELETE /spaces/:spaceId/connectors/:id  — soft-delete (revoke + scrub).
authedRouter.delete('/spaces/:spaceId/connectors/:id', async (req, res) => {
  const spaceId = Number(req.params.spaceId);
  const id = Number(req.params.id);
  if (!Number.isFinite(spaceId) || !Number.isFinite(id)) return badRequest(res, 'Invalid id');

  const space = await ensureSpaceAccess(req, res, spaceId);
  if (!space) return;

  const row = await dbGet(
    `SELECT * FROM space_connectors WHERE id = ? AND space_id = ?`,
    [id, spaceId]
  );
  if (!row) return notFound(res, 'Connector');

  // Best-effort upstream revoke. Per-type implementation in catalogue.
  // Phase 1: figma/notion have no public revoke endpoint — type.revoke absent.
  // Phase 2: google/slack/github revoke here. Non-blocking — local scrub
  // proceeds even if upstream revoke fails (we still want the row gone).
  let upstream_revoke = null;
  const type = getConnectorType(row.type_slug);
  if (type && typeof type.revoke === 'function') {
    try {
      const blob = typeof row.encrypted_payload === 'string'
        ? JSON.parse(row.encrypted_payload)
        : row.encrypted_payload;
      // Empty / scrubbed payload → skip upstream call.
      if (blob && blob.v) {
        const decrypted = credentialVault.decrypt(blob);
        const oauthEnv = resolveOAuthEnv(type, row.custom_definition, decrypted);
        const r = await type.revoke(decrypted, oauthEnv);
        upstream_revoke = r;
      }
    } catch (err) {
      log.warn({ err: err?.message, id, type: row.type_slug }, 'upstream revoke threw (non-blocking)');
      upstream_revoke = { ok: false, error: err?.message || 'threw' };
    }
  }

  await dbRun(
    `UPDATE space_connectors
        SET status = 'revoked',
            encrypted_payload = '{}'::jsonb,
            updated_at = now()
      WHERE id = ?`,
    [id]
  );
  await audit({
    userId: req.user.id,
    action: 'connector.delete',
    connectorId: id,
    spaceId,
    typeSlug: row.type_slug,
    extra: { upstream_revoke },
    req,
  });

  return success(res, { id, status: 'revoked', upstream_revoke });
});

// ─── Callback router (UNAUTHENTICATED) ──────────────────────────────

const callbackRouter = express.Router();

// GET /connectors/mcp-gate — asked by the MCP launcher wrapper on every tool
// call, authenticated by the gate token the CLI provider minted at spawn.
// Re-reads the row each time: the owner's switch cuts open sessions. Always
// 200 with a verdict for a valid token; 401 for anything else.
callbackRouter.get('/mcp-gate', async (req, res) => {
  const auth = req.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  let claims;
  try {
    claims = verifyMcpGateToken(token);
  } catch {
    return res.status(401).json({ success: false, error: { code: 'MCP_GATE_UNAUTHORIZED', message: 'invalid gate token' } });
  }
  const row = await dbGet(`SELECT id, space_id, type_slug, kind, status FROM space_connectors WHERE id = ?`, [
    claims.connector_id,
  ]);
  const verdict = evaluateMcpAccess({ row, agentId: claims.agent_id, spaceId: claims.space_id });
  return success(res, {
    ...verdict,
    connector_id: claims.connector_id,
    agent_id: claims.agent_id,
    space_id: claims.space_id,
  });
});

callbackRouter.get('/oauth/callback', async (req, res) => {
  const { state, code, error: oauthError } = req.query || {};
  if (oauthError) {
    log.warn({ oauthError }, 'OAuth provider returned error to callback');
    return res.status(400).send(`OAuth error: ${String(oauthError).slice(0, 200)}`);
  }
  if (!state || !code) {
    return res.status(400).send('Missing state or code');
  }
  if (!process.env.JWT_SECRET) {
    return res.status(500).send('JWT_SECRET not configured');
  }

  // Verify state JWT.
  let stateData;
  try {
    stateData = jwt.verify(String(state), process.env.JWT_SECRET);
  } catch (err) {
    log.warn({ err: err?.message }, 'state JWT verification failed');
    return res.status(400).send('Invalid or expired state');
  }

  const {
    space_id,
    type_slug,
    display_name,
    redirect_uri,
    scopes_requested,
    custom_definition,
    encrypted_user_fields,
    user_id,
  } = stateData;

  // Re-verify access.
  try {
    const space = await dbGet('SELECT * FROM spaces WHERE id = ?', [space_id]);
    if (!space) return res.status(404).send('Space not found');
    const user = await dbGet('SELECT id, role FROM users WHERE id = ?', [user_id]);
    if (!user) return res.status(403).send('User no longer exists');
    let accessControl = null;
    try {
      accessControl =
        typeof space.access_control === 'string'
          ? JSON.parse(space.access_control)
          : space.access_control;
    } catch {
      /* ignore */
    }
    const allowed = await checkUserSpaceAccess(user.id, user.role, space, accessControl);
    if (!allowed) return res.status(403).send('No longer authorized for this space');
  } catch (err) {
    log.error({ err }, 'callback access recheck failed');
    return res.status(500).send('Access recheck failed');
  }

  // Recompute redirect_uri from current request and compare with state.
  const currentRedirect = buildRedirectUri(req);
  if (currentRedirect !== redirect_uri) {
    log.warn({ currentRedirect, statedRedirect: redirect_uri }, 'redirect_uri mismatch');
    return res.status(400).send('redirect_uri mismatch — refusing to exchange code');
  }

  const type = getConnectorType(type_slug);
  if (!type) return res.status(400).send(`Unknown type ${type_slug}`);

  // Resolve client creds. encrypted_user_fields carries either custom_oauth2's
  // client_secret OR a branded provider's per-row client_overrides (paste-in-UI).
  let decryptedUserFields = null;
  if (encrypted_user_fields) {
    try {
      decryptedUserFields = credentialVault.decrypt(encrypted_user_fields);
    } catch (err) {
      log.error({ err }, 'callback decrypt user fields failed');
      return res.status(500).send('Vault decrypt failed');
    }
  }
  const oauthEnv = resolveOAuthEnv(type, custom_definition, decryptedUserFields);
  if (!oauthEnv.client_id || !oauthEnv.client_secret || !oauthEnv.token_url) {
    return res.status(503).send('Connector not configured (missing client creds)');
  }

  // Exchange code for token.
  let tokenResponse;
  try {
    if (typeof type.exchangeCode === 'function') {
      tokenResponse = await type.exchangeCode({
        code: String(code),
        redirect_uri,
        env: { client_id: oauthEnv.client_id, client_secret: oauthEnv.client_secret },
      });
    } else {
      const tokRes = await axios.post(
        oauthEnv.token_url,
        new URLSearchParams({
          grant_type: 'authorization_code',
          code: String(code),
          redirect_uri,
          client_id: oauthEnv.client_id,
          client_secret: oauthEnv.client_secret,
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          timeout: 10_000,
        }
      );
      tokenResponse = tokRes.data;
    }
  } catch (err) {
    const status = err?.response?.status;
    log.error({ err: err?.message, status, type_slug }, 'token exchange failed');
    return res.status(502).send(`Token exchange failed${status ? ` (HTTP ${status})` : ''}`);
  }

  if (!tokenResponse?.access_token) {
    return res.status(502).send('Token endpoint returned no access_token');
  }

  // Pull account info (best-effort).
  let info = {};
  if (typeof type.extractAccountInfo === 'function') {
    try {
      info = (await type.extractAccountInfo(tokenResponse)) || {};
    } catch {
      info = {};
    }
  }

  // Build encrypted payload. Persist branded paste-in-UI client_overrides so
  // the refresh job and per-row /test/revoke can reuse them later without
  // re-pasting. custom_oauth2's client_secret is preserved too.
  const payload = {
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token || null,
    raw: tokenResponse,
  };
  if (decryptedUserFields?.client_overrides) {
    payload.client_overrides = decryptedUserFields.client_overrides;
  }
  if (decryptedUserFields?.client_secret && type.slug === 'custom_oauth2') {
    payload.client_secret = decryptedUserFields.client_secret;
  }
  let encrypted;
  try {
    encrypted = credentialVault.encrypt(payload);
  } catch (err) {
    log.error({ err }, 'callback vault encrypt failed');
    return res.status(503).send('Vault not configured');
  }

  const expires_at = tokenResponse.expires_in
    ? new Date(Date.now() + Number(tokenResponse.expires_in) * 1000)
    : null;
  const scopes_granted = info.scopes_granted
    || (typeof tokenResponse.scope === 'string' ? tokenResponse.scope.split(/[ ,]+/).filter(Boolean) : []);

  // Identity block from UserInfo (ADR-159 §Schema). Drives the switcher.
  const identity = deriveIdentity(info);

  let newId;
  try {
    // Re-authing the same account (same provider `sub` in the same space) must
    // UPDATE the existing row, not violate the new UNIQUE — refresh creds +
    // identity + status, but keep the user-editable `display_name` and original
    // `created_by`/`created_at`. Rows with a NULL account_sub never conflict, so
    // they take the plain INSERT path (current multi-row behaviour preserved).
    const result = await dbRun(
      `INSERT INTO space_connectors
         (space_id, type_slug, kind, display_name, status, scopes_requested, scopes_granted,
          account_label, account_sub, email, account_name, avatar_url, profile,
          encrypted_payload, custom_definition, expires_at, created_by)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb, ?, ?)
       ON CONFLICT ON CONSTRAINT space_connectors_account_uq DO UPDATE SET
            status = 'active',
            scopes_requested = EXCLUDED.scopes_requested,
            scopes_granted = EXCLUDED.scopes_granted,
            account_label = EXCLUDED.account_label,
            email = EXCLUDED.email,
            account_name = EXCLUDED.account_name,
            avatar_url = EXCLUDED.avatar_url,
            profile = EXCLUDED.profile,
            encrypted_payload = EXCLUDED.encrypted_payload,
            expires_at = EXCLUDED.expires_at,
            last_error = NULL,
            updated_at = now()
       RETURNING id`,
      [
        space_id,
        type_slug,
        'oauth2',
        display_name,
        scopes_requested || [],
        scopes_granted || [],
        info.account_label || null,
        identity.account_sub,
        identity.email,
        identity.account_name,
        identity.avatar_url,
        identity.profile ? JSON.stringify(identity.profile) : null,
        JSON.stringify(encrypted),
        custom_definition ? JSON.stringify(custom_definition) : null,
        expires_at,
        user_id,
      ]
    );
    newId = result.lastInsertRowid;
  } catch (err) {
    log.error({ err }, 'callback insert failed');
    return res.status(500).send('DB insert failed');
  }

  await audit({
    userId: user_id,
    action: 'connector.callback',
    connectorId: newId,
    spaceId: space_id,
    typeSlug: type_slug,
    extra: { account_label: info.account_label || null },
    req,
  });

  const target = `/spaces/${space_id}/settings/connectors?connected=${newId}`;
  return res.redirect(302, target);
});

// ─── Exports ────────────────────────────────────────────────────────

export { callbackRouter as connectorsCallbackRouter };
// Exported for unit tests (ADR-159 §Schema identity mapping).
export { deriveIdentity, MODULE_CONNECTOR_TYPES };
export default authedRouter;
