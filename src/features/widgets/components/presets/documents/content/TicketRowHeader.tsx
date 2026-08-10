/**
 * TicketRowHeader — inline accordion row header with portal-based status/priority/type dropdowns.
 * Extracted from TicketsListView per ADR-0012 §Phase 2 to keep TicketsListView under the file-size cap.
 *
 * Layout (per geratron 2026-04-25 feedback):
 *   - Row 1: chevron + type icon + #id + title
 *   - Row 2: status / priority / type selects + due date + (spacer) + colour swatch + action buttons
 *   - Left edge: 4px colored stripe carrying the ticket state color
 *   - Assignee chips live in TicketCardContent's footer (where the date is) — not here.
 */

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  MessageCircle, Paperclip, Maximize2, ChevronRight, ChevronDown,
  Calendar, Check, AlertCircle, Tag,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { formatDate } from '@/shared/utils/dateFormat';
import type { ColumnModel } from '@/features/tables/types/table.types';
import {
  getTypeIcon,
  getStateName,
  getStateColor,
  getPriorityName,
  getPriorityColor,
  getTypeName,
  getTicketTitle,
  getTicketField,
  type TicketRow,
  type TicketDictItem,
} from './ticketUtils';

// API returns `column_type`, while ColumnModel TS type uses `type`.
// Some call-sites pass already-normalized columns, others don't — read both.
function getColumnType(c: ColumnModel): string {
  return ((c as ColumnModel & { column_type?: string }).column_type || c.type || '') as string;
}

const COLOR_PALETTE: Array<string | null> = [
  null, '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16',
  '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6',
  '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#78716c', '#64748b',
  '#1e293b', '#0f172a', '#fbbf24', '#a3e635', '#2dd4bf', '#38bdf8',
];

// State name → left-border accent hex. Mirrors STATE_COLORS in ticketUtils
// but produces a concrete hex so we can paint a 4px stripe regardless of the
// dictionary item carrying its own colour.
const STATE_BORDER_HEX: Record<string, string> = {
  backlog: '#6b7280',
  todo: '#6b7280',
  open: '#3b82f6',
  new: '#06b6d4',
  'in progress': '#3b82f6',
  'in-progress': '#3b82f6',
  review: '#a855f7',
  done: '#22c55e',
  closed: '#22c55e',
  'on hold': '#eab308',
};

