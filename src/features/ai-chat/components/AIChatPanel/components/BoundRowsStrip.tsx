import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link2, X, Unlink2, Paperclip, Pencil } from 'lucide-react';
import { apiClient } from '@/shared/utils/apiClient';
import { logger } from '@/shared/utils/logger';
import { BoundRowChip } from './BoundRowChip';
import { useBoundRowDisplay, hexToRgba, type RelationOption } from '../hooks/useBoundRowDisplay';

const RowBindingV2 = React.lazy(() => import('../../RowBindingV2').then(m => ({ default: m.RowBindingV2 })));
const RowViewerModal = React.lazy(() => import('./ChatMessages/RowViewerModal'));

interface BoundRow {
  table_id: number;
  row_id: number;
  table_name?: string;
  table_icon?: string;
  row_title?: string;
}

interface BoundRowsStripProps {
  boundRows: BoundRow[];
  setBoundRows: (fn: (prev: BoundRow[]) => BoundRow[]) => void;
  showRowBinding: boolean;
  setShowRowBinding: (v: boolean) => void;
  setShowBoundRowsBar: (v: boolean) => void;
  currentConversationId: number | null;
  userConversationId: number | null;
  effectiveSpaceId: number;
  tasksSource: any;
  favoritesConfig?: { documents?: any; custom?: any[] };
  onAttachToMessage?: (br: BoundRow) => void;
}

export function BoundRowsStrip({
  boundRows, setBoundRows, showRowBinding, setShowRowBinding,
  setShowBoundRowsBar, currentConversationId, userConversationId,
  effectiveSpaceId, tasksSource, favoritesConfig, onAttachToMessage
}: BoundRowsStripProps) {
  const cid = currentConversationId || userConversationId;
  const [toolbarIdx, setToolbarIdx] = useState<number | null>(null);
  const [editorRow, setEditorRow] = useState<{ tableId: number; rowId: number } | null>(null);

  // Link-icon click while a row is already bound → open the toolbar instead of
  // re-showing the search panel. Auto-toggle the first bound row's toolbar.
  useEffect(() => {
    if (showRowBinding && boundRows.length > 0) {
      setShowRowBinding(false);
      setToolbarIdx(prev => (prev === null ? 0 : null));
    }
  }, [showRowBinding, boundRows.length, setShowRowBinding]);

  useEffect(() => {
    if (boundRows.length === 0) setToolbarIdx(null);
  }, [boundRows.length]);

  const persistUnbind = () => {
    if (!cid) return;
    apiClient.patch(`/chat/conversations/${cid}`, { bound_table_id: null, bound_row_id: null })
      .catch(err => logger.warn('[BoundRowsStrip] Failed to unbind row:', err));
  };

  const activeRow = toolbarIdx !== null ? boundRows[toolbarIdx] : null;

  return (
    <>
      {boundRows.length > 0 && (
        <div className="border-t border-[var(--border-secondary)] bg-gradient-to-r from-blue-500/5 to-transparent">
          <div className="flex items-center gap-1.5 px-3 py-0.5 min-w-0">
            <Link2 className="w-3 h-3 text-blue-400 flex-shrink-0" />
            {boundRows.map((br, idx) => (
              <BoundRowChip
                key={idx}
                br={br}
                active={toolbarIdx === idx}
                tasksSource={tasksSource}
                favoritesConfig={favoritesConfig as any}
                onClick={() => setToolbarIdx(prev => (prev === idx ? null : idx))}
              />
            ))}
          </div>
          {activeRow && toolbarIdx !== null && (
            <BoundRowToolbar
              br={activeRow}
              counter={`${toolbarIdx + 1}/${boundRows.length}`}
              tasksSource={tasksSource}
              favoritesConfig={favoritesConfig as any}
              onUnbind={() => {
                const ar = activeRow;
                setBoundRows(prev => prev.filter(x => !(x.table_id === ar.table_id && x.row_id === ar.row_id)));
                persistUnbind();
                setToolbarIdx(null);
              }}
              onEdit={() => setEditorRow({ tableId: activeRow.table_id, rowId: activeRow.row_id })}
              onAttach={onAttachToMessage ? () => { onAttachToMessage(activeRow); setToolbarIdx(null); } : undefined}
              onClose={() => setToolbarIdx(null)}
            />
          )}
        </div>
      )}

      {showRowBinding && boundRows.length === 0 && (
        <div className="border-t border-[var(--border-secondary)] bg-[var(--bg-secondary)]">
          <React.Suspense fallback={<div className="text-xs text-[var(--text-tertiary)] p-2">Loading...</div>}>
            <RowBindingV2
              defaultSpaceId={effectiveSpaceId} boundRows={boundRows} maxBindings={1}
              compact={true} hideHeader={true} forceExpanded={true}
              tasksSource={tasksSource}
              documentsSource={favoritesConfig?.documents}
              customSources={favoritesConfig?.custom}
              allowOtherTables={true}
              onClose={() => setShowRowBinding(false)}
              onBind={(binding: any) => {
                setBoundRows(() => [binding]); setShowRowBinding(false); setShowBoundRowsBar(true);
                if (cid) {
                  apiClient.patch(`/chat/conversations/${cid}`, { bound_table_id: binding.table_id, bound_row_id: binding.row_id })
                    .then(() => logger.info('[BoundRowsStrip] Row binding saved for conv', cid))
                    .catch(err => logger.warn('[BoundRowsStrip] Failed to persist row binding:', err));
                }
              }}
              onUnbind={(tableId: number, rowId: number) => {
                setBoundRows((prev: BoundRow[]) => prev.filter(br => !(br.table_id === tableId && br.row_id === rowId)));
                if (cid) {
                  apiClient.patch(`/chat/conversations/${cid}`, { bound_table_id: null, bound_row_id: null })
                    .catch(err => logger.warn('[BoundRowsStrip] Failed to persist row unbinding:', err));
                }
              }}
            />
          </React.Suspense>
        </div>
      )}

      {editorRow && (
        <React.Suspense fallback={null}>
          <RowViewerModal
            isOpen
            mode="view"
            tableId={editorRow.tableId}
            rowId={editorRow.rowId}
            onClose={() => setEditorRow(null)}
          />
        </React.Suspense>
      )}
    </>
  );
}

