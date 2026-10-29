import { useEffect, useId, useState, type CSSProperties, type Ref } from 'react';

interface CaptionedMediaProps {
  src?: string;
  kind: 'audio' | 'video';
  audioRef?: Ref<HTMLAudioElement>;
  controls?: boolean;
  className?: string;
  containerClassName?: string;
  style?: CSSProperties;
  preload?: 'none' | 'metadata' | 'auto';
  ariaLabel?: string;
  playsInline?: boolean;
  onError?: () => void;
}

/** User-provided captions stay in this viewing session; nothing is uploaded. */
export function CaptionedMedia({ src, kind, audioRef, controls = true, className, containerClassName = '', style, preload, ariaLabel, playsInline, onError }: CaptionedMediaProps) {
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [captions, setCaptions] = useState<{ url: string; text: string } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setCaptions(null);
    setError('');
    setLoading(false);
    if (!file) return;
    let cancelled = false;
    let url: string | undefined;
    setLoading(true);
    file.text().then(text => {
      if (cancelled) return;
      if (!/^\uFEFF?WEBVTT(?:[ \t].*)?(?:\r?\n|$)/.test(text)) {
        setError('Нужен файл субтитров в формате WebVTT (.vtt).');
        return;
      }
      url = URL.createObjectURL(new Blob([text], { type: 'text/vtt' }));
      setCaptions({ url, text });
    }).catch(() => {
      if (!cancelled) setError('Не удалось прочитать субтитры. Выберите файл ещё раз.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [file]);

  return (
    <div className={`min-w-0 max-w-full ${containerClassName}`}>
      {kind === 'video' ? (
        <video src={src} controls={controls} className={className} style={style} preload={preload}
          aria-label={ariaLabel} playsInline={playsInline} onError={onError}>
          <track key={captions?.url} kind="captions" src={captions?.url} label={file?.name || 'Субтитры'} default />
        </video>
      ) : (
        <audio ref={audioRef} src={src} controls={controls} className={className} style={style} preload={preload}>
          <track key={captions?.url} kind="captions" src={captions?.url} label={file?.name || 'Субтитры'} default />
        </audio>
      )}
      <details className="mt-1 text-xs text-[var(--text-secondary)]">
        <summary className="cursor-pointer">Субтитры и текст</summary>
        <label htmlFor={inputId} className="block mt-1">Выбрать локальный файл .vtt</label>
        <input id={inputId} type="file" accept=".vtt,text/vtt" className="block max-w-full"
          onChange={e => { setFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
        {loading && <p role="status">Чтение субтитров…</p>}
        {error && <p role="alert">{error}</p>}
        {!captions && !loading && !error && <p>Субтитры не выбраны. Файл остаётся в этом браузере.</p>}
        {captions && <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words">{captions.text}</pre>}
      </details>
    </div>
  );
}
