import {
  dbAll,
  dbGet,
  safeJsonParse,
  withTransactionAsync,
} from '../database/connection.js';
import {
  ACCESS_LEVEL_VALUES,
  getEffectiveRole,
  hasPermission,
} from './EffectiveRoleService.js';
import { validateBlueprint, blueprintSha256, BlueprintError } from './ModuleInstaller.js';

const PUBLIC_STATES = new Set(['default:published', 'internal:published', 'external:audited']);
const EDGE_SOURCES = { default: 'release', internal: 'instance', external: 'godcrm.ai' };

export class ModuleRegistryError extends Error {
  constructor(code, message, status = 422) {
    super(message);
    this.name = 'ModuleRegistryError';
    this.code = code;
    this.status = status;
  }
}

function registryError(code, message, status = 422) {
  return new ModuleRegistryError(code, message, status);
}

function componentsOf(blueprint) {
  const components = new Set();
  if (blueprint.tables?.length || blueprint.requires?.tables?.length) components.add('table');
  if (blueprint.apps?.length) components.add('app');
  if (blueprint.dashboards?.some((dashboard) => dashboard.tiles?.length)) components.add('tile');
  if (blueprint.agents?.length) components.add('agent');
  if (blueprint.automations?.length) components.add('automation');
  if (blueprint.services?.length) components.add('service');
  return [...components];
}

function requiredRole(blueprint) {
  return ['agents', 'automations', 'services'].some((section) => blueprint[section]?.length)
    ? 'admin'
    : 'editor';
}

function canInstall(blueprint, effectiveRole) {
  const required = requiredRole(blueprint);
  return (ACCESS_LEVEL_VALUES[effectiveRole] ?? 0) >= ACCESS_LEVEL_VALUES[required];
}

