/**
 * SkillsRegistryService.js — ADR-099 S05: Runtime Skill Injection
 *
 * Provides runtime skill injection for agents:
 *   - Loads relevant skills from the Skills Registry table (ID: 1591)
 *   - Filters by skill_ids (explicit) or auto-matches by categories/tags
 *   - Formats skill instructions as text for system prompt injection
 *   - Enforces 2000-token budget (≈ 8000 chars at 4 chars/token)
 *   - Caches per agent session (TTL-based Map, keyed by agent config)
 *
 * Acceptance Criteria (S05):
 *   AC1 — Agent resolves relevant skills from Skills Registry on execution start
 *   AC2 — Skill instructions injected into system prompt (after main_instructions)
 *   AC3 — Skill selection based on agent config (skill_ids or auto-match by tags)
 *   AC4 — Token budget respected — max 2000 tokens for injected skills
 *   AC5 — Skills cached per agent session (not re-fetched every iteration)
 */

import { dbAll, isPostgres } from '../database/connection.js';
import { apiLogger } from '../utils/logger.js';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

/** Skills Registry table ID (887 skills as of 2026-03) */
const SKILLS_TABLE_ID = 1591;

/** Max tokens budget for injected skills */
const MAX_SKILL_TOKENS = 2000;

/** Approximate characters per token (conservative estimate) */
const APPROX_CHARS_PER_TOKEN = 4;

/** Max characters allowed for injected skills text */
const MAX_CHARS = MAX_SKILL_TOKENS * APPROX_CHARS_PER_TOKEN; // 8000 chars

/** Cache TTL: 5 minutes */
const CACHE_TTL_MS = 5 * 60 * 1000;

// ─── SESSION CACHE ────────────────────────────────────────────────────────────

/**
 * In-memory skill cache, keyed by normalized agent config signature.
 * @type {Map<string, { text: string, cachedAt: number }>}
 */
const _cache = new Map();

// ─── HELPERS ──────────────────────────────────────────────────────────────────

/**
 * Safe JSON parse that never throws.
 * @param {unknown} val
 * @param {unknown} fallback
 * @returns {unknown}
 */
function safeParse(val, fallback = {}) {
  if (typeof val === 'object' && val !== null) return val;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return fallback; }
  }
  return fallback;
}

/**
 * Build a stable cache key from agent config.
 * Combines row_id + skill selection config so different agents never collide.
 *
 * @param {AgentConfig} agentConfig
 * @returns {string}
 */
function makeCacheKey(agentConfig) {
  const id = agentConfig.row_id ?? agentConfig.id ?? agentConfig.name ?? 'default';
  const skillIds = Array.isArray(agentConfig.skill_ids) ? agentConfig.skill_ids.sort().join(',') : '';
  const tags = Array.isArray(agentConfig.skill_tags) ? agentConfig.skill_tags.sort().join(',') : '';
  const categories = Array.isArray(agentConfig.skill_categories) ? agentConfig.skill_categories.sort().join(',') : '';
  return `${id}:ids=${skillIds}:tags=${tags}:cats=${categories}`;
}

// ─── SKILL FETCHERS ───────────────────────────────────────────────────────────

/**
 * Fetch skills by explicit row IDs.
 *
 * @param {number[]} skillIds - Array of table_row IDs from Skills Registry
 * @returns {Promise<SkillData[]>}
 */
async function fetchSkillsByIds(skillIds) {
  if (!skillIds.length) return [];

  const placeholders = isPostgres()
    ? skillIds.map((_, i) => `$${i + 2}`).join(', ')
    : skillIds.map(() => '?').join(', ');

  const rows = await dbAll(
    isPostgres()
      ? `SELECT id, data FROM table_rows WHERE table_id = $1 AND id IN (${placeholders}) ORDER BY id`
      : `SELECT id, data FROM table_rows WHERE table_id = ? AND id IN (${placeholders}) ORDER BY id`,
    [SKILLS_TABLE_ID, ...skillIds]
  );

  return rows.map(r => safeParse(r.data, null)).filter(Boolean);
}

