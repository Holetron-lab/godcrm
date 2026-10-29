// ⚠️ CRITICAL: Import config FIRST to load .env before other modules
import { config } from './config.js';

import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

// Security & Logging (ADR-015)
import { globalLimiter, authLimiter, codeExecutionLimiter } from './middleware/rateLimiter.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { createCorsOriginHandler } from './middleware/corsConfig.js'; // ADR-064: Strict CORS
import { logger, requestLogger, apiLogger } from './utils/logger.js';

// ADR-036: Swagger/OpenAPI Documentation
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { swaggerOptions } from './swagger.config.js';

// v0.003.001 - Clean v3 Architecture + Security Fixes (ADR-021)
// v2 legacy removed — all routes now in v3
import authRoutesV3 from './routes/v3/auth.js';
import spacesRoutesV3 from './routes/v3/spaces.js';
import projectsRoutesV3 from './routes/v3/projects.js';
import tablesRoutesV3 from './routes/v3/tables.js';
import columnsRoutesV3 from './routes/v3/columns.js';  // ADR-019: Separated columns
import rowsRoutesV3 from './routes/v3/rows.js';        // ADR-019: Separated rows (bulk operations)
import widgetRoutesV3 from './routes/v3/widgets.js';
import { mountModuleRoutes } from './modules/loader.js'; // MODULE-CONTRACT v1: autonomous-module route registry (replaces static per-module imports, e.g. ADR-165 SC-SIM)
import dataSourcesRoutesV3 from './routes/v3/data-sources.js';
import filesRoutesV3 from './routes/v3/files.js';
import webhooksRoutesV3 from './routes/v3/webhooks.js';
import apiKeysRoutesV3 from './routes/v3/api-keys.js';
import aiAgentsRoutesV3 from './routes/v3/ai-agents.js';
import foldersRoutesV3 from './routes/v3/folders.js';
import batchRoutesV3 from './routes/v3/batch.js';
import schemaRoutesV3 from './routes/v3/schema.js';
import userSettingsRoutesV3 from './routes/v3/user-settings.js';
import documentsRoutesV3 from './routes/v3/documents.js';
import systemRoutesV3 from './routes/v3/system.js';
import exportImportRoutesV3 from './routes/v3/export-import.js'; // ADR-020: Export/Import
import agentUsersRoutesV3 from './routes/v3/agent-users.js'; // ADR-023: Agent-as-User
import errorPagesRoutes from './routes/error-pages/index.js';
import testDoomRoutes from './routes/test-doom.js';
import chatRoutesV3 from './routes/v3/chat.js'; // ADR-024: Chat & Message Architecture
import fitnessRoutesV3 from './routes/v3/fitness.js'; // ADR-025: Fitness Module
import wellnessRoutesV3 from './routes/v3/wellness.js'; // ADR-027: Wellness Ecosystem
import codeRoutesV3 from './routes/v3/code.js'; // ADR-032: Code Execution Engine
import terminalRoutesV3 from './routes/v3/terminal.js'; // ADR-024: OpenCode Terminal Agent
import labsRoutesV3 from './routes/v3/labs.js'; // ADR-043: MindWorkflow Integration
import columnMappingRoutesV3 from './routes/v3/column-mapping.js'; // ADR-069: Column Mapping
import widgetLibraryRoutesV3 from './routes/v3/widget-library.js'; // ADR-073: Widget Picker System
import moduleInstallRoutesV3 from './routes/v3/module-install.js'; // ADR-200 W2: no-deploy module installer
import ticketsRoutesV3 from './routes/v3/tickets.js'; // ADR-098: Ticket Status API
import agentVersionsRoutesV3 from './routes/v3/agent-versions.js'; // ADR-0007-S: G1-data agent_versions write path
import telegramRoutesV3 from './routes/v3/telegram.js'; // ADR-098: Telegram Bot integration
import telegramNikitronRoutes from './routes/v3/telegramNikitron.js'; // NikitronBot: Telegram bot for Nikitron
import oauthRoutes from './routes/oauth/index.js'; // ADR-063: OIDC Provider for WorkAdventure
import waRoutesV3 from './routes/v3/wa/index.js'; // ADR-063: WorkAdventure Admin API
import calendarRoutesV3 from './routes/v3/calendar.js'; // Google Calendar Integration
import frameRoutesV3 from './routes/v3/frame.js'; // Brilliant Frame Smart Glasses Integration
import deviceLogsRoutesV3 from './routes/v3/device-logs.js'; // BLE Device Debug Logs
import { startCalendarSync } from './services/CalendarSyncScheduler.js'; // Google Calendar Scheduler
import scheduleTriggerService from './services/ScheduleTriggerService.js'; // Schedule-based automation triggers
import lifePipelineRoutesV3 from './routes/v3/life-pipeline.js'; // Life Pipeline: Morning Briefing, Evening Check-in
import contentPipelineRoutesV3 from './routes/v3/content-pipeline.js'; // Content Pipeline: AI/Tech News Aggregation
import publicRoutesV3 from './routes/v3/public.js'; // ADR-105: Public Space Access (no auth)
// NO-SIGNUP-MCP §B1: friendly-path alias for the per-space public MCP mount so
// the shipped `godcrm.ai/s/help/mcp` URL resolves at the app level (the
// canonical mount is `/api/v3/public/s/:slug/mcp` on publicRoutesV3).
import { publicAbuseGuard, publicRateLimit, publicSpaceAccess } from './middleware/publicAccess.js';
import { mcpPublicHandler } from './services/mcp/publicMcp.js';
import screenshotsRoutesV3 from './routes/v3/screenshots.js'; // Screenshot Service for Telegram posts
import pesRoutesV3 from './routes/v3/pes.js'; // PES ↔ CRM Bridge
import nowStateRoutesV3 from './routes/v3/now-state.js'; // ADR-171 T1: NowState read-model
import pesAppRoutes from './routes/v3/pes/appRoutes.js'; // PES Mini App (public)
import pluginRoutesV3 from './routes/v3/plugin.js'; // Plugin API (Photoshop, etc.)
import bddRoutesV3 from './routes/v3/bdd.js'; // ADR-156 Phase 5A: BDD test runs
import connectorsAuthedRouter, { connectorsCallbackRouter } from './routes/v3/connectors.js'; // ADR-0028 Phase 1: Space Connectors
import opsAuthedRouter, { opsGateRouter } from './routes/v3/ops.js'; // Constitution v4.3 ops profiles: diagnostics / local-qa broker
import { reapOpsWorkers } from './services/ops/opsBroker.js'; // ops broker crash recovery
import stagingAuthedRouter, { stagingGateRouter } from './routes/v3/ops-staging.js'; // staging channel: sysadmin preflight via independent executor
import { reapStagingChannel } from './services/ops/stagingExecutionBroker.js'; // staging channel crash recovery
import mailRoutesV3 from './routes/v3/mail.js'; // ADR-160: Mail module (IMAP/SMTP bridge)
import credentialVault from './services/connectors/CredentialVault.js'; // ADR-0028 Phase 1: vault lifecycle
import adminChatNotificationsRoutesV3 from './routes/v3/admin/chatNotifications.js'; // ADR-0064 WP-A: global default chat notification prefs
import { startInvalidationListener as startChatPrefsListener } from './services/notifications/resolveChatPrefs.js'; // ADR-0064 WP-A: cluster-wide cache eviction
import adminRegistrationRoutesV3 from './routes/v3/admin/registration.js'; // ADR-188 F1: owner-only runtime registration policy
import { startRegistrationPolicyListener } from './services/registrationPolicy.js'; // ADR-188 F1: cluster-wide policy-cache eviction
import { startInflightBus } from './services/inflight/notifyBus.js'; // ADR-0057-A WP-B: chat_inflight LISTEN bus
import { registerBlogSeoRoutes } from './services/blogSeo.js'; // ADR-190: crawler-readable SSR-lite for /blog/* + sitemap/robots
import { registerPublicDocsSeoRoutes, collectDocsSitemapUrls } from './services/publicDocsSeo.js'; // ADR-190-A: same for opted-in public spaces' docs hub
import { registerLandingSeoRoutes } from './services/landingSeo.js'; // GEO pack (chat 3772): same for the marketing landing `/` + `/welcome`
import ownerRoutesV3 from './routes/v3/owner.js'; // ADR-0059 AMEND-3 §4.9: owner calls settings
import permissionResolver from './services/agent-permissions/resolver.js'; // ADR-0053 Phase C2: command-policy resolver
import agentPermissionsRoutesV3 from './routes/v3/agent-permissions.js'; // ADR-0053 Phase C2: PreToolUse hook endpoint
import secretsVault from './services/secrets/SecretsVault.js'; // ADR-0040 Phase 0: owner secrets vault
import secretsRoutesV3 from './routes/v3/secrets.js'; // ADR-0040 Phase 1: owner secrets CRUD + reveal
import auditRoutesV3 from './routes/v3/audit.js'; // ADR-0066-A §C: owner-only audit chain verify
import { getAdapter as getDbAdapter } from './database/connection.js'; // ADR-0040/ADR-0053: vault + resolver DB binding
import agentRunDispatcherAdminRouter from './routes/v3/agentRunDispatcher.js'; // ADR-0030 Phase 2: dispatcher admin API
import { authenticate } from './middleware/auth.js';
import { requestContext } from './middleware/requestContext.js'; // ADR-0066 P0: req.requestId/spaceId/actingAs
import uploadStatic from './middleware/uploadStatic.js';
import { uploadsFileGuard, downloadsFileGuard } from './middleware/fileGuard.js'; // ADR-0016: Authenticated file delivery
import { dbGet } from './database/connection.js'; // ADR-064: Health check DB ping

