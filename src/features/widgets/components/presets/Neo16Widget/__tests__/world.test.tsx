import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWorld } from '../town/useWorld';
import type { WorldTransport, WorldView } from '../town/types';
import { Neo16ApiError } from '../learning/types';

const view = (version = 8): WorldView => ({
  world_id: 17, state_version: version, simulated_at: 1000, learner_player_id: 'p:42', npcs: [],
  snapshot: { worldMap: { width: 2, height: 2, tileDim: 32, bgTiles: [[[0, 0], [0, 0]]], objectTiles: [[[-1, -1], [-1, 1]]] },
    playerDescriptions: [], world: { players: [{ id: 'p:42', position: { x: 0, y: 0 }, facing: { dx: 1, dy: 0 }, speed: 0 }], agents: [] } },
});
function server(): WorldTransport {
  return { enter: vi.fn(async () => view()), read: vi.fn(async () => view(10)),
    command: vi.fn<WorldTransport['command']>(async (_id, env) => ({ status: 'applied', request_id: env.request_id, world: view(9) })) };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('learner world synchronization', () => {
  it('uses world version and server learner identity; serializes movement', async () => {
    const transport = server();
    const { result } = renderHook(() => useWorld(42, transport));
    await waitFor(() => expect(result.current.world?.learner_player_id).toBe('p:42'));
    await act(async () => { await Promise.all([result.current.move({ x: 1, y: 0 }), result.current.move({ x: 0, y: 1 })]); });
    expect(transport.command).toHaveBeenCalledTimes(1);
    expect(transport.command).toHaveBeenCalledWith(17, expect.objectContaining({ widget_id: 42, expected_version: 8,
      command: 'move', payload: { destination: { x: 1, y: 0 } } }));
  });
  it('reconciles conflicts without replaying the old move', async () => {
    const transport = server();
    transport.command = vi.fn(async () => { throw new Neo16ApiError(409, 'VERSION_CONFLICT', 'conflict'); });
    const { result } = renderHook(() => useWorld(42, transport));
    await waitFor(() => expect(result.current.world).not.toBeNull());
    await act(async () => { await result.current.move({ x: 1, y: 0 }); });
    expect(transport.command).toHaveBeenCalledTimes(1);
    expect(transport.read).toHaveBeenCalledWith(17, 42);
    expect(result.current.world?.state_version).toBe(10);
    expect(result.current.notice).toMatch(/another tab/i);
  });
  it('keeps the receipt after a network failure and retries exactly the same envelope', async () => {
    const transport = server();
    const command = vi.fn<WorldTransport['command']>().mockRejectedValueOnce(new TypeError('offline'))
      .mockImplementation(async (_id, env) => ({ status: 'duplicate', request_id: env.request_id, world: view(7) }));
    transport.command = command;
    const { result } = renderHook(() => useWorld(42, transport));
    await waitFor(() => expect(result.current.world).not.toBeNull());
    await act(async () => { await result.current.move({ x: 1, y: 0 }); });
    expect(result.current.pending).toBe(true);
    await act(async () => { await result.current.retry(); });
    expect(command.mock.calls[1]).toEqual(command.mock.calls[0]);
    expect(result.current.world?.state_version).toBe(8);
  });
  it('heartbeats only while visible and stops on unmount', async () => {
    vi.useFakeTimers();
    const transport = server();
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const { unmount } = renderHook(() => useWorld(42, transport));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(transport.command).not.toHaveBeenCalled();
    visibility.mockReturnValue('visible');
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(transport.command).toHaveBeenCalledTimes(1);
    expect(transport.command).toHaveBeenCalledWith(17, expect.objectContaining({ command: 'heartbeat' }));
    unmount();
    await vi.advanceTimersByTimeAsync(2000);
    expect(transport.command).toHaveBeenCalledTimes(1);
  });
});
