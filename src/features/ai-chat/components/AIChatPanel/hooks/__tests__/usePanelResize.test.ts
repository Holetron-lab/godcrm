/**
 * usePanelResize Hook Tests
 * TDD: RED -> GREEN -> REFACTOR
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePanelResize } from '../usePanelResize';

// Mock window and document
const mockAddEventListener = vi.fn();
const mockRemoveEventListener = vi.fn();

beforeEach(() => {
  Object.defineProperty(window, 'addEventListener', {
    value: mockAddEventListener,
    writable: true
  });
  Object.defineProperty(window, 'removeEventListener', {
    value: mockRemoveEventListener,
    writable: true
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('usePanelResize', () => {
  it('should initialize with provided initial values', () => {
    const { result } = renderHook(() => usePanelResize({
      initialPanelWidth: 500,
      initialSidebarWidth: 300,
      initialPanelHeight: 400
    }));
    
    expect(result.current.panelWidth).toBe(500);
    expect(result.current.sidebarWidth).toBe(300);
    expect(result.current.panelHeight).toBe(400);
    expect(result.current.isResizing).toBe(false);
    expect(result.current.isResizingWidth).toBe(false);
    expect(result.current.isResizingSidebar).toBe(false);
  });

  it('should use default values when no initial values provided', () => {
    const { result } = renderHook(() => usePanelResize({}));
    
    expect(result.current.panelWidth).toBe(420);
    expect(result.current.sidebarWidth).toBe(256);
    expect(result.current.panelHeight).toBe('auto');
  });

  it('should start panel width resizing when startResizingWidth is called', () => {
    const { result } = renderHook(() => usePanelResize({}));
    
    act(() => {
      result.current.startResizingWidth();
    });
    
    expect(result.current.isResizingWidth).toBe(true);
    expect(mockAddEventListener).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(mockAddEventListener).toHaveBeenCalledWith('mouseup', expect.any(Function));
  });

  it('should start sidebar resizing when startResizingSidebar is called', () => {
    const { result } = renderHook(() => usePanelResize({}));
    
    act(() => {
      result.current.startResizingSidebar();
    });
    
    expect(result.current.isResizingSidebar).toBe(true);
    expect(mockAddEventListener).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(mockAddEventListener).toHaveBeenCalledWith('mouseup', expect.any(Function));
  });

  it('should start panel height resizing when startResizing is called', () => {
    const { result } = renderHook(() => usePanelResize({}));
    
    act(() => {
      result.current.startResizing();
    });
    
    expect(result.current.isResizing).toBe(true);
    expect(mockAddEventListener).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(mockAddEventListener).toHaveBeenCalledWith('mouseup', expect.any(Function));
  });

  it('should update panel width within constraints', () => {
    const { result } = renderHook(() => usePanelResize({}));
    
    act(() => {
      result.current.setPanelWidth(600);
    });
    
    expect(result.current.panelWidth).toBe(600);
    
    // Test minimum constraint
    act(() => {
      result.current.setPanelWidth(200);
    });
    
    expect(result.current.panelWidth).toBe(320); // Should be clamped to minimum
    
    // Test maximum constraint
    act(() => {
      result.current.setPanelWidth(2000);
    });
    
    expect(result.current.panelWidth).toBe(1170); // Should be clamped to maximum
  });

  it('should update sidebar width within constraints', () => {
    const { result } = renderHook(() => usePanelResize({}));
    
    act(() => {
      result.current.setSidebarWidth(300);
    });
    
    expect(result.current.sidebarWidth).toBe(300);
    
    // Test minimum constraint
    act(() => {
      result.current.setSidebarWidth(100);
    });
    
    expect(result.current.sidebarWidth).toBe(180); // Should be clamped to minimum
    
    // Test maximum constraint
    act(() => {
      result.current.setSidebarWidth(500);
    });
    
    expect(result.current.sidebarWidth).toBe(400); // Should be clamped to maximum
  });

  it('should clean up event listeners on unmount', () => {
    const { unmount } = renderHook(() => usePanelResize({}));
    
    unmount();
    
    expect(mockRemoveEventListener).toHaveBeenCalled();
  });
});