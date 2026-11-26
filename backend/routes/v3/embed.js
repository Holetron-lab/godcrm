import crypto from 'node:crypto';
import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { dbGet, dbRun, safeJsonParse, withTransactionAsync } from '../../database/connection.js';
import { checkUserSpaceAccess } from '../../services/space/access.js';
import { getClient, verifyClientSecret } from '../../services/oidc/clientRegistry.js';
import { writeAudit } from '../../services/audit/writeAudit.js';
import { apiLogger } from '../../utils/logger.js';
import { error as errorResponse, success as respondSuccess } from '../../utils/response.js';

const TICKET_TTL_SECONDS = 60;
const EMBED_TOKEN_TTL_SECONDS = 900;
const router = express.Router();
const log = apiLogger.child({ module: 'embed_tickets' });
const respondError = (res, status, code, message) => errorResponse(res, code, message, status);
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

const issueSchema = z.object({
  sub: z.string().regex(/^[1-9]\d*$/).refine((value) => Number(value) <= 2147483647),
  parent_origin: z.string().min(1).max(2048),
}).strict();

const redemptionSchema = z.object({
  client_id: z.string().min(1).max(100),
  ticket: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  parent_origin: z.string().min(1).max(2048),
}).strict();

function parseBasicClient(header) {
  if (typeof header !== 'string' || !header.startsWith('Basic ')) return null;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon < 1) return null;
  try {
    return {
      clientId: decodeURIComponent(decoded.slice(0, colon)),
      secret: decodeURIComponent(decoded.slice(colon + 1)),
    };
  } catch {
    return null;
  }
}

function requestClientKey(req) {
  return parseBasicClient(req.headers.authorization)?.clientId || req.body?.client_id || 'unknown';
}

function rateLimitHandler(req, res) {
  void writeAudit(req, {
    action: 'embed.rate_limited',
    entity_type: 'embed_ticket',
    details: { path: req.path, client_id: requestClientKey(req) },
  });
  return respondError(res, 429, 'RATE_LIMITED', 'Too many embed ticket requests');
}

const ipLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) => ipKeyGenerator(req, res),
  validate: { xForwardedForHeader: false },
  handler: rateLimitHandler,
});

const clientLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `client:${requestClientKey(req)}`,
  handler: rateLimitHandler,
});

const userLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `user:${requestClientKey(req)}:${req.body?.sub || 'unknown'}`,
  handler: rateLimitHandler,
});

router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (process.env.EMBED_TICKET_AUTH_ENABLED !== 'true') {
    return respondError(res, 404, 'ENDPOINT_NOT_FOUND', 'API endpoint not found');
  }
  next();
});
router.use(ipLimiter);

function audit(req, action, details = {}) {
  if (details.space_id != null) req.spaceId = details.space_id;
  void writeAudit(req, {
    action,
    entity_type: 'embed_ticket',
    entity_id: details.ticket_id != null ? String(details.ticket_id) : null,
    details,
  });
}

async function authenticateClient(req) {
  const credentials = parseBasicClient(req.headers.authorization);
  if (!credentials) return null;
  const client = await getClient(credentials.clientId);
  if (!client || client.is_public) return null;
  if (!(await verifyClientSecret(client, credentials.secret))) return null;
  return client;
}

function isAllowedOrigin(client, origin) {
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && url.origin === origin && client.allowed_origins.includes(origin);
  } catch {
    return false;
  }
}

async function getActiveUser(userId) {
  const user = await dbGet(
    'SELECT id, email, role, status, user_type FROM users WHERE id = ?',
    [userId],
  );
  if (!user || (user.status || 'active') !== 'active' || (user.user_type || 'human') !== 'human') {
    return null;
  }
  return user;
}

async function hasSpaceAccess(user, spaceId) {
  const space = await dbGet('SELECT * FROM spaces WHERE id = ?', [spaceId]);
  if (!space) return false;
  const accessControl = safeJsonParse(space.access_control, null);
  return checkUserSpaceAccess(user.id, user.role, space, accessControl);
}

function invalidTicket(res) {
  return respondError(res, 401, 'INVALID_EMBED_TICKET', 'Embed ticket is invalid or expired');
}

