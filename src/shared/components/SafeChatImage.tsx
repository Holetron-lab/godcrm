import { useState, memo, type CSSProperties } from 'react';
import { ImageOff } from 'lucide-react';

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
  onClick?: () => void;
  /** Optional explicit fallback label for the oversized-data-url placeholder. */
  placeholderLabel?: string;
}

function SafeChatImageImpl({ src, alt, className, style, onClick, placeholderLabel }: SafeChatImageProps) {
  const oversized = isOversizedDataUrl(src);
  const [revealed, setRevealed] = useState(false);
  const [failed, setFailed] = useState(false);

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

  if (failed) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs text-[var(--text-tertiary)] ${className ?? ''}`}
        title={alt}
      >
        <ImageOff className="w-3.5 h-3.5 opacity-60" />
        <span>{alt || 'Image failed to load'}</span>
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={alt || ''}
      loading="lazy"
      decoding="async"
      className={className}
      style={style}
      onClick={onClick}
      onError={() => setFailed(true)}
    />
  );
}

export const SafeChatImage = memo(SafeChatImageImpl);