// Monitoring service (self-hosted)
import { createMonitoringRouter } from './services/MonitoringService.js';

// Routes moved from v2 to v3 (still used on v3 endpoints)
import automationsRoutes from './routes/v3/automations.js';
import formConfigsRoutes from './routes/v3/form-configs.js';
import accessRoutes from './routes/v3/access.js';

const app = express();

// Trust first proxy (nginx) — required for express-rate-limit behind reverse proxy
app.set('trust proxy', 1);
const PORT = config.PORT;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDistPath = path.resolve(__dirname, '../dist');
// Middleware
// CSP must allow WebAssembly instantiation (pixi/transcoder WASM modules).
// helmet()'s default script-src is 'self' only, which throws
// "WebAssembly.instantiate(): ... 'unsafe-eval' is not an allowed source"
// in Safari/Chrome. 'wasm-unsafe-eval' enables WASM compile without the
// full 'unsafe-eval' relaxation. Directives mirror deploy/nginx/godcrm.conf.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'", "'wasm-unsafe-eval'"],
        // mirror deploy/nginx/godcrm.conf: marketing landing (godcrm.ai) pulls
        // Google Fonts (fonts.googleapis.com CSS + fonts.gstatic.com files) and
        // embeds YouTube. Without https: in style/font-src the stylesheet is
        // refused and the landing falls back to system fonts.
        'style-src': ["'self'", 'https:', "'unsafe-inline'"],
        // Mail HTML embeds sender-hosted images; keep in sync with nginx.
        'img-src': ["'self'", 'https:', 'data:', 'blob:'],
        'font-src': ["'self'", 'https:', 'data:'],
        'connect-src': ["'self'", 'wss:', 'https:'],
        'frame-src': ['https://www.youtube-nocookie.com', 'https://www.youtube.com']
      }
    }
  })
);
// ADR-176: the embed loader + chat iframe are deliberately cross-origin — they
// are dropped into third-party sites (e.g. the Penpot clone at design-test.godcrm.ai).
// helmet's default Cross-Origin-Resource-Policy: same-origin makes the browser
// block the cross-origin <script src=".../embed.js"> with ERR_BLOCKED_BY_RESPONSE
// .NotSameOrigin, so the loader never runs and the bubble never mounts. Relax CORP
// to cross-origin for the embed surface ONLY (framing is still gated by the CSP
// frame-ancestors allow-list on /embed/chat). Runs after helmet so it overrides.
app.use((req, res, next) => {
  if (req.path === '/embed.js' || req.path === '/embed/chat') {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  }
  next();
});
// Allow CORS for AI agent worker endpoints (server-to-server, external workers)
app.use('/api/v3/ai/agents/jobs', cors());
// ADR-064: Strict CORS — production requires explicit CORS_ORIGINS
app.use(
  cors({
    credentials: true,
    origin: createCorsOriginHandler()
  })
);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cookieParser());

// Request logging middleware (Pino)
app.use(requestLogger);

// Global rate limiter for all API routes
app.use('/api', globalLimiter);

// ADR-036: Swagger UI and OpenAPI JSON endpoints
const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'GOD CRM API Documentation',
  customCss: '.swagger-ui .topbar { display: none }',
  swaggerOptions: {
    persistAuthorization: true
  }
}));
app.get('/api/openapi.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json(swaggerSpec);
});

// PostgreSQL mode — Knex migrations handle schema
logger.info('🐘 PostgreSQL mode — using Knex migrations');

// ✅ OIDC Provider Routes (ADR-063: WorkAdventure Integration)
// Public OAuth endpoints - no authentication required
app.use('/oauth', oauthRoutes);
app.use('/.well-known', oauthRoutes); // For OIDC discovery

// Plugin login — no auth required, always returns 200 (UXP fetch throws on 4xx)
app.post('/api/v3/plugin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.json({ success: false, error: 'Email and password are required' });
    }
    const ipAddress = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const result = await (await import('./services/AuthService.js')).loginUser(email, password, ipAddress, userAgent);
    if (!result.success) {
      return res.json({ success: false, error: result.error || 'Invalid email or password' });
    }
    const { createAccessToken: makeToken } = await import('./routes/v3/auth/authShared.js');
    const accessToken = makeToken(result.user);
    return res.json({ success: true, accessToken, user: result.user });
  } catch (error) {
    return res.json({ success: false, error: error.message || 'Login failed' });
  }
});

