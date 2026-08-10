import { Plus, RefreshCw, FileText, Tag, X, Check, Edit2, Users } from 'lucide-react';
import { createPortal } from 'react-dom';
import { hexToRgba, formatDateForInput } from './kanban-utils';
import { MiniFileUploader } from './MiniFileUploader';
import type { ColumnInfo, RelationDataMap } from './kanban-types';

// Helper to render field values (JSX — must live in .tsx)
export function renderFieldValue(value: unknown): React.ReactNode {
  if (value === null || value === undefined) {
    return <span className="text-[var(--text-tertiary)] italic">—</span>;
  }
  if (typeof value === 'boolean') {
    return value ? '✓' : '✗';
  }
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  const str = String(value);
  if (str.length > 50) {
    return str.substring(0, 50) + '...';
  }
  return str;
}

// ── Expanded fields section ──────────────────────────────────────

interface ExpandedFieldsProps {
  expandedFields: [string, unknown][];
  getColumnInfo: (name: string) => ColumnInfo | undefined;
  lookupRelation: (tableId: string | number | undefined, value: unknown) => { label: string; color?: string } | null;
  relationData?: RelationDataMap;
  onQuickEdit?: (field: string, value: unknown) => void;
  translations: { moreFields: string };
}

export function ExpandedFieldsSection({
  expandedFields, getColumnInfo, lookupRelation, relationData, onQuickEdit, translations,
}: ExpandedFieldsProps) {
  if (expandedFields.length === 0) return null;
  return (
    <div className="px-2 py-1.5 space-y-1.5">
      {expandedFields.slice(0, 8).map(([key, value]: [string, unknown]) => {
        const colInfo = getColumnInfo(key);
        const colType = colInfo?.type || 'text';
        const displayName = colInfo?.displayName || key;
        const options = colInfo?.config?.options || [];
        const relationTableId = colInfo?.config?.relation?.enabled
          ? colInfo.config.relation.tableId
          : colInfo?.config?.relatedTableId;
        const relationItem = relationTableId ? lookupRelation(relationTableId, value) : null;
        const relationOptions = relationTableId && relationData
          ? Array.from(relationData.get(String(relationTableId))?.entries() || []).map(([optValue, opt]) => ({ value: optValue, label: opt.label, color: opt.color }))
          : [];

        return (
          <div key={key} className="flex items-center gap-2">
            <span className="text-[10px] text-[var(--text-tertiary)] min-w-[70px] flex-shrink-0">{displayName}:</span>
            {relationTableId && relationOptions.length > 0 ? (
              <select
                value={String(value || '')}
                onChange={(e) => onQuickEdit?.(key, e.target.value)}
                className="flex-1 text-[11px] px-1.5 py-0.5 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none cursor-pointer truncate"
                style={{
                  backgroundColor: relationItem?.color ? hexToRgba(relationItem.color, 0.15) : undefined,
                  color: relationItem?.color || undefined,
                  maxWidth: '130px'
                }}
              >
                <option value="">—</option>
                {relationOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            ) : (colType === 'select' || colType === 'multi-select') && options.length > 0 ? (
              <select
                value={String(value || '')}
                onChange={(e) => onQuickEdit?.(key, e.target.value)}
                className="flex-1 text-[11px] px-1.5 py-0.5 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none cursor-pointer truncate"
                style={{ maxWidth: '130px' }}
              >
                <option value="">—</option>
                {options.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            ) : colType === 'date' || colType === 'datetime' ? (
              <input
                type={colType === 'datetime' ? 'datetime-local' : 'date'}
                value={formatDateForInput(value, colType)}
                onChange={(e) => onQuickEdit?.(key, e.target.value)}
                className="flex-1 text-[11px] px-1.5 py-0.5 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none"
              />
            ) : colType === 'checkbox' ? (
              <input
                type="checkbox"
                checked={Boolean(value)}
                onChange={(e) => onQuickEdit?.(key, e.target.checked)}
                className="w-3.5 h-3.5 rounded border-[var(--border-primary)]"
              />
            ) : colType === 'file' && onQuickEdit ? (
              <MiniFileUploader value={String(value || '')} fieldName={key} displayName={displayName} onUpdate={onQuickEdit} />
            ) : (
              <span className="text-xs text-[var(--text-secondary)] flex-1 truncate">{renderFieldValue(value)}</span>
            )}
          </div>
        );
      })}
      {expandedFields.length > 8 && (
        <p className="text-[10px] text-[var(--text-tertiary)] italic">+{expandedFields.length - 8} {translations.moreFields}</p>
      )}
    </div>
  );
}

// ── System dates row ─────────────────────────────────────────────

interface SystemDatesProps {
  createdAt: unknown;
  updatedAt: unknown;
}

export function SystemDatesRow({ createdAt, updatedAt }: SystemDatesProps) {
  return (
    <div className="flex items-center gap-3 px-2 py-0.5 text-[10px] text-[var(--text-quaternary)] border-t border-[var(--border-secondary)]">
      {createdAt && (
        <span className="flex items-center gap-1">
          <Plus className="w-2.5 h-2.5 rotate-45 opacity-60" />
          <span>Создан:</span>
          <span className="text-[var(--text-tertiary)]">{new Date(createdAt as string).toLocaleDateString('ru-RU')}</span>
        </span>
      )}
      {updatedAt && (
        <span className="flex items-center gap-1 ml-auto">
          <RefreshCw className="w-2.5 h-2.5 opacity-60" />
          <span>Изменён:</span>
          <span className="text-[var(--text-tertiary)]">{new Date(updatedAt as string).toLocaleDateString('ru-RU')}</span>
        </span>
      )}
    </div>
  );
}

// ── Status bar (bottom of card) ──────────────────────────────────

interface StatusBarProps {
  itemId: string | number;
  adrLabel: string | null;
  adrRelTableId?: string | number;
  adrValue: unknown;
  typeLabel: string | null;
  typeValue: unknown;
  typeRelation: { label: string; color?: string } | null;
  typeRelOptions: Array<{ value: string; label: string; color?: string }>;
  showTypeSelect: boolean;
  setShowTypeSelect: (v: boolean) => void;
  typeButtonRef: React.RefObject<HTMLButtonElement | null>;
  onQuickEdit?: (field: string, value: unknown) => void;
}

export function CardStatusBar({
  itemId, adrLabel, adrRelTableId, adrValue,
  typeLabel, typeValue, typeRelation, typeRelOptions,
  showTypeSelect, setShowTypeSelect, typeButtonRef, onQuickEdit,
}: StatusBarProps) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 border-t border-[var(--border-secondary)] text-[10px] text-[var(--text-tertiary)] bg-[var(--bg-primary)] rounded-b-lg">
      {/* ADR ref */}
      {adrLabel && (
        <a
          href={adrRelTableId && adrValue ? `/tables/${adrRelTableId}?row=${adrValue}` : '#'}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full hover:bg-[var(--color-primary-500)]/20 transition cursor-pointer"
          style={{ backgroundColor: 'var(--bg-tertiary)' }}
          title={`ADR: ${adrLabel} (открыть)`}
          onClick={(e) => e.stopPropagation()}
        >
          <FileText className="w-2.5 h-2.5" />
          <span className="max-w-[60px] truncate underline decoration-dotted">{adrLabel}</span>
        </a>
      )}

      {/* Ticket type (select) */}
      <div className="relative">
        <button
          ref={typeButtonRef}
          onClick={(e) => { e.stopPropagation(); if (typeRelOptions.length > 0) setShowTypeSelect(!showTypeSelect); }}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full hover:bg-[var(--bg-tertiary)] transition cursor-pointer"
          style={{ backgroundColor: typeRelation?.color ? hexToRgba(typeRelation.color, 0.15) : 'var(--bg-tertiary)', color: typeRelation?.color || 'var(--text-tertiary)' }}
          title={typeLabel ? `Тип: ${typeLabel}` : 'Тип тикета'}
        >
          <Tag className="w-2.5 h-2.5" />
          <span className="max-w-[60px] truncate">{typeLabel || '—'}</span>
        </button>
        {showTypeSelect && typeRelOptions.length > 0 && createPortal(
          <div className="fixed inset-0 z-[9998]" onClick={(e) => { e.stopPropagation(); setShowTypeSelect(false); }}>
          <div
            className="fixed z-[9999]"
            style={{
              top: (typeButtonRef.current?.getBoundingClientRect().top || 0) - (typeRelOptions.length * 24 + 32),
              left: typeButtonRef.current?.getBoundingClientRect().left || 0,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-xl p-1 min-w-[100px]">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onQuickEdit?.('type', null);
                  setShowTypeSelect(false);
                }}
                className="w-full text-left px-2 py-1 text-[11px] text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] rounded transition"
              >
                — нет —
              </button>
              {typeRelOptions.map(opt => (
                <button
                  key={opt.value}
                  onClick={(e) => {
                    e.stopPropagation();
                    onQuickEdit?.('type', opt.value);
                    setShowTypeSelect(false);
                  }}
                  className={`w-full text-left px-2 py-1 text-[11px] hover:bg-[var(--bg-tertiary)] rounded transition flex items-center gap-1.5 ${String(typeValue) === opt.value ? 'font-medium' : ''}`}
                  style={opt.color ? { color: opt.color } : undefined}
                >
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: opt.color || 'var(--text-tertiary)' }} />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          </div>,
          document.body
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Ticket number */}
      <span className="font-mono text-[var(--text-quaternary)]">#{itemId}</span>
    </div>
  );
}

// ── Assigned users row ───────────────────────────────────────────

interface AssignedUsersProps {
  assignedResolved: Array<{ value: string; label: string; color?: string }>;
  assignedArray: string[];
  assignedFieldName: string;
  allAssignedOptions: Array<{ value: string; label: string; color?: string }>;
  showAssignedEditor: boolean;
  setShowAssignedEditor: (v: boolean) => void;
  showAssignedAddSelect: boolean;
  setShowAssignedAddSelect: (v: boolean) => void;
  assignedButtonRef: React.RefObject<HTMLDivElement | null>;
  itemId: string | number;
  onQuickEdit?: (field: string, value: unknown) => void;
  onOpenChat?: () => void;
}

export function AssignedUsersRow({
  assignedResolved, assignedArray, assignedFieldName, allAssignedOptions,
  showAssignedEditor, setShowAssignedEditor, showAssignedAddSelect, setShowAssignedAddSelect,
  assignedButtonRef, itemId, onQuickEdit, onOpenChat,
}: AssignedUsersProps) {
  return (
    <div className="flex items-center gap-1 px-2 py-1 text-[11px] border-t border-[var(--border-secondary)]" ref={assignedButtonRef}>
      <Users className="w-3 h-3 text-[var(--text-tertiary)] flex-shrink-0" />
      {showAssignedEditor ? (
        <div className="flex-1 flex items-center gap-1 flex-wrap min-w-0">
          {assignedResolved.map(user => (
            <span key={user.value} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">
              <span className="truncate max-w-[60px]">{user.label}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const newArr = assignedArray.filter(v => v !== user.value);
                  onQuickEdit?.(assignedFieldName, newArr.length > 0 ? newArr : null);
                }}
                className="text-red-400 hover:text-red-300 ml-0.5"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setShowAssignedAddSelect(!showAssignedAddSelect); }}
              className="w-5 h-5 rounded-full border border-dashed border-[var(--color-primary-500)]/40 bg-[var(--color-primary-500)]/5 flex items-center justify-center text-[var(--color-primary-400)] hover:text-[var(--color-primary-500)] hover:border-[var(--color-primary-500)] transition"
              title="Добавить"
            >
              <Plus className="w-3 h-3" />
            </button>
            {showAssignedAddSelect && allAssignedOptions.length > 0 && createPortal(
              <div className="fixed inset-0 z-[9998]" onClick={(e) => { e.stopPropagation(); setShowAssignedAddSelect(false); }}>
                <div
                  className="fixed z-[9999]"
                  style={{
                    top: (assignedButtonRef.current?.getBoundingClientRect().bottom || 0) + 2,
                    left: (assignedButtonRef.current?.getBoundingClientRect().left || 0),
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-xl p-1 w-[140px] max-h-[150px] overflow-y-auto">
                    {allAssignedOptions
                      .filter(opt => !assignedArray.includes(opt.value))
                      .map(opt => (
                        <button
                          key={opt.value}
                          onClick={(e) => {
                            e.stopPropagation();
                            const newArr = [...assignedArray, opt.value];
                            onQuickEdit?.(assignedFieldName, newArr);
                            setShowAssignedAddSelect(false);
                          }}
                          className="w-full text-left px-2 py-1 text-[11px] hover:bg-[var(--bg-tertiary)] rounded transition truncate"
                        >
                          {opt.label}
                        </button>
                      ))}
                    {allAssignedOptions.filter(opt => !assignedArray.includes(opt.value)).length === 0 && (
                      <div className="px-2 py-1 text-[11px] text-[var(--text-tertiary)] italic">Все добавлены</div>
                    )}
                  </div>
                </div>
              </div>,
              document.body
            )}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); setShowAssignedEditor(false); setShowAssignedAddSelect(false); }}
            className="ml-auto p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
          >
            <Check className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <div className="flex-1 flex items-center gap-1 min-w-0">
          {assignedResolved.length > 0 ? (
            assignedResolved.map((user, idx) => (
              <button
                key={user.value}
                onClick={(e) => {
                  e.stopPropagation();
                  if (onOpenChat) onOpenChat();
                  try {
                    window.dispatchEvent(new CustomEvent('kanban-mention-user', { detail: { userId: user.value, userName: user.label, rowId: String(itemId) } }));
                  } catch {}
                }}
                className="text-[var(--text-secondary)] hover:text-[var(--color-primary-500)] transition truncate px-1 py-0.5 rounded hover:bg-[var(--color-primary-500)]/10"
                title={`Открыть чат и упомянуть @${user.label}`}
              >
                {user.label}{idx < assignedResolved.length - 1 ? ',' : ''}
              </button>
            ))
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); setShowAssignedEditor(true); }}
              className="w-4 h-4 rounded-full flex items-center justify-center text-[var(--text-quaternary)] opacity-0 group-hover:opacity-100 hover:!text-[var(--color-primary-500)] transition"
              title="Назначить ответственного"
            >
              <Plus className="w-2.5 h-2.5" />
            </button>
          )}
          {onQuickEdit && (
            <button
              onClick={(e) => { e.stopPropagation(); setShowAssignedEditor(true); }}
              className="ml-auto p-0.5 text-[var(--text-tertiary)] hover:text-[var(--color-primary-500)] transition"
              title="Редактировать"
            >
              <Edit2 className="w-3 h-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
