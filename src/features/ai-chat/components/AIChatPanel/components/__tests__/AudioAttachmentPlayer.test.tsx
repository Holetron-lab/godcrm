import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { AudioAttachmentPlayer } from '../AudioAttachmentPlayer';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

it('decodes the actual audio envelope, seeks and releases the decoder', async () => {
  localStorage.setItem('god-crm-language', 'en');
  const close = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('AudioContext', class {
    state = 'running';
    decodeAudioData = vi.fn().mockResolvedValue({ duration: 8, numberOfChannels: 1, length: 8,
      getChannelData: () => new Float32Array([0, 0.1, 0.2, 0.1, 0, 0.05, 0.1, 0]) });
    close = close;
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
  const { container, unmount } = render(<LanguageProvider><AudioAttachmentPlayer src="/voice.wav" name="voice.wav" /></LanguageProvider>);
  const slider = screen.getByRole('slider');
  await waitFor(() => expect(slider).toBeEnabled());
  expect(container.querySelectorAll('polyline').length).toBeGreaterThanOrEqual(2);
  expect(container.querySelector('polyline')?.getAttribute('points')).toContain(',');
  fireEvent.change(slider, { target: { value: '4' } });
  expect(container.querySelector('audio')!.currentTime).toBe(4);
  expect(slider).toHaveValue('4');
  fireEvent.timeUpdate(container.querySelector('audio')!, { target: { currentTime: 6 } });
  expect(slider).toHaveValue('6');
  expect(container.querySelector('audio')).not.toHaveAttribute('controls');
  unmount();
  expect(close).toHaveBeenCalledOnce();
});

it('keeps playback and seeking available when waveform decoding fails', async () => {
  vi.stubGlobal('AudioContext', class {});
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  const { container } = render(<LanguageProvider><AudioAttachmentPlayer src="/voice.wav" name="voice.wav" /></LanguageProvider>);
  const audio = container.querySelector('audio')!;
  Object.defineProperty(audio, 'duration', { value: 12 });
  fireEvent.loadedMetadata(audio);
  expect(screen.getByRole('slider')).toBeEnabled();
  fireEvent.error(audio);
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Audio options|Настройки аудио/ }));
  expect(screen.getByRole('link')).toHaveAttribute('download', 'voice.wav');
});

it('offers volume, speed and download in the sent audio options', async () => {
  localStorage.setItem('god-crm-language', 'en');
  const { container } = render(<LanguageProvider><AudioAttachmentPlayer src="/voice.wav" name="voice.wav" /></LanguageProvider>);
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Audio options' }));
  fireEvent.change(screen.getByRole('slider', { name: 'Volume' }), { target: { value: '0.4' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Playback speed' }), { target: { value: '1.5' } });
  const audio = container.querySelector('audio')!;
  expect(audio.volume).toBe(0.4);
  expect(audio.playbackRate).toBe(1.5);
  expect(screen.getByRole('link', { name: 'Download voice.wav' })).toHaveAttribute('href', '/voice.wav');
  expect(screen.getByRole('link')).toHaveAttribute('download', 'voice.wav');
  fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Audio options' })).toHaveFocus();
});

it('does not offer playback options in the draft', () => {
  localStorage.setItem('god-crm-language', 'en');
  render(<LanguageProvider><AudioAttachmentPlayer src="/voice.wav" name="voice.wav" onRemove={vi.fn()} /></LanguageProvider>);
  expect(screen.queryByRole('button', { name: 'Audio options' })).not.toBeInTheDocument();
  expect(screen.queryByRole('slider', { name: 'Volume' })).not.toBeInTheDocument();
  expect(screen.getByRole('link')).toHaveAttribute('download', 'voice.wav');
});
