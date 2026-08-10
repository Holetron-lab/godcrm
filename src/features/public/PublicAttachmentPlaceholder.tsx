/**
 * PublicAttachmentPlaceholder — non-fetching stand-in for file/image cells
 * inside a public-surface render tree (ADR-0060 AC13).
 *
 * Public read-only viewers cannot resolve authenticated `/uploads/*` URLs,
 * and signed-URL delivery is explicitly deferred to a follow-up ticket.
 * Until then, render an icon + best-effort filename so the viewer sees
 * that *some* attachment exists, without firing a network request that
 * would 401 (and pollute the console).
 */

import { FileText, Image as ImageIcon, Paperclip } from 'lucide-react';

type AttachmentVariant = 'image' | 'file' | 'attachment';

interface PublicAttachmentPlaceholderProps {
  /** Raw cell value — string URL, comma-joined URLs, or object with name/url. */
  value: unknown;
  variant?: AttachmentVariant;
  className?: string;
}

function extractFilename(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return 'file';
  const last = trimmed.split(/[\\/]/).pop() ?? trimmed;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

function resolveLabel(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string') {
    const first = value.split(',')[0];
    return extractFilename(first);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '—';
    return resolveLabel(value[0]);
  }
  if (typeof value === 'object') {
    const obj = value as { name?: string; filename?: string; url?: string };
    return obj.name ?? obj.filename ?? (obj.url ? extractFilename(obj.url) : '—');
  }
  return String(value);
}

export function PublicAttachmentPlaceholder({
  value,
  variant = 'attachment',
  className = '',
}: PublicAttachmentPlaceholderProps) {
  const label = resolveLabel(value);
  if (label === '—') {
    return <span className={`text-[var(--text-tertiary)] ${className}`.trim()}>—</span>;
  }

  const Icon =
    variant === 'image' ? ImageIcon : variant === 'file' ? FileText : Paperclip;

  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-xs text-[var(--text-secondary)] ${className}`.trim()}
      title={label}
    >
      <Icon className="h-3.5 w-3.5 flex-shrink-0 text-[var(--text-tertiary)]" aria-hidden />
      <span className="truncate">{label}</span>
    </span>
  );
}
