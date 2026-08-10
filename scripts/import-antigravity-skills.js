#!/usr/bin/env node
/**
 * Import Antigravity Awesome Skills into AI Tools table
 *
 * Downloads skills_index.json and CATALOG.md from the antigravity-awesome-skills
 * GitHub repository, merges the data (tags/triggers from CATALOG.md), and inserts
 * into the AI Tools table (table_id=1790) in PostgreSQL database godcrm_prod.
 *
 * Usage:
 *   node scripts/import-antigravity-skills.js
 *
 * Environment variables:
 *   POSTGRES_HOST     - PostgreSQL host (default: localhost)
 *   POSTGRES_PORT     - PostgreSQL port (default: 5432)
 *   POSTGRES_DB       - PostgreSQL database (default: godcrm_prod)
 *   POSTGRES_USER     - PostgreSQL user (default: godcrm)
 *   POSTGRES_PASSWORD - PostgreSQL password (optional, uses peer auth if not set)
 *   DRY_RUN           - Set to 'true' to preview without inserting (default: false)
 *   BATCH_SIZE        - Number of rows per batch insert (default: 100)
 */

import pg from 'pg';

const { Pool } = pg;

// =============================================================================
// Configuration
// =============================================================================

const TABLE_ID = 1790;
const PROJECT_ID = 131;
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '100', 10);
const DRY_RUN = process.env.DRY_RUN === 'true';

const SKILLS_INDEX_URL =
  'https://raw.githubusercontent.com/sickn33/antigravity-awesome-skills/main/skills_index.json';
const CATALOG_MD_URL =
  'https://raw.githubusercontent.com/sickn33/antigravity-awesome-skills/main/CATALOG.md';

// =============================================================================
// Category Mapping
// =============================================================================

const OUR_CATEGORIES = new Set([
  'data', 'tables', 'workspace', 'widgets', 'analysis', 'system',
  'architecture', 'security', 'testing', 'devops', 'game-development',
  'frontend', 'backend', 'mobile', 'ai-ml',
]);

const CATEGORY_MAP = {
  'uncategorized': 'system',
  'game-development': 'game-development',
  'architecture': 'architecture',
  'security': 'security',
  'testing': 'testing',
  'devops': 'devops',
  'ai': 'ai-ml',
  'frontend': 'frontend',
  'backend': 'backend',
  'mobile': 'mobile',
  'data': 'data',
  'tables': 'tables',
  'workspace': 'workspace',
  'widgets': 'widgets',
  'analysis': 'analysis',
  'system': 'system',

  // Likely close mappings for other antigravity categories
  'design': 'frontend',
  'database': 'data',
  'cloud': 'devops',
  'infrastructure': 'devops',
  'ci-cd': 'devops',
  'monitoring': 'devops',
  'web': 'frontend',
  'api': 'backend',
  'machine-learning': 'ai-ml',
  'deep-learning': 'ai-ml',
  'nlp': 'ai-ml',
  'data-science': 'ai-ml',
  'automation': 'system',
  'tooling': 'system',
  'documentation': 'system',
  'performance': 'system',
  'accessibility': 'frontend',
};

/**
 * Map an antigravity category to one of our valid options.
 * Falls through to the raw value if it already matches, otherwise 'system'.
 */
function mapCategory(raw) {
  if (!raw) return 'system';
  const lower = raw.toLowerCase().trim();
  if (CATEGORY_MAP[lower]) return CATEGORY_MAP[lower];
  if (OUR_CATEGORIES.has(lower)) return lower;
  return lower; // keep as-is — the user said "keep as-is if it's one of ours"
}

// =============================================================================
// Helpers
// =============================================================================

function log(level, message, data = {}) {
  const ts = new Date().toISOString();
  const extra = Object.keys(data).length > 0 ? ` ${JSON.stringify(data)}` : '';
  console.log(`[${ts}] [${level.toUpperCase()}] ${message}${extra}`);
}

/**
 * Generate a unique base_id for a row.
 * Format: skill-{timestamp}-{random9}
 */
function generateBaseId() {
  return `skill-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Convert a skill id / name to a human-friendly display name.
 * e.g. "2d-games" -> "2d Games", "react-native" -> "React Native"
 */
function toDisplayName(name) {
  if (!name) return '';
  return name
    .split('-')
    .map(word => {
      // Keep fully-numeric tokens as-is (e.g. "2d")
      if (/^\d/.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

// =============================================================================
// Data Fetching
// =============================================================================

/**
 * Download JSON from a URL using native fetch (Node 18+).
 */
async function fetchJSON(url) {
  log('info', `Downloading ${url} ...`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}: ${res.statusText}`);
  }
  return res.json();
}

