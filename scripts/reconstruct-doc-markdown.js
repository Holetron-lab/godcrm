#!/usr/bin/env node
/**
 * Reconstruct markdown from Wave 1 atoms stored in the shared atoms table (3574).
 *
 * Usage:
 *   node scripts/reconstruct-doc-markdown.js <document_id> [<output_path>]
 *
 * Reads every atom with data->>'document_id' = <document_id> from table 3574,
 * sorts by order, and rebuilds the source markdown. Inverse of
 * parseMarkdownToAtoms (backend/services/agent-tools/document-tools.js).
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const ATOMS_V2 = 3574;

function atomToMarkdown(a) {
  const type = a.block_type || a.type;
  const content = a.content_en || a.content || '';
  const md = {};
  switch (type) {
    case 'heading': {
      const level = Number(a.level) || Number(a.heading_level) || 1;
      return '#'.repeat(Math.max(1, Math.min(6, level))) + ' ' + content;
    }
    case 'code': {
      const lang = (a.metadata && a.metadata.language) || '';
      return '```' + lang + '\n' + content + '\n```';
    }
    case 'quote':
      return content.split('\n').map(l => '> ' + l).join('\n');
    case 'hr':
      return '---';
    case 'list':
    case 'table':
    case 'paragraph':
    default:
      return content;
  }
}

async function main() {
  const [docIdArg, outPathArg] = process.argv.slice(2);
  if (!docIdArg) { console.error('usage: node reconstruct-doc-markdown.js <document_id> [<out>]'); process.exit(1); }

  const { Pool } = pg;
  const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    user: process.env.PGUSER || 'godcrm',
    password: process.env.PGPASSWORD || 'godcrm_dev_2026',
    database: process.env.PGDATABASE || 'godcrm_prod',
  });

  try {
    const { rows } = await pool.query(
      `SELECT data FROM table_rows
        WHERE table_id = $1 AND data->>'document_id' = $2
        ORDER BY (data->>'order')::int ASC`,
      [ATOMS_V2, String(docIdArg)]
    );
    if (rows.length === 0) {
      console.error(`no atoms found for document_id=${docIdArg} in table ${ATOMS_V2}`);
      process.exit(2);
    }

    const reg = await pool.query(
      `SELECT data->>'name' AS name, data->>'description' AS description
         FROM table_rows WHERE id = $1`,
      [Number(docIdArg)]
    );
    const regRow = reg.rows[0] || {};

    const parts = [];
    if (regRow.name) parts.push('# ' + regRow.name);
    if (regRow.description) parts.push(regRow.description.trim());
    for (const r of rows) {
      parts.push(atomToMarkdown(r.data));
    }
    const markdown = parts.join('\n\n') + '\n';

    if (outPathArg) {
      fs.writeFileSync(outPathArg, markdown, 'utf8');
      console.error(`wrote ${markdown.length} bytes → ${outPathArg} (atoms=${rows.length})`);
    } else {
      process.stdout.write(markdown);
      console.error(`reconstructed ${rows.length} atoms`);
    }
  } finally {
    await pool.end();
  }
}

main().catch(err => { console.error('FAIL:', err); process.exit(1); });