function serialize(row, effectiveRole) {
  const blueprint = safeJsonParse(row.blueprint, {});
  return {
    id: row.id,
    key: row.key,
    origin: row.origin,
    version: row.version,
    blueprint,
    publisher_space_id: row.publisher_space_id,
    status: row.status,
    checksum: row.checksum,
    category: row.category,
    components: componentsOf(blueprint),
    can_install: canInstall(blueprint, effectiveRole),
    required_role: requiredRole(blueprint) === 'admin' ? 'admin' : 'member',
    edge_source: EDGE_SOURCES[row.origin],
    edge_version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function assertOwner(userId, spaceId) {
  if (!userId || !await hasPermission(userId, 'owner', { spaceId })) {
    throw registryError('REGISTRY_OWNER_REQUIRED', 'Space owner role required', 403);
  }
}

async function ownedSpaceIds(userId) {
  if (!userId) return new Set();
  const rows = await dbAll(`
    SELECT id AS space_id FROM spaces WHERE owner_id = ?
    UNION
    SELECT space_id FROM user_access_permissions
      WHERE user_id = ? AND space_id IS NOT NULL
        AND access_level IN ('owner', 'owner_owner')
  `, [userId, userId]);
  return new Set(rows.map((row) => Number(row.space_id)));
}

function validateCategory(category) {
  return category || 'general';
}

function validateRegistryBlueprint(raw, key = null, version = null) {
  const blueprint = validateBlueprint(raw);
  if ((key && blueprint.key !== key) || (version && blueprint.version !== version)) {
    throw registryError('REGISTRY_BLUEPRINT_MISMATCH', 'Blueprint key/version must match the registry entry', 400);
  }
  return blueprint;
}

async function ownedEntry({ key, version, spaceId }) {
  return dbGet(
    'SELECT * FROM module_registry WHERE key = ? AND version = ? AND publisher_space_id = ?',
    [key, version, spaceId],
  );
}

function mapWriteError(error) {
  if (error?.code === '23505') {
    return registryError('REGISTRY_VERSION_EXISTS', 'This module key/origin/version already exists', 409);
  }
  return error;
}

export async function listModuleRegistry({
  spaceId,
  userId,
  origin,
  components = [],
  category,
  search,
  canInstall: canInstallFilter,
  key,
  version,
}) {
  const { effectiveRole } = await getEffectiveRole(userId, { spaceId });
  const owned = await ownedSpaceIds(userId);
  const rows = await dbAll('SELECT * FROM module_registry ORDER BY key, origin, version DESC');
  const needle = search?.toLowerCase();
  const wantedComponents = new Set(components);

  return rows
    .filter((row) => PUBLIC_STATES.has(`${row.origin}:${row.status}`) || owned.has(Number(row.publisher_space_id)))
    .map((row) => serialize(row, effectiveRole))
    .filter((item) => !origin || item.origin === origin)
    .filter((item) => !key || item.key === key)
    .filter((item) => !version || item.version === version)
    .filter((item) => !category || item.category === category)
    .filter((item) => [...wantedComponents].every((component) => item.components.includes(component)))
    .filter((item) => canInstallFilter === undefined || item.can_install === canInstallFilter)
    .filter((item) => !needle || [item.key, item.blueprint.title, item.blueprint.description]
      .some((value) => String(value || '').toLowerCase().includes(needle)));
}

export async function getModuleRegistryEntry(options) {
  const items = await listModuleRegistry(options);
  return items[0] || null;
}

export async function createInternalDraft({ spaceId, userId, origin = 'internal', blueprint: raw, category }) {
  if (origin !== 'internal') {
    throw registryError('REGISTRY_ORIGIN_INVALID', 'Only internal drafts can be created; external requires moderation', 400);
  }
  await assertOwner(userId, spaceId);
  const blueprint = validateRegistryBlueprint(raw);
  try {
    const id = await withTransactionAsync(async (trx) => {
      const result = await trx.run(`
        INSERT INTO module_registry
          (key, origin, version, blueprint, publisher_space_id, status, checksum, category)
        VALUES (?, 'internal', ?, ?::jsonb, ?, 'draft', ?, ?)
      `, [blueprint.key, blueprint.version, JSON.stringify(blueprint), spaceId,
        blueprintSha256(blueprint), validateCategory(category)]);
      return result.lastInsertRowid;
    });
    const row = await dbGet('SELECT * FROM module_registry WHERE id = ?', [id]);
    const { effectiveRole } = await getEffectiveRole(userId, { spaceId });
    return serialize(row, effectiveRole);
  } catch (error) {
    throw mapWriteError(error);
  }
}

export async function updateModuleMeta({ key, version, spaceId, userId, blueprint: patch }) {
  const actor = userId ? await dbGet('SELECT role FROM users WHERE id = ?', [userId]) : null;
  const platformOwner = actor?.role === 'owner' || actor?.role === 'admin';
  const spaceOwner = userId ? await hasPermission(userId, 'owner', { spaceId }) : false;
  if (!platformOwner && !spaceOwner) {
    throw registryError('REGISTRY_OWNER_REQUIRED', 'Space owner role required', 403);
  }
  const updated = await withTransactionAsync(async (trx) => {
    let row = await trx.get(
      'SELECT * FROM module_registry WHERE key = ? AND version = ? AND publisher_space_id = ? FOR UPDATE',
      [key, version, spaceId],
    );
    if (!row) {
      row = await trx.get(
        "SELECT * FROM module_registry WHERE key = ? AND version = ? AND origin = 'default' FOR UPDATE",
        [key, version],
      );
    }
    if (!row) throw registryError('REGISTRY_ENTRY_NOT_FOUND', 'Registry entry not found', 404);
    if (row.origin === 'default' && !platformOwner) {
      throw registryError('REGISTRY_OWNER_REQUIRED', 'Platform owner role required', 403);
    }
    if (row.origin !== 'default' && row.origin !== 'internal') {
      throw registryError('REGISTRY_ORIGIN_INVALID', 'Only internal or default module metadata can be edited', 409);
    }
    if (row.origin === 'internal' && !spaceOwner) {
      throw registryError('REGISTRY_OWNER_REQUIRED', 'Space owner role required', 403);
    }
    const blueprint = validateRegistryBlueprint({
      ...safeJsonParse(row.blueprint, {}),
      ...patch,
    }, key, version);
    await trx.run(`
      UPDATE module_registry SET blueprint = ?::jsonb, checksum = ?, updated_at = NOW()
      WHERE id = ?
    `, [JSON.stringify(blueprint), blueprintSha256(blueprint), row.id]);
    return trx.get('SELECT * FROM module_registry WHERE id = ?', [row.id]);
  });
  const { effectiveRole } = await getEffectiveRole(userId, { spaceId });
  return serialize(updated, effectiveRole);
}

export async function publishModule({ key, version, spaceId, userId, blueprint: raw, category }) {
  await assertOwner(userId, spaceId);
  const defaultRow = await dbGet(
    "SELECT * FROM module_registry WHERE key = ? AND version = ? AND origin = 'default'",
    [key, version],
  );

  try {
    if (defaultRow) {
      const blueprint = validateRegistryBlueprint(raw || safeJsonParse(defaultRow.blueprint), key, version);
      const id = await withTransactionAsync(async (trx) => {
        const result = await trx.run(`
          INSERT INTO module_registry
            (key, origin, version, blueprint, publisher_space_id, status, checksum, category)
          VALUES (?, 'internal', ?, ?::jsonb, ?, 'published', ?, ?)
        `, [key, version, JSON.stringify(blueprint), spaceId, blueprintSha256(blueprint),
          validateCategory(category || defaultRow.category)]);
        return result.lastInsertRowid;
      });
      const row = await dbGet('SELECT * FROM module_registry WHERE id = ?', [id]);
      const { effectiveRole } = await getEffectiveRole(userId, { spaceId });
      return serialize(row, effectiveRole);
    }

    const row = await ownedEntry({ key, version, spaceId });
    if (!row) throw registryError('REGISTRY_ENTRY_NOT_FOUND', 'Registry entry not found', 404);
    if (row.origin !== 'internal' || !['draft', 'rejected', 'published'].includes(row.status)) {
      throw registryError('REGISTRY_TRANSITION_INVALID', 'Only an internal draft or rejected entry can be published', 409);
    }
    await withTransactionAsync(async (trx) => {
      await trx.run(`
        UPDATE module_registry SET status = 'published', category = ?, updated_at = NOW()
        WHERE id = ?
      `, [validateCategory(category || row.category), row.id]);
    });
    const updated = await dbGet('SELECT * FROM module_registry WHERE id = ?', [row.id]);
    const { effectiveRole } = await getEffectiveRole(userId, { spaceId });
    return serialize(updated, effectiveRole);
  } catch (error) {
    throw mapWriteError(error);
  }
}

export async function submitModule({ key, version, spaceId, userId }) {
  await assertOwner(userId, spaceId);
  const row = await ownedEntry({ key, version, spaceId });
  if (!row) throw registryError('REGISTRY_ENTRY_NOT_FOUND', 'Registry entry not found', 404);
  if (row.origin !== 'internal' || row.status !== 'published') {
    throw registryError('REGISTRY_TRANSITION_INVALID', 'Only a published internal entry can be submitted', 409);
  }
  await withTransactionAsync(async (trx) => {
    await trx.run("UPDATE module_registry SET status = 'submitted', updated_at = NOW() WHERE id = ?", [row.id]);
  });
  const updated = await dbGet('SELECT * FROM module_registry WHERE id = ?', [row.id]);
  const { effectiveRole } = await getEffectiveRole(userId, { spaceId });
  return serialize(updated, effectiveRole);
}

export async function moderateModule({ key, version, spaceId, userId, decision }) {
  await assertOwner(userId, spaceId);
  const row = await ownedEntry({ key, version, spaceId });
  if (!row) throw registryError('REGISTRY_ENTRY_NOT_FOUND', 'Registry entry not found', 404);
  if (row.origin !== 'internal' || row.status !== 'submitted') {
    throw registryError('REGISTRY_TRANSITION_INVALID', 'Only a submitted internal entry can be moderated', 409);
  }
  const external = decision === 'audited';
  try {
    await withTransactionAsync(async (trx) => {
      await trx.run(`
        UPDATE module_registry SET origin = ?, status = ?, updated_at = NOW() WHERE id = ?
      `, [external ? 'external' : 'internal', decision, row.id]);
    });
  } catch (error) {
    throw mapWriteError(error);
  }
  const updated = await dbGet('SELECT * FROM module_registry WHERE id = ?', [row.id]);
  const { effectiveRole } = await getEffectiveRole(userId, { spaceId });
  return serialize(updated, effectiveRole);
}

export { BlueprintError };
