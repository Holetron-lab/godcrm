import React from 'react';
import { cn } from '@/shared/utils/cn';

function hashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

function looksLikeImageUrl(s: string | null | undefined): boolean {
  if (!s) return false;
  const t = s.trim();
  return t.startsWith('/') || t.startsWith('http://') || t.startsWith('https://') || t.startsWith('data:');
}

export interface AvatarProps {
  url?: string | null;
  emoji?: string | null;
  name?: string | null;
  size?: number;
  color?: string | null;
  className?: string;
  rounded?: 'full' | 'lg' | 'md';
  title?: string;
}

export const Avatar: React.FC<AvatarProps> = ({
  url,
  emoji,
  name,
  size = 32,
  color,
  className,
  rounded = 'full',
  title,
}) => {
  const [imgFailed, setImgFailed] = React.useState(false);
  const safeUrl = looksLikeImageUrl(url) ? url : null;
  const showImg = safeUrl && !imgFailed;

  React.useEffect(() => {
    setImgFailed(false);
  }, [url]);

  const radiusCls = rounded === 'full' ? 'rounded-full' : rounded === 'lg' ? 'rounded-lg' : 'rounded-md';
  const sizeStyle: React.CSSProperties = { width: size, height: size };
  const accent = color || hashColor(name || 'user');

  if (showImg) {
    return (
      <img
        src={safeUrl!}
        alt={name || ''}
        title={title}
        style={sizeStyle}
        className={cn('object-cover flex-shrink-0', radiusCls, className)}
        onError={() => setImgFailed(true)}
      />
    );
  }

  const fontPx = Math.max(10, Math.round(size * 0.45));
  return (
    <div
      style={{ ...sizeStyle, backgroundColor: `${accent}33`, color: accent }}
      className={cn('flex items-center justify-center flex-shrink-0 select-none', radiusCls, className)}
      title={title}
      aria-label={name || undefined}
    >
      {emoji ? (
        <span style={{ fontSize: fontPx, lineHeight: 1 }}>{emoji}</span>
      ) : name && name.trim() && name !== 'AI' ? (
        <span style={{ fontSize: fontPx, lineHeight: 1, fontWeight: 600 }}>
          {name.trim().charAt(0).toUpperCase()}
        </span>
      ) : (
        <span style={{ fontSize: fontPx, lineHeight: 1 }}>👤</span>
      )}
    </div>
  );
};

export default Avatar;
