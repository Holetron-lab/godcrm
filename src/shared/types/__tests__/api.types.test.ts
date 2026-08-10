// src/shared/types/__tests__/api.types.test.ts
// TDD: Тесты для API type guards
// ADR-030: DRY Refactoring

import { describe, it, expect } from 'vitest';
import { 
  isApiSuccess, 
  isApiError,
  type ApiSuccessResponse,
  type ApiErrorResponse,
  type ApiResult
} from '../api.types';

describe('API Types', () => {
  describe('isApiSuccess', () => {
    it('returns true for success response', () => {
      const response: ApiSuccessResponse<string[]> = {
        success: true,
        data: ['a', 'b'],
        timestamp: '2026-01-20T00:00:00.000Z'
      };
      
      expect(isApiSuccess(response)).toBe(true);
    });

    it('returns false for error response', () => {
      const response: ApiErrorResponse = {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Not found' },
        timestamp: '2026-01-20T00:00:00.000Z'
      };
      
      expect(isApiSuccess(response)).toBe(false);
    });

    it('narrows type correctly', () => {
      const result: ApiResult<number[]> = {
        success: true,
        data: [1, 2, 3],
        timestamp: '2026-01-20T00:00:00.000Z'
      };

      if (isApiSuccess(result)) {
        // TypeScript should know result.data is number[]
        expect(result.data.length).toBe(3);
        expect(result.data[0]).toBe(1);
      }
    });
  });

  describe('isApiError', () => {
    it('returns true for error response', () => {
      const response: ApiErrorResponse = {
        success: false,
        error: { code: 'BAD_REQUEST', message: 'Invalid input' },
        timestamp: '2026-01-20T00:00:00.000Z'
      };
      
      expect(isApiError(response)).toBe(true);
    });

    it('returns false for success response', () => {
      const response: ApiSuccessResponse<null> = {
        success: true,
        data: null,
        timestamp: '2026-01-20T00:00:00.000Z'
      };
      
      expect(isApiError(response)).toBe(false);
    });

    it('narrows type correctly', () => {
      const result: ApiResult<string> = {
        success: false,
        error: { 
          code: 'VALIDATION_ERROR', 
          message: 'Field required',
          details: { field: 'email' }
        },
        timestamp: '2026-01-20T00:00:00.000Z'
      };

      if (isApiError(result)) {
        // TypeScript should know result.error exists
        expect(result.error.code).toBe('VALIDATION_ERROR');
        expect(result.error.details).toEqual({ field: 'email' });
      }
    });
  });

  describe('Type compatibility', () => {
    it('ApiResult can be either success or error', () => {
      const successResult: ApiResult<{ id: number }> = {
        success: true,
        data: { id: 42 },
        timestamp: '2026-01-20T00:00:00.000Z'
      };

      const errorResult: ApiResult<{ id: number }> = {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Not found' },
        timestamp: '2026-01-20T00:00:00.000Z'
      };

      expect(isApiSuccess(successResult)).toBe(true);
      expect(isApiError(errorResult)).toBe(true);
    });
  });
});