router.post('/tickets', clientLimiter, userLimiter, asyncRoute(async (req, res) => {
  const credentials = parseBasicClient(req.headers.authorization);
  const client = await authenticateClient(req);
  if (!client) {
    audit(req, 'embed.ticket.issue_denied', {
      client_id: credentials?.clientId || null, reason: 'client_authentication',
    });
    return respondError(res, 401, 'INVALID_CLIENT', 'Invalid client credentials');
  }

  const parsed = issueSchema.safeParse(req.body);
  if (!parsed.success) {
    audit(req, 'embed.ticket.issue_denied', {
      client_id: client.client_id, space_id: client.space_id, reason: 'validation',
    });
    return respondError(res, 400, 'VALIDATION_ERROR', 'Invalid ticket request');
  }

  const { sub, parent_origin } = parsed.data;
  if (!Number.isInteger(client.space_id) || client.login_tier !== 'oidc') {
    audit(req, 'embed.ticket.issue_denied', {
      client_id: client.client_id, reason: 'client_binding',
    });
    return respondError(res, 403, 'EMBED_CLIENT_FORBIDDEN', 'Client is not configured for embed tickets');
  }
  if (!isAllowedOrigin(client, parent_origin)) {
    audit(req, 'embed.ticket.issue_denied', {
      client_id: client.client_id, space_id: client.space_id, reason: 'parent_origin',
    });
    return respondError(res, 403, 'EMBED_ORIGIN_FORBIDDEN', 'Parent origin is not allowed');
  }

  const user = await getActiveUser(Number(sub));
  if (!user || !(await hasSpaceAccess(user, client.space_id))) {
    audit(req, 'embed.ticket.issue_denied', {
      client_id: client.client_id, space_id: client.space_id, user_id: Number(sub), reason: 'user_or_space_access',
    });
    return respondError(res, 403, 'EMBED_USER_FORBIDDEN', 'User cannot access the bound embed space');
  }

  const ticket = crypto.randomBytes(32).toString('base64url');
  const ticketHash = crypto.createHash('sha256').update(ticket).digest('hex');
  const inserted = await dbRun(
    `INSERT INTO embed_tickets (
      ticket_hash, client_id, user_id, space_id, parent_origin, expires_at
    ) VALUES (?, ?, ?, ?, ?, NOW() + (? * INTERVAL '1 second'))
    RETURNING id`,
    [ticketHash, client.client_id, user.id, client.space_id, parent_origin, TICKET_TTL_SECONDS],
  );
  audit(req, 'embed.ticket.issued', {
    ticket_id: inserted.lastInsertRowid,
    client_id: client.client_id,
    user_id: user.id,
    space_id: client.space_id,
    parent_origin,
    expires_in: TICKET_TTL_SECONDS,
  });
  return respondSuccess(res, {
    ticket,
    expires_in: TICKET_TTL_SECONDS,
    space_id: client.space_id,
  }, 201);
}));

router.post('/session', clientLimiter, asyncRoute(async (req, res) => {
  const parsed = redemptionSchema.safeParse(req.body);
  if (!parsed.success) {
    audit(req, 'embed.ticket.redeem_denied', {
      client_id: req.body?.client_id || null, reason: 'validation',
    });
    return invalidTicket(res);
  }

  const { client_id, ticket, parent_origin } = parsed.data;
  const ticketHash = crypto.createHash('sha256').update(ticket).digest('hex');
  const consumed = await withTransactionAsync(async (trx) => {
    const result = await trx.query(
      `UPDATE embed_tickets
       SET consumed_at = NOW()
       WHERE ticket_hash = ?
         AND client_id = ?
         AND parent_origin = ?
         AND consumed_at IS NULL
         AND expires_at > NOW()
       RETURNING id, client_id, user_id, space_id, parent_origin`,
      [ticketHash, client_id, parent_origin],
    );
    return result.rows[0] || null;
  });
  if (!consumed) {
    audit(req, 'embed.ticket.redeem_denied', { client_id, reason: 'ticket_binding_or_replay' });
    return invalidTicket(res);
  }

  const client = await getClient(client_id);
  const user = await getActiveUser(consumed.user_id);
  const valid = client
    && !client.is_public
    && client.login_tier === 'oidc'
    && client.space_id === consumed.space_id
    && isAllowedOrigin(client, parent_origin)
    && user
    && await hasSpaceAccess(user, consumed.space_id);
  if (!valid) {
    audit(req, 'embed.ticket.redeem_denied', {
      ticket_id: consumed.id,
      client_id,
      user_id: consumed.user_id,
      space_id: consumed.space_id,
      reason: 'client_user_or_space_access',
    });
    return invalidTicket(res);
  }

  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not configured');
  const accessToken = jwt.sign(
    {
      id: user.id,
      sub: String(user.id),
      email: user.email,
      role: user.role,
      embed: true,
      client_id,
      space_id: consumed.space_id,
      parent_origin,
    },
    process.env.JWT_SECRET,
    { expiresIn: EMBED_TOKEN_TTL_SECONDS },
  );
  audit(req, 'embed.ticket.redeemed', {
    ticket_id: consumed.id,
    client_id,
    user_id: user.id,
    space_id: consumed.space_id,
    parent_origin,
    expires_in: EMBED_TOKEN_TTL_SECONDS,
  });
  return respondSuccess(res, {
    accessToken,
    expiresIn: EMBED_TOKEN_TTL_SECONDS,
    user: { id: String(user.id), email: user.email, role: user.role },
    space_id: consumed.space_id,
  });
}));

router.use((err, req, res, next) => {
  if (!err) return next();
  log.error({ err, clientId: requestClientKey(req) }, 'Embed ticket request failed');
  audit(req, 'embed.ticket.error', { client_id: requestClientKey(req), reason: 'internal_error' });
  if (res.headersSent) return next(err);
  return respondError(res, 500, 'EMBED_TICKET_FAILED', 'Embed ticket request failed');
});

export default router;