// Telegram Bot webhook (no auth — Telegram sends updates directly, security via chat_id check)
// Must be BEFORE authenticated routes to avoid /api/v3 catch-all with authenticate middleware
app.use('/api/v3/telegram', telegramRoutesV3);
app.use('/api/v3/telegram/nikitron', telegramNikitronRoutes); // NikitronBot

// Google Calendar OAuth callback (no auth — redirect from Google)
// Token exchange happens server-side using userId from state parameter
// No localStorage or CRM auth needed — fixes 401 errors after Google redirect
app.get('/auth/google/calendar/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code) {
    return res.status(400).send('Missing authorization code');
  }

  // Extract userId from state parameter (format: "calendar:{userId}")
  const decodedState = state ? decodeURIComponent(state) : '';
  const userId = decodedState.startsWith('calendar:') ? parseInt(decodedState.split(':')[1], 10) : null;
  if (!userId || isNaN(userId)) {
    return res.status(400).send('Invalid state parameter — missing user ID');
  }

  // Import GoogleCalendarService functions
  const { handleCallback: calHandleCallback, listCalendars: calListCalendars } = await import('./services/GoogleCalendarService.js');

  let resultHtml;
  try {
    // Exchange code for tokens server-side (no client auth needed)
    const redirectUri = `${req.protocol}://${req.get('host')}/auth/google/callback`;
    await calHandleCallback(code, redirectUri, userId);

    // Get calendar list for display
    let calendars = [];
    try {
      calendars = await calListCalendars(userId);
    } catch (e) {
      apiLogger.warn({ err: e }, 'Could not list calendars after connect');
    }

    resultHtml = `
<div class="success" style="display:block">✅</div>
<h2>Аккаунт подключён!</h2>
<p>Календарей: ${calendars.length}<br><br>Можно закрыть эту вкладку</p>`;
  } catch (err) {
    apiLogger.error({ err }, 'Calendar callback failed');
    resultHtml = `
<h2 style="color:#ea4335">Ошибка подключения</h2>
<p>${err.message || 'Unknown error'}</p>
<p><a href="/">Вернуться</a></p>`;
  }

  res.send(`<!DOCTYPE html>
<html><head><title>Google Calendar</title>
<style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f8f9fa}
.card{background:white;padding:40px;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,0.1);text-align:center;max-width:400px}
.success{color:#34a853;font-size:48px}
</style></head><body>
<div class="card">${resultHtml}</div>
</body></html>`);
});

// ✅ API Routes v3 (Clean Architecture)
// ADR-0066 P0: request-context middleware. Mounted on /api/v3 BEFORE all
// route handlers — including public routes and `authenticate` — so the
// requestId is available on every audit_log row (including auth failures).
app.use('/api/v3', requestContext);

app.use('/api/v3/auth', authLimiter, authRoutesV3);
// v2/auth alias removed — frontend uses v3
// Device logs: POST is public (no auth), GET/DELETE authenticated inside router
// Must be before '/api/v3' catch-all routes to avoid authenticate middleware interception
app.use('/api/v3/device-logs', deviceLogsRoutesV3);
// Life Pipeline (no auth for cron/webhook triggers — must be before catch-all /api/v3 routes)
app.use('/api/v3/integrations', lifePipelineRoutesV3);
// Content Pipeline (no auth for cron/webhook triggers — AI/tech news aggregation)
app.use('/api/v3/content-pipeline', contentPipelineRoutesV3);
// ADR-105: Public space access routes (no auth — external visibility via slug)
// Must be before authenticated /api/v3 routes to avoid authenticate middleware interception
app.use('/api/v3/public', publicRoutesV3);
// PES Mini App (public, no auth — must be before catch-all /api/v3 authenticated routes)
app.use('/api/v3/pes', pesAppRoutes);
// ADR-140: Палевность Checker (public, no auth)

// ADR-156 iter-5 Task 4: /api/v3/echo — smoke-test endpoint for BDD curl runner.
// Public (no auth) by design; globalLimiter above rate-limits abuse (10k/15m in prod).
app.get('/api/v3/echo', (req, res) => {
  res.json({ ok: true, ts: Date.now(), method: 'GET' });
});
app.post('/api/v3/echo', (req, res) => {
  res.json({ ok: true, ts: Date.now(), method: 'POST', body: req.body ?? null });
});

// ADR-0028 Phase 1: Space Connectors OAuth callback. MUST be mounted BEFORE
// any `app.use('/api/v3', authenticate, ...)` chain — state JWT carries identity,
// the upstream OAuth provider redirect arrives without our auth header.
app.use('/api/v3/connectors', connectorsCallbackRouter);

// Ops profiles agent transport: authenticated by the spawn-time gate token,
// not by a user JWT — so it too sits BEFORE the `authenticate` chain.
app.use('/api/v3/ops', opsGateRouter);
app.use('/api/v3/ops', stagingGateRouter); // same gate token, separate grants (staging channel)

// ADR-0053 Phase C2: agent command-policy resolver. MUST be mounted BEFORE
// the global `authenticate` chain — POST /check is gated by an internal
// token (used by the PreToolUse hook subprocess, which has no JWT), while
// GET /audit and /health apply JWT inside the router.
app.use('/api/v3/agent-permissions', agentPermissionsRoutesV3);

