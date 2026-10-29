import { useCallback, useEffect, useRef, useState } from 'react';
import { Neo16ApiError } from '../learning/types';
import { newRequestId } from '../learning/useLearningSession';
import { worldTransport } from './transport';
import type { Position, WorldCommand, WorldTransport, WorldView } from './types';

export function useWorld(widgetId: number, transport: WorldTransport = worldTransport) {
  const [world, setWorld] = useState<WorldView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const current = useRef<WorldView | null>(null);
  const receipt = useRef<WorldCommand | null>(null);
  const locked = useRef(false);
  const generation = useRef(0);

  const accept = useCallback((next: WorldView) => {
    if (!current.current || next.state_version >= current.current.state_version) {
      current.current = next;
      setWorld(next);
    }
  }, []);

  const enter = useCallback(async () => {
    if (locked.current) return;
    const run = generation.current;
    locked.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const next = await transport.enter(widgetId);
      if (run === generation.current) accept(next);
    } catch (error) {
      if (run === generation.current) setNotice(error instanceof Error ? error.message : 'Could not enter the town.');
    } finally {
      if (run === generation.current) { locked.current = false; setBusy(false); }
    }
  }, [widgetId, transport, accept]);

  const send = useCallback(async (command: WorldCommand) => {
    const state = current.current;
    if (!state || locked.current) return;
    const run = generation.current;
    locked.current = true;
    setBusy(true);
    setNotice(null);
    receipt.current = command;
    setPending(true);
    try {
      const result = await transport.command(state.world_id, command);
      if (run !== generation.current) return;
      accept(result.world);
      receipt.current = null;
      setPending(false);
    } catch (error) {
      if (run !== generation.current) return;
      if (error instanceof Neo16ApiError && error.status < 500) {
        receipt.current = null;
        setPending(false);
        if (error.code === 'VERSION_CONFLICT') {
          try {
            const next = await transport.read(state.world_id, widgetId);
            if (run !== generation.current) return;
            accept(next);
            setNotice('The town changed in another tab. Choose your destination again.');
          } catch {
            if (run === generation.current) setNotice('Could not reload the town. Try again.');
          }
        } else setNotice(error.message);
      } else setNotice('Connection interrupted. Retry to confirm your last action.');
    } finally {
      if (run === generation.current) { locked.current = false; setBusy(false); }
    }
  }, [transport, widgetId, accept]);

  const command = useCallback(async (kind: WorldCommand['command'], destination?: Position | null) => {
    const state = current.current;
    if (!state || receipt.current || locked.current) return;
    await send({ widget_id: widgetId, request_id: newRequestId(), expected_version: state.state_version,
      command: kind, payload: kind === 'move' ? { destination } : {} });
  }, [widgetId, send]);

  useEffect(() => {
    generation.current += 1;
    locked.current = false;
    current.current = null;
    receipt.current = null;
    setWorld(null);
    setPending(false);
    void enter();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void command('heartbeat');
    }, 1000);
    return () => { generation.current += 1; window.clearInterval(timer); };
  }, [enter, command]);

  return { world, notice, busy, pending, enter,
    move: (destination: Position | null) => command('move', destination),
    retry: () => receipt.current ? send(receipt.current) : enter() };
}