function resolveStateAccentColor(stateId: number | string | undefined, states: TicketDictItem[]): string {
  if (!stateId) return 'var(--border-secondary)';
  const dictItem = states.find(s => s.id === Number(stateId));
  // Prefer an explicit color stored on the dictionary row.
  const explicit = (dictItem?.color as string | undefined) || (dictItem?.data as { color?: string } | undefined)?.color;
  if (explicit && /^#[0-9A-Fa-f]{3,8}$/.test(explicit)) return explicit;
  const name = (dictItem?.name as string | undefined || '').toLowerCase();
  return STATE_BORDER_HEX[name] || 'var(--border-secondary)';
}

export interface TicketRowHeaderProps {
  ticket: TicketRow;
  ticketConfig: { columns: Record<string, string>; table_id: number };
  tableColumns?: ColumnModel[];
  types: TicketDictItem[];
  states: TicketDictItem[];
  priorities: TicketDictItem[];
  isExpanded: boolean;
  onToggle: () => void;
  onOpenChat: () => void;
  onOpenModal?: () => void;
  onAttachToMessage?: () => void;
  onStatusChange: (stateId: number) => void;
  onPriorityChange: (priorityId: number) => void;
  onTypeChange?: (typeId: number) => void;
  onColorChange?: (value: string | null) => void;
  /** Hide the accordion chevron — useful when the header is used as a card top
   *  (no inline expand/collapse), see TicketsListPreset cards mode. */
  hideChevron?: boolean;
}

export function TicketRowHeader({
  ticket,
  ticketConfig,
  tableColumns = [],
  types,
  states,
  priorities,
  isExpanded,
  onToggle,
  onOpenChat,
  onOpenModal,
  onAttachToMessage,
  onStatusChange,
  onPriorityChange,
  onTypeChange,
  onColorChange,
  hideChevron = false,
}: TicketRowHeaderProps) {
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [showPriorityDropdown, setShowPriorityDropdown] = useState(false);
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const statusButtonRef = useRef<HTMLButtonElement>(null);
  const priorityButtonRef = useRef<HTMLButtonElement>(null);
  const typeButtonRef = useRef<HTMLButtonElement>(null);
  const colorButtonRef = useRef<HTMLButtonElement>(null);
  const statusDropdownRef = useRef<HTMLDivElement>(null);
  const priorityDropdownRef = useRef<HTMLDivElement>(null);
  const typeDropdownRef = useRef<HTMLDivElement>(null);
  const [statusPos, setStatusPos] = useState({ top: 0, left: 0 });
  const [priorityPos, setPriorityPos] = useState({ top: 0, left: 0 });
  const [typePos, setTypePos] = useState({ top: 0, left: 0 });

  const typeVal = getTicketField(ticket, ticketConfig, 'type');
  const stateVal = getTicketField(ticket, ticketConfig, 'state');
  const priorityVal = getTicketField(ticket, ticketConfig, 'priority');
  const dueDateVal = getTicketField(ticket, ticketConfig, 'due_date') || ticket.due_date || ticket.deadline;
  const stateAccent = resolveStateAccentColor(stateVal as number | string | undefined, states);

  // ADR-0002 §8 Phase 3 (G6 + A3.3) — must-criteria progress badge.
  // Backend persists numeric `must_total` / `must_verified` and a string
  // `criteria_progress` ("M/N") on the ticket row. Three states:
  //   green  ✅ N/N — all Must criteria verified (must_total > 0)
  //   amber  ⚠️ M/N — partial coverage
  //   grey   —      — no Must criteria linked (must_total === 0)
  const criteriaBadge = (() => {
    const raw = ticket as Record<string, unknown>;
    const totalRaw = raw.must_total;
    const verifiedRaw = raw.must_verified;
    const progressStr = typeof raw.criteria_progress === 'string' ? raw.criteria_progress : '';
    const total = Number(totalRaw ?? NaN);
    const verified = Number(verifiedRaw ?? NaN);
    // Prefer numeric fields; fall back to parsing the string when only the
    // string is present (older rows before recompute caught up).
    let mustTotal = Number.isFinite(total) ? total : NaN;
    let mustVerified = Number.isFinite(verified) ? verified : NaN;
    if ((!Number.isFinite(mustTotal) || !Number.isFinite(mustVerified)) && progressStr.includes('/')) {
      const [v, t] = progressStr.split('/').map(s => Number(s.trim()));
      if (Number.isFinite(v) && Number.isFinite(t)) {
        mustVerified = v;
        mustTotal = t;
      }
    }
    if (!Number.isFinite(mustTotal) || mustTotal <= 0) {
      return { label: '—', cls: 'bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]', title: 'Must-критериев нет' };
    }
    if (mustVerified >= mustTotal) {
      return {
        label: `✅ ${mustVerified}/${mustTotal}`,
        cls: 'bg-green-500/15 text-green-400 border border-green-500/30',
        title: 'Все Must-критерии verified',
      };
    }
    return {
      label: `⚠️ ${mustVerified}/${mustTotal}`,
      cls: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
      title: `${mustVerified} из ${mustTotal} Must-критериев verified`,
    };
  })();

  // Color column — first column with type 'color' (e.g. `colour`). Picker
  // mirrors KanbanCard's round-swatch style. The `/columns` API returns
  // `column_type`, but normalized callers use `type`; check both.
  const colorColumn = tableColumns.find(c => getColumnType(c) === 'color');
  const currentColorValue = colorColumn ? (ticket as Record<string, unknown>)[colorColumn.name] : null;
  const currentColor = (typeof currentColorValue === 'string' && /^#[0-9A-Fa-f]{3,8}$/.test(currentColorValue))
    ? currentColorValue : null;

  useEffect(() => {
    if (!showStatusDropdown && !showPriorityDropdown && !showTypeDropdown) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (showStatusDropdown &&
          statusButtonRef.current && !statusButtonRef.current.contains(target) &&
          statusDropdownRef.current && !statusDropdownRef.current.contains(target)) {
        setShowStatusDropdown(false);
      }
      if (showPriorityDropdown &&
          priorityButtonRef.current && !priorityButtonRef.current.contains(target) &&
          priorityDropdownRef.current && !priorityDropdownRef.current.contains(target)) {
        setShowPriorityDropdown(false);
      }
      if (showTypeDropdown &&
          typeButtonRef.current && !typeButtonRef.current.contains(target) &&
          typeDropdownRef.current && !typeDropdownRef.current.contains(target)) {
        setShowTypeDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showStatusDropdown, showPriorityDropdown, showTypeDropdown]);

  const handleStatusClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (statusButtonRef.current) {
      const rect = statusButtonRef.current.getBoundingClientRect();
      setStatusPos({ top: rect.bottom + 4, left: rect.left });
    }
    setShowStatusDropdown(!showStatusDropdown);
    setShowPriorityDropdown(false);
    setShowTypeDropdown(false);
  };

  const handlePriorityClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (priorityButtonRef.current) {
      const rect = priorityButtonRef.current.getBoundingClientRect();
      setPriorityPos({ top: rect.bottom + 4, left: rect.left });
    }
    setShowPriorityDropdown(!showPriorityDropdown);
    setShowStatusDropdown(false);
    setShowTypeDropdown(false);
  };

  const handleTypeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (typeButtonRef.current) {
      const rect = typeButtonRef.current.getBoundingClientRect();
      setTypePos({ top: rect.bottom + 4, left: rect.left });
    }
    setShowTypeDropdown(!showTypeDropdown);
    setShowStatusDropdown(false);
    setShowPriorityDropdown(false);
  };

  const typeName = getTypeName(typeVal as number | string | undefined, types);

  return (
    <div
      onClick={onToggle}
      style={currentColor ? { borderLeftColor: currentColor, borderLeftWidth: '4px', borderLeftStyle: 'solid' } : undefined}
      className="p-3 cursor-pointer group flex flex-col gap-1.5"
    >
      <div className="flex items-start gap-3">
        {!hideChevron && (
          <button className="p-0.5 mt-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] shrink-0">
            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        )}

        <span className="text-lg leading-none mt-0.5 shrink-0">{getTypeIcon(typeVal as number, types)}</span>

        <div className="flex-1 min-w-0 flex items-baseline gap-2">
          <span className="text-[10px] text-blue-400 font-mono shrink-0">#{ticket.id}</span>
          <h3 className="font-medium text-sm leading-snug line-clamp-2 break-words">
            {getTicketTitle(ticket, ticketConfig) || 'Без названия'}
          </h3>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
          <button
            ref={statusButtonRef}
            onClick={handleStatusClick}
            className={cn(
              'px-2 py-0.5 rounded text-[10px] font-medium whitespace-nowrap flex items-center gap-1 hover:opacity-80 transition-colors',
              getStateColor(stateVal as number, states)
            )}
          >
            {getStateName(stateVal as number, states)}
            <ChevronDown className="w-3 h-3" />
          </button>

          <button
            ref={priorityButtonRef}
            onClick={handlePriorityClick}
            className={cn(
              'px-2 py-0.5 rounded text-[10px] font-medium whitespace-nowrap flex items-center gap-1 hover:opacity-80 transition-colors border border-transparent hover:border-current',
              getPriorityColor(priorityVal as number, priorities)
            )}
          >
            <AlertCircle className="w-3 h-3" />
            {getPriorityName(priorityVal as number, priorities)}
            <ChevronDown className="w-3 h-3" />
          </button>

          {types.length > 0 && (
            <button
              ref={typeButtonRef}
              onClick={handleTypeClick}
              disabled={!onTypeChange}
              className={cn(
                'px-2 py-0.5 rounded text-[10px] font-medium whitespace-nowrap flex items-center gap-1 transition-colors border border-transparent bg-[var(--bg-tertiary)] text-[var(--text-secondary)]',
                onTypeChange && 'hover:border-current cursor-pointer',
                !onTypeChange && 'cursor-default opacity-80',
              )}
              title={typeName ? `Тип: ${typeName}` : 'Тип тикета'}
            >
              <Tag className="w-3 h-3" />
              {typeName || '—'}
              {onTypeChange && <ChevronDown className="w-3 h-3" />}
            </button>
          )}

          {dueDateVal ? (
            <span className={cn(
              'flex items-center gap-1 text-[10px]',
              new Date(dueDateVal as string) < new Date() ? 'text-red-400' : 'text-[var(--text-tertiary)]'
            )}>
              <Calendar className="w-3 h-3" />
              {formatDate(dueDateVal as string, 'short')}
            </span>
          ) : null}

          {/* ADR-0002 §8 Phase 3 (A3.3) — must-criteria progress badge */}
          <span
            className={cn(
              'px-2 py-0.5 rounded text-[10px] font-medium whitespace-nowrap inline-flex items-center gap-1',
              criteriaBadge.cls
            )}
            title={criteriaBadge.title}
            aria-label={`Must-критерии: ${criteriaBadge.title}`}
            data-testid="ticket-criteria-progress"
          >
            {criteriaBadge.label}
          </span>

          <div className="flex-1" />

          <div className="flex items-center gap-0.5 shrink-0">
            {colorColumn && onColorChange && (
              <button
                ref={colorButtonRef}
                onClick={(e) => { e.stopPropagation(); setShowColorPicker(!showColorPicker); }}
                className="p-1 rounded hover:bg-[var(--bg-tertiary)] transition-colors"
                title="Цвет"
              >
                <span
                  className="w-3.5 h-3.5 rounded-full border border-[var(--border-primary)] inline-block"
                  style={{ backgroundColor: currentColor || 'var(--bg-tertiary)' }}
                />
              </button>
            )}
            {onOpenModal && (
              <button
                onClick={(e) => { e.stopPropagation(); onOpenModal(); }}
                className="p-1 rounded hover:bg-gray-500/20 transition-colors"
                title="Открыть в модалке"
              >
                <Maximize2 className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onOpenChat(); }}
              className="p-1 rounded hover:bg-blue-500/20 transition-colors"
              title="Открыть чат"
            >
              <MessageCircle className="w-3.5 h-3.5 text-blue-400" />
            </button>
            {onAttachToMessage && (
              <button
                onClick={(e) => { e.stopPropagation(); onAttachToMessage(); }}
                className="p-1 rounded hover:bg-green-500/20 transition-colors"
                title="Прикрепить к сообщению"
              >
                <Paperclip className="w-3.5 h-3.5 text-green-400" />
              </button>
            )}
          </div>
        </div>

      {showStatusDropdown && createPortal(
        <div
          ref={statusDropdownRef}
          className="fixed z-[9999] bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-xl py-1 min-w-[140px]"
          style={{ top: statusPos.top, left: statusPos.left }}
        >
          {states.map(state => (
            <button
              key={state.id}
              onClick={(e) => {
                e.stopPropagation();
                onStatusChange(state.id);
                setShowStatusDropdown(false);
              }}
              className="w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 hover:bg-[var(--bg-tertiary)] transition-colors"
            >
              <span className={cn(
                'w-2 h-2 rounded-full',
                getStateColor(state.id, states).replace('text-', 'bg-').split(' ')[0]
              )} />
              {state.name}
              {Number(stateVal) === state.id && <Check className="w-3 h-3 ml-auto text-green-400" />}
            </button>
          ))}
        </div>,
        document.body
      )}

      {showPriorityDropdown && createPortal(
        <div
          ref={priorityDropdownRef}
          className="fixed z-[9999] bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-xl py-1 min-w-[120px]"
          style={{ top: priorityPos.top, left: priorityPos.left }}
        >
          {priorities.map(p => (
            <button
              key={p.id}
              onClick={(e) => {
                e.stopPropagation();
                onPriorityChange(p.id);
                setShowPriorityDropdown(false);
              }}
              className="w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 hover:bg-[var(--bg-tertiary)] transition-colors"
            >
              <AlertCircle className={cn('w-3 h-3', getPriorityColor(p.id, priorities))} />
              {p.name}
              {Number(priorityVal) === p.id && <Check className="w-3 h-3 ml-auto text-green-400" />}
            </button>
          ))}
        </div>,
        document.body
      )}

      {showTypeDropdown && onTypeChange && createPortal(
        <div
          ref={typeDropdownRef}
          className="fixed z-[9999] bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-xl py-1 min-w-[140px]"
          style={{ top: typePos.top, left: typePos.left }}
        >
          {types.map(t => (
            <button
              key={t.id}
              onClick={(e) => {
                e.stopPropagation();
                onTypeChange(t.id);
                setShowTypeDropdown(false);
              }}
              className="w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 hover:bg-[var(--bg-tertiary)] transition-colors"
            >
              <span className="text-base leading-none">{getTypeIcon(t.id, types)}</span>
              {t.name as string}
              {Number(typeVal) === t.id && <Check className="w-3 h-3 ml-auto text-green-400" />}
            </button>
          ))}
        </div>,
        document.body
      )}

      {showColorPicker && colorColumn && onColorChange && createPortal(
        <div className="fixed inset-0 z-[9998]" onClick={(e) => { e.stopPropagation(); setShowColorPicker(false); }}>
          <div
            className="fixed z-[9999]"
            style={{
              top: (colorButtonRef.current?.getBoundingClientRect().bottom || 0) + 4,
              left: (colorButtonRef.current?.getBoundingClientRect().left || 0) - 80,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-xl p-2">
              <div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
                {COLOR_PALETTE.map((c, i) => (
                  <button
                    key={i}
                    onClick={(e) => {
                      e.stopPropagation();
                      onColorChange(c);
                      setShowColorPicker(false);
                    }}
                    className={cn(
                      'h-5 w-5 rounded border transition-all',
                      currentColor === c
                        ? 'border-white ring-1 ring-[var(--color-primary-500)]'
                        : 'border-transparent hover:border-white/30',
                    )}
                    style={{
                      backgroundColor: c || 'var(--bg-tertiary)',
                      backgroundImage: c ? undefined : 'linear-gradient(45deg, #666 25%, transparent 25%), linear-gradient(-45deg, #666 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #666 75%), linear-gradient(-45deg, transparent 75%, #666 75%)',
                      backgroundSize: c ? undefined : '4px 4px',
                    }}
                    title={c || 'Без цвета'}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

    </div>
  );
}