app.use('/api/v3/spaces', authenticate, spacesRoutesV3);
app.use('/api/v3', authenticate, agentRunDispatcherAdminRouter); // ADR-0030 Phase 2 admin tick + health
app.use('/api/v3/projects', authenticate, projectsRoutesV3);
app.use('/api/v3/data-sources', authenticate, dataSourcesRoutesV3);
app.use('/api/v3/api-keys', authenticate, apiKeysRoutesV3);
app.use('/api/v3/ai', authenticate, aiAgentsRoutesV3);
app.use('/api/v3', authenticate, tablesRoutesV3);
app.use('/api/v3', authenticate, columnsRoutesV3);   // ADR-019: Separated columns routes
app.use('/api/v3', authenticate, rowsRoutesV3);      // ADR-019: Separated rows bulk operations
app.use('/api/v3', authenticate, widgetRoutesV3);
// MODULE-CONTRACT v1: mount present autonomous modules' backend routes by manifest
// (data, not static imports). Absent module → nothing mounted, core boots clean.
// Formerly the static SC-SIM mount; now sc-sim rides backend/modules/sc-sim/.
await mountModuleRoutes(app, authenticate, apiLogger);
app.use('/api/v3', authenticate, filesRoutesV3);
app.use('/api/v3', authenticate, webhooksRoutesV3);
app.use('/api/v3', authenticate, foldersRoutesV3);
app.use('/api/v3', authenticate, batchRoutesV3);
app.use('/api/v3', authenticate, schemaRoutesV3);
app.use('/api/v3/user-settings', authenticate, userSettingsRoutesV3);
app.use('/api/v3', authenticate, documentsRoutesV3);
app.use('/api/v3', authenticate, exportImportRoutesV3); // ADR-020: Export/Import
app.use('/api/v3/system', authenticate, systemRoutesV3);
app.use('/api/v3/users', authenticate, agentUsersRoutesV3); // ADR-023: Agent-as-User
app.use('/api/v3', authenticate, agentVersionsRoutesV3); // ADR-0007-S: G1-data agent_versions (mint/promote/retire)
app.use('/api/v3/chat', authenticate, chatRoutesV3); // ADR-024: Chat & Message Architecture
app.use('/api/v3/fitness', authenticate, fitnessRoutesV3); // ADR-025: Fitness Module
app.use('/api/v3/wellness', authenticate, wellnessRoutesV3); // ADR-027: Wellness Ecosystem
app.use('/api/v3/code', authenticate, codeExecutionLimiter, codeRoutesV3); // ADR-032: Code Execution Engine
app.use('/api/v3/terminal', authenticate, terminalRoutesV3); // ADR-024: OpenCode Terminal Agent
app.use('/api/v3/labs', authenticate, labsRoutesV3); // ADR-043: MindWorkflow Integration
app.use('/api/v3/column-mapping', authenticate, columnMappingRoutesV3); // ADR-069: Column Mapping
app.use('/api/v3', authenticate, widgetLibraryRoutesV3); // ADR-073: Widget Picker System
app.use('/api/v3/modules', authenticate, moduleInstallRoutesV3); // ADR-200 W2: blueprint install/upgrade/uninstall
app.use('/api/v3', authenticate, ticketsRoutesV3); // ADR-098: Ticket Status API
app.use('/api/v3/wa', authenticate, waRoutesV3); // ADR-063: WorkAdventure Admin API
app.use('/api/v3/calendar', authenticate, calendarRoutesV3); // Google Calendar Integration
app.use('/api/v3/frame', authenticate, frameRoutesV3); // Brilliant Frame Smart Glasses
app.use('/api/v3/screenshots', authenticate, screenshotsRoutesV3); // Screenshot Service for Telegram posts
app.use('/api/v3/pes', authenticate, pesRoutesV3); // PES ↔ CRM Bridge
// ADR-171 T1 / ADR-0196 P0.2a: router owns the leaf path (`GET /now-state`), so
// it mounts on the bare `/api/v3` prefix like tables/rows/widgets above. Placed
// deliberately BELOW the first `app.use('/api/v3', authenticate, …)` chain
// (agentRunDispatcher, line ~329): every public v3 route — /auth, /public,
// /pes app, /tools, /connectors callbacks — is mounted ABOVE that line, so this
// adds no new surface to the authenticated fall-through.
app.use('/api/v3', authenticate, nowStateRoutesV3); // ADR-171 T1: GET /api/v3/now-state
app.use('/api/v3/plugin', authenticate, pluginRoutesV3); // Plugin API (Photoshop, etc.)
app.use('/api/v3/bdd', authenticate, bddRoutesV3); // ADR-156 Phase 5A: BDD test runs

// ADR-0028 Phase 1: Space Connectors authed routes (callback mounted earlier, ~line 249).
app.use('/api/v3', authenticate, connectorsAuthedRouter);
app.use('/api/v3', authenticate, opsAuthedRouter); // ops grants lifecycle (space owner/admin gate inside)
app.use('/api/v3', authenticate, stagingAuthedRouter); // staging channel grants / receipts / leases (staging-space owner gate inside)
app.use('/api/v3', authenticate, mailRoutesV3); // ADR-160: Mail module routes (/spaces/:id/mail/*)

// ADR-0064 WP-A: global-default chat notification prefs (app-owner gate
// enforced inside the router).
app.use('/api/v3/admin', authenticate, adminChatNotificationsRoutesV3);

// ADR-0064 WP-A: global-default chat notification prefs (app-owner gate
// enforced inside the router).
app.use('/api/v3/admin', authenticate, adminChatNotificationsRoutesV3);

// ADR-188 F1: owner-only runtime registration policy (GET/PUT /admin/registration).
app.use('/api/v3/admin', authenticate, adminRegistrationRoutesV3);

// ADR-0059 AMEND-3 §4.9: owner-only calls-settings (read-only until D14).
app.use('/api/v3/owner', authenticate, ownerRoutesV3);

// ADR-0040 Phase 1: Owner Secrets Vault CRUD + reveal. Owner-only gate is
// enforced inside the router (compares req.user.id with space 11 owner_id).
app.use('/api/v3/secrets', authenticate, secretsRoutesV3);

// ADR-0066-A §C: audit hash-chain integrity check. Owner-only gate is
// enforced inside the router (same space-11 owner check as secrets).
app.use('/api/v3/audit', authenticate, auditRoutesV3);

// Life Pipeline route moved before catch-all /api/v3 routes (see line ~199)

// Monitoring API (Lunary-compatible, self-hosted)
// Public ingest endpoint for SDK compatibility
app.use('/api/v3/monitoring', createMonitoringRouter());
// Also mount at root /v1 for direct Lunary SDK compatibility
app.use('/v1', createMonitoringRouter());

// Public webhook endpoint (no auth)
app.use('/api/webhooks', webhooksRoutesV3);

// 🎮 DOOM 404 Page Routes
app.use('/error', errorPagesRoutes);

// 🧪 Test DOOM 404 Integration
app.use('/test', testDoomRoutes);

// ✅ v3 routes for previously v2-only endpoints
app.use('/api/v3/automations', authenticate, automationsRoutes);
app.use('/api/v3/form-configs', authenticate, formConfigsRoutes);
app.use('/api/v3/access', authenticate, accessRoutes);

// v2 aliases removed — all clients migrated to v3

// Health check — ADR-064 Task 12: Enhanced with DB status, version, uptime
app.get('/api/health', async (req, res) => {
  const startMs = Date.now();
  let dbStatus = 'unknown';
  let dbLatencyMs = null;
  try {
    const dbStart = Date.now();
    await dbGet('SELECT 1 AS ping');
    dbLatencyMs = Date.now() - dbStart;
    dbStatus = 'connected';
  } catch {
    dbStatus = 'disconnected';
  }
  const mem = process.memoryUsage();
  res.json({
    status: dbStatus === 'connected' ? 'ok' : 'degraded',
    version: '0.003.001',
    uptime_seconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    database: { status: dbStatus, latency_ms: dbLatencyMs },
    memory: {
      rss_mb: Math.round(mem.rss / 1024 / 1024),
      heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024)
    }
  });
});

