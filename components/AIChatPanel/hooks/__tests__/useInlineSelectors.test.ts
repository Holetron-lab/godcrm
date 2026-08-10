/**
 * useInlineSelectors Hook Tests
 * TDD: RED -> GREEN -> REFACTOR
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useInlineSelectors } from '../useInlineSelectors';

describe('useInlineSelectors', () => {
  it('should initialize with default values', () => {
    const { result } = renderHook(() => useInlineSelectors());
    
    expect(result.current.tasksSource).toBeUndefined();
    expect(result.current.filesSource).toBeUndefined();
    expect(result.current.showTasksSelector).toBe(false);
    expect(result.current.showFilePicker).toBe(false);
    expect(result.current.taskProjectId).toBeNull();
  });

  it('should update tasks source when setTasksSource is called', () => {
    const { result } = renderHook(() => useInlineSelectors());
    
    const tasksConfig = {
      tableId: 123,
      tableName: 'Tasks',
      tableIcon: 'list',
      displayColumn: 'title'
    };
    
    act(() => {
      result.current.setTasksSource(tasksConfig);
    });
    
    expect(result.current.tasksSource).toEqual(tasksConfig);
  });

  it('should update files source when setFilesSource is called', () => {
    const { result } = renderHook(() => useInlineSelectors());
    
    const filesConfig = {
      tableId: 456,
      tableName: 'Files',
      tableIcon: 'file',
      projectId: 789
    };
    
    act(() => {
      result.current.setFilesSource(filesConfig);
    });
    
    expect(result.current.filesSource).toEqual(filesConfig);
  });

  it('should toggle tasks selector visibility', () => {
    const { result } = renderHook(() => useInlineSelectors());
    
    act(() => {
      result.current.setShowTasksSelector(true);
    });
    
    expect(result.current.showTasksSelector).toBe(true);
    
    act(() => {
      result.current.setShowTasksSelector(false);
    });
    
    expect(result.current.showTasksSelector).toBe(false);
  });

  it('should toggle file picker visibility', () => {
    const { result } = renderHook(() => useInlineSelectors());
    
    act(() => {
      result.current.setShowFilePicker(true);
    });
    
    expect(result.current.showFilePicker).toBe(true);
    
    act(() => {
      result.current.setShowFilePicker(false);
    });
    
    expect(result.current.showFilePicker).toBe(false);
  });

  it('should update task project ID', () => {
    const { result } = renderHook(() => useInlineSelectors());
    
    act(() => {
      result.current.setTaskProjectId(999);
    });
    
    expect(result.current.taskProjectId).toBe(999);
    
    act(() => {
      result.current.setTaskProjectId(null);
    });
    
    expect(result.current.taskProjectId).toBeNull();
  });

  it('should provide auto-mapping functionality', () => {
    const { result } = renderHook(() => useInlineSelectors());
    
    expect(typeof result.current.autoMapTasksTable).toBe('function');
    expect(typeof result.current.autoMapFilesTable).toBe('function');
  });
});