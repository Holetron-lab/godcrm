#!/usr/bin/env node

/**
 * Standalone script to generate vector embeddings for ALL rows in table 1790 (AI Tools)
 * 
 * Vector column config:
 *   Column ID: 21747
 *   Column name: vector_decription
 *   Formula: {{name}}\n{{tags}}\n{{description}}
 *   Model: text-embedding-3-small
 *
 * Usage: node generate-vectors-1790.js [--batch-size=50] [--start-offset=0] [--dry-run]
 */

import pg from 'pg';
import { getSecret } from '../services/secrets/getSecret.js';
const { Pool } = pg;

// --- Config ---
const TABLE_ID = 1790;
const COLUMN_ID = 21747;
const EMBEDDING_MODEL = 'text-embedding-3-small';
// ADR-0040: vault first, env fallback during transition (top-level await OK in ESM).
const OPENAI_API_KEY = await getSecret('openai_api_key', 'OPENAI_API_KEY');
const OPENAI_BASE_URL = 'https://api.openai.com/v1';

// Parse CLI args
const args = process.argv.slice(2);
const getArg = (name, defaultVal) => {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : defaultVal;
};
const BATCH_SIZE = parseInt(getArg('batch-size', '50'), 10);
const START_OFFSET = parseInt(getArg('start-offset', '0'), 10);
const DRY_RUN = args.includes('--dry-run');
const SKIP_EXISTING = !args.includes('--regenerate');

// Database connection
const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  database: process.env.POSTGRES_DB || 'godcrm_prod',
  user: process.env.POSTGRES_USER || 'godcrm',
  password: process.env.POSTGRES_PASSWORD || 'godcrm_dev_2026',
});

// --- Helpers ---

function applyFormula(formula, rowData) {
  if (!formula) return '';
  return formula.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const val = rowData[key];
    if (val === undefined || val === null) return '';
    if (typeof val === 'object') {
      if (Array.isArray(val)) return val.join(', ');
      return JSON.stringify(val);
    }
    return String(val);
  });
}

// Batch embedding - send multiple texts at once (OpenAI supports this)
async function generateEmbeddingsBatch(texts, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`${OPENAI_BASE_URL}/embeddings`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: texts,
        }),
      });

      if (!response.ok) {
        const errBody = await response.text();
        if (response.status === 429) {
          const waitTime = Math.min(attempt * 10000, 60000);
          console.warn(`  Rate limited. Waiting ${waitTime / 1000}s before retry ${attempt}/${retries}...`);
          await sleep(waitTime);
          continue;
        }
        throw new Error(`OpenAI API error ${response.status}: ${errBody}`);
      }

      const data = await response.json();
      // Sort by index to maintain order
      return data.data.sort((a, b) => a.index - b.index).map(d => d.embedding);
    } catch (err) {
      if (attempt === retries) throw err;
      const waitTime = attempt * 3000;
      console.warn(`  Attempt ${attempt} failed: ${err.message}. Retrying in ${waitTime / 1000}s...`);
      await sleep(waitTime);
    }
  }
}

