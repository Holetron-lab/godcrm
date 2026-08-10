import { describe, it, expect, vi, beforeEach } from 'vitest';
import { projectsApi } from '../api/projectsApi';

// Mock apiClient
vi.mock('@/shared/utils/apiClient', () => ({
  apiClient: {
    request: vi.fn(),
  },
}));

describe('projectsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('list', () => {
    it.todo('should fetch all projects');
    it.todo('should return project array');
    it.todo('should include project metadata');
  });

  describe('create', () => {
    it.todo('should create project with name');
    it.todo('should create project with description');
    it.todo('should create project in space');
    it.todo('should return created project');
    it.todo('should handle validation errors');
  });

  describe('update', () => {
    it.todo('should update project name');
    it.todo('should update project description');
    it.todo('should update project icon');
    it.todo('should update access control');
    it.todo('should update theme colors');
  });

  describe('delete', () => {
    it.todo('should delete project');
    it.todo('should cascade delete tables');
    it.todo('should handle permission errors');
  });
});
