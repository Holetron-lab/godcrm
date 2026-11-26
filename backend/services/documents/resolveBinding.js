import { dbGet } from '../../database/connection.js';

function safeIdent(name) {
  if (typeof name !== 'string' || !/^[a-z_][a-z0-9_]*$/i.test(name)) {
    throw new Error(`Invalid column identifier: ${JSON.stringify(name)}`);
  }
  return name;
}

export async function resolveBinding(widget_id) {
  if (widget_id === undefined || widget_id === null) {
    throw new Error('widget_id is required (ADR-154: document tools are widget-bound)');
  }

  const w = await dbGet('SELECT id, config FROM widgets WHERE id = ?', [widget_id]);
  if (!w) throw new Error(`Widget ${widget_id} not found`);

  const cfg = typeof w.config === 'string' ? JSON.parse(w.config) : (w.config || {});
  const registry_table_id = Number(cfg.registry_table_id || cfg.documents_table_id);
  if (!registry_table_id) {
    throw new Error(`Widget ${widget_id} is not a documents widget (missing registry_table_id)`);
  }

  let project_id = cfg.project_id ? Number(cfg.project_id) : null;
  let folder_path = null;
  const tbl = await dbGet(
    'SELECT project_id, folder_path FROM universal_tables WHERE id = ?',
    [registry_table_id]
  );
  if (!project_id) project_id = tbl?.project_id || null;
  folder_path = tbl?.folder_path || 'databases/documents/';

  const titleCol = safeIdent(cfg.documents_titleColumn || 'name');

  return { project_id, registry_table_id, folder_path, titleCol };
}
