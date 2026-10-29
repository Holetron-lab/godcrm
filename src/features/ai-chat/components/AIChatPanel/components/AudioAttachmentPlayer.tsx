import { useEffect, useRef, useState } from 'react';
import { Download, MoreHorizontal, Pause, Play, X } from 'lucide-react';
import { apiClient } from '@/shared/utils/apiClient';
import { Popover } from '@/shared/components/ui/Popover';
import { useLanguage } from '@/shared/i18n/LanguageContext';

const formatTime = (value: number) => `${Math.floor(value / 60)}:${Math.floor(value % 60).toString().padStart(2, '0')}`;

export function AudioAttachmentPlayer({ src, name, recordedDuration = 0, onRemove }: {
  src: string; name: string; recordedDuration?: number; onRemove?: () => void;
}) {
  const { t } = useLanguage();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [volume, setVolume] = useState(1);
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(recordedDuration);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);

  let protectedUrl: string | undefined;
  try {
    const url = new URL(src, window.location.href);
    if (url.origin === window.location.origin && /^\/(uploads|downloads)\//.test(url.pathname)) protectedUrl = url.href;
  } catch { /* Keep native media handling for invalid sources. */ }
  const [resolved, setResolved] = useState<{ source: string; url: string }>();
  const [retry, setRetry] = useState(0);
  const playbackSrc = protectedUrl ? (resolved?.source === src ? resolved.url : undefined) : src;

  useEffect(() => {
    const controller = new AbortController();
    let context: AudioContext | undefined;
    let objectUrl: string | undefined;
    setPlaying(false); setFailed(false); setTime(0); setDuration(recordedDuration); setPeaks([]); setLoading(true);
    const decode = async () => {
      try {
        if (!src || (!protectedUrl && typeof AudioContext === 'undefined')) return;
        const token = protectedUrl ? apiClient.getAccessToken() : null;
        const response = await fetch(protectedUrl || src, {
          signal: controller.signal,
          ...(protectedUrl ? {
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
            credentials: 'same-origin' as const, redirect: 'error' as const,
          } : {}),
        });
        if (!response.ok) throw new Error('Audio fetch failed');
        let bytes: ArrayBuffer;
        if (protectedUrl) {
          const blob = await response.blob();
          if (controller.signal.aborted) return;
          objectUrl = URL.createObjectURL(blob);
          setResolved({ source: src, url: objectUrl });
          if (typeof AudioContext === 'undefined') return;
          bytes = await blob.arrayBuffer();
        } else bytes = await response.arrayBuffer();
        if (controller.signal.aborted) return;
        context = new AudioContext();
        const audio = await context.decodeAudioData(bytes);
        if (controller.signal.aborted) return;
        // RMS envelope matches the live recording meter; reduce long recordings to 256 points.
        const count = Math.max(2, Math.min(256, Math.ceil(audio.duration * 10), audio.length));
        const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
        const envelope = Array.from({ length: count }, (_, i) => {
          const start = Math.floor(i * audio.length / count);
          const end = Math.floor((i + 1) * audio.length / count);
          let sum = 0;
          for (const channel of channels) {
            for (let j = start; j < end; j++) sum += channel[j] ** 2;
          }
          return Math.min(1, 4 * Math.sqrt(sum / Math.max(1, (end - start) * channels.length)));
        });
        setPeaks(envelope);
        if (Number.isFinite(audio.duration)) setDuration(audio.duration);
      } catch {
        if (!controller.signal.aborted && protectedUrl && !objectUrl) setFailed(true);
        // Media playback can still work when Web Audio cannot decode this format.
      } finally {
        if (context && context.state !== 'closed') await context.close().catch(() => {});
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void decode();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, recordedDuration, protectedUrl, retry]);

  const length = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  const progress = length ? Math.min(100, time / length * 100) : 0;
  const envelope = peaks.length ? peaks : [0, 0];
  const contours = [-1, 1].map(direction => envelope.map((peak, i) =>
    `${i * 256 / (envelope.length - 1)},${12 + direction * Math.max(0.5, peak * 11)}`).join(' '));
  const actionClass = 'flex h-8 w-8 shrink-0 items-center justify-center rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40';

  return (
    <div className="flex w-full min-w-0 flex-wrap items-center gap-1 rounded-lg bg-[var(--bg-tertiary)] px-2 py-1 text-xs">
      <button type="button" className={actionClass} disabled={!src || (!playbackSrc && !failed)}
        aria-label={t(playing ? 'aiChat.ui.pauseAudio' : 'aiChat.ui.playAudio', { name })}
        onClick={() => {
          if (!playbackSrc && protectedUrl) { setRetry(value => value + 1); return; }
          const audio = audioRef.current;
          if (!audio) return;
          if (playing) audio.pause();
          else { setFailed(false); void audio.play().catch(() => setFailed(true)); }
        }}>
        {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>
      <span className="min-w-0 max-w-[22%] truncate text-[var(--text-primary)]" title={name}>{name}</span>
      <div className="relative mx-1 h-8 min-w-12 flex-1 rounded focus-within:ring-2 focus-within:ring-[var(--text-secondary)]"
        aria-busy={loading} title={t(loading ? 'aiChat.ui.loadingWaveform' : peaks.length ? 'aiChat.ui.seekAudio' : 'aiChat.ui.waveformUnavailable')}>
        <svg viewBox="0 0 256 24" preserveAspectRatio="none" aria-hidden="true" className="absolute inset-0 h-full w-full text-[var(--text-tertiary)]">
          {contours.map((points, i) => <polyline key={i} points={points} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />)}
        </svg>
        <svg viewBox="0 0 256 24" preserveAspectRatio="none" aria-hidden="true" className="absolute inset-0 h-full w-full text-[var(--text-primary)]" style={{ clipPath: `inset(0 ${100 - progress}% 0 0)` }}>
          {contours.map((points, i) => <polyline key={i} points={points} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />)}
        </svg>
        <span aria-hidden="true" className="pointer-events-none absolute top-1 h-6 w-px bg-[var(--text-primary)]" style={{ left: `${progress}%` }} />
        <input type="range" min="0" max={length || 1} step="0.01" value={Math.min(time, length)} disabled={!length}
          aria-label={t('aiChat.ui.seekAudio')} aria-valuetext={`${formatTime(time)} / ${formatTime(length)}`}
          className="absolute inset-0 m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
          onChange={event => {
            const value = Number(event.target.value);
            if (audioRef.current) { audioRef.current.currentTime = value; setTime(value); }
          }} />
      </div>
      <span className="shrink-0 whitespace-nowrap tabular-nums text-[var(--text-secondary)]">
        <span className="inline-block text-right" style={{ minWidth: `${formatTime(length).length}ch` }}>{formatTime(time)}</span>
        {' / '}{length ? formatTime(length) : '—:—'}
      </span>
      {onRemove ? <a href={playbackSrc || undefined} download={name} className={actionClass} aria-label={t('aiChat.ui.downloadAudio', { name })}><Download className="h-4 w-4" /></a> : (
        <Popover ariaLabel={t('aiChat.ui.audioOptions')} align="end" trigger={
          <button type="button" className={actionClass} aria-label={t('aiChat.ui.audioOptions')}><MoreHorizontal className="h-4 w-4" /></button>
        } content={
          <div className="flex flex-col gap-3 text-sm text-[var(--text-primary)]">
            <label className="flex flex-col gap-1">
              <span>{t('aiChat.ui.audioVolume')}</span>
              <input type="range" min="0" max="1" step="0.05" value={volume}
                onChange={event => {
                  const value = Number(event.target.value);
                  if (audioRef.current) audioRef.current.volume = value;
                  setVolume(value);
                }} />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span>{t('aiChat.ui.audioSpeed')}</span>
              <select value={speed} className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] p-1"
                onChange={event => {
                  const value = Number(event.target.value);
                  if (audioRef.current) audioRef.current.playbackRate = value;
                  setSpeed(value);
                }}>
                {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(value => <option key={value} value={value}>{value}×</option>)}
              </select>
            </label>
            <a href={playbackSrc || undefined} download={name} className="flex items-center gap-2 rounded py-1 hover:underline"
              aria-label={t('aiChat.ui.downloadAudio', { name })}>
              <Download className="h-4 w-4" />{t('aiChat.ui.audioDownload')}
            </a>
          </div>
        } />
      )}
      {onRemove && <button type="button" onClick={onRemove} className={actionClass} aria-label={t('aiChat.ui.removeAudio', { name })}><X className="h-4 w-4" /></button>}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- Audio attachment; transcript is rendered separately in chat. */}
      {src && <audio ref={audioRef} src={playbackSrc} preload="metadata" className="hidden" onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
        onTimeUpdate={event => setTime(event.currentTarget.currentTime)}
        onDurationChange={event => { if (Number.isFinite(event.currentTarget.duration)) setDuration(event.currentTarget.duration); }}
        onLoadedMetadata={event => { if (Number.isFinite(event.currentTarget.duration)) setDuration(event.currentTarget.duration); }}
        onError={() => { setFailed(true); setPlaying(false); }} />}
      {failed && <p role="alert" className="basis-full text-red-400">{t('aiChat.ui.audioPlaybackFailed')}</p>}
    </div>
  );
}
