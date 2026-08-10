/**
 * ModelSyncService Tests
 * Tests AI model synchronization from provider APIs to CRM table
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock database
vi.mock('../../database/connection.js', () => ({
  dbAll: vi.fn(),
  dbGet: vi.fn(),
  dbRun: vi.fn(),
  isPostgres: vi.fn(() => true),
}));

vi.mock('../../utils/logger.js', () => ({
  apiLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { dbAll, dbGet, dbRun } from '../../database/connection.js';
import {
  fetchOpenAIModels,
  fetchAnthropicModels,
  fetchOpenRouterModels,
  fetchCopilotModels,
  normalizeModelName,
  syncModelsForOperator,
} from '../ModelSyncService.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ModelSyncService', () => {
  describe('normalizeModelName', () => {
    it('converts model ID to readable name', () => {
      expect(normalizeModelName('gpt-4o-mini')).toBe('GPT-4o Mini');
      expect(normalizeModelName('claude-sonnet-4-5-20250929')).toBe('Claude Sonnet 4.5');
      expect(normalizeModelName('claude-opus-4-6')).toBe('Claude Opus 4.6');
      expect(normalizeModelName('claude-3-5-haiku-20241022')).toBe('Claude 3.5 Haiku');
      expect(normalizeModelName('gemini-2.0-flash')).toBe('Gemini 2.0 Flash');
    });

    it('handles unknown models gracefully', () => {
      const name = normalizeModelName('some-random-model-v2');
      expect(typeof name).toBe('string');
      expect(name.length).toBeGreaterThan(0);
    });
  });

  describe('fetchOpenAIModels', () => {
    it('fetches and filters chat models from OpenAI API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'gpt-4o', owned_by: 'openai' },
            { id: 'gpt-4o-mini', owned_by: 'openai' },
            { id: 'dall-e-3', owned_by: 'openai' },
            { id: 'whisper-1', owned_by: 'openai' },
            { id: 'text-embedding-3-small', owned_by: 'openai' },
            { id: 'gpt-3.5-turbo', owned_by: 'openai' },
          ],
        }),
      });

      const models = await fetchOpenAIModels('sk-test', 'https://api.openai.com/v1');

      // Should filter out non-chat models (dall-e, whisper, embedding)
      expect(models.some(m => m.model_id === 'gpt-4o')).toBe(true);
      expect(models.some(m => m.model_id === 'gpt-4o-mini')).toBe(true);
      expect(models.some(m => m.model_id === 'dall-e-3')).toBe(false);
      expect(models.some(m => m.model_id === 'whisper-1')).toBe(false);
      expect(models.some(m => m.model_id === 'text-embedding-3-small')).toBe(false);
    });

    it('returns empty array on API error', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
      const models = await fetchOpenAIModels('bad-key', 'https://api.openai.com/v1');
      expect(models).toEqual([]);
    });
  });

  describe('fetchAnthropicModels', () => {
    it('returns known Anthropic models list', async () => {
      const models = await fetchAnthropicModels('sk-test');

      expect(models.length).toBeGreaterThan(0);
      expect(models.some(m => m.model_id.includes('claude-opus-4-6'))).toBe(true);
      expect(models.some(m => m.model_id.includes('claude-sonnet-4-5'))).toBe(true);
      // Every model should have name and model_id
      models.forEach(m => {
        expect(m.name).toBeTruthy();
        expect(m.model_id).toBeTruthy();
      });
    });
  });

  describe('fetchOpenRouterModels', () => {
    it('fetches models from OpenRouter free API', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', pricing: { prompt: '0.003', completion: '0.015' }, context_length: 200000 },
            { id: 'openai/gpt-4o', name: 'GPT-4o', pricing: { prompt: '0.005', completion: '0.015' }, context_length: 128000 },
          ],
        }),
      });

      const models = await fetchOpenRouterModels();
      expect(models.length).toBe(2);
      expect(models[0].model_id).toBe('anthropic/claude-3.5-sonnet');
    });
  });

  describe('fetchCopilotModels', () => {
    it('returns known Copilot CLI models', async () => {
      const models = await fetchCopilotModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models.some(m => m.model_id === 'claude-sonnet-4.5')).toBe(true);
      expect(models.some(m => m.model_id === 'gpt-5.2-codex')).toBe(true);
    });
  });

  describe('syncModelsForOperator', () => {
    it('adds new models that dont exist yet', async () => {
      const models = [
        { name: 'GPT-4o', model_id: 'gpt-4o' },
        { name: 'GPT-4o Mini', model_id: 'gpt-4o-mini' },
      ];

      // No existing models
      dbAll.mockResolvedValueOnce([]);
      // dbRun for inserts
      dbRun.mockResolvedValue({ lastInsertRowid: 1 });

      const result = await syncModelsForOperator(26257, models, 1787);

      expect(result.added).toBe(2);
      expect(result.skipped).toBe(0);
      expect(dbRun).toHaveBeenCalledTimes(2);
    });

    it('skips models that already exist', async () => {
      const models = [
        { name: 'GPT-4o', model_id: 'gpt-4o' },
        { name: 'GPT-4o Mini', model_id: 'gpt-4o-mini' },
      ];

      // gpt-4o already exists
      dbAll.mockResolvedValueOnce([
        { id: 100, data: JSON.stringify({ model_id: 'gpt-4o', operator_id: '26257' }) },
      ]);
      dbRun.mockResolvedValue({ lastInsertRowid: 2 });

      const result = await syncModelsForOperator(26257, models, 1787);

      expect(result.added).toBe(1);
      expect(result.skipped).toBe(1);
      expect(dbRun).toHaveBeenCalledTimes(1);
    });

    it('updates existing models with new data', async () => {
      const models = [
        { name: 'GPT-4o Updated', model_id: 'gpt-4o', context_window: 128000 },
      ];

      dbAll.mockResolvedValueOnce([
        { id: 100, data: JSON.stringify({ name: 'GPT-4o', model_id: 'gpt-4o', operator_id: '26257' }) },
      ]);
      dbRun.mockResolvedValue({ changes: 1 });

      const result = await syncModelsForOperator(26257, models, 1787, { update: true });

      expect(result.updated).toBe(1);
      expect(result.added).toBe(0);
    });
  });
});
