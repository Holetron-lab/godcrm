#!/usr/bin/env node

/**
 * Batch AI Enrichment Script for AI Tools table (1790)
 * Ticket #43305: Enrich existing skills with AI-generated metadata
 *
 * Usage:
 *   node scripts/enrich-skills-batch.js                    # Enrich all unenriched skills
 *   node scripts/enrich-skills-batch.js --limit 10          # Enrich only 10 skills
 *   node scripts/enrich-skills-batch.js --dry-run           # Preview without changes
 *   node scripts/enrich-skills-batch.js --source antigravity # Only antigravity skills
 *   node scripts/enrich-skills-batch.js --delay 2000         # 2s delay between API calls
 *
 * Environment:
 *   BATCH_SIZE=10       - Number of skills per batch (default: 10)
 *   DRY_RUN=true        - Preview mode
 *   DELAY_MS=1500       - Delay between API calls in ms (default: 1500)
 */

import pg from 'pg';

const TABLE_ID = 1790;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_DELAY_MS = 1500; // Rate limit: ~40 req/min

// Parse CLI args
const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
};
const hasFlag = (name) => args.includes(`--${name}`);

const LIMIT = parseInt(getArg('limit')) || 0;
const DRY_RUN = hasFlag('dry-run') || process.env.DRY_RUN === 'true';
const SOURCE_FILTER = getArg('source') || null;
const DELAY_MS = parseInt(getArg('delay')) || parseInt(process.env.DELAY_MS) || DEFAULT_DELAY_MS;
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE) || DEFAULT_BATCH_SIZE;

// Anthropic API config
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';

const ENRICHMENT_TOOL = {
  name: 'enrich_skill',
  description: 'Provide structured metadata for an AI skill/tool',
  input_schema: {
    type: 'object',
    properties: {
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: '3-8 relevant keyword tags for searching (lowercase, hyphenated)'
      },
      risk_level: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
        description: 'Risk level: low (read-only), medium (modifies files), high (system access, destructive)'
      },
      rating: {
        type: 'number',
        minimum: 1,
        maximum: 5,
        description: 'Quality score 1-5'
      },
      category: {
        type: 'string',
        enum: [
          'data', 'tables', 'workspace', 'widgets', 'analysis',
          'system', 'architecture', 'security', 'testing', 'devops',
          'game-development', 'frontend', 'backend', 'mobile', 'ai-ml'
        ],
        description: 'Best fit category'
      },
      platform: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['claude-code', 'cursor', 'windsurf', 'copilot', 'god-crm']
        },
        description: 'Supported platforms'
      }
    },
    required: ['tags', 'risk_level', 'rating', 'category', 'platform']
  }
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isUnenriched(data) {
  // Skip internal tools — they're already properly categorized
  if (data.source === 'internal') return false;

  // Consider unenriched if:
  // - tags is empty or missing
  // - risk_level is "unknown" or missing
  // - rating is 0 or missing
  const hasNoTags = !data.tags || (Array.isArray(data.tags) && data.tags.length === 0);
  const hasUnknownRisk = !data.risk_level || data.risk_level === 'unknown';
  const hasNoRating = !data.rating || data.rating === 0;

  return hasNoTags || hasUnknownRisk || hasNoRating;
}

function validateEnrichment(enrichment) {
  const validCategories = [
    'data', 'tables', 'workspace', 'widgets', 'analysis',
    'system', 'architecture', 'security', 'testing', 'devops',
    'game-development', 'frontend', 'backend', 'mobile', 'ai-ml'
  ];
  const validRiskLevels = ['low', 'medium', 'high'];
  const validPlatforms = ['claude-code', 'cursor', 'windsurf', 'copilot', 'god-crm'];

  let tags = Array.isArray(enrichment.tags) ? enrichment.tags : [];
  tags = tags.filter(t => typeof t === 'string').map(t => t.toLowerCase().trim()).slice(0, 8);

  const risk_level = validRiskLevels.includes(enrichment.risk_level) ? enrichment.risk_level : 'low';

  let rating = parseInt(enrichment.rating, 10);
  if (isNaN(rating) || rating < 1) rating = 1;
  if (rating > 5) rating = 5;

  const category = validCategories.includes(enrichment.category) ? enrichment.category : 'system';

  let platform = Array.isArray(enrichment.platform) ? enrichment.platform : [];
  platform = platform.filter(p => validPlatforms.includes(p));
  if (platform.length === 0) platform = ['claude-code'];

  return { tags, risk_level, rating, category, platform };
}

