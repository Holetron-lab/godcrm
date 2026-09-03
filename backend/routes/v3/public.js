// API v3: Public Routes - Unauthenticated access to external spaces (ADR-105)
// No authentication required. Uses publicRateLimit and publicSpaceAccess middleware.
import express from 'express';
import { dbAll, dbGet, isPostgres, safeJsonParse } from '../../database/connection.js';
import { getProjectsBySpace } from '../../services/ProjectService.js';
import { buildOrderClause } from '../../services/orderClause.js';
import { apiLogger } from '../../utils/logger.js';
import { success, error, notFound } from '../../utils/response.js';
import { publicAbuseGuard, publicRateLimit, publicSpaceAccess, publicPasswordVerify } from '../../middleware/publicAccess.js';
import {
  PUBLIC_PRESET_WHITELIST,
  isPresetAllowed,
  extractWidgetTableRef,
  scrubWidgetConfig,
  extractDocumentsRegistryTableId,
  scrubRegistryRowData,
  scrubAtomRowData
} from '../../lib/publicScrubber.js';
import { resolveLandingProject } from '../../services/public/resolveLandingProject.js';
import { readPublicSidebarPrefs } from '../../services/SpaceVisibilityService.js';
import { isPromoEnabled } from '../../services/starter-pack/StarterPackService.js';
import { getEffectiveRegistrationPolicy } from '../../services/registrationPolicy.js';
// NO-SIGNUP-MCP §B1: per-space public MCP mount. Imported here (not the other
// way) so the route inherits this router's abuse-guard + rate-limit. The
// gated read loaders publicMcp.js needs are exported from THIS file at the
// bottom — the cycle is safe (they are hoisted function declarations called
// only at request time).
import { mcpPublicHandler } from '../../services/mcp/publicMcp.js';

const router = express.Router();

// ADR-105 AC11: Abuse guard (temp IP block) runs before rate limiter
router.use(publicAbuseGuard);

// Apply public rate limiter to all routes in this router
router.use(publicRateLimit);

/**
 * ALL /api/v3/public/s/:slug/mcp — anonymous, no-signup MCP endpoint scoped to
 * one public space (NO-SIGNUP-MCP.md Stream B v2). `publicSpaceAccess` pins
 * `req.publicSpace` (and enforces the optional per-space password). The handler
 * dispatches only through space-gated loaders — never `executeTool`.
 * Streamable-HTTP uses GET (stream) + POST (messages), hence `router.all`.
 */
router.all('/s/:slug/mcp', publicSpaceAccess, mcpPublicHandler);

/**
 * GET /api/v3/public/registration-config — ADR-183-A D6.
 * Pre-auth bootstrap for the registration form. Exposes the owner-controlled promo
 * toggle so the FE renders the promo field iff `promo_enabled === true`. The FE must
 * NOT read `_app_settings` directly — this is the public contract. Not space-scoped
 * (no publicSpaceAccess), but still behind the router-level abuse-guard + rate-limit.
 */
router.get('/registration-config', async (req, res) => {
  try {
    return success(res, { promo_enabled: await isPromoEnabled() });
  } catch (err) {
    apiLogger.error({ err }, 'registration-config failed');
    // Fail-open to the flag's own default (promo ON) — never break the register page.
    return success(res, { promo_enabled: true });
  }
});

/**
 * GET /api/v3/public/config — ADR-188 F5.
 * Unauthenticated public projection of the effective registration policy, so the
 * login page can decide (pre-auth) whether to render the "Sign up" link. Exposes
 * ONLY the two non-sensitive fields the login page needs — never `default_role`,
 * `auto_join`, or `landing_space`. Behind the router-level abuse-guard +
 * rate-limit; NOT space-scoped (the front door is instance-level).
 *
 * `signup_mode` — the single source of truth is `getEffectiveRegistrationPolicy()`
 *   (same 60s cache + pg_notify eviction as the owner/admin surface), so whatever
 *   the Ring 0 governance default resolves to (ADR-183-B D3) is honoured here with
 *   no second store.
 * `referral_enabled` — pure projection: referral self-registration is available
 *   iff the front door is not `closed`. In `invite` mode a valid referral/invite
 *   code is precisely the door; in `closed` mode there is no self-registration at
 *   all, so referral is moot. No separate flag is invented (ADR-183-B D3 keeps the
 *   promo toggle distinct and out of scope here).
 */
router.get('/config', async (req, res) => {
  try {
    const policy = await getEffectiveRegistrationPolicy();
    const signup_mode = policy.signup_mode;
    return success(res, {
      signup_mode,
      referral_enabled: signup_mode !== 'closed',
    });
  } catch (err) {
    apiLogger.error({ err }, 'public/config failed');
    // Fail CLOSED — never advertise an open front door on an unexpected error.
    return success(res, { signup_mode: 'closed', referral_enabled: false });
  }
});

/**
 * GET /api/v3/public/s/:slug
 * Get public space info (metadata, projects list for external visibility).
 * Requires publicSpaceAccess middleware (handles password protection).
 */
router.get('/s/:slug', publicSpaceAccess, async (req, res) => {
  try {
    const space = req.publicSpace;

    // Fetch projects in this space (public metadata only).
    // AC15 (ADR-0060 §6): hard-ban the per-space System Data project here
    // too — without this the public landing page would list it as a card
    // that 404s on click. Filtering at the listing surface keeps UX in
    // sync with the drill-in gates in loadPublicProject.
    const projectsRaw = await getProjectsBySpace(space.id);
    const projects = projectsRaw.filter(p => !isSystemDataProject(p));

    // Return safe project metadata (no internal IDs for tables, no sensitive data)
    const publicProjects = projects.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      icon: p.icon,
      type: p.type,
      order_index: p.order_index,
      created_at: p.created_at
    }));

    // ADR-0060-A P7/A2: surface the landing project + its first dashboard.
    // Frontend uses these to mount <DashboardGrid readOnly /> directly,
    // replacing the P-track card-grid. The helper enforces AC15 (System
    // Data ban) and the 3-tier fallback so the payload is meaningful even
    // when main_project_id has never been set.
    //
    // Defensive try/catch: between code-deploy and migration-apply the
    // `spaces.main_project_id` column may not yet exist on the target
    // DB (e.g. DEV runtime pointed at unmigrated PROD). Falling back to
    // nulls keeps the existing /s/:slug payload intact instead of 500ing
    // the whole public surface. Becomes dead code once migration 062 has
    // landed on every host.
    let landing = { main_project_id: null, main_dashboard_id: null };
    try {
      landing = await resolveLandingProject(space.id);
    } catch (resolveErr) {
      apiLogger.warn(
        { err: resolveErr, spaceId: space.id },
        'resolveLandingProject failed (migration 062 not applied?); falling back to nulls'
      );
    }

    success(res, {
      space: {
        id: space.id,
        name: space.name,
        description: space.description,
        icon: space.icon,
        type: space.type,
        theme_primary: space.theme_primary,
        theme_secondary: space.theme_secondary,
        theme_tertiary: space.theme_tertiary,
        public_slug: space.public_slug,
        main_project_id: landing.main_project_id,
        main_dashboard_id: landing.main_dashboard_id,
        created_at: space.created_at
      },
      projects: publicProjects
    });
  } catch (err) {
    apiLogger.error({ err }, 'GET /public/s/:slug error');
    error(res, 'PUBLIC_SPACE_ERROR', err.message, 500);
  }
});