// Deep health check — ADR-064 Task 12: Admin only, full system status
app.get('/api/health/deep', authenticate, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'owner') {
    return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Admin access required' } });
  }
  let dbStatus = 'unknown';
  let dbLatencyMs = null;
  try {
    const dbStart = Date.now();
    await dbGet('SELECT 1 AS ping');
    dbLatencyMs = Date.now() - dbStart;
    dbStatus = 'connected';
  } catch {
    dbStatus = 'disconnected';
  }
  const mem = process.memoryUsage();
  res.json({
    status: dbStatus === 'connected' ? 'ok' : 'degraded',
    version: '0.003.001',
    uptime_seconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    database: { status: dbStatus, latency_ms: dbLatencyMs },
    memory: {
      rss_mb: Math.round(mem.rss / 1024 / 1024),
      heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
      heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
      external_mb: Math.round(mem.external / 1024 / 1024)
    },
    node_version: process.version,
    env: process.env.NODE_ENV || 'development'
  });
});

// Google OAuth callback (GET - receives redirect from Google)
// Handles both web and mobile flows:
// - Web: state is absent or doesn't start with "mobile:" → redirect to React frontend
// - Mobile: state starts with "mobile:" → forward to mobile-callback API handler
app.get('/auth/google/callback', (req, res) => {
  const { code, error, state } = req.query;

  if (error) {
    return res.redirect(`/login?error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return res.redirect('/login?error=no_code');
  }

  // Check if this is a mobile app request (state starts with "mobile:")
  const decodedState = state ? decodeURIComponent(state) : '';
  if (decodedState.startsWith('mobile:')) {
    // Forward to mobile-callback handler which exchanges code and redirects via deep link
    return res.redirect(`/api/v3/auth/google/mobile-callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(decodedState)}`);
  }

  // Check if this is a Google Calendar connection request (state starts with "calendar:")
  if (decodedState.startsWith('calendar:')) {
    // Forward to calendar callback handler which exchanges code for calendar tokens
    return res.redirect(`/auth/google/calendar/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(decodedState)}`);
  }

  // Web flow: redirect to frontend with code, which will exchange it via POST API
  res.redirect(`/auth/google/complete?code=${encodeURIComponent(code)}`);
});

// ADR-0016 Phase 1: Authenticated file delivery — every byte stream
// previously served by open `express.static` mounts now goes through
// `fileGuard` first. The guard looks up the requested path against the
// `files` table, reads the owning column's `config.visibility`
// ('public' | 'internal' | 'private', default 'private'), and gates
// access accordingly. Orphan files (no DB row) -> 404.
//
// Static file serving for downloadable games/files
const DOWNLOADS_PATH = '/root/production/games';
app.use('/downloads', downloadsFileGuard, express.static(DOWNLOADS_PATH, {
  setHeaders: (res, filePath) => {
    const basename = path.basename(filePath);
    res.setHeader('Content-Disposition', `attachment; filename="${basename}"`);
    res.removeHeader('X-Frame-Options');
  }
}));

// Authorization runs before the shared upload delivery policy.
app.use('/uploads', uploadsFileGuard, uploadStatic);

// NO-SIGNUP-MCP §B1: friendly-path alias `/s/:slug/mcp` → public MCP handler.
// Registered BEFORE the static + SPA catch-all so POST/GET to the bare
// `godcrm.ai/s/help/mcp` reaches the MCP mount instead of falling to index.html.
// Inherits the same abuse-guard + rate-limit + space-pinning as the canonical
// `/api/v3/public/s/:slug/mcp` route.
app.all('/s/:slug/mcp', publicAbuseGuard, publicRateLimit, publicSpaceAccess, mcpPublicHandler);

// ADR-190: request-time SSR-lite for /blog/* + /sitemap.xml + /robots.txt.
// MUST precede the SPA static mount + `app.get('*')` catch-all so crawlers get
// server-injected per-post <head>/JSON-LD/body instead of the generic shell.
// ADR-190-A: the docs hub of every opted-in public space contributes its URLs
// to the same /sitemap.xml — injected here rather than imported inside blogSeo
// so the dependency stays one-way (publicDocsSeo → blogSeo).
registerBlogSeoRoutes(app, { clientDistPath, extraSitemapUrls: collectDocsSitemapUrls });

// ADR-190-A: /s/:slug, /s/:slug/docs and /s/:slug/docs/:docSlug for spaces that
// opted in via settings.public_seo. Registered AFTER the /s/:slug/mcp alias
// above (which it must not swallow) and BEFORE the static + catch-all mounts.
registerPublicDocsSeoRoutes(app, { clientDistPath });

// GEO pack (doc 254978 §6): crawler-readable landing. `/` is rendered only on
// the marketing hosts (same list as the SPA's RootIndex), `/welcome` on every
// host; app hosts fall through to the SPA. MUST precede the static mount —
// express.static serves dist/index.html for `/` by itself.
registerLandingSeoRoutes(app, { clientDistPath });

// Static frontend (SPA)
app.use(express.static(clientDistPath, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

app.get('*', (req, res) => {
  // Don't serve SPA for API routes or monitoring routes
  if (req.path.startsWith('/api') || req.path.startsWith('/v1')) {
    return res.status(404).json({
      success: false,
      error: { code: 'ENDPOINT_NOT_FOUND', message: 'API endpoint not found' },
      timestamp: new Date().toISOString()
    });
  }

  // Disable caching for index.html to ensure latest version is always served
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

// Global error handler (must be last)
app.use(errorHandler);

// ── Socket.IO for 16Neo multiplayer ──────────────────
const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  path: '/neo16-ws',
});

// Init Neo16 namespace
import('./routes/v3/neo16/socketHandler.js').then(({ initNeo16Socket }) => {
  initNeo16Socket(io);
  apiLogger.info('16Neo Socket.IO namespace /neo16 ready');
}).catch(err => {
  apiLogger.error({ err }, 'Failed to init Neo16 Socket.IO');
});

// EADDRINUSE retry: wait for old process to release port on PM2 restart
let _listenRetries = 0;
const MAX_LISTEN_RETRIES = 10;
const LISTEN_RETRY_DELAY = 2000; // ms

httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && _listenRetries < MAX_LISTEN_RETRIES) {
    _listenRetries++;
    apiLogger.warn({ port: PORT, attempt: _listenRetries, max: MAX_LISTEN_RETRIES },
      'Port in use, retrying...');
    setTimeout(() => httpServer.listen(PORT), LISTEN_RETRY_DELAY);
  } else {
    apiLogger.error({ err }, 'Server error');
    process.exit(1);
  }
});

const server = httpServer.listen(PORT, () => {
  logger.info({ port: PORT, version: '0.003.000' }, '🚀 GOD CRM Server started');
  apiLogger.info('API Routes v3 ready');

  // Startup recovery + agent worker initialization (sequential)
  // Step 1: Recover stuck jobs (resets tickets to BACKLOG)
  // Step 2: Start Agent Worker (polls BACKLOG tickets and re-dispatches)
  // Must run in order: recovery first, then worker, so tickets are in correct state
  if (process.env.NODE_ENV !== 'test') {
    (async () => {
      // Step 0: Kill any orphan Claude Code CLI and MCP processes from previous server instance
      // On systemctl restart, child processes may survive if the old server didn't shut down cleanly
      try {
        const { killAllActiveProcesses, killOrphanMCPProcesses } = await import('./services/labs/ai-execution-service.js');
        const killed = killAllActiveProcesses();
        if (killed > 0) {
          apiLogger.warn({ killed }, 'Startup: Killed orphan Claude Code CLI processes');
        }
        // Also kill any orphan MCP processes (mcp-searxng, google-drive-mcp, etc.)
        const mcpKilled = await killOrphanMCPProcesses();
        if (mcpKilled > 0) {
          apiLogger.warn({ mcpKilled }, 'Startup: Killed orphan MCP processes');
        }
      } catch (err) {
        apiLogger.debug({ err }, 'Startup: No orphan processes to clean (ok)');
      }

      // Step 1 & 2: Agent recovery + worker — only when agent worker is enabled
      if (process.env.AGENT_WORKER_ENABLED !== 'false') {
        // Step 1: Recover stuck agent jobs + reset bound tickets to BACKLOG
        try {
          const { recoverStuckJobs } = await import('./services/AgentJobService.js');
          const result = await recoverStuckJobs();
          apiLogger.info({ result }, 'Startup: Agent job recovery complete');
        } catch (err) {
          apiLogger.error({ err }, 'Startup: Failed to run agent job recovery');
        }

        // Step 2: Start Agent Worker (after recovery, so tickets are in correct state)
        try {
          const { AgentWorkerService } = await import('./services/AgentWorkerService.js');
          await AgentWorkerService.start();
          apiLogger.info('ADR-104: AgentWorkerService started — agents will auto-resume');
        } catch (err) {
          apiLogger.error({ err }, 'ADR-104: Failed to start AgentWorkerService');
        }

        // Step 3: Start Job Watchdog (monitors stalled jobs + orphaned conversations)
        try {
          const { startJobWatchdog } = await import('./services/AgentJobService.js');
          startJobWatchdog();
          apiLogger.info('AgentJobService: Job watchdog started');
        } catch (err) {
          apiLogger.error({ err }, 'AgentJobService: Failed to start job watchdog');
        }
      } else {
        apiLogger.info('AgentWorkerService disabled via AGENT_WORKER_ENABLED=false — skipping recovery and worker');
      }
    })();
  }

  // Google Calendar: Start periodic sync scheduler
  if (process.env.CALENDAR_SYNC_ENABLED !== 'false' && process.env.NODE_ENV !== 'test') {
    try {
      startCalendarSync();
      apiLogger.info('Google Calendar sync scheduler started (every 5 min)');
    } catch (err) {
      apiLogger.error({ err }, 'Failed to start Calendar sync scheduler');
    }
  }

  // ADR-0066-A §D: nightly audit-chain verify + owner head anchor.
  // Self-gates on AUDIT_CHAIN_VERIFY_ENABLED (default OFF; stays dark on
  // NL until Phase C). @sysadmin flips the env or swaps for a systemd
  // timer hitting GET /api/v3/audit/verify.
  if (process.env.NODE_ENV !== 'test') {
    import('./services/audit/AuditChainScheduler.js')
      .then(({ startAuditChainScheduler }) => startAuditChainScheduler())
      .catch((err) =>
        apiLogger.error({ err }, 'Failed to start audit chain scheduler')
      );
  }

  // Schedule-based automation triggers: check cron expressions every minute
  if (process.env.SCHEDULE_TRIGGERS_ENABLED !== 'false' && process.env.NODE_ENV !== 'test') {
    scheduleTriggerService.init().then(() => {
      apiLogger.info('Schedule trigger service started (every 60s)');
    }).catch(err => {
      apiLogger.error({ err }, 'Failed to start Schedule trigger service');
    });
  }

  // ADR-0028 Phase 1: CredentialVault lifecycle (Module Lifecycle pattern, ADR-0025).
  // Does NOT throw if CRM_CREDENTIAL_KEY is missing — logs warning, ops can fix later.
  credentialVault.init().then((h) => {
    apiLogger.info({ vault: h }, 'CredentialVault init complete');
  }).catch(err => {
    apiLogger.error({ err }, 'CredentialVault init failed');
  });

  // Ops broker crash recovery: a previous process may have died with a QA
  // container running. No-op when no executor is installed on this box.
  reapOpsWorkers().catch(err => {
    apiLogger.warn({ err }, 'ops reaper failed at boot');
  });
  // Staging channel: receipts/leases a dead broker left `running`/live.
  reapStagingChannel().catch(err => {
    apiLogger.warn({ err }, 'staging channel reaper failed at boot');
  });

  // ADR-0064 WP-A: chat-prefs resolver invalidation listener. Best-effort —
  // failure degrades eviction to local-only + 60s TTL (still correct, just
  // slower to propagate across PM2 workers).
  startChatPrefsListener().catch((err) => {
    apiLogger.warn({ err }, 'chat_prefs invalidation listener failed to start — TTL-only eviction');
  });

  // ADR-188 F1: registration-policy cache invalidation listener. Best-effort —
  // failure degrades eviction to local-only + 60s TTL.
  startRegistrationPolicyListener().catch((err) => {
    apiLogger.warn({ err }, 'registration policy listener failed to start — TTL-only eviction');
  });

  // ADR-0053 Phase C2: PermissionResolver lifecycle. Backs the PreToolUse hook
  // (scripts/agent-permission-hook.js) — never fail-hard, hook fails-open if
  // the resolver is unavailable. Listens on pg_notify('command_policies_changed')
  // for cluster-wide cache eviction.
  getDbAdapter()
    .then((adapter) => permissionResolver.init({ adapter }))
    .then((h) => {
      apiLogger.info({ resolver: h }, 'PermissionResolver init complete');
    })
    .catch((err) => {
      apiLogger.error({ err }, 'PermissionResolver init failed');
    });

  // ADR-0040 Phase 0: SecretsVault lifecycle. Fail-fast in production when
  // SECRETS_MASTER_KEY is missing — init() exits the process (see AC4).
  getDbAdapter()
    .then((adapter) => secretsVault.init({ adapter }))
    .then((h) => {
      apiLogger.info({ vault: h }, 'SecretsVault init complete');
    })
    .catch((err) => {
      apiLogger.error({ err }, 'SecretsVault init failed');
      // In production, init() already scheduled process.exit(1). Re-raising
      // here in non-prod paths preserves stack trace in logs but does not
      // crash the dev server (vault stays disabled, getSecret returns null).
    });

  // ADR-0064 WP-A: chat-prefs resolver invalidation listener. Best-effort —
  // failure degrades eviction to local-only + 60s TTL (still correct, just
  // slower to propagate across PM2 workers).
  startChatPrefsListener().catch((err) => {
    apiLogger.warn({ err }, 'chat_prefs invalidation listener failed to start — TTL-only eviction');
  });

  // ADR-0057-A WP-B: chat_inflight LISTEN bus. Best-effort — failure leaves
  // SSE clients with the per-poll `active_agents` snapshot but no live push.
  startInflightBus().catch((err) => {
    apiLogger.warn({ err }, 'chat_inflight bus failed to start — push-deltas disabled');
  });

  // ADR-0053 Phase C2: PermissionResolver lifecycle. Backs the PreToolUse hook
  // (scripts/agent-permission-hook.js) — never fail-hard, hook fails-open if
  // the resolver is unavailable. Listens on pg_notify('command_policies_changed')
  // for cluster-wide cache eviction.
  getDbAdapter()
    .then((adapter) => permissionResolver.init({ adapter }))
    .then((h) => {
      apiLogger.info({ resolver: h }, 'PermissionResolver init complete');
    })
    .catch((err) => {
      apiLogger.error({ err }, 'PermissionResolver init failed');
    });

  // ADR-0028 Phase 2: Connector token-refresh scheduler (5-min tick).
  if (process.env.NODE_ENV !== 'test') {
    import('./services/connectors/refreshScheduler.js').then(({ init: initRefresh }) => {
      return initRefresh();
    }).then((h) => {
      apiLogger.info({ refresh: h }, 'Connector refresh scheduler init complete');
    }).catch(err => {
      apiLogger.error({ err }, 'Connector refresh scheduler init failed');
    });
  }

  // ADR-0030 Phase 2: Agent run dispatcher (poll-driven, dry-run mode).
  // Gated by AGENT_RUN_DISPATCHER_ENABLED — service no-ops if flag != 'true'.
  if (process.env.NODE_ENV !== 'test') {
    import('./services/agent-run-dispatcher/index.js').then(({ init: initDispatcher }) => {
      return initDispatcher();
    }).then((h) => {
      apiLogger.info({ dispatcher: h }, 'Agent run dispatcher init complete');
    }).catch(err => {
      apiLogger.error({ err }, 'Agent run dispatcher init failed');
    });
  }

  // WP-17: Scheduled message delivery worker (every 30s)
  if (process.env.NODE_ENV !== 'test') {
    import('./services/ScheduledMessageWorker.js').then(({ startScheduledMessageWorker }) => {
      startScheduledMessageWorker();
    }).catch(err => {
      apiLogger.error({ err }, 'Failed to start ScheduledMessageWorker');
    });
  }

  // ADR-158 §P6: Scheduled outbound mail worker (every 60s). SOAKOFF-gated so
  // the NL box (Ring 1) keeps it OFF until Phase C — it must not send real
  // email while the frozen KZ copy is still live. Dev/Ring 0 run it by default.
  if (process.env.NODE_ENV !== 'test' && process.env.MAIL_SCHEDULED_WORKER_SOAKOFF !== 'true') {
    import('./services/mail/scheduledWorker.js').then(({ startMailScheduledWorker }) => {
      startMailScheduledWorker();
    }).catch(err => {
      apiLogger.error({ err }, 'Failed to start MailScheduledWorker');
    });
  }

  // ADR-0011 §Phase D: Verification TTL sweeper (hourly; flag-gated)
  if (process.env.NODE_ENV !== 'test' && process.env.VERIFICATION_COLUMN_ENABLED === 'true') {
    import('./services/verification/ttlSweeper.js').then(({ startVerificationTTLSweeper }) => {
      startVerificationTTLSweeper();
    }).catch(err => {
      apiLogger.error({ err }, 'Failed to start VerificationTTLSweeper');
    });
  }
});

// BUG-504: Increase Node.js HTTP server timeouts to match nginx (1800s)
// Default headersTimeout is 60s, keepAliveTimeout is 5s — too short for long agent tasks
server.keepAliveTimeout = 1800 * 1000; // 30 min
server.headersTimeout = 1805 * 1000;   // Must be > keepAliveTimeout
server.timeout = 0;                     // Disable per-request timeout (nginx handles it)

// ─── GRACEFUL SHUTDOWN ──────────────────────────────────────────
// On SIGTERM/SIGINT (systemctl restart, deploy, Ctrl+C):
//   1. Stop AgentWorkerService (clears polling, waits for active jobs)
//   2. Stop ScheduleTriggerService (clear cron intervals)
//   3. Stop CalendarSyncScheduler (clear sync interval)
//   4. Kill all active Claude Code CLI child processes
//   5. Clear stuck is_processing flags
//   6. Close HTTP server
// This ensures a clean restart without orphan processes or stuck state.

let _isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (_isShuttingDown) return; // prevent double-shutdown
  _isShuttingDown = true;

  apiLogger.info({ signal }, '⏹️  Graceful shutdown initiated');

  // FIX-A: Signal AgentJobService that shutdown is in progress BEFORE killing
  // child processes. This prevents processJobLocally()'s catch block from
  // overwriting the recovery marker that we set in step 5 below.
  try {
    const { setShuttingDown } = await import('./services/AgentJobService.js');
    setShuttingDown();
    apiLogger.info('Shutdown: AgentJobService shutdown flag set');
  } catch (err) {
    apiLogger.error({ err }, 'Shutdown: Failed to set AgentJobService shutdown flag');
  }

  // 1. Stop AgentWorkerService (stop polling + wait for active jobs)
  try {
    const { AgentWorkerService } = await import('./services/AgentWorkerService.js');
    await AgentWorkerService.stop();
    apiLogger.info('Shutdown: AgentWorkerService stopped');
  } catch (err) {
    apiLogger.error({ err }, 'Shutdown: Failed to stop AgentWorkerService');
  }

  // 2. Stop ScheduleTriggerService (clear cron intervals)
  try {
    const scheduleTriggerService = (await import('./services/ScheduleTriggerService.js')).default;
    scheduleTriggerService.stop();
    apiLogger.info('Shutdown: ScheduleTriggerService stopped');
  } catch (err) {
    apiLogger.error({ err }, 'Shutdown: Failed to stop ScheduleTriggerService');
  }

  // 2b. Stop ScheduledMessageWorker
  try {
    const { stopScheduledMessageWorker } = await import('./services/ScheduledMessageWorker.js');
    stopScheduledMessageWorker();
    apiLogger.info('Shutdown: ScheduledMessageWorker stopped');
  } catch (err) {
    apiLogger.error({ err }, 'Shutdown: Failed to stop ScheduledMessageWorker');
  }

  // 2c. Shutdown CredentialVault (ADR-0028: zero key buffer)
  try {
    await credentialVault.shutdown();
    apiLogger.info('Shutdown: CredentialVault stopped');
  } catch (err) {
    apiLogger.error({ err }, 'Shutdown: Failed to stop CredentialVault');
  }

  // 2c′. Shutdown PermissionResolver (ADR-0053: close LISTEN client, drop cache)
  try {
    await permissionResolver.shutdown();
    apiLogger.info('Shutdown: PermissionResolver stopped');
  } catch (err) {
    apiLogger.error({ err }, 'Shutdown: Failed to stop PermissionResolver');
  }

  // 2c″. Shutdown SecretsVault (ADR-0040: close LISTEN client, zero key)
  try {
    await secretsVault.shutdown();
    apiLogger.info('Shutdown: SecretsVault stopped');
  } catch (err) {
    apiLogger.error({ err }, 'Shutdown: Failed to stop SecretsVault');
  }

  // 2c″. Shutdown PermissionResolver (ADR-0053: close LISTEN client, drop cache)
  try {
    await permissionResolver.shutdown();
    apiLogger.info('Shutdown: PermissionResolver stopped');
  } catch (err) {
    apiLogger.error({ err }, 'Shutdown: Failed to stop PermissionResolver');
  }

  // 2d. Stop connector refresh scheduler (ADR-0028 Phase 2)
  try {
    const { shutdown: stopRefresh } = await import('./services/connectors/refreshScheduler.js');
    await stopRefresh();
    apiLogger.info('Shutdown: ConnectorRefreshScheduler stopped');
  } catch (err) {
    apiLogger.error({ err }, 'Shutdown: Failed to stop ConnectorRefreshScheduler');
  }

  // 2e. Stop agent run dispatcher (ADR-0030 Phase 2)
  try {
    const { shutdown: stopDispatcher } = await import('./services/agent-run-dispatcher/index.js');
    await stopDispatcher();
    apiLogger.info('Shutdown: AgentRunDispatcher stopped');
  } catch (err) {
    apiLogger.error({ err }, 'Shutdown: Failed to stop AgentRunDispatcher');
  }

  // 3. Stop CalendarSyncScheduler (clear sync interval)
  try {
    const { stopCalendarSync } = await import('./services/CalendarSyncScheduler.js');
    stopCalendarSync();
    apiLogger.info('Shutdown: CalendarSyncScheduler stopped');
  } catch (err) {
    apiLogger.error({ err }, 'Shutdown: Failed to stop CalendarSyncScheduler');
  }

  // 3b. Stop VerificationTTLSweeper (ADR-0011 §Phase D)
  try {
    const { stopVerificationTTLSweeper } = await import('./services/verification/ttlSweeper.js');
    stopVerificationTTLSweeper();
    apiLogger.info('Shutdown: VerificationTTLSweeper stopped');
  } catch (err) {
    apiLogger.error({ err }, 'Shutdown: Failed to stop VerificationTTLSweeper');
  }

  // 4. CLI agent processes — DO NOT KILL on graceful shutdown.
  // Claude Code CLI processes run as detached process groups. Killing them on
  // PM2 restart / deploy was the root cause of agents "stopping" — each restart
  // killed all running CLI agents. Instead, let them finish naturally.
  // On next startup, recoverStuckJobs() will check PID liveness and handle:
  //   - Still alive → leave running (PID tracked in agent_jobs.worker_pid)
  //   - Dead → mark failed + re-dispatch
  // Only kill truly orphaned MCP server processes (those leak resources).
  try {
    const { getActiveProcessCount, killOrphanMCPProcesses } = await import('./services/labs/ai-execution-service.js');
    const activeCount = getActiveProcessCount();
    if (activeCount > 0) {
      apiLogger.info({ activeCount }, 'Shutdown: Leaving active CLI agent processes running (will be adopted on restart)');
    }
    // Only kill orphan MCP processes (not the CLI agents themselves)
    const mcpKilled = await killOrphanMCPProcesses();
    if (mcpKilled > 0) {
      apiLogger.info({ mcpKilled }, 'Shutdown: Killed orphan MCP processes');
    }
  } catch (err) {
    apiLogger.error({ err }, 'Shutdown: Failed to handle child processes');
  }

  // 5. Mark processing/pending agent_jobs as failed (so recoverStuckJobs finds them cleanly on restart)
  try {
    const { dbRun, dbAll, isPostgres } = await import('./database/connection.js');

    // FIX-D: Mark processing jobs with recovery marker in BOTH error_message AND result_metadata.
    // The result_metadata JSON flag is more reliable than text matching on error_message,
    // which could be overwritten by concurrent catch blocks (though FIX-A now prevents that).
    // Belt-and-suspenders: use both mechanisms for maximum reliability.
    const shutdownMetadata = JSON.stringify({ shutdown_recovery: true, shutdown_at: new Date().toISOString() });
    const processingResult = await dbRun(
      isPostgres()
        ? `UPDATE agent_jobs SET status = 'failed', error_message = 'Graceful shutdown — will auto-recover on restart', result_metadata = $1, completed_at = NOW() WHERE status = 'processing'`
        : `UPDATE agent_jobs SET status = 'failed', error_message = 'Graceful shutdown — will auto-recover on restart', result_metadata = ?, completed_at = datetime('now') WHERE status = 'processing'`,
      [shutdownMetadata]
    );

    // For graceful shutdown: store which conversations need recovery (for restart Phase 1b)
    // Get conversations that had active jobs before marking them failed
    const activeConvs = await dbAll(
      isPostgres()
        ? `SELECT DISTINCT conversation_id, agent_name, agent_row_id, agent_user_id, context, trigger_message_id, trigger_user_id
           FROM agent_jobs WHERE error_message = 'Graceful shutdown — will auto-recover on restart' AND completed_at >= NOW() - INTERVAL '5 seconds'`
        : `SELECT DISTINCT conversation_id, agent_name, agent_row_id, agent_user_id, context, trigger_message_id, trigger_user_id
           FROM agent_jobs WHERE error_message = 'Graceful shutdown — will auto-recover on restart' AND completed_at >= datetime('now', '-5 seconds')`
    );

    if (processingResult?.changes > 0) {
      apiLogger.info({ count: processingResult.changes, conversations: activeConvs?.length || 0 }, 'Shutdown: Marked processing jobs as failed for recovery');
    }

    // Reset all is_processing conversations so they don't stay stuck
    const result = await dbRun(
      isPostgres()
        ? `UPDATE conversations SET is_processing = false, processing_started_at = NULL, processing_agent_id = NULL, processing_agent_name = NULL, updated_at = NOW() WHERE is_processing = true`
        : `UPDATE conversations SET is_processing = 0, processing_started_at = NULL, processing_agent_id = NULL, processing_agent_name = NULL, updated_at = datetime('now') WHERE is_processing = 1`
    );
    if (result?.changes > 0) {
      apiLogger.info({ count: result.changes }, 'Shutdown: Cleared is_processing flags');
    }
  } catch (err) {
    apiLogger.error({ err }, 'Shutdown: Failed to clean up jobs/conversations');
  }

  // 4. Close HTTP server (stop accepting new connections)
  server.close(() => {
    apiLogger.info('Shutdown: HTTP server closed');
    process.exit(0);
  });

  // Safety: force exit after 10 seconds if graceful close hangs
  setTimeout(() => {
    apiLogger.warn('Shutdown: Forced exit after 10s timeout');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