/**
 * Fetch skills that match any of the given categories.
 *
 * @param {string[]} categories - Category names (e.g. ['workspace', 'tables'])
 * @returns {Promise<SkillData[]>}
 */
async function fetchSkillsByCategories(categories) {
  if (!categories.length) return [];

  const placeholders = isPostgres()
    ? categories.map((_, i) => `$${i + 2}`).join(', ')
    : categories.map(() => '?').join(', ');

  const rows = await dbAll(
    isPostgres()
      ? `SELECT id, data FROM table_rows
         WHERE table_id = $1
           AND data->>'category' IN (${placeholders})
           AND (data->>'is_active')::boolean IS NOT FALSE
         ORDER BY id`
      : `SELECT id, data FROM table_rows
         WHERE table_id = ?
           AND json_extract(data, '$.category') IN (${placeholders})
           AND json_extract(data, '$.is_active') != 0
         ORDER BY id`,
    [SKILLS_TABLE_ID, ...categories]
  );

  return rows.map(r => safeParse(r.data, null)).filter(Boolean);
}

/**
 * Fetch skills that have any tag overlap with the given tags.
 * Uses a JSON array tag matching approach for both adapters.
 *
 * @param {string[]} tags - Tags to match against skill tags arrays
 * @returns {Promise<SkillData[]>}
 */
async function fetchSkillsByTags(tags) {
  if (!tags.length) return [];

  // Fetch all active skills and filter in JS (avoids complex JSON array query)
  // For large registries this is acceptable since we cache the result.
  const rows = await dbAll(
    isPostgres()
      ? `SELECT id, data FROM table_rows
         WHERE table_id = $1
           AND (data->>'is_active')::boolean IS NOT FALSE
         ORDER BY id`
      : `SELECT id, data FROM table_rows
         WHERE table_id = ?
           AND json_extract(data, '$.is_active') != 0
         ORDER BY id`,
    [SKILLS_TABLE_ID]
  );

  const tagSet = new Set(tags.map(t => t.toLowerCase()));

  return rows
    .map(r => safeParse(r.data, null))
    .filter((skill) => {
      if (!skill) return false;
      const skillTags = Array.isArray(skill.tags)
        ? skill.tags.map((t) => t.toLowerCase())
        : [];
      return skillTags.some(t => tagSet.has(t));
    });
}

/**
 * Dispatch to the appropriate fetcher based on agent config priority:
 *   1. skill_ids (explicit)
 *   2. skill_categories (auto-match by category)
 *   3. skill_tags (auto-match by tag overlap)
 *   4. (none) → return []
 *
 * @param {AgentConfig} agentConfig
 * @returns {Promise<SkillData[]>}
 */
async function fetchRelevantSkills(agentConfig) {
  if (Array.isArray(agentConfig.skill_ids) && agentConfig.skill_ids.length > 0) {
    return fetchSkillsByIds(agentConfig.skill_ids);
  }

  if (Array.isArray(agentConfig.skill_categories) && agentConfig.skill_categories.length > 0) {
    return fetchSkillsByCategories(agentConfig.skill_categories);
  }

  if (Array.isArray(agentConfig.skill_tags) && agentConfig.skill_tags.length > 0) {
    return fetchSkillsByTags(agentConfig.skill_tags);
  }

  return [];
}

// ─── FORMATTER ────────────────────────────────────────────────────────────────

/**
 * Format an array of skill data objects into a prompt-friendly instructions block.
 * Skips inactive skills.
 *
 * Format:
 *   ## Available Skills
 *   ### skill_name — Display Name
 *   Description text.
 *   - Category: workspace
 *   - Method: GET /api/v3/endpoint
 *
 * @param {SkillData[]} skills
 * @returns {string} Formatted instructions text (empty string if no skills)
 */
