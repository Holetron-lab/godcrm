/**
 * SkillsRegistryService Tests — ADR-099 S05: Runtime Skill Injection
 *
 * Tests:
 *   - loadAgentSkills: main entry point — fetch, format, cache
 *   - fetchSkillsByIds: explicit skill_ids selection
 *   - fetchSkillsByCategories: auto-match by category
 *   - fetchSkillsByTags: auto-match by tags overlap
 *   - formatSkillInstructions: text formatting for system prompt
 *   - Token budget enforcement (max 2000 tokens ≈ 8000 chars)
 *   - Session-level caching (TTL-based, key by agent config)
 *   - clearCache: manual cache invalidation
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ===== MOCKS =====

const mockDbAll = vi.fn();
const mockDbGet = vi.fn();
const mockIsPostgres = vi.fn(() => false);

vi.mock('../../database/connection', () => ({
  dbAll: (...args) => mockDbAll(...args),
  dbGet: (...args) => mockDbGet(...args),
  isPostgres: () => mockIsPostgres(),
}));

vi.mock('../../utils/logger', () => ({
  apiLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ===== FIXTURES =====

const makeSkillRow = (id, overrides = {}) => ({
  id,
  data: JSON.stringify({
    name: `skill_${id}`,
    display_name: `Skill ${id}`,
    description: `Description for skill ${id}`,
    category: 'data',
    method: 'GET',
    endpoint: `/api/v3/skill_${id}`,
    is_active: true,
    tags: ['tag1', 'tag2'],
    ...overrides,
  }),
});

const makeAgentConfig = (overrides = {}) => ({
  name: 'Test Agent',
  row_id: 42,
  ...overrides,
});

// ===== IMPORT AFTER MOCKS =====

let loadAgentSkills, formatSkillInstructions, clearCache;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();

  // Re-import after each reset to get fresh module state (clear in-memory cache)
  const mod = await import('../SkillsRegistryService.js');
  loadAgentSkills = mod.loadAgentSkills;
  formatSkillInstructions = mod.formatSkillInstructions;
  clearCache = mod.clearCache;
});

// ===== TESTS =====

describe('SkillsRegistryService', () => {

  // ── AC1: Resolves relevant skills on execution start ──

  describe('loadAgentSkills()', () => {
    it('returns empty string when agentConfig is null', async () => {
      const result = await loadAgentSkills(null);
      expect(result).toBe('');
      expect(mockDbAll).not.toHaveBeenCalled();
    });

    it('returns empty string when agentConfig has no skill configuration', async () => {
      mockDbAll.mockResolvedValue([]);
      const result = await loadAgentSkills(makeAgentConfig());
      expect(result).toBe('');
    });

    it('fetches skills by explicit skill_ids when provided', async () => {
      const rows = [makeSkillRow(1), makeSkillRow(2)];
      mockDbAll.mockResolvedValue(rows);

      const agentConfig = makeAgentConfig({ skill_ids: [1, 2] });
      const result = await loadAgentSkills(agentConfig);

      expect(mockDbAll).toHaveBeenCalledOnce();
      expect(result).toContain('skill_1');
      expect(result).toContain('skill_2');
    });

    it('fetches skills by skill_categories when no skill_ids', async () => {
      const rows = [makeSkillRow(10, { category: 'workspace' })];
      mockDbAll.mockResolvedValue(rows);

      const agentConfig = makeAgentConfig({ skill_categories: ['workspace'] });
      const result = await loadAgentSkills(agentConfig);

      expect(mockDbAll).toHaveBeenCalledOnce();
      expect(result).toContain('skill_10');
    });

    it('fetches skills by skill_tags when no skill_ids or categories', async () => {
      const rows = [makeSkillRow(20, { tags: ['testing', 'qa'] })];
      mockDbAll.mockResolvedValue(rows);

      const agentConfig = makeAgentConfig({ skill_tags: ['testing'] });
      const result = await loadAgentSkills(agentConfig);

      expect(mockDbAll).toHaveBeenCalledOnce();
      expect(result).toContain('skill_20');
    });

    it('returns empty string when no skills match', async () => {
      mockDbAll.mockResolvedValue([]);

      const agentConfig = makeAgentConfig({ skill_ids: [999] });
      const result = await loadAgentSkills(agentConfig);

      expect(result).toBe('');
    });
  });

  // ── AC3: Skill selection based on agent config ──

  describe('skill selection priority', () => {
    it('prefers skill_ids over skill_categories', async () => {
      const rows = [makeSkillRow(1)];
      mockDbAll.mockResolvedValue(rows);

      const agentConfig = makeAgentConfig({
        skill_ids: [1],
        skill_categories: ['workspace'],
      });
      await loadAgentSkills(agentConfig);

      // skill_ids query uses IN clause with specific IDs
      const [query] = mockDbAll.mock.calls[0];
      expect(query).toMatch(/IN \(/);
    });

    it('prefers skill_categories over skill_tags', async () => {
      const rows = [makeSkillRow(5, { category: 'tables' })];
      mockDbAll.mockResolvedValue(rows);

      const agentConfig = makeAgentConfig({
        skill_categories: ['tables'],
        skill_tags: ['some-tag'],
      });
      await loadAgentSkills(agentConfig);

      const [query] = mockDbAll.mock.calls[0];
      // categories query filters by category field
      expect(query).toMatch(/category/i);
    });
  });

  // ── AC4: Token budget respected — max 2000 tokens ──

  describe('token budget enforcement', () => {
    it('truncates skills to stay within 2000-token budget', async () => {
      // Create many skills with long descriptions
      const longDesc = 'X'.repeat(500);
      const rows = Array.from({ length: 50 }, (_, i) =>
        makeSkillRow(i + 1, { description: longDesc })
      );
      mockDbAll.mockResolvedValue(rows);

      const agentConfig = makeAgentConfig({ skill_ids: Array.from({ length: 50 }, (_, i) => i + 1) });
      const result = await loadAgentSkills(agentConfig);

      // 2000 tokens * 4 chars/token = 8000 chars max
      const MAX_CHARS = 2000 * 4;
      expect(result.length).toBeLessThanOrEqual(MAX_CHARS);
    });

    it('includes all skills when they fit within budget', async () => {
      const rows = [
        makeSkillRow(1, { description: 'Short desc 1' }),
        makeSkillRow(2, { description: 'Short desc 2' }),
      ];
      mockDbAll.mockResolvedValue(rows);

      const agentConfig = makeAgentConfig({ skill_ids: [1, 2] });
      const result = await loadAgentSkills(agentConfig);

      expect(result).toContain('skill_1');
      expect(result).toContain('skill_2');
    });
  });

  // ── AC2: Skill instructions injected after main_instructions ──

  describe('formatSkillInstructions()', () => {
    it('returns empty string for empty skills array', () => {
      expect(formatSkillInstructions([])).toBe('');
    });

    it('formats skills with name, display_name, description', () => {
      const skills = [{
        name: 'list_tables',
        display_name: 'List Tables',
        description: 'Get all tables in the workspace',
        category: 'workspace',
        method: 'GET',
        endpoint: '/api/v3/tables',
      }];

      const result = formatSkillInstructions(skills);

      expect(result).toContain('list_tables');
      expect(result).toContain('List Tables');
      expect(result).toContain('Get all tables in the workspace');
    });

    it('includes a section header for skill instructions', () => {
      const skills = [{
        name: 'test_skill',
        display_name: 'Test Skill',
        description: 'Test description',
        category: 'test',
      }];

      const result = formatSkillInstructions(skills);
      expect(result).toMatch(/## (Skills|Available Skills|Skill Instructions)/i);
    });

    it('formats multiple skills as a list', () => {
      const skills = [
        { name: 'skill_a', display_name: 'Skill A', description: 'Desc A', category: 'data' },
        { name: 'skill_b', display_name: 'Skill B', description: 'Desc B', category: 'tables' },
      ];

      const result = formatSkillInstructions(skills);
      expect(result).toContain('skill_a');
      expect(result).toContain('skill_b');
    });

    it('skips inactive skills (is_active = false)', () => {
      const skills = [
        { name: 'active_skill', display_name: 'Active', description: 'Works', category: 'data', is_active: true },
        { name: 'inactive_skill', display_name: 'Inactive', description: 'Disabled', category: 'data', is_active: false },
      ];

      const result = formatSkillInstructions(skills);
      expect(result).toContain('active_skill');
      expect(result).not.toContain('inactive_skill');
    });
  });

  // ── AC5: Skills cached per agent session ──

  describe('session-level caching', () => {
    it('fetches skills from DB on first call', async () => {
      const rows = [makeSkillRow(1)];
      mockDbAll.mockResolvedValue(rows);

      const agentConfig = makeAgentConfig({ skill_ids: [1] });
      await loadAgentSkills(agentConfig);

      expect(mockDbAll).toHaveBeenCalledOnce();
    });

    it('returns cached result on second call with same agent config', async () => {
      const rows = [makeSkillRow(1)];
      mockDbAll.mockResolvedValue(rows);

      const agentConfig = makeAgentConfig({ skill_ids: [1] });
      const result1 = await loadAgentSkills(agentConfig);
      const result2 = await loadAgentSkills(agentConfig);

      // DB should only be called once
      expect(mockDbAll).toHaveBeenCalledOnce();
      expect(result1).toBe(result2);
    });

    it('fetches from DB again for different agent configs', async () => {
      mockDbAll.mockResolvedValue([makeSkillRow(1)]);

      const agentA = makeAgentConfig({ row_id: 1, skill_ids: [1] });
      const agentB = makeAgentConfig({ row_id: 2, skill_ids: [2] });

      await loadAgentSkills(agentA);
      await loadAgentSkills(agentB);

      expect(mockDbAll).toHaveBeenCalledTimes(2);
    });

    it('clearCache() removes all cached entries', async () => {
      const rows = [makeSkillRow(1)];
      mockDbAll.mockResolvedValue(rows);

      const agentConfig = makeAgentConfig({ skill_ids: [1] });

      await loadAgentSkills(agentConfig);
      expect(mockDbAll).toHaveBeenCalledOnce();

      clearCache();

      await loadAgentSkills(agentConfig);
      expect(mockDbAll).toHaveBeenCalledTimes(2);
    });

    it('re-fetches after TTL expires', async () => {
      vi.useFakeTimers();

      const rows = [makeSkillRow(1)];
      mockDbAll.mockResolvedValue(rows);

      const agentConfig = makeAgentConfig({ skill_ids: [1] });

      await loadAgentSkills(agentConfig);
      expect(mockDbAll).toHaveBeenCalledOnce();

      // Advance time past 5-minute TTL
      vi.advanceTimersByTime(6 * 60 * 1000);

      await loadAgentSkills(agentConfig);
      expect(mockDbAll).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });
  });

  // ── PostgreSQL vs SQLite ──

  describe('database adapter compatibility', () => {
    it('uses PostgreSQL syntax when isPostgres() returns true', async () => {
      mockIsPostgres.mockReturnValue(true);
      mockDbAll.mockResolvedValue([makeSkillRow(1)]);

      const agentConfig = makeAgentConfig({ skill_ids: [1] });
      await loadAgentSkills(agentConfig);

      const [query] = mockDbAll.mock.calls[0];
      // PostgreSQL uses $1, $2 placeholders
      expect(query).toMatch(/\$\d/);
    });

    it('uses SQLite syntax when isPostgres() returns false', async () => {
      mockIsPostgres.mockReturnValue(false);
      mockDbAll.mockResolvedValue([makeSkillRow(1)]);

      const agentConfig = makeAgentConfig({ skill_ids: [1] });
      await loadAgentSkills(agentConfig);

      const [query] = mockDbAll.mock.calls[0];
      // SQLite uses ? placeholders
      expect(query).toMatch(/\?/);
    });
  });

  // ── Error handling ──

  describe('error handling', () => {
    it('returns empty string and logs warning when DB query fails', async () => {
      mockDbAll.mockRejectedValue(new Error('DB connection error'));

      const agentConfig = makeAgentConfig({ skill_ids: [1] });
      const result = await loadAgentSkills(agentConfig);

      expect(result).toBe('');
    });

    it('handles malformed JSON in skill data row gracefully', async () => {
      mockDbAll.mockResolvedValue([
        { id: 1, data: 'invalid json{' },
        makeSkillRow(2),
      ]);

      const agentConfig = makeAgentConfig({ skill_ids: [1, 2] });
      // Should not throw, should return valid skills
      const result = await loadAgentSkills(agentConfig);
      expect(result).toContain('skill_2');
    });
  });
});
