import { describe, it, expect, vi, beforeEach } from 'vitest';
import { filesApi } from '../api/filesApi';

// Mock apiClient
vi.mock('@/shared/utils/apiClient', () => ({
  apiClient: {
    request: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
    getAccessToken: vi.fn(() => 'test-token'),
  },
}));

describe('filesApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('upload', () => {
    it.todo('should upload single file');
    it.todo('should upload multiple files');
    it.todo('should include spaceId in form data');
    it.todo('should include projectId in form data');
    it.todo('should include tableId and rowId for cell attachments');
    it.todo('should report upload progress');
    it.todo('should handle upload errors');
    it.todo('should validate file size limits');
    it.todo('should validate file type restrictions');
  });

  describe('list', () => {
    it.todo('should list files for space');
    it.todo('should list files for project');
    it.todo('should list files for table row');
    it.todo('should support pagination');
    it.todo('should filter by mime type');
  });

  describe('get', () => {
    it.todo('should get file by ID');
    it.todo('should return file metadata');
    it.todo('should throw 404 for non-existent file');
  });

  describe('delete', () => {
    it.todo('should delete file by ID');
    it.todo('should remove file from storage');
    it.todo('should handle permission errors');
  });

  describe('download', () => {
    it.todo('should generate download URL');
    it.todo('should support signed URLs');
  });

  describe('storage providers', () => {
    it.todo('should list storage providers');
    it.todo('should get default provider');
    it.todo('should configure S3 provider');
    it.todo('should configure Google Drive provider');
  });
});

describe('File Validation', () => {
  describe('size limits', () => {
    it.todo('should reject files over limit');
    it.todo('should allow files within limit');
  });

  describe('type validation', () => {
    it.todo('should accept allowed mime types');
    it.todo('should reject dangerous file types');
    it.todo('should validate file extension matches content');
  });
});
