import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spacesApi } from '../api/spacesApi';

// Mock apiClient
vi.mock('@/shared/utils/apiClient', () => ({
  apiClient: {
    request: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('spacesApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('list', () => {
    it.todo('should fetch all spaces for user');
    it.todo('should transform API response to SpaceModel');
    it.todo('should parse JSON fields correctly');
    it.todo('should include user_access_level');
    it.todo('should handle empty spaces list');
  });

  describe('getById', () => {
    it.todo('should fetch space by ID');
    it.todo('should include nested projects');
    it.todo('should include dashboards');
    it.todo('should throw 404 for non-existent space');
  });

  describe('create', () => {
    it.todo('should create space with required fields');
    it.todo('should set default icon and theme');
    it.todo('should return created space with ID');
    it.todo('should validate space name uniqueness');
  });

  describe('update', () => {
    it.todo('should update space fields');
    it.todo('should update only provided fields');
    it.todo('should update theme colors');
    it.todo('should validate permissions');
  });

  describe('delete', () => {
    it.todo('should delete space by ID');
    it.todo('should cascade delete projects');
    it.todo('should require owner permission');
  });

  describe('access control', () => {
    it.todo('should add user to space');
    it.todo('should remove user from space');
    it.todo('should update user role');
    it.todo('should list space members');
  });

  describe('reorder', () => {
    it.todo('should reorder spaces');
    it.todo('should persist order per user');
  });
});
