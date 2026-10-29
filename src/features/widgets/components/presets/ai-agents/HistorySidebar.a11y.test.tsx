import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HistorySidebar } from './HistorySidebar';

describe('history width control', () => {
  it('supports keyboard adjustment and limits without starting a pointer drag', () => {
    const change = vi.fn();
    const drag = vi.fn();
    render(<HistorySidebar sidebarWidth={280} onWidthChange={change} onMouseDown={drag}
      isResizing={false} onCollapse={vi.fn()} isLoadingConversations={false}
      enrichedConversations={[]} selectedConversationId={null} expandedConversation={null}
      onExpandConversation={vi.fn()} onSelectConversation={vi.fn()} onDeleteConversation={vi.fn()} />);
    const slider = screen.getByRole('slider', { name: 'Ширина истории' });
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    fireEvent.keyDown(slider, { key: 'Home' });
    fireEvent.keyDown(slider, { key: 'End' });
    fireEvent.keyDown(slider, { key: 'Tab' });
    expect(change.mock.calls).toEqual([[300], [260], [200], [500]]);
    expect(drag).not.toHaveBeenCalled();
  });
});
