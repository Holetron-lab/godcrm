import { useEffect, useState, memo, type CSSProperties } from 'react';
import { ImageOff } from 'lucide-react';
import { apiClient } from '@/shared/utils/apiClient';

const LARGE_DATA_URL_BYTES = 256 * 1024;

function isOversizedDataUrl(src?: string): boolean {
  if (!src) return false;
  if (!src.startsWith('data:')) return false;
  return src.length > LARGE_DATA_URL_BYTES;
}

interface SafeChatImageProps {
  src?: string;
  alt?: string;
  className?: string;
  style?: CSSProperties;
  draggable?: boolean;
  onClick?: () => void;
  /** Optional explicit fallback label for the oversized-data-url placeholder. */
  placeholderLabel?: string;
}

function SafeChatImageImpl({ src, alt, className, style, draggable, onClick, placeholderLabel }: SafeChatImageProps) {
  const oversized = isOversizedDataUrl(src);
  const [revealed, setRevealed] = useState(false);
  const [failed, setFailed] = useState(false);
  const [recoveredSrc, setRecoveredSrc] = useState<string>();
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    if (!failed || !src) return;
    const token = apiClient.getAccessToken();
    if (!token) return;
    let url: URL;
    try { url = new URL(src, window.location.href); } catch { return; }
    // Native images cannot send the API bearer token when the cookie is missing.
    // Restrict the fallback to our file mounts; never forward credentials off-site.
    // Mail attachment bytes are served under the API (ADR-158 §P5 download endpoint).
    const ownMount =
      /^\/(uploads|downloads)\//.test(url.pathname) ||
      /^\/api\/v3\/spaces\/\d+\/mail\/messages\/\d+\/attachments\//.test(url.pathname);
    if (url.origin !== window.location.origin || !ownMount) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setRecovering(true);
    void fetch(url.href, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'same-origin', redirect: 'error', signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) return;
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setRecoveredSrc(objectUrl);
    }).catch(() => {
      // Keep the retry action on network or authorization failure.
    }).finally(() => {
      if (!controller.signal.aborted) setRecovering(false);
    });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [failed, src]);

  if (!src) return null;

  if (oversized && !revealed) {
    const sizeMb = (src.length / (1024 * 1024)).toFixed(1);
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setRevealed(true); }}
        className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-[var(--border-primary)] bg-black/10 text-xs text-[var(--text-secondary)] hover:bg-black/20 ${className ?? ''}`}
        style={style}
        title={alt || placeholderLabel || 'Inline image'}
      >
        <ImageOff className="w-4 h-4 opacity-70" />
        <span>
          {placeholderLabel || alt || 'Image'} · {sizeMb} MB inline — tap to load
        </span>
      </button>
    );
  }

  if (failed && !recoveredSrc) {
    return (
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); setFailed(false); }}
        disabled={recovering}
        aria-busy={recovering}
        aria-label={`Повторить загрузку: ${alt || 'изображение'}`}
        className={`relative z-10 inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs text-[var(--text-tertiary)] ${className ?? ''}`}
        title="Повторить загрузку изображения"
      >
        <ImageOff className="w-3.5 h-3.5 opacity-60" />
        <span>{alt || 'Не удалось загрузить изображение'} · {recovering ? 'Загрузка…' : 'Повторить'}</span>
      </button>
    );
  }

  const image = (
    <img
      src={recoveredSrc || src}
      alt={alt || ''}
      loading="lazy"
      decoding="async"
      className={className}
      style={style}
      draggable={draggable}
      onError={() => { setRecoveredSrc(undefined); setFailed(true); }}
    />
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="inline-block max-w-full" aria-label={alt || 'Открыть изображение'}>
      {image}
    </button>
  ) : image;
}

export const SafeChatImage = memo(function SafeChatImage(props: SafeChatImageProps) {
  return <SafeChatImageImpl key={props.src} {...props} />;
});