/**
 * Download text from a URL.
 */
async function fetchText(url) {
  log('info', `Downloading ${url} ...`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}: ${res.statusText}`);
  }
  return res.text();
}

// =============================================================================
// CATALOG.md Parser
// =============================================================================

/**
 * Parse CATALOG.md and extract tags + triggers per skill name.
 *
 * Expected table format inside each category section:
 *   | Skill | Description | Tags | Triggers |
 *   | --- | --- | --- | --- |
 *   | `angular` | Modern Angular... | angular | angular, v20, ... |
 *
 * Returns Map<skillName, { tags: string[], triggers: string[] }>
 */
function parseCatalog(markdown) {
  const result = new Map();
  const lines = markdown.split('\n');

  for (const line of lines) {
    // Only care about table data rows (starts with |, contains backtick-quoted skill name)
    if (!line.startsWith('|')) continue;
    // Skip header / separator rows
    if (line.includes('| ---') || line.includes('| Skill')) continue;

    const cells = line
      .split('|')
      .map(c => c.trim())
      .filter(c => c.length > 0);

    // We expect at least 4 cells: Skill, Description, Tags, Triggers
    if (cells.length < 4) continue;

    // Extract skill name from backtick-quoted cell, e.g. `angular`
    const skillMatch = cells[0].match(/`([^`]+)`/);
    if (!skillMatch) continue;

    const skillName = skillMatch[1].trim();
    const tagsRaw = cells[2] || '';
    const triggersRaw = cells[3] || '';

    const tags = tagsRaw
      .split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0);

    const triggers = triggersRaw
      .split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0);

    result.set(skillName, { tags, triggers });
  }

  log('info', `Parsed CATALOG.md: found tags/triggers for ${result.size} skills`);
  return result;
}

// =============================================================================
// Row Data Builder
// =============================================================================

/**
 * Build the JSON data object for a single skill row.
 */
function buildRowData(skill, catalogEntry) {
  const tags = catalogEntry ? catalogEntry.tags : [];
  const triggers = catalogEntry ? catalogEntry.triggers : [];

  // Merge triggers into tags (unique)
  const allTags = [...new Set([...tags, ...triggers])];

  return {
    name: skill.id,
    display_name: toDisplayName(skill.name || skill.id),
    description: skill.description || '',
    category: mapCategory(skill.category),
    endpoint: '',
    method: '',
    parameters_schema: '',
    required_scopes: [],
    is_active: false,
    usage_count: 0,
    avg_execution_ms: 0,
    source: 'antigravity',
    source_url: `https://github.com/sickn33/antigravity-awesome-skills/tree/main/${skill.path}`,
    platform: ['claude-code'],
    tags: allTags,
    rating: 0,
    risk_level: skill.risk || 'unknown',
  };
}

// =============================================================================
// Database Operations
// =============================================================================

/**
 * Create a pg Pool connected to godcrm_prod.
 */
function createPool() {
  const config = {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    database: process.env.POSTGRES_DB || 'godcrm_prod',
    user: process.env.POSTGRES_USER || 'godcrm',
  };

  // Only set password if explicitly provided (allows peer auth on localhost)
  if (process.env.POSTGRES_PASSWORD) {
    config.password = process.env.POSTGRES_PASSWORD;
  }

  return new Pool(config);
}

/**
 * Get the set of existing skill names in table 1790 to avoid duplicates.
 */
async function getExistingSkillNames(pool) {
  const res = await pool.query(
    `SELECT data->>'name' AS skill_name
     FROM table_rows
     WHERE table_id = $1`,
    [TABLE_ID]
  );
  const names = new Set();
  for (const row of res.rows) {
    if (row.skill_name) names.add(row.skill_name);
  }
  log('info', `Found ${names.size} existing skills in table ${TABLE_ID}`);
  return names;
}

/**
 * Batch-insert rows into table_rows.
 * Uses a single multi-row INSERT per batch for performance.
 */
