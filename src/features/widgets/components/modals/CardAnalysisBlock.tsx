import { useRequestedFocus } from '@/shared/hooks/useRequestedFocus';
import { useEffect, useId, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { MarkdownPreview } from '@/shared/components/MarkdownPreview';
import type { ColumnModel } from '@/features/tables/types/table.types';

/**
 * The AI-analysis window — a long-text column that is written by an automation,
 * not by hand, and therefore needs a different surface from the summary block.
 *
 * The column holds ONE accumulating journal: a «Итог на сейчас» head that the
 * agent rewrites on every pass, then one dated entry per observation, newest
 * first, oldest never deleted. Rendered as one markdown blob it becomes a wall
 * of text that grows without bound and pushes everything under it off-screen —
 * so this splits the same text at its `##`/`###` headings and gives each dated
 * entry its own collapsed row.
 *
 * What stays open: the head (that IS the current state of the plant) and the
 * newest entry. Everything older is one click away. The whole window scrolls
 * inside a fixed height so a card with two years of history is the same size as
 * a card with one photo.
 *
 * The text is still editable — double click opens the raw markdown, same
 * gesture as every other field in the card. The parser is display-only: it
 * never rewrites what the agent stored.
 */

interface AnalysisEntry {
  /** Heading text with the date token removed — «сверка с Google Объективом». */
  title: string;
  /** `дд.мм.гггг` as written, or '' when the heading carries no date. */
  dateLabel: string;
  /** Sort key; 0 when undated, so undated entries sink below dated ones. */
  dateValue: number;
  /** Everything under the heading, still markdown. */
  body: string;
}

interface ParsedAnalysis {
  /** Head heading, plain text — drawn as a caption, never as a markdown `##`. */
  leadTitle: string;
  /** Head body: the preamble plus everything under the first heading. */
  leadBody: string;
  entries: AnalysisEntry[];
}

/**
 * A decorative pictograph at the head of a heading. The agent opens its summary
 * with 📊; inside a block that already carries a label it says nothing, and it
 * drags the line taller than its neighbours.
 */
const LEADING_EMOJI =
  /^(?:[0-9#*]\uFE0F?\u20E3|[←-⇿⌀-➿⬀-⯿™ℹ\u{1F000}-\u{1FBFF}]|\uFE0F|\u200D|\u20E3|\s)+/u;

const stripEmoji = (text: string) => text.replace(LEADING_EMOJI, '').trim();

/**
 * A heading inside a body would render at 1.3em with a rule under it — a third
 * type size in a card that should have one. Emphasis carries that structure
 * instead. Display-only, like the rest of the parser: the stored text is never
 * rewritten.
 */
const flattenHeadings = (markdown: string) =>
  markdown.replace(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm, (_, text: string) => `**${text.trim()}**`);

/** `## …` / `### …` — the level the agent uses for the head and for entries. */
const HEADING = /^#{2,4}\s+(.*)$/;

/** A written date in either the Russian or the ISO form. */
const DATE_IN_TEXT = /(\d{2})\.(\d{2})\.(\d{4})|(\d{4})-(\d{2})-(\d{2})/;

const readDate = (text: string): { label: string; value: number } => {
  const m = DATE_IN_TEXT.exec(text);
  if (!m) return { label: '', value: 0 };
  const [day, month, year] = m[1] ? [m[1], m[2], m[3]] : [m[6], m[5], m[4]];
  return {
    label: `${day}.${month}.${year}`,
    // Zero-padded concatenation sorts identically to a real date and cannot
    // drift by a timezone the way `new Date('2026-08-20')` does.
    value: Number(`${year}${month}${day}`),
  };
};

/**
 * Cut the journal into its head and its dated entries.
 *
 * The FIRST heading is the head whatever it says: the agent writes «Итог на
 * сейчас» there, but a hand-edited card may say anything, and the head is
 * defined by position — it is the block that describes now — not by its words.
 */
const parseAnalysis = (raw: string): ParsedAnalysis => {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const blocks: { heading: string; body: string[] }[] = [];
  let current: { heading: string; body: string[] } | null = null;
  const preamble: string[] = [];

  lines.forEach((line) => {
    const match = HEADING.exec(line.trim());
    if (match) {
      if (current) blocks.push(current);
      current = { heading: match[1].trim(), body: [] };
      return;
    }
    // A lone `---` between blocks is a separator the agent writes for the raw
    // markdown view; here every entry already has its own frame.
    if (/^-{3,}$/.test(line.trim())) return;
    (current ? current.body : preamble).push(line);
  });
  if (current) blocks.push(current);

  if (blocks.length === 0) {
    return { leadTitle: '', leadBody: flattenHeadings(raw.trim()), entries: [] };
  }

  const [head, ...rest] = blocks;
  const leadTitle = stripEmoji(head.heading);
  const leadBody = flattenHeadings(
    [preamble.join('\n').trim(), head.body.join('\n').trim()].filter(Boolean).join('\n\n'),
  );

  const entries = rest.map((block) => {
    const { label, value } = readDate(block.heading);
    const title = stripEmoji(block.heading)
      // The date is shown in its own column of the row — leave it out of the
      // title so a narrow card does not truncate the words to show the digits.
      .replace(DATE_IN_TEXT, '')
      .replace(/^[\s—–\-–:·]+|[\s—–\-–:·]+$/g, '')
      .trim();
    return {
      title,
      dateLabel: label,
      dateValue: value,
      body: flattenHeadings(block.body.join('\n').trim()),
    };
  });

  // Newest first. The agent already writes in that order; a hand edit or an
  // out-of-order append must not put an old observation on top.
  entries.sort((a, b) => b.dateValue - a.dateValue);

  return { leadTitle, leadBody, entries };
};

interface CardAnalysisBlockProps {
  column: ColumnModel;
  /** Raw cell text. */
  content: string;
  editable: boolean;
  editing: boolean;
  draft: string;
  saving: boolean;
  editHint?: string;
  onDraftChange: (value: string) => void;
  onStartEdit: () => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export function CardAnalysisBlock({
  column,
  content,
  editable,
  editing,
  draft,
  saving,
  editHint,
  onDraftChange,
  onStartEdit,
  onSubmit,
  onCancel,
}: CardAnalysisBlockProps) {
  const editorId = useId();
  const requestedFocusRef = useRequestedFocus<HTMLTextAreaElement>(editing);
  const { leadTitle, leadBody, entries } = useMemo(() => parseAnalysis(content), [content]);

  /** Only the newest entry starts open — the rest are history, not the state. */
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  useEffect(() => {
    setOpenIndex(0);
  }, [content]);

  const label = `${column.icon ? `${column.icon} ` : ''}${column.displayName || column.name}`;

  if (editing) {
    return (
      <section className="space-y-2">
        <label htmlFor={editorId} className="block text-xs font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
          {label}
        </label>
        <textarea
          id={editorId}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel();
          }}
          rows={18}
          ref={requestedFocusRef}
          className="w-full resize-y rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 font-mono text-xs leading-relaxed text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]"
        />
        <div className="flex items-center gap-1.5">
          <button
            onClick={onSubmit}
            disabled={saving}
            className="rounded bg-[var(--color-primary-500)] px-2 py-0.5 text-xs text-white hover:bg-[var(--color-primary-600)] disabled:opacity-50"
          >
            {saving ? '...' : 'OK'}
          </button>
          <button
            onClick={onCancel}
            className="rounded px-2 py-0.5 text-xs text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          >
            Отмена
          </button>
        </div>
      </section>
    );
  }

  return (
    <section>
      {/* Same head as the summary field: a label OUTSIDE the surface, not a
          titlebar drawn on top of it. The count rides on the same baseline. */}
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
          {label}
        </span>
        {entries.length > 0 && (
          <span className="flex-shrink-0 text-xs tabular-nums text-[var(--text-tertiary)]">
            {entries.length} {entries.length === 1 ? 'запись' : 'записей'}
          </span>
        )}
      </div>

      {/* One borderless card, exactly the summary surface — plus its own scroll,
          because the journal only grows and a card must not get taller every
          time a photo is added. */}
      <div
        className={`max-h-[56vh] overflow-y-auto rounded-lg bg-[var(--bg-secondary)] p-3 transition${
          editable ? ' cursor-pointer' : ''
        }`}
        onDoubleClick={editable ? onStartEdit : undefined}
        title={editable ? editHint : undefined}
      >
        {content.trim() ? (
          <>
            {/* The head reads as one paragraph with its own first line — the
                title is bold body text, not a heading, so the whole window
                stays on a single type size. */}
            {leadTitle && (
              <p className="mb-1 text-sm font-semibold text-[var(--text-primary)]">{leadTitle}</p>
            )}
            {leadBody && <MarkdownPreview content={leadBody} className="text-sm" />}

            {entries.map((entry, index) => {
              const open = openIndex === index;
              return (
                <div
                  key={`${entry.dateLabel}-${entry.title}-${index}`}
                  // No frame per entry — a hairline is enough to say «next
                  // record», and the first one leans on the lead above it.
                  className={
                    index === 0 && !leadTitle && !leadBody
                      ? ''
                      : 'mt-2 border-t border-[var(--border-primary)] pt-2'
                  }
                >
                  <button
                    type="button"
                    aria-expanded={open}
                    // A click toggles; the double click that opens the editor
                    // belongs to the container, so stop it dying on the button.
                    onClick={() => setOpenIndex(open ? null : index)}
                    className="-mx-1 flex w-[calc(100%+0.5rem)] items-center gap-2 rounded px-1 py-0.5 text-left transition hover:bg-[var(--bg-tertiary)]"
                  >
                    <ChevronRight
                      className={`h-4 w-4 flex-shrink-0 text-[var(--text-tertiary)] transition-transform${
                        open ? ' rotate-90' : ''
                      }`}
                    />
                    {entry.dateLabel && (
                      <span className="flex-shrink-0 text-sm font-medium tabular-nums text-[var(--text-secondary)]">
                        {entry.dateLabel}
                      </span>
                    )}
                    <span className="truncate text-sm text-[var(--text-tertiary)]">
                      {entry.title}
                    </span>
                  </button>
                  {open && entry.body && (
                    // Indented to the width of the chevron so the body reads as
                    // belonging to the row it hangs under.
                    <div className="mt-1 pl-6">
                      <MarkdownPreview content={entry.body} className="text-sm" />
                    </div>
                  )}
                </div>
              );
            })}
          </>
        ) : (
          <p className="text-sm italic text-[var(--text-tertiary)]">
            Пока пусто — анализ появится после загрузки фото.
          </p>
        )}
      </div>
    </section>
  );
}