export function formatSkillInstructions(skills) {
  if (!Array.isArray(skills) || skills.length === 0) return '';

  const activeSkills = skills.filter(s => s.is_active !== false);
  if (activeSkills.length === 0) return '';

  const lines = ['## Available Skills', ''];

  for (const skill of activeSkills) {
    const name = skill.name || '(unnamed)';
    const displayName = skill.display_name || name;
    const description = skill.description || '';
    const category = skill.category || '';
    const method = skill.method || '';
    const endpoint = skill.endpoint || '';

    lines.push(`### ${name} — ${displayName}`);
    if (description) lines.push(description);
    if (category) lines.push(`- Category: ${category}`);
    if (method && endpoint) lines.push(`- Method: ${method} ${endpoint}`);
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

// ─── MAIN API ─────────────────────────────────────────────────────────────────

/**
 * Load and format skill instructions for an agent.
 *
 * Returns a ready-to-inject string for the agent system prompt, or ''
 * if the agent has no skill configuration or no matching skills.
 *
 * Caching: results are stored per agent config key for CACHE_TTL_MS (5 min).
 * Call clearCache() to force a re-fetch.
 *
 * @param {AgentConfig | null} agentConfig - Agent row data (from AI Agents table 1784)
 * @returns {Promise<string>} Formatted skill instructions, or ''
 */
export async function loadAgentSkills(agentConfig) {
  if (!agentConfig) return '';

  // Check cache first (AC5)
  const cacheKey = makeCacheKey(agentConfig);
  const cached = _cache.get(cacheKey);
  if (cached && (Date.now() - cached.cachedAt) < CACHE_TTL_MS) {
    apiLogger.debug({ cacheKey }, 'SkillsRegistry: cache hit');
    return cached.text;
  }

  try {
    const skills = await fetchRelevantSkills(agentConfig);

    if (skills.length === 0) {
      // Cache empty result too (avoids repeated empty queries)
      _cache.set(cacheKey, { text: '', cachedAt: Date.now() });
      return '';
    }

    const fullText = formatSkillInstructions(skills);

    // AC4: Enforce token budget
    const text = fullText.length > MAX_CHARS
      ? fullText.substring(0, MAX_CHARS)
      : fullText;

    _cache.set(cacheKey, { text, cachedAt: Date.now() });

    apiLogger.info(
      { agentName: agentConfig.name, skillCount: skills.length, textLen: text.length },
      'SkillsRegistry: loaded skills for agent'
    );

    return text;
  } catch (err) {
    apiLogger.warn({ err: err.message, agentName: agentConfig.name }, 'SkillsRegistry: failed to load skills (non-fatal)');
    return '';
  }
}

/**
 * Clear the in-memory skill cache.
 * Useful for tests and forced re-fetch scenarios.
 */
export function clearCache() {
  _cache.clear();
}

/**
 * Get current cache size (for diagnostics).
 * @returns {number}
 */
export function getCacheSize() {
  return _cache.size;
}

// ─── TYPES (JSDoc) ────────────────────────────────────────────────────────────

/**
 * @typedef {Object} AgentConfig
 * @property {number} [row_id] - Agent row ID in AI Agents table
 * @property {string} [name] - Agent name
 * @property {number[]} [skill_ids] - Explicit skill row IDs to load
 * @property {string[]} [skill_categories] - Categories to auto-match
 * @property {string[]} [skill_tags] - Tags to auto-match
 */

/**
 * @typedef {Object} SkillData
 * @property {string} name - Skill identifier
 * @property {string} display_name - Human-readable name
 * @property {string} description - What the skill does
 * @property {string} category - Skill category
 * @property {string} [method] - HTTP method
 * @property {string} [endpoint] - API endpoint
 * @property {boolean} [is_active] - Whether skill is active
 * @property {string[]} [tags] - Skill tags
 */

export default { loadAgentSkills, formatSkillInstructions, clearCache, getCacheSize };