async function batchInsert(pool, rows) {
  const totalRows = rows.length;
  let inserted = 0;

  for (let i = 0; i < totalRows; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    // Build multi-row VALUES clause
    // Each row needs: (table_id, base_id, data, created_at, updated_at)
    const values = [];
    const params = [];
    let paramIndex = 1;

    for (let j = 0; j < batch.length; j++) {
      const row = batch[j];

      values.push(
        `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}::jsonb, NOW(), NOW())`
      );
      params.push(TABLE_ID, row.base_id, JSON.stringify(row.data));
      paramIndex += 3;
    }

    const sql = `
      INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at)
      VALUES ${values.join(',\n             ')}
    `;

    await pool.query(sql, params);
    inserted += batch.length;

    log('info', `Imported ${inserted}/${totalRows} skills...`);
  }

  return inserted;
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  log('info', '================================================================');
  log('info', '  Antigravity Awesome Skills -> AI Tools Table Importer');
  log('info', '================================================================');
  log('info', `Table ID: ${TABLE_ID}, Project ID: ${PROJECT_ID}`);
  log('info', `Batch size: ${BATCH_SIZE}`);
  log('info', `Dry run: ${DRY_RUN}`);
  log('info', '');

  // ------------------------------------------------------------------
  // Step 1: Download skills_index.json and CATALOG.md in parallel
  // ------------------------------------------------------------------
  const [skillsIndex, catalogMd] = await Promise.all([
    fetchJSON(SKILLS_INDEX_URL),
    fetchText(CATALOG_MD_URL),
  ]);

  // skills_index.json can be an array or { skills: [...] }
  const skills = Array.isArray(skillsIndex)
    ? skillsIndex
    : (skillsIndex.skills || []);

  log('info', `Downloaded ${skills.length} skills from skills_index.json`);

  // ------------------------------------------------------------------
  // Step 2: Parse CATALOG.md for tags and triggers
  // ------------------------------------------------------------------
  const catalogMap = parseCatalog(catalogMd);

  // ------------------------------------------------------------------
  // Step 3: Connect to PostgreSQL
  // ------------------------------------------------------------------
  const pool = createPool();

  try {
    await pool.query('SELECT 1');
    log('info', 'Connected to PostgreSQL');
  } catch (err) {
    log('error', 'Failed to connect to PostgreSQL', { error: err.message });
    log('error', 'Tip: set POSTGRES_PASSWORD env var or ensure peer authentication is configured');
    process.exit(1);
  }

  try {
    // ------------------------------------------------------------------
    // Step 4: Check for existing skills (idempotency)
    // ------------------------------------------------------------------
    const existingNames = await getExistingSkillNames(pool);

    // ------------------------------------------------------------------
    // Step 5: Build rows for new skills only
    // ------------------------------------------------------------------
    const newRows = [];
    let skippedCount = 0;

    for (const skill of skills) {
      if (!skill.id) {
        log('warn', 'Skipping skill with no id', { skill });
        skippedCount++;
        continue;
      }

      // Idempotency: skip if already exists
      if (existingNames.has(skill.id)) {
        skippedCount++;
        continue;
      }

      // Look up tags/triggers from CATALOG.md by skill id (== skill name in catalog)
      const catalogEntry = catalogMap.get(skill.id) || catalogMap.get(skill.name) || null;
      const data = buildRowData(skill, catalogEntry);

      newRows.push({
        base_id: generateBaseId(),
        data,
      });
    }

    log('info', '');
    log('info', `Skills to import: ${newRows.length}`);
    log('info', `Skills skipped (already exist or invalid): ${skippedCount}`);
    log('info', '');

    if (newRows.length === 0) {
      log('info', 'Nothing to import. All skills already exist in the table.');
      return;
    }

    // ------------------------------------------------------------------
    // Step 6: Preview categories distribution
    // ------------------------------------------------------------------
    const categoryDistribution = {};
    for (const row of newRows) {
      const cat = row.data.category;
      categoryDistribution[cat] = (categoryDistribution[cat] || 0) + 1;
    }
    log('info', 'Category distribution:');
    for (const [cat, count] of Object.entries(categoryDistribution).sort((a, b) => b[1] - a[1])) {
      log('info', `  ${cat}: ${count}`);
    }
    log('info', '');

    // ------------------------------------------------------------------
    // Step 7: Insert (or dry-run)
    // ------------------------------------------------------------------
    if (DRY_RUN) {
      log('info', '[DRY RUN] Would insert the following skills:');
      for (const row of newRows.slice(0, 10)) {
        log('info', `  - ${row.data.name} (${row.data.category}) [${row.data.tags.length} tags]`);
      }
      if (newRows.length > 10) {
        log('info', `  ... and ${newRows.length - 10} more`);
      }
      log('info', '[DRY RUN] No rows were inserted.');
    } else {
      const insertedCount = await batchInsert(pool, newRows);
      log('info', '');
      log('info', '================================================================');
      log('info', `  Import complete: ${insertedCount} skills inserted`);
      log('info', '================================================================');
    }
  } catch (err) {
    log('error', 'Import failed', { error: err.message, stack: err.stack });
    process.exit(1);
  } finally {
    await pool.end();
    log('info', 'Database connection closed');
  }
}

main().catch(err => {
  log('error', 'Unhandled error', { error: err.message, stack: err.stack });
  process.exit(1);
});
