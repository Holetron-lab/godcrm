import { dbGet, safeJsonParse } from '../database/connection.js';

export async function getModuleInstall(moduleKey, spaceId) {
  const row = await dbGet(
    `SELECT id, module_key, version, space_id, installed_by, access_level, bindings, installed_at
       FROM module_installs WHERE module_key = ? AND space_id = ?`,
    [moduleKey, spaceId]
  );
  return row ? { ...row, bindings: safeJsonParse(row.bindings, null) } : null;
}

export async function upsertModuleInstall(trx, { moduleKey, version, spaceId, userId, accessLevel, bindings }) {
  await trx.run(
    `INSERT INTO module_installs
       (module_key, version, space_id, installed_by, access_level, bindings, installed_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW())
     ON CONFLICT (module_key, space_id) DO UPDATE SET
       version = EXCLUDED.version,
       access_level = EXCLUDED.access_level,
       bindings = EXCLUDED.bindings`,
    [moduleKey, version, spaceId, userId, accessLevel, bindings == null ? null : JSON.stringify(bindings)]
  );
}

export async function deleteModuleInstall(trx, moduleKey, spaceId) {
  await trx.run('DELETE FROM module_installs WHERE module_key = ? AND space_id = ?', [moduleKey, spaceId]);
}
