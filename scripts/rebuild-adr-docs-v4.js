#!/usr/bin/env node
/**
 * Publish ADR markdown files to a target documents widget using the v4 API.
 *
 * Target selection — pass exactly one of:
 *   --registry <table_id>    target a registry table directly
 *                            (project + folder discovered from universal_tables)
 *   --widget   <widget_id>   target the registry referenced by a widget's config
 *                            (project + registry + folder pulled from widgets.config)
 *   --project  <project_id>  legacy mode — calls /documents/init to find/create
 *                            the project's documents folder + registry
 *
 * Required:
 *   --files <file.md,slug,icon,name>[ <...>]
 *      One or more comma-separated quadruples. Example:
 *        --files docs/ADR-0002-foo.md,adr-0002,⚖️,"ADR-0002 — Foo"
 *
 * Optional:
 *   --folder <folder_path>   override discovered folder (rarely needed)
 *   --no-cleanup             skip the pre-wipe of registry rows + atoms;
 *                            safe default for adding to an existing widget
 *
 * Problem this solves:
 *   Wave 1 MCP create_document writes into a shared atoms table with numeric
 *   level / block_type. The v4 frontend expects a per-doc content table with
 *   string level (h1|h2|h3|text|divider). The formats are incompatible, so
 *   docs created via the MCP path show "Документ пуст". This script uses the
 *   v4 API exclusively (POST /projects/:id/documents + /import-v4).
 *
 * No silent defaults: the script refuses to run without an explicit target,
 * because earlier runs that fell back to project=5103 published ADRs into
 * the wrong widget several times.
 *
 * Idempotent (with --no-cleanup): slug collisions surface as 409s — delete
 * the offending registry rows first.
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(ROOT, '.env') });

const { Pool } = pg;

const DEFAULT_FOLDER_PATH = 'databases/documents/';
const API_BASE = process.env.API_BASE || 'http://127.0.0.1:5000/api/v3';
const INTERNAL_USER_ID = 1;

function usage(msg) {
  if (msg) console.error(`error: ${msg}\n`);
  console.error([
    'usage: node scripts/rebuild-adr-docs-v4.js <target> --files <file.md,slug,icon,name>...',
    '',
    'target — pass exactly one of:',
    '  --registry <table_id>   target a registry table directly',
    '  --widget   <widget_id>  resolve registry from widget config',
    '  --project  <project_id> use /documents/init for project',
    '',
    'optional:',
    '  --folder <path>         override discovered folder',
    '  --no-cleanup            skip pre-wipe (recommended for adds)',
  ].join('\n'));
  process.exit(2);
}

function parseCliArgs(argv) {
  const args = { project: null, registry: null, widget: null, folder: null, files: [], cleanup: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') args.project = Number(argv[++i]);
    else if (a === '--registry') args.registry = Number(argv[++i]);
    else if (a === '--widget') args.widget = Number(argv[++i]);
    else if (a === '--folder') args.folder = argv[++i];
    else if (a === '--no-cleanup') args.cleanup = false;
    else if (a === '--files') {
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) {
        const parts = argv[++i].split(',');
        if (parts.length < 4) usage(`--files entry needs file,slug,icon,name (got: ${parts.join(',')})`);
        const [file, slug, icon, ...nameParts] = parts;
        args.files.push({ file, slug, icon, name: nameParts.join(',') });
      }
    } else if (a === '-h' || a === '--help') usage();
    else usage(`unknown arg: ${a}`);
  }
  const targets = ['project', 'registry', 'widget'].filter(k => args[k] != null);
  if (targets.length === 0) usage('exactly one of --registry | --widget | --project is required (no silent default)');
  if (targets.length > 1) usage(`only one target allowed; got: ${targets.map(t => `--${t}`).join(', ')}`);
  if (args.files.length === 0) usage('--files <file.md,slug,icon,name> is required');
  return args;
}

async function resolveTarget(pool, args) {
  if (args.widget != null) {
    const r = await pool.query(`SELECT title, config FROM widgets WHERE id = $1`, [args.widget]);
    if (r.rowCount === 0) throw new Error(`widget ${args.widget} not found`);
    let cfg;
    try { cfg = JSON.parse(r.rows[0].config || '{}'); }
    catch (e) { throw new Error(`widget ${args.widget} config is not JSON: ${e.message}`); }
    const registry = Number(cfg.registry_table_id);
    const project = Number(cfg.project_id);
    if (!registry || !project) {
      throw new Error(`widget ${args.widget} ("${r.rows[0].title}") config missing registry_table_id/project_id (got registry=${cfg.registry_table_id}, project=${cfg.project_id})`);
    }
    const f = await pool.query(`SELECT folder_path FROM universal_tables WHERE id = $1`, [registry]);
    if (f.rowCount === 0) throw new Error(`widget ${args.widget} points at registry table ${registry} that does not exist`);
    return {
      project, registry,
      folder: args.folder || f.rows[0].folder_path || DEFAULT_FOLDER_PATH,
      label: `widget ${args.widget} ("${r.rows[0].title}")`,
    };
  }
  if (args.registry != null) {
    const r = await pool.query(`SELECT name, project_id, folder_path FROM universal_tables WHERE id = $1`, [args.registry]);
    if (r.rowCount === 0) throw new Error(`registry table ${args.registry} not found`);
    if (!r.rows[0].project_id) throw new Error(`registry table ${args.registry} has no project_id`);
    return {
      project: r.rows[0].project_id, registry: args.registry,
      folder: args.folder || r.rows[0].folder_path || DEFAULT_FOLDER_PATH,
      label: `registry ${args.registry} ("${r.rows[0].name}")`,
    };
  }
  return {
    project: args.project, registry: null,
    folder: args.folder || DEFAULT_FOLDER_PATH,
    label: `project ${args.project} (legacy mode — registry resolved via /init)`,
  };
}

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) { console.error('JWT_SECRET missing'); process.exit(1); }

const token = jwt.sign(
  { id: INTERNAL_USER_ID, email: 'architect@internal', role: 'admin' },
  JWT_SECRET,
  { expiresIn: '10m' }
);

async function api(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  return json && json.data !== undefined ? json.data : json;
}

// ---------------------------------------------------------------------------
// Markdown → v4 sections parser
// Mirrors src/features/widgets/utils/parseMarkdownToAtoms.ts::parseMarkdownToDocumentV4
// ---------------------------------------------------------------------------
function toDocumentLevel(n) {
  return n === 1 ? 'h1' : n === 2 ? 'h2' : n === 3 ? 'h3' : 'text';
}

function detectType(title, content, level) {
  const tl = (title || '').toLowerCase();
  const cl = (content || '').toLowerCase();
  if (/^(GET|POST|PUT|PATCH|DELETE)\s+/i.test(title || '')) return 'endpoint';
  if (tl.includes('component') || /<[A-Z][a-zA-Z]+/.test(content)) return 'component';
  if (tl.startsWith('use') || /use[A-Z]\w+/.test(content)) return 'hook';
  if (tl.includes('store') || cl.includes('zustand')) return 'store';
  if (tl.includes('how') || tl.includes('guide') || tl.includes('tutorial')) return 'howto';
  if (content.match(/```[\s\S]+```/) && content.split('```').length > 4) return 'code';
  if (content.length > 500) return 'concept';
  return 'reference';
}

function parseMarkdownV4(markdown) {
  const content = (markdown || '').replace(/\r\n/g, '\n').trim();
  const lines = content.split('\n');

  const h1Match = content.match(/^#\s+(.+)$/m);
  const documentTitle = h1Match ? h1Match[1].trim() : 'Untitled';

  let description = '';
  const h1Idx = content.indexOf('# ');
  const h2Idx = content.indexOf('\n## ');
  if (h1Idx !== -1 && h2Idx !== -1 && h2Idx > h1Idx) {
    description = content.substring(content.indexOf('\n', h1Idx) + 1, h2Idx)
      .trim().split('\n').slice(0, 3).join(' ').trim();
  }

  const sections = [];
  let currentTitle = '';
  let currentLevel = 'text';
  let currentContent = [];
  let inSection = false;
  let orderIndex = 0;
  let skippedFirstH1 = false;

  const finalize = () => {
    if (!inSection) return;
    const trimmed = currentContent.join('\n').trim();

    if (currentLevel === 'h1' && !skippedFirstH1) {
      skippedFirstH1 = true;
      currentTitle = ''; currentContent = []; inSection = false;
      return;
    }

    if (currentLevel === 'h2' || currentLevel === 'h3') {
      if (currentTitle) {
        orderIndex += 10;
        sections.push({
          order: orderIndex,
          level: currentLevel,
          content: currentTitle,
          type: detectType(currentTitle, trimmed, currentLevel),
        });
      }
      if (trimmed) {
        orderIndex += 10;
        sections.push({ order: orderIndex, level: 'text', content: trimmed, type: 'reference' });
      }
    } else {
      if (currentTitle || trimmed) {
        orderIndex += 10;
        sections.push({
          order: orderIndex,
          level: currentLevel,
          content: currentTitle || trimmed,
          type: detectType(currentTitle, trimmed, currentLevel),
        });
      }
    }

    currentTitle = ''; currentContent = []; inSection = false;
  };

  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headerMatch) {
      finalize();
      currentLevel = toDocumentLevel(headerMatch[1].length);
      currentTitle = headerMatch[2].trim();
      inSection = true;
    } else if (line.startsWith('---') && line.replace(/-/g, '').trim() === '') {
      if (inSection) finalize();
      orderIndex += 10;
      sections.push({ order: orderIndex, level: 'divider', content: '' });
    } else {
      if (!inSection && line.trim()) {
        inSection = true; currentLevel = 'text'; currentTitle = '';
      }
      if (inSection) currentContent.push(line);
    }
  }
  finalize();

  return { title: documentTitle, description, sections };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const cli = parseCliArgs(process.argv.slice(2));
  const { files: ADRS, cleanup } = cli;

  const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    user: process.env.PGUSER || 'godcrm',
    password: process.env.PGPASSWORD || 'godcrm_dev_2026',
    database: process.env.PGDATABASE || 'godcrm_prod',
  });

  try {
    const target = await resolveTarget(pool, cli);
    const PROJECT_ID = target.project;
    const FOLDER_PATH = target.folder;
    console.log(`target: ${target.label}`);
    console.log(`  project=${PROJECT_ID}, folder=${FOLDER_PATH}, cleanup=${cleanup}, files=${ADRS.length}`);

    console.log('\n--- 1. Init documents v4 folder (idempotent) ---');
    const init = await api('POST', `/projects/${PROJECT_ID}/documents/init`, { folder_path: FOLDER_PATH });
    const REGISTRY_TABLE_ID = init.registry_table_id;
    const ATOMS_TABLE_ID = init.atoms_table_id;
    console.log(`  registry=${REGISTRY_TABLE_ID}, atoms=${ATOMS_TABLE_ID}, already=${init.already_exists || false}`);

    if (target.registry != null && target.registry !== REGISTRY_TABLE_ID) {
      throw new Error(
        `target mismatch: requested registry=${target.registry} but /init for project ${PROJECT_ID} ` +
        `(folder=${FOLDER_PATH}) returned registry=${REGISTRY_TABLE_ID}. ` +
        `refusing to publish to a different registry than requested.`
      );
    }

    if (cleanup) {
      console.log('\n--- 2. Cleanup: delete broken registry rows + orphan atoms ---');
      const reg = await pool.query(
        `SELECT id, data::jsonb->>'slug' AS slug FROM table_rows WHERE table_id = $1`,
        [REGISTRY_TABLE_ID]
      );
      const targetSlugs = new Set(ADRS.map(a => a.slug));
      const toDelete = reg.rows.filter(r => !r.slug || targetSlugs.has(r.slug));
      for (const row of toDelete) {
        await pool.query(`DELETE FROM table_rows WHERE id = $1 AND table_id = $2`, [row.id, REGISTRY_TABLE_ID]);
        console.log(`  deleted registry row ${row.id} (slug=${row.slug || 'null'})`);
      }
      // NOTE: in v4 atoms live in per-doc companion tables; wiping the legacy
      // shared ATOMS_TABLE_ID here would nuke other docs' content. Left out.
    } else {
      console.log('\n--- 2. Cleanup skipped (--no-cleanup) ---');
    }

    console.log('\n--- 3. Publish ADRs via v4 API ---');
    const results = [];
    for (const adr of ADRS) {
      const mdPath = path.isAbsolute(adr.file) ? adr.file : path.join(ROOT, adr.file.startsWith('docs/') ? adr.file : path.join('docs', adr.file));
      const markdown = fs.readFileSync(mdPath, 'utf-8');
      const parsed = parseMarkdownV4(markdown);

      const createRes = await api('POST', `/projects/${PROJECT_ID}/documents`, {
        name: adr.name,
        slug: adr.slug,
        description: parsed.description.substring(0, 500),
        icon: adr.icon,
        category: 'Backend',
        folder_path: FOLDER_PATH,
      });
      const docId = createRes.document_id;
      const tableId = createRes.table_id;

      const importRes = await api('POST', `/documents/${docId}/import-v4`, {
        registry_table_id: REGISTRY_TABLE_ID,
        sections: parsed.sections,
      });

      console.log(`  ✓ ${adr.slug}: doc_id=${docId}, table_id=${tableId}, sections=${importRes.count}`);
      results.push({ slug: adr.slug, doc_id: docId, table_id: tableId, sections: importRes.count });
    }

    console.log('\n--- 4. Verify via GET content ---');
    for (const r of results) {
      const content = await api('GET', `/documents/${r.doc_id}/content?registry_table_id=${REGISTRY_TABLE_ID}`);
      const levelCounts = {};
      for (const it of content.items || []) { levelCounts[it.level] = (levelCounts[it.level] || 0) + 1; }
      console.log(`  ${r.slug}: count=${content.count}, levels=${JSON.stringify(levelCounts)}`);
    }

    console.log('\n✓ Publish complete.');
    console.log(JSON.stringify({ project_id: PROJECT_ID, registry_table_id: REGISTRY_TABLE_ID, docs: results }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('FAIL:', err);
  process.exit(1);
});
