// backend/utils/__tests__/response.test.js
// Response Helper Tests - ADR-015
import { describe, it, expect, vi } from 'vitest';

// Mock response object
function createMockRes() {
  const res = {
    statusCode: 200,
    _json: null,
    status: vi.fn(function(code) { 
      this.statusCode = code; 
      return this; 
    }),
    json: vi.fn(function(data) { 
      this._json = data; 
      return this; 
    })
  };
  return res;
}

describe('Response Helpers', () => {
  describe('success', () => {
    it('should send success response with data', async () => {
      const { success } = await import('../response.js');
      const res = createMockRes();
      
      success(res, { id: 1, name: 'Test' });
      
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res._json.success).toBe(true);
      expect(res._json.data).toEqual({ id: 1, name: 'Test' });
      expect(res._json.timestamp).toBeDefined();
    });

    it('should allow custom status code', async () => {
      const { success } = await import('../response.js');
      const res = createMockRes();
      
      success(res, { created: true }, 201);
      
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  describe('created', () => {
    it('should send 201 response', async () => {
      const { created } = await import('../response.js');
      const res = createMockRes();
      
      created(res, { id: 1 });
      
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res._json.success).toBe(true);
    });
  });

  describe('error responses', () => {
    it('should send badRequest (400)', async () => {
      const { badRequest } = await import('../response.js');
      const res = createMockRes();
      
      badRequest(res, 'Invalid input');
      
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.success).toBe(false);
      expect(res._json.error.code).toBe('BAD_REQUEST');
      expect(res._json.error.message).toBe('Invalid input');
    });

    it('should send unauthorized (401)', async () => {
      const { unauthorized } = await import('../response.js');
      const res = createMockRes();
      
      unauthorized(res);
      
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res._json.error.code).toBe('UNAUTHORIZED');
    });

    it('should send forbidden (403)', async () => {
      const { forbidden } = await import('../response.js');
      const res = createMockRes();
      
      forbidden(res);
      
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res._json.error.code).toBe('FORBIDDEN');
    });

    it('should send notFound (404)', async () => {
      const { notFound } = await import('../response.js');
      const res = createMockRes();
      
      notFound(res, 'User');
      
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res._json.error.message).toBe('User not found');
    });
  });

  describe('paginated', () => {
    it('should send paginated response', async () => {
      const { paginated } = await import('../response.js');
      const res = createMockRes();
      
      paginated(res, [{ id: 1 }, { id: 2 }], { page: 1, limit: 10, total: 25 });
      
      expect(res._json.success).toBe(true);
      expect(res._json.data).toHaveLength(2);
      expect(res._json.pagination).toEqual({
        page: 1,
        limit: 10,
        total: 25,
        totalPages: 3
      });
    });
  });
});
