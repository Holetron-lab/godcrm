/**
 * ADR-0011 · Phase F — Verification Cell Renderer
 *
 * Renders a `verification` column JSONB value as:
 *  - compact inline badge (✓ Верифицировано · Xд назад / ✗ Отклонено / —)
 *  - on click: popover with full audit_log timeline, methods and jti
 */

import * as Popover from '@radix-ui/react-popover';
import { Check, X, ShieldCheck, ShieldAlert } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext';

interface VerificationTransition {
  column: string;
  from: unknown;
  to: unknown;
}

interface VerificationAuditEntry {
  at: string;
  actor: number;
  event: 'verified' | 'unverified';
  reason: string | null;
  transition?: VerificationTransition | null;
}

interface VerificationMethod {
  method: string;
  at: string;
  code_hash?: string;
}

interface VerificationCellValue {
  verified: boolean;
  verified_at: string | null;
  verified_by_user_id: number | null;
  methods_used: VerificationMethod[];
  jti: string | null;
  audit_log: VerificationAuditEntry[];
}

interface VerificationCellProps {
  value: unknown;
  rawMode?: boolean;
}

function parseValue(value: unknown): VerificationCellValue | null {
  if (value === null || value === undefined || value === '') return null;

  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const v = parsed as Partial<VerificationCellValue>;
  return {
    verified: Boolean(v.verified),
    verified_at: typeof v.verified_at === 'string' ? v.verified_at : null,
    verified_by_user_id: typeof v.verified_by_user_id === 'number' ? v.verified_by_user_id : null,
    methods_used: Array.isArray(v.methods_used) ? v.methods_used : [],
    jti: typeof v.jti === 'string' ? v.jti : null,
    audit_log: Array.isArray(v.audit_log) ? v.audit_log : [],
  };
}

function formatTransitionValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '∅';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function safeFullDate(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    // Locale-formatted `DD.MM.YYYY HH:mm` — compact enough for the inline badge
    // and stable (no live-ticking "X minutes ago" that goes stale, per user feedback).
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export const VerificationCell = ({ value, rawMode }: VerificationCellProps) => {
  const { language } = useLanguage();
  const data = parseValue(value);

  if (rawMode) {
    if (value === null || value === undefined || value === '') {
      return <span className="font-mono text-xs text-[var(--text-secondary)]">NULL</span>;
    }
    const raw = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return (
      <span className="font-mono text-xs text-[var(--text-secondary)] truncate max-w-[240px]" title={raw}>
        {raw}
      </span>
    );
  }

  const isPristine = !data || data.audit_log.length === 0;
  const isVerified = Boolean(data?.verified);
  const lastEventAt =
    data?.verified_at ?? data?.audit_log?.[data.audit_log.length - 1]?.at ?? null;
  const absoluteAt = safeFullDate(lastEventAt);
  const eventCount = data?.audit_log.length ?? 0;

  if (isPristine) {
    return <span className="text-[var(--text-secondary)]">—</span>;
  }

  const accent = isVerified
    ? { color: '#22c55e', bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.35)' }
    : { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.35)' };

  const label = isVerified
    ? (language === 'ru' ? 'Верифицировано' : 'Verified')
    : (language === 'ru' ? 'Отклонено' : 'Unverified');

  const eventsWord = language === 'ru' ? 'событий' : 'events';

  const reverseLog = data ? [...data.audit_log].reverse() : [];

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
          }}
          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium cursor-pointer hover:opacity-90 transition"
          style={{
            backgroundColor: accent.bg,
            color: 'var(--text-primary)',
            border: `1px solid ${accent.border}`,
          }}
          title={label}
        >
          {isVerified ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
          <span>{label}</span>
          {absoluteAt && (
            <span className="font-normal">· {absoluteAt}</span>
          )}
          {eventCount > 1 && (
            <span className="font-normal">· {eventCount} {eventsWord}</span>
          )}
        </button>
      </Popover.Trigger>

      {data && <Popover.Portal>
        <Popover.Content
          aria-label={language === 'ru' ? 'История верификации' : 'Verification history'}
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className="z-[1000] w-[360px] max-w-[calc(100vw-16px)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto rounded-xl shadow-2xl border border-[var(--border-primary)] bg-[var(--bg-primary)]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-3 py-2.5 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
            <div className="flex items-center gap-2 mb-1.5">
              {isVerified
                ? <ShieldCheck className="w-4 h-4" style={{ color: accent.color }} />
                : <ShieldAlert className="w-4 h-4" style={{ color: accent.color }} />}
              <span
                className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                style={{
                  backgroundColor: accent.bg,
                  color: 'var(--text-primary)',
                  border: `1px solid ${accent.border}`,
                }}
              >
                {label}
              </span>
              {data.verified_by_user_id !== null && (
                <span className="text-xs text-[var(--text-secondary)]">
                  User #{data.verified_by_user_id}
                </span>
              )}
            </div>
            {data.verified_at && (
              <div className="text-[11px] text-[var(--text-secondary)]">
                {safeFullDate(data.verified_at)}
              </div>
            )}
            {data.methods_used.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {data.methods_used.map((m, i) => (
                  <span
                    key={`${m.method}-${i}`}
                    className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-primary)]"
                    title={m.code_hash ? `${m.method} · ${safeFullDate(m.at)}` : safeFullDate(m.at)}
                  >
                    {m.method}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Timeline */}
          <div className="max-h-[260px] overflow-y-auto px-3 py-2">
            {reverseLog.length === 0 ? (
              <div className="text-xs text-[var(--text-secondary)] italic py-2 text-center">
                {language === 'ru' ? 'Нет событий' : 'No events'}
              </div>
            ) : (
              <ul className="space-y-2">
                {reverseLog.map((entry, idx) => {
                  const ok = entry.event === 'verified';
                  const c = ok ? '#22c55e' : '#f59e0b';
                  return (
                    <li key={`${entry.at}-${idx}`} className="flex gap-2 text-xs">
                      <span
                        className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center mt-0.5"
                        style={{ backgroundColor: `${c}20`, color: c }}
                      >
                        {ok ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="font-medium text-[var(--text-primary)]">
                            User #{entry.actor}
                          </span>
                          <span className="text-[var(--text-secondary)] text-[11px]">
                            {safeFullDate(entry.at)}
                          </span>
                        </div>
                        {entry.transition && entry.transition.column && (
                          <div className="mt-0.5 text-[var(--text-secondary)] break-words">
                            <span className="font-mono text-[11px]">{entry.transition.column}</span>
                            {': '}
                            <code className="px-1 rounded bg-[var(--bg-tertiary)] text-[11px]">
                              {formatTransitionValue(entry.transition.from)}
                            </code>
                            <span className="mx-1 opacity-60">→</span>
                            <code className="px-1 rounded bg-[var(--bg-tertiary)] text-[11px]">
                              {formatTransitionValue(entry.transition.to)}
                            </code>
                          </div>
                        )}
                        {entry.reason && (
                          <div className="italic text-[var(--text-secondary)] mt-0.5 break-words">
                            {entry.reason}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Footer */}
          {data.jti && (
            <div className="px-3 py-2 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)]">
              <div className="text-[10px] text-[var(--text-secondary)] uppercase tracking-wide mb-0.5">jti</div>
              <div className="font-mono text-[10px] text-[var(--text-secondary)] break-all select-all">
                {data.jti}
              </div>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>}
    </Popover.Root>
  );
};