async function callClaude(apiKey, rowData) {
  const name = rowData.name || 'Unknown';
  const displayName = rowData.display_name || name;
  const description = rowData.description || 'No description';
  const category = rowData.category || 'uncategorized';
  const source = rowData.source || 'unknown';

  const prompt = `You are an AI skills/tools classifier. Analyze this skill and provide structured metadata.

Skill name: ${name}
Display name: ${displayName}
Description: ${description}
Current category: ${category}
Source: ${source}

Provide:
1. tags: 3-8 relevant keyword tags for searching (lowercase, hyphenated)
2. risk_level: "low" (read-only, informational), "medium" (modifies files/config), "high" (system access, network, destructive)
3. rating: 1-5 quality score based on description clarity and usefulness
4. category: best fit from [data, tables, workspace, widgets, analysis, system, architecture, security, testing, devops, game-development, frontend, backend, mobile, ai-ml]
5. platform: which platforms support this skill from [claude-code, cursor, windsurf, copilot, god-crm]`;

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      tools: [ENRICHMENT_TOOL],
      tool_choice: { type: 'tool', name: 'enrich_skill' },
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${errorText}`);
  }

  const result = await response.json();
  const toolUseBlock = result.content?.find(b => b.type === 'tool_use');
  if (!toolUseBlock?.input) {
    throw new Error('No tool_use block in response');
  }

  return validateEnrichment(toolUseBlock.input);
}

async function main() {
  console.log('=== AI Skills Batch Enrichment ===');
  console.log(`Table: ${TABLE_ID}`);
  console.log(`Dry run: ${DRY_RUN}`);
  console.log(`Source filter: ${SOURCE_FILTER || 'all'}`);
  console.log(`Delay: ${DELAY_MS}ms`);
  console.log(`Limit: ${LIMIT || 'unlimited'}`);
  console.log('');

  // Connect to PostgreSQL
  const client = new pg.Client({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'godcrm_prod',
    user: process.env.POSTGRES_USER || 'godcrm',
    password: process.env.POSTGRES_PASSWORD || undefined
  });

  await client.connect();
  console.log('Connected to godcrm_prod');

  // Get Anthropic API key from AI Operators table (table_id=226)
  const keyResult = await client.query(`
    SELECT data FROM table_rows
    WHERE table_id = (SELECT id FROM universal_tables WHERE name = 'AI Operators' LIMIT 1)
    AND data->>'provider' = 'anthropic'
    LIMIT 1
  `);
  const operatorData = keyResult.rows[0]?.data;
  const apiKey = typeof operatorData === 'string' ? JSON.parse(operatorData).api_key : operatorData?.api_key;
  if (!apiKey) {
    console.error('ERROR: No Anthropic API key found in AI Operators table');
    process.exit(1);
  }
  console.log('Anthropic API key found (from AI Operators)');

  // Get all rows from table 1790
  const rowsResult = await client.query(
    'SELECT id, data FROM table_rows WHERE table_id = $1 ORDER BY id',
    [TABLE_ID]
  );

  console.log(`Total rows in table: ${rowsResult.rows.length}`);

  // Filter to unenriched rows
  let candidates = rowsResult.rows.filter(row => {
    const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    if (SOURCE_FILTER && data.source !== SOURCE_FILTER) return false;
    return isUnenriched(data);
  });

  console.log(`Unenriched rows: ${candidates.length}`);

  if (LIMIT > 0) {
    candidates = candidates.slice(0, LIMIT);
    console.log(`Limited to: ${candidates.length}`);
  }

  if (candidates.length === 0) {
    console.log('Nothing to enrich!');
    await client.end();
    return;
  }

  // Process in batches
  let enriched = 0;
  let failed = 0;
  let skipped = 0;
  const startTime = Date.now();

  for (let i = 0; i < candidates.length; i++) {
    const row = candidates[i];
    const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    const skillName = data.name || data.display_name || `row-${row.id}`;

    process.stdout.write(`[${i + 1}/${candidates.length}] ${skillName}... `);

    try {
      const enrichment = await callClaude(apiKey, data);

      if (DRY_RUN) {
        console.log(`WOULD ENRICH: category=${enrichment.category}, risk=${enrichment.risk_level}, rating=${enrichment.rating}, tags=[${enrichment.tags.join(', ')}]`);
        enriched++;
      } else {
        // Merge enrichment into data
        const updatedData = {
          ...data,
          tags: enrichment.tags,
          risk_level: enrichment.risk_level,
          rating: enrichment.rating,
          category: enrichment.category,
          platform: enrichment.platform
        };

        await client.query(
          'UPDATE table_rows SET data = $1, updated_at = NOW() WHERE id = $2',
          [JSON.stringify(updatedData), row.id]
        );

        console.log(`✅ category=${enrichment.category}, risk=${enrichment.risk_level}, rating=${enrichment.rating}, tags=${enrichment.tags.length}`);
        enriched++;
      }
    } catch (err) {
      console.log(`❌ ${err.message.substring(0, 80)}`);
      failed++;

      // If rate limited, wait longer
      if (err.message.includes('429') || err.message.includes('rate')) {
        console.log('  Rate limited — waiting 30s...');
        await sleep(30000);
      }
    }

    // Delay between API calls (rate limiting)
    if (i < candidates.length - 1) {
      await sleep(DELAY_MS);
    }

    // Progress report every batch
    if ((i + 1) % BATCH_SIZE === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const rate = (enriched / parseFloat(elapsed) * 60).toFixed(1);
      console.log(`  --- Progress: ${enriched} enriched, ${failed} failed, ${skipped} skipped | ${elapsed}s elapsed | ${rate}/min ---`);
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('');
  console.log('=== Summary ===');
  console.log(`Enriched: ${enriched}`);
  console.log(`Failed: ${failed}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Total time: ${totalTime}s`);
  console.log(`Dry run: ${DRY_RUN}`);

  await client.end();
  console.log('Done!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