async function generateEmbeddingSingle(text, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`${OPENAI_BASE_URL}/embeddings`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: text,
        }),
      });

      if (!response.ok) {
        const errBody = await response.text();
        if (response.status === 429) {
          const waitTime = Math.min(attempt * 5000, 30000);
          console.warn(`  Rate limited. Waiting ${waitTime / 1000}s before retry ${attempt}/${retries}...`);
          await sleep(waitTime);
          continue;
        }
        throw new Error(`OpenAI API error ${response.status}: ${errBody}`);
      }

      const data = await response.json();
      return data.data[0].embedding;
    } catch (err) {
      if (attempt === retries) throw err;
      const waitTime = attempt * 2000;
      console.warn(`  Attempt ${attempt} failed: ${err.message}. Retrying in ${waitTime / 1000}s...`);
      await sleep(waitTime);
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Main ---

async function main() {
  console.log('=== Vector Embedding Generator for Table 1790 (AI Tools) ===');
  console.log(`Model: ${EMBEDDING_MODEL}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log(`Start offset: ${START_OFFSET}`);
  console.log(`Skip existing: ${SKIP_EXISTING}`);
  console.log(`Dry run: ${DRY_RUN}`);
  console.log('');

  if (!OPENAI_API_KEY) {
    console.error('ERROR: OPENAI_API_KEY environment variable is required');
    process.exit(1);
  }

  // 1. Get all columns for this table (to map column IDs to names)
  const columnsResult = await pool.query(
    'SELECT id, column_name FROM table_columns WHERE table_id = $1',
    [TABLE_ID]
  );
  const columns = columnsResult.rows;
  const columnMap = {};
  for (const col of columns) {
    columnMap[col.id] = col.column_name;
  }
  console.log(`Found ${columns.length} columns in table ${TABLE_ID}`);

  // 2. Get the vector column config
  const vectorColResult = await pool.query(
    'SELECT * FROM table_columns WHERE table_id = $1 AND id = $2',
    [TABLE_ID, COLUMN_ID]
  );
  const vectorCol = vectorColResult.rows[0];
  if (!vectorCol) {
    console.error(`ERROR: Vector column ${COLUMN_ID} not found in table ${TABLE_ID}`);
    process.exit(1);
  }

  let colConfig = {};
  try {
    colConfig = JSON.parse(vectorCol.config || '{}');
  } catch (e) {
    colConfig = {};
  }
  const vectorConfig = colConfig.vector || {};
  const formula = vectorConfig.formula || '{{name}}\\n{{tags}}\\n{{description}}';
  console.log(`Vector formula: ${formula}`);
  console.log('');

  // 3. Get all rows
  const rowsResult = await pool.query(
    'SELECT id, data FROM table_rows WHERE table_id = $1 ORDER BY id',
    [TABLE_ID]
  );
  const allRows = rowsResult.rows;
  console.log(`Total rows in table: ${allRows.length}`);

  // 4. Filter rows that need embedding
  const rowsToProcess = [];
  let skippedExisting = 0;
  let skippedEmpty = 0;

  for (const row of allRows) {
    let rowData = {};
    try {
      rowData = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data || {});
    } catch (e) {
      rowData = {};
    }

    // Check if embedding already exists
    if (SKIP_EXISTING) {
      const existing = rowData[COLUMN_ID] || rowData[String(COLUMN_ID)];
      if (existing && existing.embedding && Array.isArray(existing.embedding) && existing.embedding.length > 0) {
        skippedExisting++;
        continue;
      }
    }

    // Build text from formula - map column IDs to column names
    const rowDataByName = {};
    for (const col of columns) {
      if (rowData[col.id] !== undefined) {
        rowDataByName[col.column_name] = rowData[col.id];
      } else if (rowData[String(col.id)] !== undefined) {
        rowDataByName[col.column_name] = rowData[String(col.id)];
      } else if (rowData[col.column_name] !== undefined) {
        rowDataByName[col.column_name] = rowData[col.column_name];
      }
    }

    let text = applyFormula(formula, rowDataByName);
    // Replace literal \n with actual newlines
    text = text.replace(/\\n/g, '\n');

    if (!text || text.trim().length === 0) {
      skippedEmpty++;
      continue;
    }

    rowsToProcess.push({ id: row.id, text: text.trim(), data: rowData });
  }

  console.log(`Skipped (already have embeddings): ${skippedExisting}`);
  console.log(`Skipped (empty text): ${skippedEmpty}`);
  console.log(`Rows needing embeddings: ${rowsToProcess.length}`);
  
  if (rowsToProcess.length === 0) {
    console.log('\nAll rows already have embeddings. Use --regenerate to force regeneration.');
    await pool.end();
    return;
  }

  if (DRY_RUN) {
    console.log('\n--- DRY RUN: First 10 rows that would be processed ---');
    for (const row of rowsToProcess.slice(0, 10)) {
      console.log(`  Row ${row.id}: "${row.text.substring(0, 120)}${row.text.length > 120 ? '...' : ''}"`);
    }
    console.log(`\n(${rowsToProcess.length} rows total would be processed)`);
    await pool.end();
    return;
  }

  // 5. Process in batches using OpenAI batch embedding API
  const remaining = rowsToProcess.slice(START_OFFSET);
  let successCount = 0;
  let failCount = 0;
  const startTime = Date.now();

  console.log(`\nProcessing ${remaining.length} rows starting from offset ${START_OFFSET}...`);
  console.log('');

  for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
    const batch = remaining.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(remaining.length / BATCH_SIZE);

    process.stdout.write(`Batch ${batchNum}/${totalBatches} (rows ${i + 1}-${Math.min(i + BATCH_SIZE, remaining.length)} of ${remaining.length})... `);

    try {
      // Send all texts in this batch to OpenAI at once
      const texts = batch.map(r => r.text);
      const embeddings = await generateEmbeddingsBatch(texts);

      // Update each row in the database
      for (let j = 0; j < batch.length; j++) {
        const row = batch[j];
        const embedding = embeddings[j];

        row.data[COLUMN_ID] = {
          text: row.text,
          embedding: embedding,
          generated_at: new Date().toISOString(),
          model: EMBEDDING_MODEL,
          dimensions: embedding.length,
          agent: 'Script: generate-vectors-1790',
        };

        await pool.query(
          'UPDATE table_rows SET data = $1, updated_at = NOW() WHERE id = $2',
          [JSON.stringify(row.data), row.id]
        );

        successCount++;
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const rate = (successCount / (elapsed || 1)).toFixed(1);
      const eta = remaining.length > successCount
        ? (((remaining.length - successCount) / Math.max(parseFloat(rate), 0.1)) / 60).toFixed(1)
        : 0;
      console.log(`OK (${batch.length} embeddings, total: ${successCount}/${remaining.length}, ${rate}/s, ETA: ${eta}min)`);

      // Small delay between batches to avoid rate limits
      if (i + BATCH_SIZE < remaining.length) {
        await sleep(300);
      }

    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      console.log('  Falling back to individual processing for this batch...');
      
      // Fall back to individual processing for this batch
      for (const row of batch) {
        try {
          const embedding = await generateEmbeddingSingle(row.text);
          row.data[COLUMN_ID] = {
            text: row.text,
            embedding: embedding,
            generated_at: new Date().toISOString(),
            model: EMBEDDING_MODEL,
            dimensions: embedding.length,
            agent: 'Script: generate-vectors-1790',
          };
          await pool.query(
            'UPDATE table_rows SET data = $1, updated_at = NOW() WHERE id = $2',
            [JSON.stringify(row.data), row.id]
          );
          successCount++;
          await sleep(200);
        } catch (rowErr) {
          console.error(`    Row ${row.id} failed: ${rowErr.message}`);
          failCount++;
        }
      }
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('');
  console.log('=== COMPLETE ===');
  console.log(`Success: ${successCount}`);
  console.log(`Failed: ${failCount}`);
  console.log(`Total time: ${totalTime}s`);
  console.log(`Average: ${(successCount / (totalTime || 1)).toFixed(1)} rows/s`);

  await pool.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
