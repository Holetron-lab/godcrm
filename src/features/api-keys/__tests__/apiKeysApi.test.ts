/**
 * @file apiKeysApi.test.ts
 * @description Tests for API Keys API functions (SECURITY CRITICAL)
 * @see ADR-034: Feature Tests Coverage
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiKeysApi, type CreateApiKeyRequest } from '../api/apiKeysApi';
import { apiClient } from '@/shared/utils/apiClient';

// Mock the apiClient
vi.mock('@/shared/utils/apiClient', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockApiClient = apiClient as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

describe('apiKeysApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('list', () => {
    it('should list all API keys', async () => {
      const mockKeys = [
        { id: 1, key_prefix: 'sk_test_...', name: 'Test Key' },
        { id: 2, key_prefix: 'sk_live_...', name: 'Live Key' },
      ];
      mockApiClient.get.mockResolvedValue({ success: true, data: mockKeys });

      const result = await apiKeysApi.list();

      expect(mockApiClient.get).toHaveBeenCalledWith('/api-keys');
      expect(result).toEqual(mockKeys);
    });

    it('should filter by project_id when provided', async () => {
      mockApiClient.get.mockResolvedValue({ success: true, data: [] });

      await apiKeysApi.list(42);

      expect(mockApiClient.get).toHaveBeenCalledWith('/api-keys?project_id=42');
    });

    it('should return empty array on failure', async () => {
      mockApiClient.get.mockResolvedValue({ success: false, data: null });

      const result = await apiKeysApi.list();

      expect(result).toEqual([]);
    });
  });

  describe('create', () => {
    it('should create API key with required fields', async () => {
      const createData: CreateApiKeyRequest = {
        name: 'New API Key',
        scopes: ['tables:read'],
      };
      const mockResponse = {
        id: 1,
        key: 'sk_test_abc123xyz', // Full key, only shown once!
        key_prefix: 'sk_test_...',
        name: 'New API Key',
        scopes: ['tables:read'],
        rate_limit: 1000,
        expires_at: null,
        created_at: new Date().toISOString(),
      };
      mockApiClient.post.mockResolvedValue({ success: true, data: mockResponse });

      const result = await apiKeysApi.create(createData);

      expect(mockApiClient.post).toHaveBeenCalledWith('/api-keys', createData);
      expect(result).toEqual(mockResponse);
      expect(result.key).toBeDefined(); // CRITICAL: key is returned
    });

    it('should create key with expiration', async () => {
      const createData: CreateApiKeyRequest = {
        name: 'Expiring Key',
        expires_in_days: 30,
      };
      mockApiClient.post.mockResolvedValue({ 
        success: true, 
        data: { 
          id: 1, 
          key: 'sk_test_xyz',
          expires_at: '2026-02-22T00:00:00Z'
        } 
      });

      const result = await apiKeysApi.create(createData);

      expect(result.expires_at).toBeDefined();
    });

    it('should create key with agent assignment', async () => {
      const createData: CreateApiKeyRequest = {
        name: 'Agent Key',
        agent_id: 5,
        project_id: 10,
      };
      mockApiClient.post.mockResolvedValue({ success: true, data: { id: 1, key: 'sk_test_xyz' } });

      await apiKeysApi.create(createData);

      expect(mockApiClient.post).toHaveBeenCalledWith('/api-keys', createData);
    });
  });

  describe('update', () => {
    it('should update API key name', async () => {
      const updates = { name: 'Updated Name' };
      mockApiClient.patch.mockResolvedValue({ success: true, data: { id: 1, ...updates } });

      const result = await apiKeysApi.update(1, updates);

      expect(mockApiClient.patch).toHaveBeenCalledWith('/api-keys/1', updates);
      expect(result.name).toBe('Updated Name');
    });

    it('should deactivate API key', async () => {
      const updates = { is_active: 0 };
      mockApiClient.patch.mockResolvedValue({ success: true, data: { id: 1, is_active: 0 } });

      const result = await apiKeysApi.update(1, updates);

      expect(result.is_active).toBe(0);
    });

    it('should update rate limit', async () => {
      const updates = { rate_limit: 5000 };
      mockApiClient.patch.mockResolvedValue({ success: true, data: { id: 1, rate_limit: 5000 } });

      const result = await apiKeysApi.update(1, updates);

      expect(result.rate_limit).toBe(5000);
    });
  });

  describe('delete', () => {
    it('should revoke API key', async () => {
      mockApiClient.delete.mockResolvedValue(undefined);

      await apiKeysApi.delete(42);

      expect(mockApiClient.delete).toHaveBeenCalledWith('/api-keys/42');
    });

    it('should include project_id when provided', async () => {
      mockApiClient.delete.mockResolvedValue(undefined);

      await apiKeysApi.delete(42, 10);

      expect(mockApiClient.delete).toHaveBeenCalledWith('/api-keys/42?project_id=10');
    });
  });

  describe('regenerate', () => {
    it('should regenerate API key and return new key', async () => {
      const mockNewKey = {
        id: 1,
        key: 'sk_test_newkey123', // New full key
        key_prefix: 'sk_test_...',
        name: 'My Key',
        scopes: ['*'],
        rate_limit: 1000,
        expires_at: null,
        created_at: new Date().toISOString(),
      };
      mockApiClient.post.mockResolvedValue({ success: true, data: mockNewKey });

      const result = await apiKeysApi.regenerate(1);

      expect(mockApiClient.post).toHaveBeenCalledWith('/api-keys/1/regenerate', { project_id: undefined });
      expect(result.key).toBeDefined();
      expect(result.key).not.toBe(''); // CRITICAL: new key is returned
    });

    it('should include project_id when provided', async () => {
      mockApiClient.post.mockResolvedValue({ success: true, data: { id: 1, key: 'sk_new' } });

      await apiKeysApi.regenerate(1, 10);

      expect(mockApiClient.post).toHaveBeenCalledWith('/api-keys/1/regenerate', { project_id: 10 });
    });
  });

  describe('security', () => {
    it.todo('should not log full API key to console');
    it.todo('should not include full key in error messages');
    it.todo('should require at least one scope');
    it.todo('should validate scope format');
    it.todo('should enforce rate limiting');
  });
});