/**
 * Helper: find the documents `_registry` table for a public space.
 * Space-scoped (joins through projects.space_id) — returns `{ id, project_id }`
 * or null. Single source for both the REST routes and the MCP mount so a future
 * gate added to one reaches the other (NO-SIGNUP-MCP §B2 drift guard).
 */
async function findPublicDocsRegistry(spaceId) {
  return dbGet(`
    SELECT ut.id, ut.project_id
    FROM universal_tables ut
    JOIN projects p ON p.id = ut.project_id
    WHERE p.space_id = ?
      AND ut.name = '_registry'
      AND ut.table_type = 'documents_registry'
    LIMIT 1
  `, [spaceId]);
}

/**
 * Gated loader: list published documents in a public space's registry.
 * Returns `{ documents, registry_table_id, not_initialized? }`.
 */
async function loadPublicDocumentsRegistry(spaceId) {
  const registry = await findPublicDocsRegistry(spaceId);
  if (!registry) {
    return { documents: [], not_initialized: true };
  }

  const orderBy = isPostgres()
    ? `COALESCE((data->>'order_index')::integer, 0), created_at`
    : `CAST(json_extract(data, '$.order_index') AS INTEGER), created_at`;

  const rows = await dbAll(
    `SELECT id, base_id, data, created_at, updated_at FROM table_rows WHERE table_id = ? ORDER BY ${orderBy}`,
    [registry.id]
  );

  const documents = rows.map(row => {
    const data = safeJsonParse(row.data, {});
    return {
      id: row.id,
      base_id: row.base_id,
      name: data.name || '',
      description: data.description || '',
      slug: data.slug || '',
      icon: data.icon || '',
      category: data.category || null,
      status: data.status || 'draft',
      order_index: data.order_index || 0,
      // ADR-190-A D3: optional per-document SEO overrides. Additive, optional
      // keys — note this loader also backs the anonymous MCP `list_documents`
      // (services/mcp/publicMcp.js), so the MCP payload widens by these three.
      seo_title: data.seo_title || '',
      seo_description: data.seo_description || '',
      seo_noindex: data.seo_noindex === true,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  });

  return { documents, registry_table_id: registry.id };
}

/**
 * Gated loader: fetch a single public document + its content items.
 * `docRef` may be the registry row's numeric id OR the document slug — the
 * MCP `get_document_content` tool passes a `document_id` while the REST route
 * passes a slug, so both resolve here. Returns `{ document, table_id, items,
 * count }` or null (registry missing, not found, no content table, or —
 * defence-in-depth — the content table lives outside this space / System Data).
 */
async function loadPublicDocument(spaceId, docRef) {
  const registry = await findPublicDocsRegistry(spaceId);
  if (!registry) return null;

  // Numeric ref → registry row id; otherwise → slug lookup. Both are scoped to
  // this space's registry table, so neither can reach another tenant's docs.
  const asNum = Number(docRef);
  const byId = Number.isFinite(asNum) && String(asNum) === String(docRef).trim();
  let docRow;
  if (byId) {
    docRow = await dbGet(
      `SELECT id, base_id, data, created_at, updated_at FROM table_rows WHERE table_id = ? AND id = ?`,
      [registry.id, asNum]
    );
  } else {
    const slugQuery = isPostgres()
      ? `SELECT id, base_id, data, created_at, updated_at FROM table_rows WHERE table_id = $1 AND data->>'slug' = $2`
      : `SELECT id, base_id, data, created_at, updated_at FROM table_rows WHERE table_id = ? AND json_extract(data, '$.slug') = ?`;
    docRow = await dbGet(slugQuery, [registry.id, docRef]);
  }
  if (!docRow) return null;

  const docData = safeJsonParse(docRow.data, {});
  const tableId = docData.table_id;
  if (!tableId) return null;

  // Defence-in-depth: the document's content table must itself live inside
  // this same public space (same gate the widget-scoped atoms route uses).
  // A registry row pointing at an out-of-space content table → null.
  const contentTable = await loadPublicAtomsTable(spaceId, Number(tableId));
  if (!contentTable) return null;

  const contentOrderBy = buildOrderClause('order', {
    dialect: isPostgres() ? 'pg' : 'sqlite', mode: 'coalesce', tieBreak: 'id',
  });

  const rows = await dbAll(
    `SELECT id, base_id, data, created_at, updated_at FROM table_rows WHERE table_id = ? ORDER BY ${contentOrderBy}`,
    [tableId]
  );

  const items = rows.map(row => ({
    id: row.id,
    base_id: row.base_id,
    ...safeJsonParse(row.data, {}),
    created_at: row.created_at,
    updated_at: row.updated_at
  }));

  return {
    document: {
      id: docRow.id,
      base_id: docRow.base_id,
      name: docData.name || '',
      description: docData.description || '',
      slug: docData.slug || '',
      icon: docData.icon || '',
      category: docData.category || null,
      status: docData.status || 'draft',
      created_at: docRow.created_at,
      updated_at: docRow.updated_at
    },
    table_id: tableId,
    items,
    count: items.length
  };
}

/**
 * GET /api/v3/public/s/:slug/docs
 * List documents in the public space.
 * Finds the documents project and returns the _registry entries.
 */
router.get('/s/:slug/docs', publicSpaceAccess, async (req, res) => {
  try {
    success(res, await loadPublicDocumentsRegistry(req.publicSpace.id));
  } catch (err) {
    apiLogger.error({ err }, 'GET /public/s/:slug/docs error');
    error(res, 'PUBLIC_DOCS_ERROR', err.message, 500);
  }
});

/**
 * GET /api/v3/public/s/:slug/docs/:docSlug
 * Get a single document's content by its slug.
 * Returns the document items (read-only).
 */
router.get('/s/:slug/docs/:docSlug', publicSpaceAccess, async (req, res) => {
  try {
    const doc = await loadPublicDocument(req.publicSpace.id, req.params.docSlug);
    if (!doc) {
      return notFound(res, 'Document');
    }
    success(res, doc);
  } catch (err) {
    apiLogger.error({ err }, 'GET /public/s/:slug/docs/:docSlug error');
    error(res, 'PUBLIC_DOC_CONTENT_ERROR', err.message, 500);
  }
});

/**
 * POST /api/v3/public/s/:slug/verify-password
 * Verify password for a protected public space.
 * On success, sets an httpOnly session cookie.
 */
router.post('/s/:slug/verify-password', publicPasswordVerify);

// ============================================================
// ADR-0060 P1 — Public tree + read-only table endpoints
// ============================================================

/**
 * Helper: parse column config JSON safely (table_columns.config is TEXT).
 * Returns {} on any failure.
 *
 * Exported for the row-level column-whitelist unit tests (ADR-0060 P5d AC14).
 */
export function parseColumnConfig(col) {
  return safeJsonParse(col?.config, {}) || {};
}

/**
 * Helper: is column publicly exposed?
 * Inside a public space (gated by space.public_slug) all columns are visible
 * by default. Owners can hide a specific column by setting
 * `config.is_public === false` (explicit opt-out).
 *
 * Exported so the row-level column whitelist (AC3 projection / AC14 row data
 * gate) can be unit-tested without spinning up a DB-backed supertest.
 */
export function isColumnPublic(col) {
  const cfg = parseColumnConfig(col);
  const v = cfg.is_public;
  return !(v === false || v === 'false');
}

/**
 * Helper: project a column row to its public-safe metadata shape.
 */
function projectPublicColumn(col) {
  const cfg = parseColumnConfig(col);
  // Whitelist of safe config fields only — never leak the full config blob.
  const safeConfig = {
    is_public: true
  };
  if (cfg.cellFormat !== undefined) safeConfig.cellFormat = cfg.cellFormat;
  // Options can be inline on column.options text OR config.options — prefer
  // config.options (canonical), fall back to column.options (JSON text).
  if (Array.isArray(cfg.options)) {
    safeConfig.options = cfg.options;
  } else if (col.options) {
    const parsedOptions = safeJsonParse(col.options, null);
    if (Array.isArray(parsedOptions)) safeConfig.options = parsedOptions;
  }
  // Relation metadata — only labelColumn is useful publicly, tableId reveals
  // internal structure but is needed by the viewer; keep minimal.
  if (cfg.relation && cfg.relation.enabled) {
    safeConfig.relation = {
      enabled: true,
      labelColumn: cfg.relation.labelColumn || null
    };
  }
  return {
    id: col.id,
    // `name` is the canonical row-data key (matches table_rows.data[name]).
    // `display_name` is the human-readable label rendered in the viewer.
    // Before ADR-0060 P5d these were collapsed onto a single `name` field,
    // which broke row lookup when display_name diverged from column_name.
    name: col.column_name,
    display_name: col.display_name || col.column_name,
    type: col.type,
    position: col.order_index ?? 0,
    settings: safeConfig
  };
}

/**
 * Helper: resolve a relation cell value (which is the related row's id or
 * base_id) into a `{ label }` projection — never leaks the internal id.
 * Returns `{ label: '<unresolved>' }` if the target table has no usable
 * label column or the relation row is missing.
 */
async function resolveRelationLabel(relCfg, cellValue) {
  if (cellValue === null || cellValue === undefined || cellValue === '') {
    return { label: '' };
  }
  const targetTableId = relCfg.tableId;
  const labelColumn = relCfg.labelColumn;
  if (!targetTableId || !labelColumn) {
    return { label: '<unresolved>' };
  }
  try {
    // Find the column id on the target table whose column_name matches the
    // configured labelColumn — that's the key under which the row's data is
    // stored in table_rows.data.
    const labelCol = await dbGet(
      'SELECT id, column_name FROM table_columns WHERE table_id = ? AND column_name = ?',
      [targetTableId, labelColumn]
    );
    if (!labelCol) {
      return { label: '<unresolved>' };
    }
    // Cell value might be the related row id (numeric) or a base_id (string).
    // Try numeric id first.
    let relRow = null;
    const asNum = Number(cellValue);
    if (Number.isFinite(asNum) && String(asNum) === String(cellValue)) {
      relRow = await dbGet(
        'SELECT data FROM table_rows WHERE table_id = ? AND id = ?',
        [targetTableId, asNum]
      );
    }
    if (!relRow) {
      relRow = await dbGet(
        'SELECT data FROM table_rows WHERE table_id = ? AND base_id = ?',
        [targetTableId, String(cellValue)]
      );
    }
    if (!relRow) {
      return { label: '<unresolved>' };
    }
    const parsed = safeJsonParse(relRow.data, {}) || {};
    // table_rows.data is keyed by column id (string).
    const label =
      parsed[String(labelCol.id)] ??
      parsed[labelCol.column_name] ??
      '<unresolved>';
    return { label: String(label) };
  } catch {
    return { label: '<unresolved>' };
  }
}

/**
 * Helper: project a single cell value based on column type.
 * - relation → { label } (uses async resolver, see caller)
 * - file → { filename } (strip storage path)
 * - everything else → raw value
 */
function projectFileCell(value) {
  if (value === null || value === undefined) return null;
  // File cells can be a string path, an object { url, filename }, or an array
  // of such. Always reduce to a filename-only shape.
  const toFilename = (v) => {
    if (!v) return null;
    if (typeof v === 'string') {
      const parts = v.split('/').filter(Boolean);
      return { filename: parts[parts.length - 1] || v };
    }
    if (typeof v === 'object') {
      const fn = v.filename || v.name || (v.url ? String(v.url).split('/').filter(Boolean).pop() : null);
      return { filename: fn || '<file>' };
    }
    return { filename: String(v) };
  };
  if (Array.isArray(value)) return value.map(toFilename).filter(Boolean);
  return toFilename(value);
}

/**
 * GET /api/v3/public/s/:slug/tree
 * Returns the full project/table/dashboard/widget tree for a public space.
 * Space-level `public_slug` is the visibility gate — once a space is public,
 * everything inside is viewable read-only (no per-entity flags required).
 */
/**
 * Gated loader: build the full project/table/dashboard/widget tree for a
 * public space. Every layer is `is_public`-filtered and the System Data
 * project is hard-banned. Returns `{ space, projects:[{tables,dashboards,
 * widgets}] }`. Shared by the REST `/tree` route and the MCP mount's
 * `list_tables` / `list_projects` handlers (NO-SIGNUP-MCP §B2).
 */
async function loadPublicTree(space) {
  // Opt-out gate: per-entity is_public defaults TRUE (visible). Owners hide
  // a specific entity by setting is_public=FALSE in its settings UI.
  //
  // AC15 (ADR-0060 §6): the per-space System Data project is hard-banned
  // regardless of is_public. Filtered in JS (after fetching name+type) so
  // the rule is centralized in `isSystemDataProject` instead of duplicated
  // as a SQL WHERE clause that future schema renames could miss.
  const projectsRaw = await dbAll(
    `SELECT id, name, type, icon, order_index
       FROM projects
      WHERE space_id = ?
        AND is_public IS NOT FALSE
      ORDER BY order_index, id`,
    [space.id]
  );
  const projects = projectsRaw.filter(p => !isSystemDataProject(p));

  const spaceMeta = {
    id: space.id,
    name: space.name,
    icon: space.icon,
    public_slug: space.public_slug,
    public_sidebar: readPublicSidebarPrefs(space.settings)
  };

  if (projects.length === 0) {
    return { space: spaceMeta, projects: [] };
  }

  const projectIds = projects.map(p => p.id);
  const placeholders = projectIds.map(() => '?').join(',');

  const tables = await dbAll(
    `SELECT id, project_id, COALESCE(display_name, name) AS name, icon, order_index
       FROM universal_tables
      WHERE project_id IN (${placeholders})
        AND deleted_at IS NULL
        AND is_public IS NOT FALSE
      ORDER BY order_index, id`,
    projectIds
  );

  const dashboards = await dbAll(
    `SELECT id, project_id, name, icon, order_index
       FROM dashboards
      WHERE project_id IN (${placeholders})
        AND is_public IS NOT FALSE
      ORDER BY order_index, id`,
    projectIds
  );

  let widgets = [];
  if (dashboards.length > 0) {
    const dashIds = dashboards.map(d => d.id);
    const dashPlaceholders = dashIds.map(() => '?').join(',');
    widgets = await dbAll(
      `SELECT w.id, w.dashboard_id, w.title AS name, w.icon, w.order_index, d.project_id
         FROM widgets w
         JOIN dashboards d ON d.id = w.dashboard_id
        WHERE w.dashboard_id IN (${dashPlaceholders})
          AND w.is_public IS NOT FALSE
        ORDER BY w.order_index, w.id`,
      dashIds
    );
  }

  // Group children by project_id.
  const byProject = new Map();
  for (const p of projects) {
    byProject.set(p.id, {
      id: p.id,
      name: p.name,
      icon: p.icon,
      is_public: true,
      tables: [],
      dashboards: [],
      widgets: []
    });
  }
  for (const t of tables) {
    const entry = byProject.get(t.project_id);
    if (entry) entry.tables.push({ id: t.id, name: t.name, icon: t.icon });
  }
  for (const d of dashboards) {
    const entry = byProject.get(d.project_id);
    if (entry) entry.dashboards.push({ id: d.id, name: d.name, icon: d.icon });
  }
  for (const w of widgets) {
    const entry = byProject.get(w.project_id);
    if (entry) entry.widgets.push({ id: w.id, name: w.name, icon: w.icon });
  }

  return { space: spaceMeta, projects: Array.from(byProject.values()) };
}

router.get('/s/:slug/tree', publicSpaceAccess, async (req, res) => {
  try {
    success(res, await loadPublicTree(req.publicSpace));
  } catch (err) {
    apiLogger.error({ err }, 'GET /public/s/:slug/tree error');
    error(res, 'PUBLIC_TREE_ERROR', err.message, 500);
  }
});

/**
 * Helper: load a table inside a public space.
 * Space-level public_slug is the primary gate. Opt-out gates layered on top:
 * the table or its parent project may set is_public=FALSE to hide.
 * Returns null if the table doesn't exist, isn't in this space, or is hidden.
 */
async function loadPublicTable(spaceId, tableId) {
  const table = await dbGet(
    `SELECT ut.id, ut.project_id, ut.name, ut.display_name, ut.icon,
            ut.is_public AS table_public,
            p.space_id, p.is_public AS project_public,
            p.name AS project_name, p.type AS project_type
       FROM universal_tables ut
       JOIN projects p ON p.id = ut.project_id
      WHERE ut.id = ? AND ut.deleted_at IS NULL`,
    [tableId]
  );
  if (!table) return null;
  // AC15: HARD ban — tables inside System Data are never public.
  if (isSystemDataProject({ name: table.project_name, type: table.project_type })) {
    return null;
  }
  if (String(table.space_id) !== String(spaceId)) return null;
  if (table.table_public === false) return null;
  if (table.project_public === false) return null;
  return table;
}

/**
 * Helper: load a per-doc atoms table that is referenced from an already-gated
 * public registry row. Atoms tables are internal storage of a public document
 * — the parent widget + registry have already passed the public gates, so we
 * only enforce same-space + System Data ban here, NOT `table.table_public`.
 *
 * Without this relaxation, per-doc atoms tables (which are seeded as
 * is_public=false by default and never flipped) 404 even when their parent
 * registry row is fully public. See bug: orphan-style data integrity issue
 * where atoms render empty on /s/:slug despite registry list returning fine.
 */
async function loadPublicAtomsTable(spaceId, atomsTableId) {
  const table = await dbGet(
    `SELECT ut.id, ut.project_id, ut.name,
            p.space_id, p.is_public AS project_public,
            p.name AS project_name, p.type AS project_type
       FROM universal_tables ut
       JOIN projects p ON p.id = ut.project_id
      WHERE ut.id = ? AND ut.deleted_at IS NULL`,
    [atomsTableId]
  );
  if (!table) return null;
  // AC15: HARD ban — tables inside System Data are never public.
  if (isSystemDataProject({ name: table.project_name, type: table.project_type })) {
    return null;
  }
  if (String(table.space_id) !== String(spaceId)) return null;
  // Defence-in-depth: a registry row pointing at an atoms table inside a
  // PRIVATE project (cross-project misconfig or crafted payload) must still
  // 404. The relaxed gate is only on the per-table `is_public` opt-out.
  if (table.project_public === false) return null;
  return table;
}

/**
 * GET /api/v3/public/s/:slug/tables/:tableId
 * Returns metadata + whitelisted columns for a public table.
 * 404 (not 403) if the table is not public or not in this space.
 */
router.get('/s/:slug/tables/:tableId', publicSpaceAccess, async (req, res) => {
  try {
    const tableId = Number(req.params.tableId);
    if (!Number.isFinite(tableId) || tableId <= 0) {
      return notFound(res, 'Table');
    }
    const schema = await loadPublicTableSchema(req.publicSpace.id, tableId);
    if (!schema) {
      return notFound(res, 'Table');
    }
    success(res, schema);
  } catch (err) {
    apiLogger.error({ err }, 'GET /public/s/:slug/tables/:tableId error');
    error(res, 'PUBLIC_TABLE_ERROR', err.message, 500);
  }
});

/**
 * Gated loader: table metadata + whitelisted, projected columns for a public
 * table. Returns null (→ 404 / MCP not_found) when the table is not in this
 * space, hidden, or under System Data. Shared by the REST `/tables/:tableId`
 * route and the MCP `get_table_schema` handler so the column projection has a
 * single source (NO-SIGNUP-MCP §B2).
 */
async function loadPublicTableSchema(spaceId, tableId) {
  const table = await loadPublicTable(spaceId, tableId);
  if (!table) return null;
  const columns = (await fetchPublicColumns(tableId)).map(projectPublicColumn);
  return {
    table: {
      id: table.id,
      name: table.display_name || table.name,
      icon: table.icon
    },
    columns
  };
}

/**
 * Helper: clamp limit/offset for the public surface.
 *   limit  → [1, 500], default 50
 *   offset → [0, ∞),   default 0
 */
function clampPagination(rawLimit, rawOffset, { defLimit = 50, maxLimit = 500 } = {}) {
  const limitN = Number(rawLimit);
  const offsetN = Number(rawOffset);
  const limit = Number.isFinite(limitN)
    ? Math.max(1, Math.min(maxLimit, Math.floor(limitN)))
    : defLimit;
  const offset = Number.isFinite(offsetN) && offsetN > 0 ? Math.floor(offsetN) : 0;
  return { limit, offset };
}

/**
 * Helper: fetch a page of public rows for a table.
 *
 * Same scrubbing as the table-viewer endpoint: column whitelist via
 * `isColumnPublic`, relation cells resolved to `{ label }`, file cells
 * reduced to `{ filename }`. Used by both `/tables/:id/rows` and
 * `/widgets/:id/data` so the two surfaces can never diverge.
 *
 * Caller is responsible for the public-access gates on the table itself.
 */
async function fetchPublicColumns(tableId) {
  const allColumns = await dbAll(
    `SELECT id, column_name, display_name, type, config, options, order_index
       FROM table_columns
      WHERE table_id = ?
      ORDER BY order_index, id`,
    [tableId]
  );
  return allColumns.filter(isColumnPublic);
}

/**
 * Project a single raw table_rows row through the public column whitelist —
 * relation cells → { label }, file cells → { filename }, everything else raw.
 * Shared by the paginated reader and the single-row reader so both surfaces
 * scrub identically.
 */
async function projectPublicRow(row, publicColumns) {
  const parsed = safeJsonParse(row.data, {}) || {};
  const projected = {};
  for (const col of publicColumns) {
    const key = String(col.id);
    const altKey = col.column_name;
    const value = parsed[key] !== undefined ? parsed[key] : parsed[altKey];
    const cfg = parseColumnConfig(col);
    if (cfg.relation && cfg.relation.enabled) {
      // eslint-disable-next-line no-await-in-loop
      projected[col.column_name] = await resolveRelationLabel(cfg.relation, value);
    } else if (col.type === 'file' || col.type === 'image' || col.type === 'attachment') {
      projected[col.column_name] = projectFileCell(value);
    } else {
      projected[col.column_name] = value ?? null;
    }
  }
  return {
    id: row.id,
    base_id: row.base_id,
    data: projected,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

async function fetchPublicRows(tableId, { limit, offset }) {
  const publicColumns = await fetchPublicColumns(tableId);

  const totalRow = await dbGet(
    'SELECT COUNT(*) AS total FROM table_rows WHERE table_id = ?',
    [tableId]
  );
  const total = Number(totalRow?.total) || 0;

  if (publicColumns.length === 0) {
    return { rows: [], total };
  }

  const rawRows = await dbAll(
    `SELECT id, base_id, data, created_at, updated_at
       FROM table_rows
      WHERE table_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?`,
    [tableId, limit, offset]
  );

  const projectedRows = [];
  for (const row of rawRows) {
    // eslint-disable-next-line no-await-in-loop
    projectedRows.push(await projectPublicRow(row, publicColumns));
  }
  return { rows: projectedRows, total };
}

/**
 * Fetch a single public row by id, scrubbed through the same column whitelist.
 * Caller is responsible for the public-access gate on the table itself
 * (`loadPublicTable`). Returns null if the row id is not in this table.
 */
async function fetchPublicRowById(tableId, rowId) {
  const id = Number(rowId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const publicColumns = await fetchPublicColumns(tableId);
  if (publicColumns.length === 0) return null;
  const row = await dbGet(
    `SELECT id, base_id, data, created_at, updated_at
       FROM table_rows WHERE table_id = ? AND id = ?`,
    [tableId, id]
  );
  if (!row) return null;
  return projectPublicRow(row, publicColumns);
}

/**
 * GET /api/v3/public/s/:slug/tables/:tableId/rows?limit=50&offset=0
 * Returns paginated rows containing only whitelisted columns.
 * 404 if the table is not public or not in this space.
 * `limit` clamps to [1, 500]; `offset` clamps to [0, ∞).
 */
router.get('/s/:slug/tables/:tableId/rows', publicSpaceAccess, async (req, res) => {
  try {
    const space = req.publicSpace;
    const tableId = Number(req.params.tableId);
    if (!Number.isFinite(tableId) || tableId <= 0) {
      return notFound(res, 'Table');
    }

    const table = await loadPublicTable(space.id, tableId);
    if (!table) {
      return notFound(res, 'Table');
    }

    const { limit, offset } = clampPagination(req.query.limit, req.query.offset);
    const { rows, total } = await fetchPublicRows(tableId, { limit, offset });
    success(res, { rows, total });
  } catch (err) {
    apiLogger.error({ err }, 'GET /public/s/:slug/tables/:tableId/rows error');
    error(res, 'PUBLIC_TABLE_ROWS_ERROR', err.message, 500);
  }
});

// ============================================================
// ADR-0060 §Fat-P5 — Public widget endpoints (projects/dashboards/widgets/data)
//
// Surface: separate `/public/s/:slug/...` series, NOT auth-bypass on the
// internal `/widgets/...` routes. Every gate (entity is_public, parent
// dashboard/project public, space match, preset whitelist, table FK
// reachability) is checked before any row data is touched. 404 instead of
// 403 to avoid leaking the existence of private entities.
// ============================================================

/**
 * AC15 (ADR-0060 §6): the per-space "System Data" project — created by
 * `backend/services/system-tables-creator/space-setup.js` with
 * name='System Data' and type='system_data' — holds Variables, Storage
 * Providers and other sensitive aggregates (per ADR-0024) and MUST be
 * hard-banned from the public surface regardless of is_public.
 *
 * The check runs BEFORE any is_public gate so an owner accidentally flipping
 * `is_public=true` on a system project cannot leak. The match is broad on
 * purpose (type='system_data', legacy 'system', name='System Data') so
 * future renames or partial creates still fail closed.
 *
 * NOTE on identifier: the spec referenced `projects.slug` but no such
 * column exists in this schema — `type` is the canonical discriminator set
 * by space-setup.js. Hence the type+name match here.
 *
 * Callers must SELECT both `name` and `type` columns when fetching the row
 * (or, for JOINed loaders, alias them as project_name/project_type and pass
 * a synthetic `{ name, type }` view).
 */
function isSystemDataProject(projectRow) {
  if (!projectRow) return false;
  const t = projectRow.type;
  if (t === 'system_data' || t === 'system') return true;
  if (projectRow.name === 'System Data') return true;
  return false;
}

/**
 * Helper: load a project inside a public space.
 * Returns null if the project doesn't exist, isn't in this space, has
 * is_public=FALSE, or is the per-space System Data project (AC15).
 */
async function loadPublicProject(spaceId, projectId) {
  const row = await dbGet(
    `SELECT id, space_id, name, type, icon, description, theme_primary,
            is_public, primary_table_id
       FROM projects WHERE id = ?`,
    [projectId]
  );
  if (!row) return null;
  // AC15: HARD ban — runs BEFORE is_public so accidental flips can't leak.
  if (isSystemDataProject(row)) return null;
  if (String(row.space_id) !== String(spaceId)) return null;
  if (row.is_public === false) return null;
  return row;
}

/**
 * Helper: load a dashboard inside a public space.
 * Verifies the dashboard, its project, and the project's space match the
 * public space. Returns null otherwise.
 */
async function loadPublicDashboard(spaceId, dashboardId) {
  const row = await dbGet(
    `SELECT d.id, d.name, d.icon, d.project_id,
            d.is_public AS dash_public,
            p.space_id, p.is_public AS project_public,
            p.name AS project_name, p.type AS project_type
       FROM dashboards d
       JOIN projects p ON p.id = d.project_id
      WHERE d.id = ?`,
    [dashboardId]
  );
  if (!row) return null;
  // AC15: HARD ban — system_data project hides every descendant.
  if (isSystemDataProject({ name: row.project_name, type: row.project_type })) {
    return null;
  }
  if (String(row.space_id) !== String(spaceId)) return null;
  if (row.dash_public === false) return null;
  if (row.project_public === false) return null;
  return row;
}

/**
 * Helper: load a widget inside a public space.
 * Walks widget → dashboard → project → space and refuses if any layer's
 * is_public=FALSE, if it's a template, or if its preset is not in the
 * whitelist. Returns the raw widget row when allowed.
 */
async function loadPublicWidget(spaceId, widgetId) {
  const row = await dbGet(
    `SELECT w.id, w.dashboard_id, w.widget_type, w.preset_name, w.title, w.icon,
            w.config, w.position,
            w.is_public AS widget_public, w.is_template,
            d.project_id, d.is_public AS dash_public,
            p.space_id, p.is_public AS project_public,
            p.name AS project_name, p.type AS project_type
       FROM widgets w
       JOIN dashboards d ON d.id = w.dashboard_id
       JOIN projects p ON p.id = d.project_id
      WHERE w.id = ?`,
    [widgetId]
  );
  if (!row) return null;
  // AC15: HARD ban — system_data project hides every descendant.
  if (isSystemDataProject({ name: row.project_name, type: row.project_type })) {
    return null;
  }
  if (String(row.space_id) !== String(spaceId)) return null;
  if (row.widget_public === false) return null;
  if (row.dash_public === false) return null;
  if (row.project_public === false) return null;
  if (row.is_template === true) return null;
  if (!isPresetAllowed(row.preset_name)) return null;
  return row;
}

/**
 * GET /api/v3/public/s/:slug/projects/:projectId
 * Returns project metadata + the id of the project's default dashboard
 * (if any). 404 if the project is not public or not in this space.
 */
router.get('/s/:slug/projects/:projectId', publicSpaceAccess, async (req, res) => {
  try {
    const space = req.publicSpace;
    const projectId = Number(req.params.projectId);
    if (!Number.isFinite(projectId) || projectId <= 0) {
      return notFound(res, 'Project');
    }
    const project = await loadPublicProject(space.id, projectId);
    if (!project) {
      return notFound(res, 'Project');
    }
    const dashboard = await dbGet(
      `SELECT id FROM dashboards
        WHERE project_id = ?
          AND is_public IS NOT FALSE
        ORDER BY is_default DESC, order_index, id
        LIMIT 1`,
      [projectId]
    );
    success(res, {
      project: {
        id: project.id,
        name: project.name,
        icon: project.icon,
        description: project.description,
        theme_primary: project.theme_primary
      },
      dashboard_id: dashboard?.id ?? null
    });
  } catch (err) {
    apiLogger.error({ err }, 'GET /public/s/:slug/projects/:projectId error');
    error(res, 'PUBLIC_PROJECT_ERROR', err.message, 500);
  }
});

/**
 * GET /api/v3/public/s/:slug/dashboards/:dashboardId
 * Returns dashboard metadata + the list of whitelisted, public widgets it
 * contains. 404 if the dashboard / its project is not public or not in this
 * space. Non-whitelisted presets are silently filtered out (default-deny).
 */
router.get('/s/:slug/dashboards/:dashboardId', publicSpaceAccess, async (req, res) => {
  try {
    const space = req.publicSpace;
    const dashboardId = Number(req.params.dashboardId);
    if (!Number.isFinite(dashboardId) || dashboardId <= 0) {
      return notFound(res, 'Dashboard');
    }
    const dashboard = await loadPublicDashboard(space.id, dashboardId);
    if (!dashboard) {
      return notFound(res, 'Dashboard');
    }
    const presetList = Array.from(PUBLIC_PRESET_WHITELIST);
    const placeholders = presetList.map(() => '?').join(',');
    const widgets = await dbAll(
      `SELECT id, title, icon, preset_name, position, order_index
         FROM widgets
        WHERE dashboard_id = ?
          AND is_public IS NOT FALSE
          AND is_template = false
          AND preset_name IN (${placeholders})
        ORDER BY order_index, id`,
      [dashboardId, ...presetList]
    );
    const items = widgets.map(w => ({
      id: w.id,
      name: w.title,
      icon: w.icon,
      type: w.preset_name,
      position: safeJsonParse(w.position, { x: 0, y: 0, w: 6, h: 4 })
    }));
    success(res, {
      dashboard: {
        id: dashboard.id,
        name: dashboard.name,
        icon: dashboard.icon
      },
      widgets: items,
      widget_ids: items.map(i => i.id)
    });
  } catch (err) {
    apiLogger.error({ err }, 'GET /public/s/:slug/dashboards/:dashboardId error');
    error(res, 'PUBLIC_DASHBOARD_ERROR', err.message, 500);
  }
});

/**
 * GET /api/v3/public/s/:slug/widgets/:widgetId
 * Returns scrubbed widget config for read-only public rendering.
 * 404 if the widget is not in this space, has any non-public ancestor,
 * is a template, its preset is not whitelisted, or its referenced
 * `table_id` points at a private table (don't reveal existence of
 * private tables via a widget).
 */
router.get('/s/:slug/widgets/:widgetId', publicSpaceAccess, async (req, res) => {
  try {
    const space = req.publicSpace;
    const widgetId = Number(req.params.widgetId);
    if (!Number.isFinite(widgetId) || widgetId <= 0) {
      return notFound(res, 'Widget');
    }
    const widget = await loadPublicWidget(space.id, widgetId);
    if (!widget) {
      return notFound(res, 'Widget');
    }
    // FK gate: if the widget references a table, the table must be public too.
    const refTableId = extractWidgetTableRef(widget.config);
    if (refTableId != null) {
      const table = await loadPublicTable(space.id, refTableId);
      if (!table) return notFound(res, 'Widget');
    }
    const scrubbed = scrubWidgetConfig(widget);
    if (!scrubbed) return notFound(res, 'Widget');
    success(res, {
      widget: {
        ...scrubbed,
        icon: widget.icon,
        position: safeJsonParse(widget.position, { x: 0, y: 0, w: 6, h: 4 })
      }
    });
  } catch (err) {
    apiLogger.error({ err }, 'GET /public/s/:slug/widgets/:widgetId error');
    error(res, 'PUBLIC_WIDGET_ERROR', err.message, 500);
  }
});

/**
 * GET /api/v3/public/s/:slug/widgets/:widgetId/data?limit=50&offset=0
 * Returns paginated rows for the widget's referenced table, scrubbed
 * through the same column whitelist as `/tables/:id/rows`.
 *
 * 404 if the widget or its referenced table is not public. If the widget
 * has no `table_id` reference, returns `{ rows:[], total:0 }` so the
 * renderer can still mount an empty view (rather than leaking "this widget
 * had a config issue" via a 404).
 */
router.get('/s/:slug/widgets/:widgetId/data', publicSpaceAccess, async (req, res) => {
  try {
    const space = req.publicSpace;
    const widgetId = Number(req.params.widgetId);
    if (!Number.isFinite(widgetId) || widgetId <= 0) {
      return notFound(res, 'Widget');
    }
    const widget = await loadPublicWidget(space.id, widgetId);
    if (!widget) {
      return notFound(res, 'Widget');
    }
    const refTableId = extractWidgetTableRef(widget.config);
    if (refTableId == null) {
      return success(res, { rows: [], total: 0, table_id: null });
    }
    const table = await loadPublicTable(space.id, refTableId);
    if (!table) return notFound(res, 'Widget');

    const { limit, offset } = clampPagination(req.query.limit, req.query.offset);
    const { rows, total } = await fetchPublicRows(refTableId, { limit, offset });
    success(res, { rows, total, table_id: refTableId });
  } catch (err) {
    apiLogger.error({ err }, 'GET /public/s/:slug/widgets/:widgetId/data error');
    error(res, 'PUBLIC_WIDGET_DATA_ERROR', err.message, 500);
  }
});

// ============================================================
// ADR-0060 P6/B — Public Documents Widget endpoints
//
// Widget-scoped read-only mirror of the DocumentsWidget data layer. Lets the
// F-track adapter mount the authoring widget under <PublicViewProvider> by
// swapping its apiClient for a publicApi dataSource that reads from these
// routes — same envelope shapes as the authenticated /tables/:id/rows /
// /tables/:id/rows/:id / /tables/:id/columns endpoints (modulo the public
// scrub).
//
// All endpoints share a single loader (`loadPublicDocumentsWidget`) that
// enforces: widget is a 'documents' preset, widget+dashboard+project+space
// all public, registry table belongs to the same public space, registry
// resolves to a real id. 404 on any failure to avoid existence-leak.
// ============================================================

/**
 * Helper: resolve a documents widget + its registry table for a given public
 * space. Returns `{ widget, registryTableId }` or null.
 *
 * Gates (any false → null, no info leak):
 *   - widget exists and walks widget → dashboard → project → space
 *   - widget.preset_name === 'documents'
 *   - widget.is_public / dashboard.is_public / project.is_public all NOT FALSE
 *   - widget.is_template === false
 *   - widget.config carries a positive integer registry_table_id /
 *     documents_table_id
 *   - the resolved registry table actually lives in this space (defends
 *     against cross-space widget configs).
 */
async function loadPublicDocumentsWidget(spaceId, widgetId) {
  const row = await dbGet(
    `SELECT w.id, w.dashboard_id, w.widget_type, w.preset_name, w.title, w.icon,
            w.config, w.position,
            w.is_public AS widget_public, w.is_template,
            d.project_id, d.is_public AS dash_public,
            p.space_id, p.is_public AS project_public,
            p.name AS project_name, p.type AS project_type
       FROM widgets w
       JOIN dashboards d ON d.id = w.dashboard_id
       JOIN projects p ON p.id = d.project_id
      WHERE w.id = ?`,
    [widgetId]
  );
  if (!row) return null;
  // AC15: HARD ban — a documents widget hosted under System Data never serves.
  if (isSystemDataProject({ name: row.project_name, type: row.project_type })) {
    return null;
  }
  if (String(row.space_id) !== String(spaceId)) return null;
  if (row.widget_public === false) return null;
  if (row.dash_public === false) return null;
  if (row.project_public === false) return null;
  if (row.is_template === true) return null;
  if (row.preset_name !== 'documents') return null;

  const registryTableId = extractDocumentsRegistryTableId(row.config);
  if (!registryTableId) return null;

  // Cross-space gate: the registry table must belong to a project inside this
  // same public space. Without this, a documents widget configured against a
  // private space's registry would leak through the public widget id.
  const registryTable = await dbGet(
    `SELECT ut.id, ut.project_id, p.space_id, ut.is_public AS table_public,
            p.is_public AS project_public
       FROM universal_tables ut
       JOIN projects p ON p.id = ut.project_id
      WHERE ut.id = ? AND ut.deleted_at IS NULL`,
    [registryTableId]
  );
  if (!registryTable) return null;
  if (String(registryTable.space_id) !== String(spaceId)) return null;
  if (registryTable.table_public === false) return null;
  if (registryTable.project_public === false) return null;

  return { widget: row, registryTableId };
}

/**
 * Helper: resolve a single registry row by slug within a registry table.
 * Returns the raw row (with parsed data) or null.
 *
 * Cross-space gate for the per-doc atoms table is applied by the caller
 * (so a single DB hit suffices when only the registry row is needed).
 */
async function findDocRowBySlug(registryTableId, docSlug) {
  const slugQuery = isPostgres()
    ? `SELECT id, base_id, data, created_at, updated_at
         FROM table_rows
        WHERE table_id = $1 AND data->>'slug' = $2`
    : `SELECT id, base_id, data, created_at, updated_at
         FROM table_rows
        WHERE table_id = ? AND json_extract(data, '$.slug') = ?`;
  const row = await dbGet(slugQuery, [registryTableId, docSlug]);
  if (!row) return null;
  return { ...row, parsed: safeJsonParse(row.data, {}) || {} };
}

/**
 * Project a single registry row to its public-safe shape.
 * Mirrors the authenticated `/tables/:id/rows/:id` envelope so the F-track
 * adapter does NOT need a separate transform path.
 */
function projectRegistryRow(row) {
  return {
    id: row.id,
    base_id: row.base_id,
    data: scrubRegistryRowData(safeJsonParse(row.data, {}) || {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * GET /api/v3/public/s/:slug/widgets/:widgetId/documents
 * List registry rows for a public documents widget.
 *
 * Envelope: `{ data: { rows, total } }` — same shape as the public
 * /tables/:id/rows endpoint so the F-track adapter consumes both via one
 * normalizer.
 *
 * Sort: same as authoring widget — `order_index ASC, created_at ASC` so the
 * sidebar ordering matches what authors see.
 */
router.get('/s/:slug/widgets/:widgetId/documents', publicSpaceAccess, async (req, res) => {
  try {
    const space = req.publicSpace;
    const widgetId = Number(req.params.widgetId);
    if (!Number.isFinite(widgetId) || widgetId <= 0) {
      return notFound(res, 'Widget');
    }
    const resolved = await loadPublicDocumentsWidget(space.id, widgetId);
    if (!resolved) {
      return notFound(res, 'Widget');
    }
    const { registryTableId } = resolved;

    const orderBy = isPostgres()
      ? `COALESCE((data->>'order_index')::integer, 0), created_at`
      : `CAST(json_extract(data, '$.order_index') AS INTEGER), created_at`;

    const rawRows = await dbAll(
      `SELECT id, base_id, data, created_at, updated_at
         FROM table_rows WHERE table_id = ?
        ORDER BY ${orderBy}`,
      [registryTableId]
    );

    const rows = rawRows.map(projectRegistryRow);
    success(res, { rows, total: rows.length, registry_table_id: registryTableId });
  } catch (err) {
    apiLogger.error({ err }, 'GET /public/s/:slug/widgets/:widgetId/documents error');
    error(res, 'PUBLIC_DOCS_WIDGET_LIST_ERROR', err.message, 500);
  }
});

/**
 * GET /api/v3/public/s/:slug/widgets/:widgetId/documents/columns
 * Registry columns for a public documents widget. Same shape as authenticated
 * /tables/:id/columns (`data` is the columns array directly) so the F-track
 * adapter swaps base URLs without reshaping.
 *
 * IMPORTANT: this route MUST be registered before /:docSlug below — Express
 * matches in order, and `:docSlug = 'columns'` would otherwise catch the
 * literal segment first.
 */
router.get(
  '/s/:slug/widgets/:widgetId/documents/columns',
  publicSpaceAccess,
  async (req, res) => {
    try {
      const space = req.publicSpace;
      const widgetId = Number(req.params.widgetId);
      if (!Number.isFinite(widgetId) || widgetId <= 0) {
        return notFound(res, 'Widget');
      }
      const resolved = await loadPublicDocumentsWidget(space.id, widgetId);
      if (!resolved) {
        return notFound(res, 'Widget');
      }
      const { registryTableId } = resolved;

      const allColumns = await dbAll(
        `SELECT id, column_name, display_name, type, config, options, order_index
           FROM table_columns
          WHERE table_id = ?
          ORDER BY order_index, id`,
        [registryTableId]
      );
      const columns = allColumns.filter(isColumnPublic).map(projectPublicColumn);
      success(res, columns);
    } catch (err) {
      apiLogger.error(
        { err },
        'GET /public/s/:slug/widgets/:widgetId/documents/columns error'
      );
      error(res, 'PUBLIC_DOCS_WIDGET_COLUMNS_ERROR', err.message, 500);
    }
  }
);

/**
 * GET /api/v3/public/s/:slug/widgets/:widgetId/documents/:docSlug
 * Single registry row by slug.
 *
 * Envelope: `{ data: { row } }` — mirrors authenticated /tables/:id/rows/:id.
 */
router.get(
  '/s/:slug/widgets/:widgetId/documents/:docSlug',
  publicSpaceAccess,
  async (req, res) => {
    try {
      const space = req.publicSpace;
      const widgetId = Number(req.params.widgetId);
      const { docSlug } = req.params;
      if (!Number.isFinite(widgetId) || widgetId <= 0) {
        return notFound(res, 'Widget');
      }
      const resolved = await loadPublicDocumentsWidget(space.id, widgetId);
      if (!resolved) {
        return notFound(res, 'Widget');
      }
      const doc = await findDocRowBySlug(resolved.registryTableId, docSlug);
      if (!doc) {
        return notFound(res, 'Document');
      }
      success(res, { row: projectRegistryRow(doc) });
    } catch (err) {
      apiLogger.error(
        { err },
        'GET /public/s/:slug/widgets/:widgetId/documents/:docSlug error'
      );
      error(res, 'PUBLIC_DOCS_WIDGET_DOC_ERROR', err.message, 500);
    }
  }
);

/**
 * GET /api/v3/public/s/:slug/widgets/:widgetId/documents/:docSlug/atoms
 * Per-doc atoms list (each doc has its own atoms table; registry row's
 * `data.table_id` points at it).
 *
 * Envelope: `{ data: { rows, total } }`. Atoms are ordered by `order` ASC,
 * id ASC (same as authoring). Cross-space gate: the per-doc atoms table
 * must itself live inside this public space (a registry row that points at
 * an out-of-space atoms table → 404).
 */
router.get(
  '/s/:slug/widgets/:widgetId/documents/:docSlug/atoms',
  publicSpaceAccess,
  async (req, res) => {
    try {
      const space = req.publicSpace;
      const widgetId = Number(req.params.widgetId);
      const { docSlug } = req.params;
      if (!Number.isFinite(widgetId) || widgetId <= 0) {
        return notFound(res, 'Widget');
      }
      const resolved = await loadPublicDocumentsWidget(space.id, widgetId);
      if (!resolved) {
        return notFound(res, 'Widget');
      }
      const doc = await findDocRowBySlug(resolved.registryTableId, docSlug);
      if (!doc) {
        return notFound(res, 'Document');
      }
      const atomsTableId = Number(doc.parsed?.table_id);
      if (!Number.isFinite(atomsTableId) || atomsTableId <= 0) {
        // Doc has no atoms table configured — return empty rather than 404
        // so the F-track viewer can mount an empty doc cleanly.
        return success(res, { rows: [], total: 0, table_id: null });
      }
      // Cross-space gate on atoms table — atoms are internal storage of a
      // public document, so the per-table `is_public` gate is skipped (parent
      // widget/registry already passed). Same-space + System Data ban still
      // enforced via loadPublicAtomsTable.
      const atomsTable = await loadPublicAtomsTable(space.id, atomsTableId);
      if (!atomsTable) {
        return notFound(res, 'Document');
      }

      const atomsOrderBy = buildOrderClause('order', {
        dialect: isPostgres() ? 'pg' : 'sqlite', mode: 'coalesce', tieBreak: 'id',
      });
      const rawAtoms = await dbAll(
        `SELECT id, base_id, data, created_at, updated_at
           FROM table_rows WHERE table_id = ?
          ORDER BY ${atomsOrderBy}`,
        [atomsTableId]
      );
      const rows = rawAtoms.map(r => ({
        id: r.id,
        base_id: r.base_id,
        data: scrubAtomRowData(safeJsonParse(r.data, {}) || {}),
        created_at: r.created_at,
        updated_at: r.updated_at,
      }));
      success(res, { rows, total: rows.length, table_id: atomsTableId });
    } catch (err) {
      apiLogger.error(
        { err },
        'GET /public/s/:slug/widgets/:widgetId/documents/:docSlug/atoms error'
      );
      error(res, 'PUBLIC_DOCS_WIDGET_ATOMS_ERROR', err.message, 500);
    }
  }
);

/**
 * Gated loader: list the whitelisted public widgets of a dashboard inside a
 * public space. Walks dashboard → project → space via `loadPublicDashboard`
 * (404-on-mismatch) then returns only whitelisted, non-template, public
 * widgets. Returns null if the dashboard is not public / not in this space.
 */
async function listPublicDashboardWidgets(spaceId, dashboardId) {
  const dashboard = await loadPublicDashboard(spaceId, dashboardId);
  if (!dashboard) return null;
  const presetList = Array.from(PUBLIC_PRESET_WHITELIST);
  const placeholders = presetList.map(() => '?').join(',');
  const widgets = await dbAll(
    `SELECT id, title, icon, preset_name, order_index
       FROM widgets
      WHERE dashboard_id = ?
        AND is_public IS NOT FALSE
        AND is_template = false
        AND preset_name IN (${placeholders})
      ORDER BY order_index, id`,
    [dashboardId, ...presetList]
  );
  return {
    dashboard: { id: dashboard.id, name: dashboard.name, icon: dashboard.icon },
    widgets: widgets.map(w => ({
      id: w.id,
      name: w.title,
      icon: w.icon,
      type: w.preset_name
    }))
  };
}

// ── Gated public read loaders shared with the MCP mount (NO-SIGNUP-MCP §B2) ──
// Every export below takes `spaceId` from the caller's pinned `req.publicSpace`
// and re-checks space membership, so a table/row/doc id outside the space
// resolves to null/404. `executeTool` is NOT on this path.
export {
  loadPublicTable,
  loadPublicTableSchema,
  fetchPublicRows,
  fetchPublicRowById,
  clampPagination,
  loadPublicTree,
  loadPublicDocumentsRegistry,
  loadPublicDocument,
  listPublicDashboardWidgets,
};

export default router;
