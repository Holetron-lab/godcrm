#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [spaceArg, outputArg] = process.argv.slice(2);
const spaceId = Number(spaceArg);
const sourceUrl = (process.env.SOURCE_URL || '').replace(/\/$/, '');
const token = process.env.SOURCE_TOKEN || '';

if (!Number.isInteger(spaceId) || spaceId <= 0 || !sourceUrl || !token || !outputArg) {
  console.error('Usage: SOURCE_URL=https://source.example SOURCE_TOKEN=... node export-space.mjs <spaceId> <private-output-directory>');
  process.exit(2);
}

const outputDir = path.resolve(outputArg);
if (!outputDir.startsWith('/root/backups/') && !outputDir.startsWith('/tmp/')) {
  console.error('Refusing output outside /root/backups or /tmp: exports can contain private workspace data.');
  process.exit(2);
}

const response = await fetch(`${sourceUrl}/api/v3/spaces/${spaceId}/export`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ includeSettings: true }),
  signal: AbortSignal.timeout(120000),
});
const text = await response.text();
if (!response.ok) throw new Error(`Export HTTP ${response.status}: ${text.slice(0, 500)}`);

const payload = JSON.parse(text);
const data = payload.data;
if (!payload.success || data?.type !== 'space' || data.space?.id !== spaceId) {
  throw new Error('Unexpected export response shape or space ID');
}

const sensitiveColumn = /password|api.?key|secret|token|credential|private.?key/i;
const sensitiveTable = /secret|credential|token|api.?key/i;
const excludedSensitiveTables = [];
let sanitizedColumns = 0;
for (const project of data.projects || []) {
  project.tables = (project.tables || []).filter(table => {
    if (!sensitiveTable.test(table.table?.name || '')) return true;
    excludedSensitiveTables.push(table.table.name);
    return false;
  });
  for (const table of project.tables) {
    const columns = (table.columns || [])
      .filter(column => ['password', 'apiKey', 'token', 'secret'].includes(column.columnType) || sensitiveColumn.test(column.name || ''))
      .map(column => column.name);
    sanitizedColumns += columns.length;
    table.rows = (table.rows || []).map(row => {
      const sanitized = { ...row };
      for (const column of columns) sanitized[column] = null;
      return sanitized;
    });
  }
}

const projects = data.projects || [];
const exportedAt = new Date().toISOString();
const base = `space-${spaceId}-partial-${exportedAt.replaceAll(':', '-')}`;
await mkdir(outputDir, { recursive: true, mode: 0o700 });
const exportPath = path.join(outputDir, `${base}.json`);
const serialized = `${JSON.stringify(data, null, 2)}\n`;
await writeFile(exportPath, serialized, { mode: 0o600 });

const manifest = {
  schema: 1,
  source_space_id: spaceId,
  exported_at: exportedAt,
  fidelity: 'PARTIAL_NOT_A_FULL_MIGRATION',
  sanitization: { excludedSensitiveTables, sanitizedColumns },
  excluded_or_unproven: [
    'dashboards and widgets', 'calendar events', 'conversations and messages',
    'files and uploads', 'space connectors and credentials', 'RCLL memories',
    'cross-table relation remapping', 'system-table virtual rows',
  ],
  project_count: projects.length,
  table_count: projects.reduce((sum, project) => sum + (project.tables?.length || 0), 0),
  row_count: projects.reduce((sum, project) => sum + (project.tables || []).reduce((n, table) => n + (table.rows?.length || 0), 0), 0),
  legacy_document_count: projects.reduce((sum, project) => sum + (project.documents?.length || 0), 0),
  sha256: createHash('sha256').update(serialized).digest('hex'),
  export_file: path.basename(exportPath),
};
const manifestPath = path.join(outputDir, `${base}.manifest.json`);
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
await chmod(exportPath, 0o600);
await chmod(manifestPath, 0o600);
console.log(JSON.stringify({ export: exportPath, manifest: manifestPath, ...manifest }, null, 2));
