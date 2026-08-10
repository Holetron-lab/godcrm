/**
 * ResponseModeService Tests
 * ADR-091 Phase 2 Task 7 / Ticket #41160 (AC14)
 *
 * Tests the two-level response_mode resolution:
 *   1. conversation_participants.agent_response_mode (per-conversation override)
 *   2. sub_agents JSONB response_mode (migration period)
 *   3. AI Agents table row data.response_mode (global agent config)
 *   4. Default: 'mention_only'
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock database functions
const mockDbGet = vi.fn();
const mockDbAll = vi.fn();

vi.mock('../../database/connection', () => ({
  dbGet: (...args) => mockDbGet(...args),
  dbAll: (...args) => mockDbAll(...args),
  isPostgres: () => false,
  safeJsonParse: (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch { return null; }
  },
}));

// Mock logger to avoid noise in tests
vi.mock('../../utils/logger', () => ({
  apiLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Import after mocks are set up
import {
  resolveResponseMode,
  resolveResponseModeByRowId,
  setConversationResponseMode,
  VALID_RESPONSE_MODES,
  DEFAULT_RESPONSE_MODE,
} from '../ResponseModeService.js';

describe('ResponseModeService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constants', () => {
    it('exports valid response modes', () => {
      expect(VALID_RESPONSE_MODES).toEqual(['always', 'topic_only', 'mention_only']);
    });

    it('default response mode is mention_only', () => {
      expect(DEFAULT_RESPONSE_MODE).toBe('mention_only');
    });
  });

  describe('resolveResponseMode', () => {
    it('returns default when agentUserId is null', async () => {
      const result = await resolveResponseMode(null, 100);
      expect(result).toBe('mention_only');
      expect(mockDbGet).not.toHaveBeenCalled();
    });

    it('returns default when conversationId is null', async () => {
      const result = await resolveResponseMode(50, null);
      expect(result).toBe('mention_only');
      expect(mockDbGet).not.toHaveBeenCalled();
    });

    it('returns default when both params are null', async () => {
      const result = await resolveResponseMode(null, null);
      expect(result).toBe('mention_only');
    });

    // ---- Priority 1: Per-conversation override ----

    it('Priority 1: returns agent_response_mode from conversation_participants', async () => {
      mockDbGet.mockImplementation((query) => {
        if (query.includes('agent_response_mode') && query.includes('conversation_participants')) {
          return Promise.resolve({ agent_response_mode: 'always' });
        }
        return Promise.resolve(null);
      });

      const result = await resolveResponseMode(50, 100);
      expect(result).toBe('always');
    });

    it('Priority 1: returns topic_only from conversation_participants', async () => {
      mockDbGet.mockImplementation((query) => {
        if (query.includes('conversation_participants')) {
          return Promise.resolve({ agent_response_mode: 'topic_only' });
        }
        return Promise.resolve(null);
      });

      const result = await resolveResponseMode(50, 100);
      expect(result).toBe('topic_only');
    });

    it('Priority 1: skips invalid agent_response_mode values', async () => {
      // Setup: participants has invalid value, user has row_id, no sub_agents, global config has 'always'
      mockDbGet.mockImplementation((query) => {
        if (query.includes('conversation_participants')) {
          return Promise.resolve({ agent_response_mode: 'invalid_mode' });
        }
        if (query.includes('managed_by_agent_row_id')) {
          return Promise.resolve({ managed_by_agent_row_id: 999 });
        }
        if (query.includes('sub_agents')) {
          return Promise.resolve({ sub_agents: '[]' });
        }
        if (query.includes('AI Agents')) {
          return Promise.resolve({ data: JSON.stringify({ response_mode: 'always', name: 'Test Agent' }) });
        }
        return Promise.resolve(null);
      });

      const result = await resolveResponseMode(50, 100);
      expect(result).toBe('always');
    });

    it('Priority 1: skips NULL agent_response_mode (inherit from global)', async () => {
      mockDbGet.mockImplementation((query) => {
        if (query.includes('conversation_participants')) {
          return Promise.resolve({ agent_response_mode: null });
        }
        if (query.includes('managed_by_agent_row_id')) {
          return Promise.resolve({ managed_by_agent_row_id: 999 });
        }
        if (query.includes('sub_agents')) {
          return Promise.resolve({ sub_agents: '[]' });
        }
        if (query.includes('AI Agents')) {
          return Promise.resolve({ data: JSON.stringify({ response_mode: 'always', name: 'Test Agent' }) });
        }
        return Promise.resolve(null);
      });

      const result = await resolveResponseMode(50, 100);
      expect(result).toBe('always');
    });

    // ---- Priority 2: Sub-agents JSONB ----

    it('Priority 2: returns response_mode from sub_agents JSONB entry', async () => {
      mockDbGet.mockImplementation((query) => {
        if (query.includes('conversation_participants')) {
          return Promise.resolve({ agent_response_mode: null });
        }
        if (query.includes('managed_by_agent_row_id')) {
          return Promise.resolve({ managed_by_agent_row_id: 999 });
        }
        if (query.includes('sub_agents')) {
          return Promise.resolve({
            sub_agents: JSON.stringify([
              { row_id: 999, response_mode: 'topic_only' },
              { row_id: 888, response_mode: 'always' }
            ])
          });
        }
        // Should not reach global config
        return Promise.resolve(null);
      });

      const result = await resolveResponseMode(50, 100);
      expect(result).toBe('topic_only');
    });

    it('Priority 2: ignores sub_agents entries that do not match agent row_id', async () => {
      mockDbGet.mockImplementation((query) => {
        if (query.includes('conversation_participants')) {
          return Promise.resolve({ agent_response_mode: null });
        }
        if (query.includes('managed_by_agent_row_id')) {
          return Promise.resolve({ managed_by_agent_row_id: 999 });
        }
        if (query.includes('sub_agents')) {
          return Promise.resolve({
            sub_agents: JSON.stringify([
              { row_id: 888, response_mode: 'always' }
            ])
          });
        }
        if (query.includes('AI Agents')) {
          return Promise.resolve({ data: JSON.stringify({ response_mode: 'topic_only', name: 'Test' }) });
        }
        return Promise.resolve(null);
      });

      // Falls through to Priority 3 (global config)
      const result = await resolveResponseMode(50, 100);
      expect(result).toBe('topic_only');
    });

    it('Priority 2: handles plain number entries in sub_agents (no override)', async () => {
      mockDbGet.mockImplementation((query) => {
        if (query.includes('conversation_participants')) {
          return Promise.resolve({ agent_response_mode: null });
        }
        if (query.includes('managed_by_agent_row_id')) {
          return Promise.resolve({ managed_by_agent_row_id: 999 });
        }
        if (query.includes('sub_agents')) {
          return Promise.resolve({ sub_agents: JSON.stringify([999, 888]) });
        }
        if (query.includes('AI Agents')) {
          return Promise.resolve({ data: JSON.stringify({ response_mode: 'always', name: 'Test' }) });
        }
        return Promise.resolve(null);
      });

      // Plain numbers have no response_mode, falls to Priority 3
      const result = await resolveResponseMode(50, 100);
      expect(result).toBe('always');
    });

    // ---- Priority 3: Global agent config ----

    it('Priority 3: returns response_mode from AI Agents table row data', async () => {
      mockDbGet.mockImplementation((query) => {
        if (query.includes('conversation_participants')) {
          return Promise.resolve({ agent_response_mode: null });
        }
        if (query.includes('managed_by_agent_row_id')) {
          return Promise.resolve({ managed_by_agent_row_id: 999 });
        }
        if (query.includes('sub_agents')) {
          return Promise.resolve({ sub_agents: '[]' });
        }
        if (query.includes('AI Agents')) {
          return Promise.resolve({ data: JSON.stringify({ response_mode: 'always', name: 'Test Agent' }) });
        }
        return Promise.resolve(null);
      });

      const result = await resolveResponseMode(50, 100);
      expect(result).toBe('always');
    });

    it('Priority 3: handles JSONB data (object, not string)', async () => {
      mockDbGet.mockImplementation((query) => {
        if (query.includes('conversation_participants')) {
          return Promise.resolve({ agent_response_mode: null });
        }
        if (query.includes('managed_by_agent_row_id')) {
          return Promise.resolve({ managed_by_agent_row_id: 999 });
        }
        if (query.includes('sub_agents')) {
          return Promise.resolve({ sub_agents: [] });
        }
        if (query.includes('AI Agents')) {
          // PostgreSQL returns JSONB as object, not string
          return Promise.resolve({ data: { response_mode: 'topic_only', name: 'Test Agent' } });
        }
        return Promise.resolve(null);
      });

      const result = await resolveResponseMode(50, 100);
      expect(result).toBe('topic_only');
    });

    // ---- Priority 4: Default ----

    it('Priority 4: returns mention_only when no config is set', async () => {
      mockDbGet.mockImplementation((query) => {
        if (query.includes('conversation_participants')) {
          return Promise.resolve({ agent_response_mode: null });
        }
        if (query.includes('managed_by_agent_row_id')) {
          return Promise.resolve({ managed_by_agent_row_id: 999 });
        }
        if (query.includes('sub_agents')) {
          return Promise.resolve({ sub_agents: '[]' });
        }
        if (query.includes('AI Agents')) {
          return Promise.resolve({ data: JSON.stringify({ name: 'Test Agent' }) }); // no response_mode
        }
        return Promise.resolve(null);
      });

      const result = await resolveResponseMode(50, 100);
      expect(result).toBe('mention_only');
    });

    it('Priority 4: returns default when agent row not found in AI Agents table', async () => {
      mockDbGet.mockImplementation((query) => {
        if (query.includes('conversation_participants')) {
          return Promise.resolve({ agent_response_mode: null });
        }
        if (query.includes('managed_by_agent_row_id')) {
          return Promise.resolve({ managed_by_agent_row_id: 999 });
        }
        if (query.includes('sub_agents')) {
          return Promise.resolve({ sub_agents: '[]' });
        }
        if (query.includes('AI Agents')) {
          return Promise.resolve(null); // Agent row not found
        }
        return Promise.resolve(null);
      });

      const result = await resolveResponseMode(50, 100);
      expect(result).toBe('mention_only');
    });

    it('Priority 4: returns default when user has no managed_by_agent_row_id', async () => {
      mockDbGet.mockImplementation((query) => {
        if (query.includes('conversation_participants')) {
          return Promise.resolve({ agent_response_mode: null });
        }
        if (query.includes('managed_by_agent_row_id')) {
          return Promise.resolve({ managed_by_agent_row_id: null });
        }
        return Promise.resolve(null);
      });

      const result = await resolveResponseMode(50, 100);
      expect(result).toBe('mention_only');
    });

    // ---- Error handling ----

    it('returns default on database error', async () => {
      mockDbGet.mockRejectedValue(new Error('DB connection failed'));

      const result = await resolveResponseMode(50, 100);
      expect(result).toBe('mention_only');
    });

    // ---- Priority chain ordering ----

    it('per-conversation override takes precedence over global config', async () => {
      mockDbGet.mockImplementation((query) => {
        if (query.includes('conversation_participants')) {
          return Promise.resolve({ agent_response_mode: 'topic_only' });
        }
        // If it ever reaches here, global config is 'always'
        if (query.includes('AI Agents')) {
          return Promise.resolve({ data: JSON.stringify({ response_mode: 'always' }) });
        }
        return Promise.resolve(null);
      });

      const result = await resolveResponseMode(50, 100);
      expect(result).toBe('topic_only');
    });

    it('sub_agents JSONB override takes precedence over global config', async () => {
      mockDbGet.mockImplementation((query) => {
        if (query.includes('conversation_participants')) {
          return Promise.resolve({ agent_response_mode: null }); // No override
        }
        if (query.includes('managed_by_agent_row_id')) {
          return Promise.resolve({ managed_by_agent_row_id: 999 });
        }
        if (query.includes('sub_agents')) {
          return Promise.resolve({
            sub_agents: JSON.stringify([{ row_id: 999, response_mode: 'always' }])
          });
        }
        // Global config has 'mention_only'
        if (query.includes('AI Agents')) {
          return Promise.resolve({ data: JSON.stringify({ response_mode: 'mention_only' }) });
        }
        return Promise.resolve(null);
      });

      const result = await resolveResponseMode(50, 100);
      expect(result).toBe('always');
    });
  });

  describe('resolveResponseModeByRowId', () => {
    it('returns default when agentRowId is null', async () => {
      const result = await resolveResponseModeByRowId(null, 100);
      expect(result).toBe('mention_only');
    });

    it('returns default when conversationId is null', async () => {
      const result = await resolveResponseModeByRowId(999, null);
      expect(result).toBe('mention_only');
    });

    it('delegates to resolveResponseMode when agent has user account', async () => {
      // User lookup returns an agent user
      mockDbGet.mockImplementation((query) => {
        if (query.includes('managed_by_agent_row_id') && query.includes('users') && query.includes('user_type')) {
          return Promise.resolve({ id: 50 });
        }
        // resolveResponseMode path
        if (query.includes('conversation_participants')) {
          return Promise.resolve({ agent_response_mode: 'always' });
        }
        return Promise.resolve(null);
      });

      const result = await resolveResponseModeByRowId(999, 100);
      expect(result).toBe('always');
    });

    it('resolves via sub_agents JSONB when no user account', async () => {
      mockDbGet.mockImplementation((query) => {
        // No user account for this agent
        if (query.includes('managed_by_agent_row_id') && query.includes('users') && query.includes('user_type')) {
          return Promise.resolve(null);
        }
        if (query.includes('sub_agents')) {
          return Promise.resolve({
            sub_agents: JSON.stringify([{ row_id: 999, response_mode: 'topic_only' }])
          });
        }
        return Promise.resolve(null);
      });

      const result = await resolveResponseModeByRowId(999, 100);
      expect(result).toBe('topic_only');
    });

    it('resolves via global config when no user account and no sub_agents match', async () => {
      mockDbGet.mockImplementation((query) => {
        if (query.includes('managed_by_agent_row_id') && query.includes('users') && query.includes('user_type')) {
          return Promise.resolve(null);
        }
        if (query.includes('sub_agents')) {
          return Promise.resolve({ sub_agents: '[]' });
        }
        if (query.includes('AI Agents')) {
          return Promise.resolve({ data: JSON.stringify({ response_mode: 'always' }) });
        }
        return Promise.resolve(null);
      });

      const result = await resolveResponseModeByRowId(999, 100);
      expect(result).toBe('always');
    });

    it('returns default on error', async () => {
      mockDbGet.mockRejectedValue(new Error('DB error'));
      const result = await resolveResponseModeByRowId(999, 100);
      expect(result).toBe('mention_only');
    });
  });

  describe('setConversationResponseMode', () => {
    it('returns false when agentUserId is null', async () => {
      const result = await setConversationResponseMode(null, 100, 'always');
      expect(result).toBe(false);
    });

    it('returns false when conversationId is null', async () => {
      const result = await setConversationResponseMode(50, null, 'always');
      expect(result).toBe(false);
    });

    it('throws on invalid response_mode', async () => {
      await expect(
        setConversationResponseMode(50, 100, 'invalid')
      ).rejects.toThrow('Invalid response_mode');
    });

    it('accepts null mode to clear override', async () => {
      mockDbGet.mockImplementation((query) => {
        if (query.includes('UPDATE')) {
          return Promise.resolve({ id: 1 }); // PG UPDATE RETURNING returns row
        }
        if (query.includes('SELECT') && query.includes('conversation_participants')) {
          return Promise.resolve({ id: 1 });
        }
        return Promise.resolve(null);
      });

      const result = await setConversationResponseMode(50, 100, null);
      expect(result).toBe(true);
    });

    it('accepts valid modes: always, topic_only, mention_only', async () => {
      for (const mode of ['always', 'topic_only', 'mention_only']) {
        vi.clearAllMocks();
        mockDbGet.mockImplementation((query) => {
          if (query.includes('UPDATE')) return Promise.resolve({ id: 1 });
          if (query.includes('SELECT')) return Promise.resolve({ id: 1 });
          return Promise.resolve(null);
        });

        const result = await setConversationResponseMode(50, 100, mode);
        expect(result).toBe(true);
      }
    });

    it('returns false when participant does not exist', async () => {
      mockDbGet.mockImplementation((query) => {
        if (query.includes('UPDATE')) return Promise.resolve(null);
        if (query.includes('SELECT')) return Promise.resolve(null); // Not found
        return Promise.resolve(null);
      });

      const result = await setConversationResponseMode(50, 100, 'always');
      expect(result).toBe(false);
    });

    it('returns false on database error', async () => {
      mockDbGet.mockRejectedValue(new Error('DB error'));
      const result = await setConversationResponseMode(50, 100, 'always');
      expect(result).toBe(false);
    });
  });
});
