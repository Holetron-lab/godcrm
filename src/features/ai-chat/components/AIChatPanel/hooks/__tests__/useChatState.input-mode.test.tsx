import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { useChatInputMode } from '@/shared/hooks/useChatInputMode';
import { useChatState } from '../useChatState';

beforeEach(() => localStorage.clear());

it('keeps one text input by default when switching between human and agent chats', () => {
  const { result } = renderHook(() => useChatState({ currentConversationId: 201 }));
  act(() => {
    result.current.actions.setChatPartner({ type: 'user', id: 1, name: 'Person' });
    result.current.actions.setUserConversationId(101);
  });
  act(() => result.current.actions.setInputValue('Shared text'));
  act(() => result.current.actions.setChatPartner({ type: 'agent', id: 2, name: 'Agent' }));
  expect(result.current.state.inputValue).toBe('Shared text');
  act(() => result.current.actions.setInputValue(text => text + ' edited'));
  act(() => result.current.actions.setChatPartner({ type: 'user', id: 1, name: 'Person' }));
  expect(result.current.state.inputValue).toBe('Shared text edited');
});

it.each(['shared', 'per-chat'])('keeps files, entity rows and replies with their chat in %s mode', mode => {
  localStorage.setItem('god-crm-chat-input-mode', mode);
  const { result } = renderHook(() => useChatState());
  act(() => {
    result.current.actions.setChatPartner({ type: 'user', id: 1, name: 'Person' });
    result.current.actions.setUserConversationId(101);
  });
  const file = new File(['a'], 'a.txt');
  act(() => {
    result.current.actions.setAttachments([file]);
    result.current.actions.setMessageBoundRows([{ table_id: 10, row_id: 11 }]);
    result.current.actions.setMentionedUsers([{ id: 1, name: 'Person', type: 'human' }]);
    result.current.actions.setReplyTo({ message_id: 11 });
  });
  const clearOriginal = result.current.actions.setAttachments;
  act(() => result.current.actions.setUserConversationId(102));
  expect(result.current.state.attachments).toEqual([]);
  expect(result.current.state.replyTo).toBeNull();
  expect(result.current.state.messageBoundRows).toEqual([]);
  expect(result.current.state.mentionedUsers).toEqual([]);
  const other = new File(['b'], 'b.txt');
  act(() => result.current.actions.setAttachments([other]));
  act(() => clearOriginal([]));
  expect(result.current.state.attachments).toEqual([other]);
  act(() => result.current.actions.setUserConversationId(101));
  expect(result.current.state.attachments).toEqual([]);
  expect(result.current.state.replyTo).toEqual({ message_id: 11 });
  expect(result.current.state.messageBoundRows).toEqual([{ table_id: 10, row_id: 11 }]);
  expect(result.current.state.mentionedUsers).toHaveLength(1);
});

it('preserves existing per-chat drafts when toggling modes and seeds empty drafts from the shared text', () => {
  const { result } = renderHook(() => ({ chat: useChatState(), preference: useChatInputMode() }));
  act(() => result.current.chat.actions.setInputValue('Shared'));
  act(() => result.current.preference.setMode('per-chat'));
  expect(result.current.chat.state.inputValue).toBe('Shared');
  act(() => result.current.chat.actions.setInputValue('Private A'));
  act(() => result.current.preference.setMode('shared'));
  expect(result.current.chat.state.inputValue).toBe('Shared');
  act(() => result.current.chat.actions.setInputValue('New shared'));
  act(() => result.current.preference.setMode('per-chat'));
  expect(result.current.chat.state.inputValue).toBe('Private A');
  act(() => result.current.preference.setMode('shared'));
  expect(result.current.chat.state.inputValue).toBe('New shared');
});
