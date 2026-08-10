/**
 * RowMutationBubble — Compact pill renderer for `content_type === 'row_mutation'`
 * system messages emitted by the row-mutation event log (ADR-0031 §A).
 *
 * Render contract (ADR-0031 §X):
 *   [chip]  event text   actor • ts
 *
 *   chip — only present when `metadata.row_ref = { table_id, row_id, title?, icon? }`
 *   event text — `message.content` (templated, may include leading emoji)
 *   actor — `metadata.actor.name` (falls back to "system")
 *   ts — relative time ("2m ago" / "10:42")
 *
 * Always rendered as a single-line pill (~32px). Stack of consecutive
 * mutations renders as a vertical list with tight spacing.
 */
import React from 'react';
import { Activity, Link2 } from 'lucide-react';
import type { ChatMessage } from '../../../types';

// ── Metadata shape (loose — backend may add fields) ──────────────────
interface RowRef {
  table_id?: number;
  row_id?: number;
  title?: string;
  icon?: string;
}

interface ActorRef {
  id?: number;
  name?: string;
}

interface RowMutationMetadata {
  event_type?: string;
  row_ref?: RowRef;
  actor?: ActorRef;
  table_id?: number;
  row_id?: number;
}

const formatTs = (raw?: string | Date): string => {
  if (!raw) return '';
  const d = typeof raw === 'string' ? new Date(raw) : raw;
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
};

const RowMutationChip: React.FC<{ ref_: RowRef }> = ({ ref_ }) => {
  const rowId = ref_.row_id;
  const label = ref_.title || (typeof rowId === 'number' ? `#${rowId}` : 'Row');

  // No standalone /tables/X/rows/Y route exists — render as a plain chip.
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[rgba(59,130,246,0.08)] border border-[rgba(59,130,246,0.2)] flex-shrink-0"
      title={label}
    >
      {ref_.icon ? (
        <span className="text-sm flex-shrink-0">{ref_.icon}</span>
      ) : (
        <Link2 className="w-3 h-3 flex-shrink-0 text-blue-400" />
      )}
      <span className="text-xs font-medium truncate max-w-[180px]">{label}</span>
    </span>
  );
};

const RowMutationPill: React.FC<{ message: ChatMessage }> = ({ message }) => {
  const meta = (message.metadata || {}) as RowMutationMetadata;
  const rowRef = meta.row_ref;
  const hasChip = !!(rowRef && (rowRef.table_id || rowRef.row_id));
  const ts = formatTs(
    (message as unknown as { created_at?: string }).created_at ||
      (message.timestamp as unknown as string | Date | undefined),
  );

  // Actor identity is now rendered in the turn header (avatar + name + system
  // badge), so the pill body intentionally omits it to avoid duplication.
  return (
    <div
      data-message-id={message.id}
      className="flex items-center gap-1.5 flex-wrap px-2 py-1 rounded text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]/40 transition-colors"
    >
      <Activity className="w-3 h-3 text-[var(--text-tertiary)] flex-shrink-0" />
      {hasChip && rowRef ? <RowMutationChip ref_={rowRef} /> : null}
      <span className="text-xs leading-snug break-words min-w-0">
        {message.content || ''}
      </span>
      {ts && (
        <span className="ml-auto text-[10px] text-[var(--text-tertiary)] flex-shrink-0 tabular-nums">
          {ts}
        </span>
      )}
    </div>
  );
};

export const RowMutationBubbleStack: React.FC<{ messages: ChatMessage[] }> = ({
  messages,
}) => {
  if (!messages || messages.length === 0) return null;
  return (
    <div className="space-y-0.5 my-1">
      {messages.map((m, i) => (
        <RowMutationPill key={m.id || i} message={m} />
      ))}
    </div>
  );
};

export default RowMutationBubbleStack;
