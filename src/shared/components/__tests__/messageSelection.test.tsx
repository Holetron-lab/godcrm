import { fireEvent, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderWithProviders as render } from '@/tests/renderWithProviders';
import { MarkdownPreview } from '../MarkdownPreview';
import { TurnFooter } from '@/features/ai-chat/components/AIChatPanel/components/ChatMessages/ChatTurn/TurnFooter';
import type { ChatMessage } from '@/features/ai-chat/components/AIChatPanel/types';

function selectText(element: Element, start = 0, end = element.textContent!.length) {
  const range = document.createRange();
  range.setStart(element.firstChild!, start);
  range.setEnd(element.firstChild!, end);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
}

afterEach(() => window.getSelection()?.removeAllRanges());

describe('message selection', () => {
  it('keeps text nodes and selection when callbacks and user objects refresh', () => {
    const view = (name: string) => <MemoryRouter><MarkdownPreview content="Keep this text" currentUser={{ id: 1, name }} onCheckboxClick={vi.fn()} /></MemoryRouter>;
    const { rerender } = render(view('First'));
    const paragraph = screen.getByText('Keep this text');
    selectText(paragraph, 5, 9);
    rerender(view('Updated'));
    expect(screen.getByText('Keep this text')).toBe(paragraph);
    expect(window.getSelection()?.toString()).toBe('this');
  });

  it('uses the latest checkbox callback after a rerender', () => {
    const first = vi.fn();
    const latest = vi.fn();
    const view = (callback: typeof first) => <MemoryRouter><MarkdownPreview content={'- [ ] First\n- [ ] Second'} onCheckboxClick={callback} /></MemoryRouter>;
    const { rerender } = render(view(first));
    rerender(view(latest));
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledWith(expect.objectContaining({ index: 1, lineText: 'Second', checked: true }));
  });

  const message: ChatMessage = { id: '42', role: 'assistant', content: 'Full message text', timestamp: new Date(), contentType: 'text' };
  function fixture(onForward: (message: ChatMessage) => void) {
    return render(<><p>Outside selection</p><div data-chat-turn><div data-message-id="42"><p>Full message text</p></div><TurnFooter reactableMessageId={42} primaryMessage={message} allMessages={[message]} turnType="agent" reactionList={[]} quickEmojis={[]} onForward={onForward} /></div></>);
  }

  it('forwards only selected text through the footer button', () => {
    const onForward = vi.fn();
    fixture(onForward);
    selectText(screen.getByText(message.content), 5, 12);
    const button = screen.getByTitle('Переслать');
    expect(fireEvent.mouseDown(button)).toBe(false);
    fireEvent.click(button);
    expect(onForward).toHaveBeenCalledWith(expect.objectContaining({ id: '42', content: 'message' }));
  });

  it('forwards the full message without a selection', () => {
    const onForward = vi.fn();
    fixture(onForward);
    fireEvent.click(screen.getByTitle('Переслать'));
    expect(onForward).toHaveBeenCalledWith(message);
  });

  it('rejects a selection that extends outside the message', () => {
    const onForward = vi.fn();
    fixture(onForward);
    const range = document.createRange();
    range.setStart(screen.getByText('Outside selection').firstChild!, 0);
    range.setEnd(screen.getByText(message.content).firstChild!, 4);
    window.getSelection()!.addRange(range);
    fireEvent.click(screen.getByTitle('Переслать'));
    expect(onForward).toHaveBeenCalledWith(message);
  });

  it('does not take selected text from another bubble', () => {
    const onForward = vi.fn();
    fixture(onForward);
    selectText(screen.getByText('Outside selection'));
    fireEvent.click(screen.getByTitle('Переслать'));
    expect(onForward).toHaveBeenCalledWith(message);
  });
});
