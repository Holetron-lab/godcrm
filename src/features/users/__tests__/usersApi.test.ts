/**
 * @file usersApi.test.ts
 * @description Tests for Users API functions
 * @see ADR-034: Feature Tests Coverage
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usersApi, type WorkspaceUser } from '../api/usersApi';
import { apiClient } from '@/shared/utils/apiClient';

// Mock the apiClient
vi.mock('@/shared/utils/apiClient', () => ({
  apiClient: {
    request: vi.fn(),
  },
}));

const mockApiClient = apiClient as unknown as { request: ReturnType<typeof vi.fn> };

describe('usersApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('list', () => {
    it('should fetch all workspace users', async () => {
      const mockUsers: WorkspaceUser[] = [
        { id: 1, name: 'Admin', email: 'admin@example.com', role: 'owner', created_at: '2026-01-01' },
        { id: 2, name: 'User', email: 'user@example.com', role: 'member', created_at: '2026-01-02' },
      ];
      mockApiClient.request.mockResolvedValue({ data: mockUsers });

      const result = await usersApi.list();

      expect(mockApiClient.request).toHaveBeenCalledWith('/users');
      expect(result).toEqual(mockUsers);
    });

    it('should return array with user properties', async () => {
      const mockUsers: WorkspaceUser[] = [
        { id: 1, name: 'Test User', email: 'test@example.com', role: 'member', created_at: '2026-01-01' },
      ];
      mockApiClient.request.mockResolvedValue({ data: mockUsers });

      const result = await usersApi.list();

      expect(result[0]).toHaveProperty('id');
      expect(result[0]).toHaveProperty('name');
      expect(result[0]).toHaveProperty('email');
      expect(result[0]).toHaveProperty('role');
    });

    it.todo('should handle empty user list');
    it.todo('should handle network error');
    it.todo('should handle unauthorized access');
  });

  describe('security', () => {
    it.todo('should not expose password hashes');
    it.todo('should not expose sensitive user data');
    it.todo('should require authentication');
  });
});
