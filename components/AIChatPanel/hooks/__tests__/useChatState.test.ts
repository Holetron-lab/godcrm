/**
 * useChatState Hook Tests
 * TDD: RED -> GREEN -> REFACTOR
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChatState } from '../useChatState';

describe('useChatState', () => {
  it('should initialize with default state values', () => {
    const { result } = renderHook(() => useChatState());
    
    expect(result.current.state.activePanel).toBe('none');
    expect(result.current.state.chatMode).toBe('ai');
    expect(result.current.state.chatPartner).toBeNull();
    expect(result.current.state.inputValue).toBe('');
    expect(result.current.state.attachments).toEqual([]);
    expect(result.current.state.dragOver).toBe(false);
    expect(result.current.state.panelWidth).toBe(420);
    expect(result.current.state.sidebarWidth).toBe(256);
    expect(result.current.state.markdownEnabled).toBe(true);
    expect(result.current.state.agentMode).toBe('agent');
    expect(result.current.state.thinkingEnabled).toBe(false);
    expect(result.current.state.settingsTab).toBe('ai');
  });

  it('should update activePanel when setActivePanel is called', () => {
    const { result } = renderHook(() => useChatState());
    
    act(() => {
      result.current.actions.setActivePanel('contacts');
    });
    
    expect(result.current.state.activePanel).toBe('contacts');
  });

  it('should update chatMode when setChatMode is called', () => {
    const { result } = renderHook(() => useChatState());
    
    act(() => {
      result.current.actions.setChatMode('people');
    });
    
    expect(result.current.state.chatMode).toBe('people');
  });

  it('should update inputValue when setInputValue is called', () => {
    const { result } = renderHook(() => useChatState());
    
    act(() => {
      result.current.actions.setInputValue('Hello world');
    });
    
    expect(result.current.state.inputValue).toBe('Hello world');
  });

  it('should update panelWidth when setPanelWidth is called', () => {
    const { result } = renderHook(() => useChatState());
    
    act(() => {
      result.current.actions.setPanelWidth(500);
    });
    
    expect(result.current.state.panelWidth).toBe(500);
  });

  it('should update multiple state values independently', () => {
    const { result } = renderHook(() => useChatState());
    
    act(() => {
      result.current.actions.setActivePanel('settings');
      result.current.actions.setMarkdownEnabled(false);
      result.current.actions.setAgentMode('ask');
    });
    
    expect(result.current.state.activePanel).toBe('settings');
    expect(result.current.state.markdownEnabled).toBe(false);
    expect(result.current.state.agentMode).toBe('ask');
    // Other values should remain unchanged
    expect(result.current.state.chatMode).toBe('ai');
    expect(result.current.state.inputValue).toBe('');
  });

  it('should handle complex objects like chatPartner', () => {
    const { result } = renderHook(() => useChatState());
    
    const testPartner = {
      type: 'agent' as const,
      id: 1,
      name: 'Test Agent',
      icon: 'bot'
    };
    
    act(() => {
      result.current.actions.setChatPartner(testPartner);
    });
    
    expect(result.current.state.chatPartner).toEqual(testPartner);
  });

  it('should handle arrays like attachments', () => {
    const { result } = renderHook(() => useChatState());
    
    const testFiles = [
      new File(['test'], 'test.txt', { type: 'text/plain' })
    ];
    
    act(() => {
      result.current.actions.setAttachments(testFiles);
    });
    
    expect(result.current.state.attachments).toEqual(testFiles);
  });
});