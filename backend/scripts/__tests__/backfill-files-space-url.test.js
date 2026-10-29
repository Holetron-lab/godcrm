// Fleet Audit WP-4 (Bugs 1552/228712) — files.space_id backfill + absolute-url normalisation.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { dbAll, dbRun, dbGet } from '../../database/connection.js';
import { createEphemeralWorkspace, fixtureToken } from '../../tests/helpers/workspace-fixture.js';
import {
  normalizeUploadUrl,
  planRow,
  buildPlan,
  loadCandidates,
  applyPlan,
} from '../backfill-files-space-url.js';

describe('normalizeUploadUrl', () => {
  it('strips the origin from absolute /uploads and /downloads URLs', () => {
    expect(normalizeUploadUrl('https://crm.hltrn.cc/uploads/general/a.png')).toBe('/uploads/general/a.png');
    expect(normalizeUploadUrl('https://devcrm.hltrn.cc/uploads/spaces/11/b.md')).toBe('/uploads/spaces/11/b.md');
    expect(normalizeUploadUrl('http://localhost:5000/downloads/c.zip')).toBe('/downloads/c.zip');
  });

  it('leaves relative and foreign URLs alone', () => {
    expect(normalizeUploadUrl('/uploads/general/a.png')).toBeNull();
    expect(normalizeUploadUrl('https://example.com/report.pdf')).toBeNull();
    expect(normalizeUploadUrl(null)).toBeNull();
  });
});

describe('planRow', () => {
  it('fills space_id only when missing and derivable', () => {
    expect(planRow({ id: 'a', url: '/uploads/x', space_id: null, derived_space_id: 7 })).toEqual({ id: 'a', space_id: 7 });
    expect(planRow({ id: 'b', url: '/uploads/x', space_id: 3, derived_space_id: 7 })).toBeNull();
    expect(planRow({ id: 'c', url: '/uploads/x', space_id: null, derived_space_id: null })).toBeNull();
  });

  it('combines url and space_id fixes in one change', () => {
    expect(planRow({ id: 'd', url: 'https://crm.hltrn.cc/uploads/x', space_id: null, derived_space_id: 7 }))
      .toEqual({ id: 'd', url: '/uploads/x', space_id: 7 });
  });
});

describe('backfill against godcrm_test', () => {
  let ws;
  const tok = fixtureToken();
  const ids = {
    viaProject: `wp4-${tok}-project`,
    viaTable: `wp4-${tok}-table`,
    orphan: `wp4-${tok}-orphan`,
    absUrl: `wp4-${tok}-abs`,
  };

  async function insertFile(id, { url, spaceId = null, projectId = null, tableId = null }) {
    await dbRun(
      `INSERT INTO files (id, name, original_name, mime_type, size, path, url, space_id, project_id, table_id, visibility)
       VALUES (?, ?, ?, 'image/png', 1, ?, ?, ?, ?, ?, 'internal')`,
      [id, `${id}.png`, `${id}.png`, `/tmp/${id}.png`, url, spaceId, projectId, tableId]
    );
  }

  beforeAll(async () => {
    ws = await createEphemeralWorkspace({ dashboard: false, label: 'wp4' });
    await insertFile(ids.viaProject, { url: `/uploads/general/${ids.viaProject}.png`, projectId: ws.projectId });
    await insertFile(ids.viaTable, { url: `/uploads/general/${ids.viaTable}.png`, tableId: ws.tableId });
    await insertFile(ids.orphan, { url: `/uploads/coins/${ids.orphan}.png` });
    await insertFile(ids.absUrl, { url: `https://crm.hltrn.cc/uploads/general/${ids.absUrl}.png`, spaceId: ws.spaceId });
  });

  afterAll(async () => {
    await dbRun('DELETE FROM files WHERE id LIKE ?', [`wp4-${tok}-%`]);
    await ws.cleanup();
  });

  const mine = (rows) => rows.filter((r) => r.id.startsWith(`wp4-${tok}-`));

  it('plans space_id via project and via table, url via origin strip, skips the orphan', async () => {
    const { changes, skipped } = buildPlan(mine(await loadCandidates()));
    const byId = Object.fromEntries(changes.map((c) => [c.id, c]));
    expect(byId[ids.viaProject]).toEqual({ id: ids.viaProject, space_id: ws.spaceId });
    expect(byId[ids.viaTable]).toEqual({ id: ids.viaTable, space_id: ws.spaceId });
    expect(byId[ids.absUrl]).toEqual({ id: ids.absUrl, url: `/uploads/general/${ids.absUrl}.png` });
    expect(skipped.map((r) => r.id)).toEqual([ids.orphan]);
  });

  it('applies the plan so fileGuard can find the row, and is idempotent', async () => {
    const { changes } = buildPlan(mine(await loadCandidates()));
    await applyPlan(changes);

    const fixed = await dbGet('SELECT id, space_id FROM files WHERE url = ?', [`/uploads/general/${ids.absUrl}.png`]);
    expect(fixed?.id).toBe(ids.absUrl);
    const rows = await dbAll('SELECT id, space_id FROM files WHERE id IN (?, ?)', [ids.viaProject, ids.viaTable]);
    expect(rows.map((r) => r.space_id)).toEqual([ws.spaceId, ws.spaceId]);

    const second = buildPlan(mine(await loadCandidates()));
    expect(second.changes).toEqual([]);
    expect(second.skipped.map((r) => r.id)).toEqual([ids.orphan]);
  });
});
