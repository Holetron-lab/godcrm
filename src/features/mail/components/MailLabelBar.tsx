import { Tag, Plus, X, Check } from 'lucide-react';
import { Popover } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { useMailLabels, useTagMessage, useUntagMessage } from '../hooks/useMailLabels';
import { hexToRgba } from '../utils/labelColor';
import type { MailLabel, MailMessage } from '../types';

export interface MailLabelBarProps {
  spaceId: number | undefined;
  message: MailMessage;
}

/**
 * ADR-158 §P4 — reader label bar. Shows the open message's labels and lets the
 * user (un)tag it: labels flagged `showInToolbar` get one-click toggle buttons,
 * every other tagged label shows as a removable chip, and a "＋ Ярлык" popover
 * exposes the full set. Tag/untag is optimistic (see `useTagMessage`), so chips
 * flip instantly. Renders nothing until the space has at least one label.
 *
 * Rendered inline inside `MailReadToolbar` (as its `labelSlot`), so this is a
 * bare flex group — no bar chrome/border of its own.
 */
export function MailLabelBar({ spaceId, message }: MailLabelBarProps) {
  const labelsQuery = useMailLabels(spaceId);
  const tag = useTagMessage(spaceId);
  const untag = useUntagMessage(spaceId);

  const labels = labelsQuery.data ?? [];
  const tagged = message.labels ?? [];
  const taggedIds = new Set(tagged.map((l) => l.id));

  if (labels.length === 0) return null;

  const setTagged = (label: MailLabel, on: boolean) => {
    if (on) tag.mutate({ msgId: message.id, labelId: label.id });
    else untag.mutate({ msgId: message.id, labelId: label.id });
  };

  const toolbarLabels = labels.filter((l) => l.showInToolbar);
  const toolbarIds = new Set(toolbarLabels.map((l) => l.id));
  // Tagged labels that aren't already surfaced as a toolbar button → shown as
  // removable chips so nothing tagged is hidden.
  const chipLabels = tagged.filter((l) => !toolbarIds.has(l.id));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {toolbarLabels.map((label) => {
        const on = taggedIds.has(label.id);
        const tint = label.color ?? undefined;
        return (
          <button
            key={label.id}
            type="button"
            aria-pressed={on}
            title={on ? `Снять «${label.name}»` : `Пометить «${label.name}»`}
            onClick={() => setTagged(label, !on)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors',
              on
                ? 'text-[var(--text-primary)]'
                : 'border-[var(--border-primary)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
            )}
            style={
              on && tint
                ? { color: tint, borderColor: tint, backgroundColor: hexToRgba(tint, 0.14) }
                : undefined
            }
          >
            <Tag size={12} className="flex-shrink-0" style={tint ? { color: tint } : undefined} />
            {label.name}
          </button>
        );
      })}

      {chipLabels.map((label) => {
        const tint = label.color ?? undefined;
        return (
          <span
            key={label.id}
            title={label.name}
            className="inline-flex max-w-[12rem] items-center gap-1 rounded-full border border-[var(--border-primary)] py-0.5 pl-2 pr-1 text-xs font-medium text-[var(--text-secondary)]"
            style={tint ? { color: tint, borderColor: tint, backgroundColor: hexToRgba(tint, 0.14) } : undefined}
          >
            <span className="truncate">{label.name}</span>
            <button
              type="button"
              aria-label={`Снять ярлык «${label.name}»`}
              onClick={() => untag.mutate({ msgId: message.id, labelId: label.id })}
              className="rounded-full opacity-70 hover:opacity-100"
            >
              <X size={12} />
            </button>
          </span>
        );
      })}

      <Popover
        align="start"
        trigger={
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--border-primary)] px-2 py-0.5 text-xs text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
          >
            <Plus size={12} /> Ярлык
          </button>
        }
        content={
          <ul className="max-h-64 min-w-[200px] overflow-y-auto">
            {labels.map((label) => {
              const on = taggedIds.has(label.id);
              const tint = label.color ?? undefined;
              return (
                <li key={label.id}>
                  <button
                    type="button"
                    onClick={() => setTagged(label, !on)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)]"
                  >
                    <Tag size={14} className="flex-shrink-0" style={tint ? { color: tint } : undefined} />
                    <span className="flex-1 truncate">{label.name}</span>
                    {on && <Check size={14} className="flex-shrink-0 text-[var(--color-primary-600)]" />}
                  </button>
                </li>
              );
            })}
          </ul>
        }
      />
    </div>
  );
}
