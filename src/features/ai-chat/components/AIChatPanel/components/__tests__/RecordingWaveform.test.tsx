import { render, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RecordingWaveform } from '../RecordingWaveform';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('draws live signal with the latest sample at the right edge and releases audio resources', () => {
  vi.useFakeTimers();
  const disconnect = vi.fn(); const close = vi.fn().mockResolvedValue(undefined);
  const analyser = { fftSize: 0, getByteTimeDomainData: (buffer: Uint8Array) => buffer.fill(160) };
  vi.stubGlobal('AudioContext', class {
    state = 'running';
    createAnalyser = () => analyser;
    createMediaStreamSource = () => ({ connect: vi.fn(), disconnect });
    resume = vi.fn().mockResolvedValue(undefined);
    close = close;
  });
  const drawing = { scale: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn() };
  // Select the 2D overload so Vitest does not infer the WebGPU overload.
  const canvas: { getContext(contextId: '2d'): CanvasRenderingContext2D | null } = HTMLCanvasElement.prototype;
  vi.spyOn(canvas, 'getContext').mockReturnValue(drawing as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'clientWidth', 'get').mockReturnValue(200);
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
  const { unmount } = render(<RecordingWaveform stream={stream} />);
  vi.advanceTimersByTime(1000);
  // Two continuous mirrored contours per frame, never one stroke per sample.
  expect(drawing.moveTo).toHaveBeenCalledTimes(20);
  expect(drawing.moveTo).toHaveBeenLastCalledWith(1, 23);
  expect(drawing.lineTo).toHaveBeenLastCalledWith(199, 23);
  expect(drawing.stroke).toHaveBeenCalledTimes(10);
  unmount();
  expect(disconnect).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
  expect(stop).not.toHaveBeenCalled(); // Recorder owns the shared microphone stream.
  vi.advanceTimersByTime(1000);
  expect(drawing.stroke).toHaveBeenCalledTimes(10);
});
