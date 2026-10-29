import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/tests/renderWithProviders';
import type { ChatMessage } from '../../../../../types';
import type { StepGroup } from '../ChatTurn/types';
import { useStepGroups } from '../ChatTurn/useStepGroups';
import { TurnBody } from '../ChatTurn/TurnBody';

vi.mock('@/shared/components/MarkdownPreview', () => ({ MarkdownPreview: ({ content }: { content: string }) => <div>{content}</div> }));
const tools = (first: number, last = first): StepGroup => ({ type: 'tools', first_id: first, last_id: last, count: last - first + 1, agent_id: 7 });
const carrier = (groups: StepGroup[]): ChatMessage => ({ id: '1000', role: 'assistant', content: '', contentType: 'agent_status', timestamp: new Date(), _step_groups_before: groups } as ChatMessage);
const call = (id: number, tool: string): ChatMessage => ({ id: String(id), role: 'assistant', contentType: 'tool_call', content: JSON.stringify({ tool, input: {} }), timestamp: new Date() });
const resultMessage = (id: number): ChatMessage => ({ id: String(id), role: 'tool', contentType: 'tool_result', content: 'Done', timestamp: new Date() });

it('joins consecutive same-agent tool fragments and pairs a call/result across fragments', async () => {
  const fetchToolStepsPreview = vi.fn().mockImplementation(async (after: number) => after === 9 ? [call(10, 'Read')] : [resultMessage(20)]);
  const { result } = renderHook(() => useStepGroups([carrier([tools(10), tools(20)])], { isProcessing: false, isLastTurn: false, fetchToolStepsPreview }));
  expect(result.current.allStepGroups).toHaveLength(1);
  await act(() => result.current.handleLoadGroup(result.current.allStepGroups[0]));
  const key = result.current.allStepGroups[0]._groupIdx;
  expect(result.current.loadedGroupSteps[key]).toHaveLength(1);
  expect(result.current.loadedGroupSteps[key][0]).toMatchObject({ toolName: 'Read', result: 'Done', resultMessageId: 20 });
  // Request original ranges only, never the interleaved foreign-agent gap.
  expect(fetchToolStepsPreview.mock.calls).toEqual([[9, 11], [19, 21]]);
});

it('preserves reasoning and different-agent boundaries', () => {
  const thinking: StepGroup = { ...tools(15), type: 'thinking', preview: 'Reasoning' };
  const { result } = renderHook(() => useStepGroups([carrier([tools(10), thinking, tools(20), { ...tools(30), agent_id: 8 }])], { isProcessing: false, isLastTurn: false }));
  expect(result.current.allStepGroups).toHaveLength(4);
});

it('does not attach loaded data to a different group after earlier history is inserted', async () => {
  const fetchToolStepsPreview = vi.fn().mockResolvedValue([call(20, 'Read')]);
  const { result, rerender } = renderHook(({ groups }) => useStepGroups([carrier(groups)], { isProcessing: false, isLastTurn: false, fetchToolStepsPreview }), { initialProps: { groups: [tools(20)] } });
  await act(() => result.current.handleLoadGroup(result.current.allStepGroups[0]));
  rerender({ groups: [{ ...tools(10), type: 'thinking', preview: 'Earlier' }, tools(20)] });
  expect(result.current.loadedGroupSteps[result.current.allStepGroups[0]._groupIdx]).toBeUndefined();
  expect(result.current.loadedGroupSteps[result.current.allStepGroups[1]._groupIdx]?.[0]).toMatchObject({ toolName: 'Read' });
});

it('reloads a group whose range grows during polling', async () => {
  const fetchToolStepsPreview = vi.fn().mockResolvedValueOnce([call(20, 'Read')]).mockResolvedValueOnce([call(20, 'Read'), resultMessage(21)]);
  const { result, rerender } = renderHook(({ groups }) => useStepGroups([carrier(groups)], { isProcessing: true, isLastTurn: true, fetchToolStepsPreview }), { initialProps: { groups: [tools(20)] } });
  await act(() => result.current.handleLoadGroup(result.current.allStepGroups[0]));
  rerender({ groups: [tools(20, 21)] });
  await act(() => result.current.handleLoadGroup(result.current.allStepGroups[0]));
  expect(fetchToolStepsPreview).toHaveBeenCalledTimes(2);
  expect(result.current.loadedGroupSteps[result.current.allStepGroups[0]._groupIdx]?.[0]).toMatchObject({ result: 'Done' });
});

it('shows a retry instead of an empty expanded accordion after an empty response', async () => {
  const fetchToolStepsPreview = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([call(20, 'Read')]);
  renderWithProviders(<TurnBody messages={[carrier([tools(20)])]} turnType="agent" isProcessing markdownEnabled fetchToolStepsPreview={fetchToolStepsPreview} />);
  fireEvent.click(screen.getByRole('button', { name: /инструмент/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить шаги');
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
  await waitFor(() => expect(screen.getByText('Read')).toBeInTheDocument());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('keeps a polling tool in the gap between retained source ranges visible', async () => {
  renderWithProviders(<TurnBody messages={[carrier([tools(10), tools(20)]), call(15, 'Grep'), resultMessage(16)]} turnType="agent" isProcessing markdownEnabled />);
  const toggles = screen.getAllByRole('button', { name: /инструмент/i });
  expect(toggles).toHaveLength(2);
  fireEvent.click(toggles[1]);
  expect(screen.getByText('Grep')).toBeInTheDocument();
});