interface BoundRowToolbarProps {
  br: BoundRow;
  counter: string;
  tasksSource: any;
  favoritesConfig?: any;
  onUnbind: () => void;
  onEdit: () => void;
  onAttach?: () => void;
  onClose: () => void;
}

function BoundRowToolbar({ br, counter, tasksSource, favoritesConfig, onUnbind, onEdit, onAttach, onClose }: BoundRowToolbarProps) {
  const display = useBoundRowDisplay(br, tasksSource, favoritesConfig);
  const [openPopover, setOpenPopover] = useState<null | 'status' | 'secondary'>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const secondaryBtnRef = useRef<HTMLButtonElement | null>(null);
  const statusBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!openPopover) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popoverRef.current && popoverRef.current.contains(t)) return;
      if (secondaryBtnRef.current?.contains(t) || statusBtnRef.current?.contains(t)) return;
      setOpenPopover(null);
    };
    const tid = setTimeout(() => document.addEventListener('click', handler), 0);
    return () => { clearTimeout(tid); document.removeEventListener('click', handler); };
  }, [openPopover]);

  // Mirror the second line of a RowList item: type pill + status pill + grey
  // description preview (always shown when present, not only as fallback).
  return (
    <div className="relative flex items-center gap-1 px-2 py-1 border-t border-[#333333] bg-[var(--bg-tertiary)]/40 text-[11px] min-w-0">
      {display.secondaryColName && (
        <PillButton
          ref={secondaryBtnRef}
          label={display.secondaryOption?.label || '—'}
          color={display.secondaryOption?.color}
          onClick={(e) => { e.stopPropagation(); setOpenPopover(p => p === 'secondary' ? null : 'secondary'); }}
        />
      )}
      {display.statusColName && (
        <PillButton
          ref={statusBtnRef}
          label={display.statusOption?.label || '—'}
          color={display.statusOption?.color}
          onClick={(e) => { e.stopPropagation(); setOpenPopover(p => p === 'status' ? null : 'status'); }}
        />
      )}

      {display.description && (
        <span
          className="text-[var(--text-tertiary)] truncate min-w-0 flex-1"
          title={display.description}
        >
          {display.description}
        </span>
      )}

      {!display.description && <span className="flex-1 min-w-0" aria-hidden />}

      <span className="w-px h-4 bg-[var(--border-secondary)] flex-shrink-0 mx-1" />

      <span className="text-[var(--text-tertiary)] flex-shrink-0">{counter}</span>

      <button
        type="button"
        onClick={onEdit}
        className="inline-flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--color-primary-400)] flex-shrink-0"
        title="Редактировать"
      >
        <Pencil className="w-3 h-3" />
      </button>
      {onAttach && (
        <button
          type="button"
          onClick={onAttach}
          className="inline-flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--color-primary-400)] flex-shrink-0"
          title="Прикрепить к сообщению"
        >
          <Paperclip className="w-3 h-3" />
        </button>
      )}
      <button
        type="button"
        onClick={onUnbind}
        className="inline-flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-red-400 flex-shrink-0"
        title="Открепить"
      >
        <Unlink2 className="w-3 h-3" />
      </button>
      <button
        type="button"
        onClick={onClose}
        className="inline-flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] flex-shrink-0"
        title="Закрыть"
      >
        <X className="w-3 h-3" />
      </button>

      {openPopover === 'status' && display.statusColName && (
        <PortalDropdown
          ref={popoverRef}
          anchorRef={statusBtnRef}
          options={display.statusOptions}
          loading={display.statusLoading}
          currentId={display.statusOption?.id}
          onPick={(opt) => { display.updateStatus(opt.id); setOpenPopover(null); }}
        />
      )}
      {openPopover === 'secondary' && display.secondaryColName && (
        <PortalDropdown
          ref={popoverRef}
          anchorRef={secondaryBtnRef}
          options={display.secondaryOptions}
          loading={display.secondaryLoading}
          currentId={display.secondaryOption?.id}
          onPick={(opt) => { display.updateSecondary(opt.id); setOpenPopover(null); }}
        />
      )}
    </div>
  );
}

