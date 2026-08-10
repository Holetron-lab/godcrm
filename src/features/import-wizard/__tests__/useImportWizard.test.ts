import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useImportWizard } from '../hooks/useImportWizard';

describe('useImportWizard', () => {
  describe('initial state', () => {
    it('should start at step 1', () => {
      const { result } = renderHook(() => useImportWizard());
      expect(result.current.step).toBe(1);
    });

    it('should have default sync config', () => {
      const { result } = renderHook(() => useImportWizard());
      expect(result.current.config.syncConfig).toBeDefined();
      expect(result.current.config.syncConfig?.enabled).toBe(true);
    });

    it('should have empty custom columns', () => {
      const { result } = renderHook(() => useImportWizard());
      expect(result.current.config.customColumns).toEqual([]);
    });
  });

  describe('navigation', () => {
    it('should go to next step', () => {
      const { result } = renderHook(() => useImportWizard());
      
      act(() => {
        result.current.nextStep();
      });
      
      expect(result.current.step).toBe(2);
    });

    it('should go to previous step', () => {
      const { result } = renderHook(() => useImportWizard());
      
      act(() => {
        result.current.nextStep();
        result.current.nextStep();
        result.current.prevStep();
      });
      
      expect(result.current.step).toBe(2);
    });

    it('should not go below step 1', () => {
      const { result } = renderHook(() => useImportWizard());
      
      act(() => {
        result.current.prevStep();
      });
      
      expect(result.current.step).toBe(1);
    });

    it('should not exceed total steps', () => {
      const { result } = renderHook(() => useImportWizard());
      
      act(() => {
        for (let i = 0; i < 10; i++) {
          result.current.nextStep();
        }
      });
      
      expect(result.current.step).toBe(result.current.totalSteps);
    });
  });

  describe('config updates', () => {
    it.todo('should update data source ID');
    it.todo('should update table name');
    it.todo('should update ID column');
    it.todo('should update sync config');
    it.todo('should add custom columns');
  });

  describe('canProceed validation', () => {
    it.todo('should require data source for step 1');
    it.todo('should require table name for step 2');
    it.todo('should require valid ID column for step 3');
    it.todo('should always allow step 5 (optional custom columns)');
  });

  describe('reset', () => {
    it('should reset to initial state', () => {
      const { result } = renderHook(() => useImportWizard());
      
      act(() => {
        result.current.nextStep();
        result.current.nextStep();
        result.current.updateConfig({ dataSourceId: 'test' });
        result.current.reset();
      });
      
      expect(result.current.step).toBe(1);
      expect(result.current.config.dataSourceId).toBeUndefined();
    });
  });
});
