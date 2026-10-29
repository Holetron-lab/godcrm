import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LearningPanel } from '../learning/LearningPanel';
import type { Neo16Transport, SessionState } from '../learning/types';

afterEach(() => sessionStorage.clear());
it('restores a completed session after reload and selects the NPC chosen on the map', async () => {
  const state: SessionState = {
    session: { id: 11, status: 'active', state_version: 2, goals_done: [], quest_key: 'arrange_meeting', content_version: 1 },
    quest: { id: 1, key: 'arrange_meeting', version: 1, title: 'Meeting', npcs: [
      { key: 'nora', name: 'Nora', role: 'Host' }, { key: 'reed', name: 'Reed', role: 'Scientist' }], goals: [] },
    turns: [], progress: { id: 4, status: 'in_progress', xp: 0 },
  };
  const transport: Neo16Transport = {
    startSession: vi.fn(async () => ({ status: 201, body: { session_id: 11, world_id: 7, resumed: false, progress_id: 4, state } })),
    getState: vi.fn<Neo16Transport['getState']>(async () => ({ ...state, session: { ...state.session, status: 'completed' }, progress: { id: 4, status: 'completed', xp: 50 } })),
    sendCommand: vi.fn<Neo16Transport['sendCommand']>(async () => ({ status: 409, body: { status: 'stale', turn: { id: 1, processing_status: 'applied' } } })),
  };
  const first = render(<LearningPanel widgetId={71} transport={transport} restoreSession selectedNpcKey="reed" />);
  await waitFor(() => expect(screen.getByLabelText('Talk to')).toHaveValue('reed'));
  fireEvent.change(screen.getByLabelText('Your message'), { target: { value: 'Hello' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(transport.sendCommand).toHaveBeenCalledWith(11, expect.objectContaining({ expected_version: 2, payload: { npc_key: 'reed', text: 'Hello' } })));
  first.unmount();
  render(<LearningPanel widgetId={71} transport={transport} restoreSession />);
  await waitFor(() => expect(screen.getByTestId('session-status')).toHaveTextContent('completed'));
  expect(screen.getByTestId('xp')).toHaveTextContent('50 XP');
  expect(transport.startSession).toHaveBeenCalledTimes(1);
});
