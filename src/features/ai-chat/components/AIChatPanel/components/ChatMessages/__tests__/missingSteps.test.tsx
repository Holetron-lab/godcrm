import { describe, it, expect, vi } from 'vitest';
import { renderHook, screen } from '@testing-library/react';
import { renderWithProviders } from '@/tests/renderWithProviders';
import { liftForeignStepGroups } from '../../../../../utils/groupMessagesIntoTurns';
import type { ChatMessage } from '../../../../../types';
import { useStepGroups } from '../ChatTurn/useStepGroups';
import { TurnBody } from '../ChatTurn/TurnBody';

vi.mock('@/shared/components/MarkdownPreview', () => ({ MarkdownPreview: ({ content }: { content: string }) => <div>{content}</div> }));
const group = { type: 'thinking' as const, first_id: 2, last_id: 4, count: 2, preview: 'Earlier reasoning', agent_id: 7 };
const anchor: ChatMessage & { _step_groups_after: typeof group[] } = {
  id: '1', role: 'user', content: 'Go', timestamp: new Date(), _step_groups_after: [group],
};
const step = (id: string, content = 'New reasoning'): ChatMessage => ({
  id, content, role: 'assistant', contentType: 'thinking', timestamp: new Date(), metadata: { agent_row_id: 7 },
});
const annotations = (messages: ChatMessage[]) => messages.flatMap(m =>
  (m as ChatMessage & { _step_groups_after?: typeof group[] })._step_groups_after ?? []);

describe('steps retained while history and polling coexist', () => {
  it('keeps history when a newer step arrives outside its ID range', () => {
    expect(annotations(liftForeignStepGroups([anchor, step('8')]))).toEqual([group]);
  });
  it('keeps partially loaded groups until all their steps are present', () => {
    expect(annotations(liftForeignStepGroups([anchor, step('2')]))).toEqual([group]);
    expect(annotations(liftForeignStepGroups([anchor, step('2'), step('4')]))).toEqual([]);
  });
  it('does not let another agent invalidate a history group', () => {
    const other = { ...step('3'), metadata: { agent_row_id: 9 } };
    expect(annotations(liftForeignStepGroups([anchor, other]))).toEqual([group]);
  });
  it('reads after-groups from a carrier even after more messages join the bubble', () => {
    const carrier = { ...step('1'), contentType: 'agent_status' as const, _step_groups_after: [group], _total_hidden_after: 2 };
    const { result } = renderHook(() => useStepGroups([carrier, step('8')], { isProcessing: true, isLastTurn: true }));
    expect(result.current.allStepGroups).toHaveLength(1);
    expect(result.current.totalHiddenSteps).toBe(2);
  });
  it('renders both history and new inline steps, without repeating a covered step', () => {
    const carrier = { ...step('1'), contentType: 'agent_status' as const, _step_groups_after: [group] };
    renderWithProviders(<TurnBody messages={[carrier, step('2', 'Earlier reasoning'), step('8')]} turnType="agent" isProcessing markdownEnabled />);
    expect(screen.getAllByText('Earlier reasoning')).toHaveLength(1);
    expect(screen.getByText('New reasoning')).toBeInTheDocument();
  });
});