const PillButton = React.forwardRef<HTMLButtonElement, {
  label: string;
  color?: string;
  onClick: (e: React.MouseEvent) => void;
}>(({ label, color, onClick }, ref) => (
  <button
    ref={ref}
    type="button"
    onClick={onClick}
    className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium hover:opacity-80 transition-opacity max-w-[140px] truncate"
    style={{
      backgroundColor: color ? hexToRgba(color, 0.15) : 'rgba(255,255,255,0.08)',
      color: color || 'var(--text-secondary)',
    }}
    title={label}
  >
    {label}
  </button>
));
PillButton.displayName = 'BoundRowToolbarPill';

const PortalDropdown = React.forwardRef<HTMLDivElement, {
  anchorRef: React.RefObject<HTMLElement>;
  options: RelationOption[];
  loading: boolean;
  currentId?: string | number;
  onPick: (opt: RelationOption) => void;
}>(({ anchorRef, options, loading, currentId, onPick }, ref) => {
  const [pos, setPos] = useState<{ top: number; left: number; minWidth: number; openUp: boolean } | null>(null);

  useLayoutEffect(() => {
    const compute = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dropdownH = 280;
      const spaceBelow = window.innerHeight - r.bottom;
      const openUp = spaceBelow < dropdownH && r.top > spaceBelow;
      setPos({
        top: openUp ? r.top - 4 : r.bottom + 4,
        left: r.left,
        minWidth: Math.max(r.width, 160),
        openUp,
      });
    };
    compute();
    window.addEventListener('scroll', compute, true);
    window.addEventListener('resize', compute);
    return () => {
      window.removeEventListener('scroll', compute, true);
      window.removeEventListener('resize', compute);
    };
  }, [anchorRef]);

  if (!pos) return null;
  return createPortal(
    <div
      ref={ref}
      className="fixed z-[9999] min-w-[160px] max-h-[260px] overflow-y-auto bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded shadow-xl py-1"
      style={{
        top: pos.top,
        left: pos.left,
        minWidth: pos.minWidth,
        transform: pos.openUp ? 'translateY(-100%)' : undefined,
      }}
    >
      {loading ? (
        <div className="px-2 py-1 text-[11px] text-[var(--text-tertiary)]">Загрузка…</div>
      ) : options.length === 0 ? (
        <div className="px-2 py-1 text-[11px] text-[var(--text-tertiary)]">Нет вариантов</div>
      ) : options.map(opt => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onPick(opt)}
          className={`w-full text-left px-2 py-1 text-[11px] hover:bg-[var(--bg-tertiary)] flex items-center gap-1.5 ${String(opt.id) === String(currentId) ? 'bg-[var(--bg-tertiary)]/60' : ''}`}
        >
          {opt.color && (
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: opt.color }} />
          )}
          <span className="text-[var(--text-primary)] truncate">{opt.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
});
PortalDropdown.displayName = 'BoundRowToolbarPortalDropdown';
