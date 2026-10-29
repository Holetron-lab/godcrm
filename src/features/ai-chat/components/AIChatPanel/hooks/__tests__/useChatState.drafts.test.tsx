import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useChatState } from '../useChatState';

beforeEach(() => localStorage.setItem('god-crm-chat-input-mode', 'per-chat'));

describe('conversation drafts (QA-3660-DRAFT-01)', () => {
  it('keeps distinct A/B drafts for two conversations with the same person', () => {
    function Composer() {
      const { state, actions } = useChatState();
      return <>
        {[101, 102].map(id => <button key={id} onClick={() => {
          actions.setChatPartner({ type: 'user', id: 1, name: 'Me' });
          actions.setUserConversationId(id);
        }}>{id}</button>)}
        <output aria-label="Conversation">{state.userConversationId}</output>
        <textarea aria-label="Message" value={state.inputValue}
          onChange={event => actions.setInputValue(event.target.value)} />
      </>;
    }
    render(<Composer />);
    const input = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.click(screen.getByRole('button', { name: '101' }));
    fireEvent.change(input, { target: { value: 'Private A' } });
    fireEvent.click(screen.getByRole('button', { name: '102' }));
    expect(screen.getByLabelText('Conversation')).toHaveTextContent('102');
    expect(input).toHaveValue('');
    fireEvent.change(input, { target: { value: 'Private B' } });
    fireEvent.click(screen.getByRole('button', { name: '101' }));
    expect(input).toHaveValue('Private A');
    fireEvent.click(screen.getByRole('button', { name: '102' }));
    expect(input).toHaveValue('Private B');
  });

  it('keeps delayed functional updates attached to their originating conversation', () => {
    const { result } = renderHook(() => useChatState());
    act(() => {
      result.current.actions.setChatPartner({ type: 'group', id: 101, name: 'A' });
      result.current.actions.setUserConversationId(101);
    });
    act(() => result.current.actions.setInputValue('A'));
    const updateA = result.current.actions.setInputValue;
    act(() => {
      result.current.actions.setChatPartner({ type: 'group', id: 102, name: 'B' });
      result.current.actions.setUserConversationId(102);
    });
    act(() => result.current.actions.setInputValue('B'));
    act(() => updateA(previous => previous + ' updated'));
    expect(result.current.state.inputValue).toBe('B');
    act(() => result.current.actions.setUserConversationId(101));
    expect(result.current.state.inputValue).toBe('A updated');
  });

  it('isolates AI conversations with the same agent while selection is pending', () => {
    const { result, rerender } = renderHook((props: {
      currentConversationId: number; pendingConversationId: number | null;
    }) => useChatState(props), { initialProps: { currentConversationId: 201, pendingConversationId: null as number | null } });
    act(() => result.current.actions.setChatPartner({ type: 'agent', id: 7, name: 'Agent' }));
    act(() => result.current.actions.setInputValue('AI A'));
    rerender({ currentConversationId: 201, pendingConversationId: 202 });
    expect(result.current.state.inputValue).toBe('');
    rerender({ currentConversationId: 202, pendingConversationId: null });
    act(() => result.current.actions.setInputValue('AI B'));
    rerender({ currentConversationId: 202, pendingConversationId: 201 });
    expect(result.current.state.inputValue).toBe('AI A');
    // A failed selection restores the current conversation's draft.
    rerender({ currentConversationId: 202, pendingConversationId: null });
    expect(result.current.state.inputValue).toBe('AI B');
    // Stale user-chat state must not pick the AI draft.
    act(() => {
      result.current.actions.setUserConversationId(101);
      result.current.actions.setChatPartner({ type: 'user', id: 7, name: 'Person' });
    });
    expect(result.current.state.inputValue).toBe('');
    act(() => result.current.actions.setInputValue('DM'));
    act(() => result.current.actions.setChatPartner({ type: 'agent', id: 7, name: 'Renamed agent' }));
    expect(result.current.state.inputValue).toBe('AI B');
  });

  it('preserves same-chat drafts across panel navigation and partner metadata changes', () => {
    const { result, rerender } = renderHook(() => useChatState());
    act(() => {
      result.current.actions.setUserConversationId(101);
      result.current.actions.setChatPartner({ type: 'user', id: 1, name: 'Me' });
    });
    act(() => result.current.actions.setInputValue('Keep me'));
    act(() => result.current.actions.setActivePanel('settings'));
    rerender();
    act(() => {
      result.current.actions.setActivePanel('none');
      result.current.actions.setChatPartner({ type: 'group', id: 101, name: 'Renamed' });
    });
    expect(result.current.state.inputValue).toBe('Keep me');
  });

  it('does not carry a new-chat draft into an existing conversation', () => {
    const { result } = renderHook(() => useChatState());
    act(() => result.current.actions.setChatPartner({ type: 'user', id: 1, name: 'Me' }));
    act(() => result.current.actions.setInputValue('Not sent yet'));
    act(() => result.current.actions.setUserConversationId(101));
    expect(result.current.state.inputValue).toBe('');
    act(() => result.current.actions.setUserConversationId(null));
    expect(result.current.state.inputValue).toBe('Not sent yet');
    act(() => result.current.actions.setChatPartner({ type: 'agent', id: 1, name: 'Agent' }));
    expect(result.current.state.inputValue).toBe('');
  });

  it.each(['user', 'agent'] as const)('retains a %s draft after creation and failed send, then clears it on retry', type => {
    const { result, rerender } = renderHook((props: { currentConversationId: number | null }) => useChatState(props), {
      initialProps: { currentConversationId: null as number | null },
    });
    act(() => result.current.actions.setChatPartner({ type, id: 1, name: 'Partner' }));
    act(() => result.current.actions.setInputValue('Retry me'));
    const clearOriginal = result.current.actions.setInputValue;
    act(() => {
      result.current.bindDraftToConversation(301);
      if (type === 'user') result.current.actions.setUserConversationId(301);
    });
    if (type === 'agent') rerender({ currentConversationId: 301 });
    expect(result.current.state.inputValue).toBe('Retry me');
    act(() => clearOriginal(value => value === 'Retry me' ? '' : value));
    expect(result.current.state.inputValue).toBe('');
  });
});
