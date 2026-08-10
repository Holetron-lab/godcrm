import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Plus, ChevronDown, ChevronRight, Trash2, ExternalLink, MessageCircle, Paperclip, X, Check, Calendar, Move, AlertCircle } from 'lucide-react';
import { EmojiPicker } from '@/features/tables/components/UniversalTable/EmojiPicker';
import { hexToRgba, formatShortDate, isOverdue, formatDateForInput, resolveCardTitle } from './kanban-utils';
import type { ExpandableCardProps, ColumnInfo, FieldValue } from './kanban-types';
import { ExpandedFieldsSection, SystemDatesRow, CardStatusBar, AssignedUsersRow } from './KanbanCardExpanded';

export function ExpandableCard({
  item,
  cardTitleColumn,
  cardSubtitleColumn,
  scheduledDateColumn,
  dueDateColumn,
  colorColumn,
  emojiColumn,
  groupColumn,
  cardColumns = [],
  visibleColumns = [],
  columnsInfo = [],
  relationData,
  isExpanded,
  onToggleExpand,
  onDoubleClick,
  onOpenComments,
  onOpenChat,
  onAttachToMessage,
  onQuickEdit,
  onDelete,
  isDragging,
  dragHandleListeners,
  dragHandleAttributes,
  translations
}: ExpandableCardProps) {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showPrioritySelect, setShowPrioritySelect] = useState(false);
  const [showTypeSelect, setShowTypeSelect] = useState(false);
  const [showAssignedEditor, setShowAssignedEditor] = useState(false);
  const [showAssignedAddSelect, setShowAssignedAddSelect] = useState(false);
  const colorButtonRef = useRef<HTMLButtonElement>(null);
  const priorityButtonRef = useRef<HTMLButtonElement>(null);
  const typeButtonRef = useRef<HTMLButtonElement>(null);
  const assignedButtonRef = useRef<HTMLDivElement>(null);

  const getColumnInfo = (name: string): ColumnInfo | undefined => {
    return columnsInfo.find(c => c.name === name);
  };

  const lookupRelation = (tableId: string | number | undefined, value: unknown): { label: string; color?: string } | null => {
    if (!tableId || !relationData || value === null || value === undefined) return null;
    const tableMap = relationData.get(String(tableId));
    if (!tableMap) return null;
    return tableMap.get(String(value)) || null;
  };

  // Color column — supports both 'select' (with options) and 'color' (hex value directly)
  const colorColInfo = colorColumn ? getColumnInfo(colorColumn) : null;
  const colorColType = colorColInfo?.type || '';
  const colorOptions = colorColInfo?.config?.options || [];
  const currentColorValue = colorColumn ? (item.data?.[colorColumn] as string) : null;
  const currentColor = colorColType === 'color'
    ? (currentColorValue && /^#[0-9A-Fa-f]{3,8}$/.test(currentColorValue) ? currentColorValue : null)
    : (colorOptions.find((o) => o.value === currentColorValue)?.color || null);

  // Emoji
  const currentEmoji = emojiColumn ? (item.data?.[emojiColumn] as string) || '' : (item.data?.icon as string) || (item.data?.emoji as string) || '';

  const handleStartEdit = (field: string, currentValue: FieldValue) => {
    setEditingField(field);
    setEditValue(String(currentValue || ''));
  };

  const handleSaveEdit = () => {
    if (editingField && onQuickEdit) onQuickEdit(editingField, editValue);
    setEditingField(null);
  };

  const handleCancelEdit = () => {
    setEditingField(null);
    setEditValue('');
  };

  // Dates
  const startDate = scheduledDateColumn ? item.data?.[scheduledDateColumn] : null;
  const endDate = dueDateColumn ? item.data?.[dueDateColumn] : null;
  const createdAt = (item as Record<string, unknown>).created_at || item.data?.created_at;
  const updatedAt = (item as Record<string, unknown>).updated_at || item.data?.updated_at;

  // Priority & phase from data
  const priorityValue = item.data?.priority;
  const phaseValue = item.data?.phase || item.data?.state || item.data?.[groupColumn || ''];

  // Resolve priority via relation data
  const priorityColInfo = getColumnInfo('priority');
  const priorityRelTableId = priorityColInfo?.config?.relation?.enabled
    ? priorityColInfo.config.relation.tableId
    : priorityColInfo?.config?.relatedTableId;
  const priorityRelation = priorityRelTableId ? lookupRelation(priorityRelTableId, priorityValue) : null;
  const priorityLabel = priorityRelation?.label || (priorityValue ? String(priorityValue) : null);
  const priorityColor = priorityRelation?.color || null;
  const priorityRelOptions = priorityRelTableId && relationData
    ? Array.from(relationData.get(String(priorityRelTableId))?.entries() || []).map(([v, opt]) => ({ value: v, label: opt.label, color: opt.color }))
    : [];

  // Resolve type via relation data
  const typeValue = item.data?.type;
  const typeColInfo = getColumnInfo('type');
  const typeRelTableId = typeColInfo?.config?.relation?.enabled
    ? typeColInfo.config.relation.tableId
    : typeColInfo?.config?.relatedTableId;
  const typeRelation = typeRelTableId ? lookupRelation(typeRelTableId, typeValue) : null;
  const typeLabel = typeRelation?.label || (typeValue ? String(typeValue) : null);
  const typeRelOptions = typeRelTableId && relationData
    ? Array.from(relationData.get(String(typeRelTableId))?.entries() || []).map(([v, opt]) => ({ value: v, label: opt.label, color: opt.color }))
    : [];

  // Resolve ADR ref via relation data
  const adrValue = item.data?.adr_ref;
  const adrColInfo = getColumnInfo('adr_ref');
  const adrRelTableId = adrColInfo?.config?.relation?.enabled
    ? adrColInfo.config.relation.tableId
    : adrColInfo?.config?.relatedTableId;
  const adrRelation = adrRelTableId ? lookupRelation(adrRelTableId, adrValue) : null;
  const adrLabel = adrRelation?.label || (adrValue ? String(adrValue) : null);

  // Resolve phase/state display
  const groupColInfo = getColumnInfo(groupColumn || 'state');
  const groupOptions = groupColInfo?.config?.options || [];
  const phaseOption = groupOptions.find(o => o.value === String(phaseValue));

  // Assigned users — resolve via relation data if available
  const assignedRawValue = item.data?.assigned || item.data?.assignee || item.data?.assigned_to;
  const assignedColInfo = getColumnInfo('assigned_to') || getColumnInfo('assigned') || getColumnInfo('assignee');
  const assignedFieldName = assignedColInfo?.name || 'assigned_to';
  const assignedRelTableId = assignedColInfo?.config?.relation?.enabled
    ? assignedColInfo.config.relation.tableId
    : assignedColInfo?.config?.relatedTableId;
  const assignedArray: string[] = Array.isArray(assignedRawValue)
    ? assignedRawValue.map(String)
    : (assignedRawValue ? [String(assignedRawValue)] : []);
  const assignedResolved = assignedArray.map(v => {
    const rel = assignedRelTableId ? lookupRelation(assignedRelTableId, v) : null;
    return { value: v, label: rel?.label || v, color: rel?.color };
  });
  const allAssignedOptions = assignedRelTableId && relationData
    ? Array.from(relationData.get(String(assignedRelTableId))?.entries() || []).map(([v, opt]) => ({ value: v, label: opt.label, color: opt.color }))
    : [];
  const assignedValue = assignedResolved.length > 0 ? assignedResolved.map(a => a.label).join(', ') : null;

  // Description
  const description = item.data?.[cardSubtitleColumn || 'description'] || item.data?.description || '';

  // Card border style
  const cardBorderStyle = currentColor ? { borderLeftColor: currentColor, borderLeftWidth: '4px' } : {};

  // Build tooltip with all ticket data
  const buildTooltip = (): string => {
    const parts: string[] = [];
    parts.push(`#${item.id} — ${resolveCardTitle(item.data, cardTitleColumn)}`);
    if (description) parts.push(`Описание: ${String(description).slice(0, 200)}`);
    if (startDate) parts.push(`Начало: ${formatShortDate(startDate)}`);
    if (endDate) parts.push(`Дедлайн: ${formatShortDate(endDate)}`);
    if (priorityLabel) parts.push(`Приоритет: ${priorityLabel}`);
    if (phaseOption?.label) parts.push(`Фаза: ${phaseOption.label}`);
    if (assignedValue) parts.push(`Ответственный: ${assignedValue}`);
    if (updatedAt) parts.push(`Обновлён: ${formatShortDate(updatedAt)}`);
    return parts.join('\n');
  };

  // Expanded fields for detailed view
  const alreadyShownFields = new Set([
    cardTitleColumn,
    cardSubtitleColumn || 'description',
    groupColumn || '',
    emojiColumn || '',
    colorColumn || '',
    scheduledDateColumn || '',
    dueDateColumn || '',
    assignedFieldName,
    'id', 'created_at', 'updated_at', 'icon', 'emoji', 'description',
    'priority', 'assigned', 'assignee', 'assigned_to', 'type', 'adr_ref',
    'state', 'status', 'phase',
    ...cardColumns,
  ].filter(Boolean));

  const expandedFields = Object.entries(item.data || {}).filter(([key]) =>
    !alreadyShownFields.has(key) &&
    (visibleColumns.length === 0 || visibleColumns.includes(key))
  );

  return (
    <div
      style={cardBorderStyle}
      className={`group bg-[var(--bg-primary)] rounded-lg border border-[var(--border-primary)] shadow-sm hover:shadow-md transition-all select-none ${
        isDragging ? 'opacity-50 scale-105' : ''
      } ${isExpanded ? 'ring-2 ring-[var(--color-primary-500)]/30' : ''}`}
    >
      {/* ═══ ROW 1: Emoji + Title ═══ */}
      <div className="flex items-start gap-2 p-2 pb-1.5 mb-[5px] border-b border-[var(--border-secondary)]">
        <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <EmojiPicker
            value={currentEmoji || ''}
            onChange={(emoji) => {
              const field = emojiColumn || 'icon';
              onQuickEdit?.(field, emoji);
            }}
            compact
            size="sm"
            portal
            buttonPosition="bottom"
          />
        </div>

        <div
          className="flex-1 min-w-0 cursor-grab touch-none"
          {...dragHandleListeners}
          {...dragHandleAttributes}
        >
          {editingField === cardTitleColumn ? (
            <div className="flex flex-col gap-1 bg-[var(--bg-secondary)] rounded px-1 py-0.5">
              <textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="w-full px-1.5 py-0.5 text-sm rounded border border-[var(--color-primary-500)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none resize-none"
                rows={3}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSaveEdit(); }
                  if (e.key === 'Escape') handleCancelEdit();
                }}
              />
              <div className="flex justify-end gap-1">
                <button onClick={handleSaveEdit} className="p-0.5 text-green-500 hover:bg-green-500/10 rounded"><Check className="w-3 h-3" /></button>
                <button onClick={handleCancelEdit} className="p-0.5 text-red-500 hover:bg-red-500/10 rounded"><X className="w-3 h-3" /></button>
              </div>
            </div>
          ) : (
            <p
              className="font-medium text-[var(--text-primary)] text-sm leading-snug line-clamp-6 min-h-[2.5em] hover:text-[var(--color-primary-500)] transition-colors"
              onDoubleClick={() => handleStartEdit(cardTitleColumn, item.data?.[cardTitleColumn])}
            >
              {resolveCardTitle(item.data, cardTitleColumn)}
            </p>
          )}
        </div>
      </div>

      {/* ═══ ROW 2: Deadlines (only if date columns configured) ═══ */}
      {(scheduledDateColumn || dueDateColumn) && (
        <div className="flex items-center gap-1 px-2 py-1 text-[11px] text-[var(--text-tertiary)]">
          {startDate ? (
            <input
              type="datetime-local"
              value={formatDateForInput(startDate, 'datetime')}
              onChange={(e) => { if (scheduledDateColumn && onQuickEdit) onQuickEdit(scheduledDateColumn, e.target.value ? new Date(e.target.value).toISOString() : null); }}
              className="kanban-date-input bg-transparent border-none text-[11px] text-[var(--text-tertiary)] focus:outline-none cursor-pointer p-0 flex-1 min-w-0"
              title="Дата начала"
              onClick={(e) => e.stopPropagation()}
            />
          ) : scheduledDateColumn ? (
            <input
              type="datetime-local"
              value=""
              onChange={(e) => { if (onQuickEdit) onQuickEdit(scheduledDateColumn, e.target.value ? new Date(e.target.value).toISOString() : null); }}
              className="kanban-date-input bg-transparent border-none text-[11px] text-[var(--text-tertiary)] focus:outline-none cursor-pointer p-0 flex-1 min-w-0 opacity-40"
              title="Задать дату начала"
              onClick={(e) => e.stopPropagation()}
            />
          ) : null}
          {scheduledDateColumn && dueDateColumn && (
            <span className="text-[var(--text-quaternary)] flex-shrink-0">→</span>
          )}
          {endDate ? (
            <input
              type="datetime-local"
              value={formatDateForInput(endDate, 'datetime')}
              onChange={(e) => { if (dueDateColumn && onQuickEdit) onQuickEdit(dueDateColumn, e.target.value ? new Date(e.target.value).toISOString() : null); }}
              className={`kanban-date-input bg-transparent border-none text-[11px] focus:outline-none cursor-pointer p-0 flex-1 min-w-0 ${isOverdue(endDate) ? 'text-red-400 font-medium' : 'text-[var(--text-tertiary)]'}`}
              title="Дедлайн"
              onClick={(e) => e.stopPropagation()}
            />
          ) : dueDateColumn ? (
            <input
              type="datetime-local"
              value=""
              onChange={(e) => { if (onQuickEdit) onQuickEdit(dueDateColumn, e.target.value ? new Date(e.target.value).toISOString() : null); }}
              className="kanban-date-input bg-transparent border-none text-[11px] text-[var(--text-tertiary)] focus:outline-none cursor-pointer p-0 flex-1 min-w-0 opacity-40"
              title="Задать дедлайн"
              onClick={(e) => e.stopPropagation()}
            />
          ) : null}
        </div>
      )}

      {/* ═══ ROW 3: Toolbar ═══ */}
      <div className="flex items-center gap-0.5 px-2 py-1 border-b border-[var(--border-secondary)]">
        <button
          onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
          className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition"
          title={isExpanded ? 'Свернуть' : 'Развернуть'}
        >
          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDoubleClick(); }}
          className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition"
          title={translations.openFull}
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
        {onOpenChat && (
          <button
            onClick={(e) => { e.stopPropagation(); onOpenChat(); }}
            className="p-1 rounded hover:bg-blue-500/15 text-[var(--text-tertiary)] hover:text-blue-400 transition"
            title={translations.chat}
          >
            <MessageCircle className="w-3.5 h-3.5" />
          </button>
        )}
        {onAttachToMessage && (
          <button
            onClick={(e) => { e.stopPropagation(); onAttachToMessage(); }}
            className="p-1 rounded hover:bg-green-500/15 text-[var(--text-tertiary)] hover:text-green-400 transition"
            title={translations.attachToMessage}
          >
            <Paperclip className="w-3.5 h-3.5" />
          </button>
        )}
        <div
          className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition cursor-grab touch-none"
          title="Перетащить"
          {...dragHandleListeners}
          {...dragHandleAttributes}
        >
          <Move className="w-3.5 h-3.5" />
        </div>

        {/* Color picker */}
        {colorColumn && onQuickEdit && (
          <div className="relative">
            <button
              ref={colorButtonRef}
              onClick={(e) => { e.stopPropagation(); setShowColorPicker(!showColorPicker); }}
              className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition"
              title="Цвет кар��очки"
            >
              <span className="w-3.5 h-3.5 rounded-full border border-[var(--border-primary)] inline-block" style={{ backgroundColor: currentColor || 'var(--bg-tertiary)' }} />
            </button>
            {showColorPicker && createPortal(
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
                    {[null, '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16',
                      '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6',
                      '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#78716c', '#64748b',
                      '#1e293b', '#0f172a', '#fbbf24', '#a3e635', '#2dd4bf', '#38bdf8',
                    ].map((c, i) => (
                      <button
                        key={i}
                        onClick={(e) => {
                          e.stopPropagation();
                          onQuickEdit(colorColumn, c);
                          setShowColorPicker(false);
                        }}
                        className={`h-5 w-5 rounded border transition-all ${
                          currentColor === c ? 'border-white ring-1 ring-[var(--color-primary-500)]' : 'border-transparent hover:border-white/30'
                        }`}
                        style={{
                          backgroundColor: c || 'var(--bg-tertiary)',
                          backgroundImage: c ? undefined : 'linear-gradient(45deg, #666 25%, transparent 25%), linear-gradient(-45deg, #666 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #666 75%), linear-gradient(-45deg, transparent 75%, #666 75%)',
                          backgroundSize: c ? undefined : '4px 4px'
                        }}
                        title={c || 'Без цвета'}
                      />
                    ))}
                  </div>
                </div>
              </div>,
              document.body
            )}
          </div>
        )}

        {/* Priority select in toolbar */}
        {onQuickEdit && (
          <div className="relative">
            <button
              ref={priorityButtonRef}
              onClick={(e) => { e.stopPropagation(); setShowPrioritySelect(!showPrioritySelect); }}
              className="p-1 rounded hover:bg-[var(--bg-tertiary)] transition flex items-center gap-0.5"
              title={priorityLabel ? `Приоритет: ${priorityLabel}` : 'Приоритет'}
              style={priorityColor ? { color: priorityColor } : undefined}
            >
              <AlertCircle className="w-3.5 h-3.5" style={!priorityColor ? { color: 'var(--text-tertiary)' } : undefined} />
              {priorityLabel && <span className="text-[10px] font-medium max-w-[50px] truncate">{priorityLabel}</span>}
            </button>
            {showPrioritySelect && priorityRelOptions.length > 0 && createPortal(
              <div className="fixed inset-0 z-[9998]" onClick={(e) => { e.stopPropagation(); setShowPrioritySelect(false); }}>
              <div
                className="fixed z-[9999]"
                style={{
                  top: (priorityButtonRef.current?.getBoundingClientRect().bottom || 0) + 4,
                  left: (priorityButtonRef.current?.getBoundingClientRect().left || 0) - 20,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-xl p-1 min-w-[100px]">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onQuickEdit('priority', null);
                      setShowPrioritySelect(false);
                    }}
                    className="w-full text-left px-2 py-1 text-[11px] text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] rounded transition"
                  >
                    — нет —
                  </button>
                  {priorityRelOptions.map(opt => (
                    <button
                      key={opt.value}
                      onClick={(e) => {
                        e.stopPropagation();
                        onQuickEdit('priority', opt.value);
                        setShowPrioritySelect(false);
                      }}
                      className={`w-full text-left px-2 py-1 text-[11px] hover:bg-[var(--bg-tertiary)] rounded transition flex items-center gap-1.5 ${String(priorityValue) === opt.value ? 'font-medium' : ''}`}
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
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Delete with confirmation */}
        {onDelete && (
          <div className="relative">
            {showDeleteConfirm ? (
              <div className="flex items-center gap-0.5">
                <span className="text-[10px] text-red-400 mr-1">Удалить?</span>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(); setShowDeleteConfirm(false); }}
                  className="p-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition"
                  title="Подтвердить"
                >
                  <Check className="w-3 h-3" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(false); }}
                  className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] transition"
                  title="Отмена"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(true); }}
                className="p-1 rounded hover:bg-red-500/15 text-[var(--text-tertiary)] hover:text-red-400 transition"
                title="Удалить"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* ═══ ROW 3: Status (shown when grouping is NOT by status/state) ═══ */}
      {groupColumn !== 'state' && groupColumn !== 'status' && phaseValue && (() => {
        const stateColInfo = getColumnInfo('state') || getColumnInfo('status');
        const stateRelTableId = stateColInfo?.config?.relation?.enabled
          ? stateColInfo.config.relation.tableId
          : stateColInfo?.config?.relatedTableId;
        const stateRelation = stateRelTableId ? lookupRelation(stateRelTableId, phaseValue) : null;
        const stateLabel = stateRelation?.label || phaseOption?.label || String(phaseValue);
        const stateColor = stateRelation?.color || phaseOption?.color || null;
        const stateOptions = stateRelTableId && relationData
          ? Array.from(relationData.get(String(stateRelTableId))?.entries() || []).map(([v, opt]) => ({ value: v, label: opt.label, color: opt.color }))
          : (groupOptions.length > 0 ? groupOptions.map(o => ({ value: o.value, label: o.label, color: o.color })) : []);
        return (
          <div
            className="flex items-center gap-1.5 px-2 py-1 text-[11px] rounded-sm"
            style={{ backgroundColor: stateColor ? hexToRgba(stateColor, 0.12) : undefined }}
          >
            <select
              value={String(phaseValue)}
              onChange={(e) => {
                const field = stateColInfo?.name || 'state';
                onQuickEdit?.(field, e.target.value);
              }}
              className="flex-1 text-[11px] px-1 py-0.5 rounded border-none bg-transparent cursor-pointer focus:outline-none font-medium"
              style={{ color: stateColor || 'var(--text-secondary)' }}
              onClick={(e) => e.stopPropagation()}
            >
              {stateOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        );
      })()}

      {/* ═══ ROW 4: Description ═══ */}
      {description ? (
        <div
          className="px-2 py-1 cursor-grab touch-none"
          title={!isExpanded ? buildTooltip() : undefined}
          {...(!isExpanded ? dragHandleListeners : {})}
          {...(!isExpanded ? dragHandleAttributes : {})}
        >
          {editingField === (cardSubtitleColumn || 'description') ? (
            <div className="flex flex-col gap-1">
              <textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="w-full px-2 py-1 text-xs rounded border border-[var(--color-primary-500)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none resize-none"
                rows={5}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Escape') handleCancelEdit();
                }}
              />
              <div className="flex justify-end gap-1">
                <button onClick={handleSaveEdit} className="px-2 py-0.5 text-[10px] bg-[var(--color-primary-500)] text-white rounded">{translations.save}</button>
                <button onClick={handleCancelEdit} className="px-2 py-0.5 text-[10px] text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] rounded">{translations.cancel}</button>
              </div>
            </div>
          ) : (
            <p
              className={`text-xs text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap cursor-text hover:bg-[var(--bg-tertiary)]/50 rounded px-1 -mx-1 py-0.5 transition ${isExpanded ? '' : 'line-clamp-3'}`}
              onClick={() => handleStartEdit(cardSubtitleColumn || 'description', description)}
            >
              {String(description)}
            </p>
          )}
        </div>
      ) : cardSubtitleColumn ? (
        <div className="px-2 py-1">
          {editingField === cardSubtitleColumn ? (
            <div className="flex flex-col gap-1">
              <textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="w-full px-2 py-1 text-xs rounded border border-[var(--color-primary-500)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none resize-none"
                rows={3}
                autoFocus
              />
              <div className="flex justify-end gap-1">
                <button onClick={handleSaveEdit} className="px-2 py-0.5 text-[10px] bg-[var(--color-primary-500)] text-white rounded">{translations.save}</button>
                <button onClick={handleCancelEdit} className="px-2 py-0.5 text-[10px] text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] rounded">{translations.cancel}</button>
              </div>
            </div>
          ) : (
            <p
              className="text-xs text-[var(--text-tertiary)] italic cursor-text hover:bg-[var(--bg-tertiary)]/50 rounded px-1 -mx-1 py-0.5"
              onClick={() => handleStartEdit(cardSubtitleColumn, '')}
            >
              {translations.noDescription}
            </p>
          )}
        </div>
      ) : null}

      {/* ═══ Expanded Content — extra fields ═══ */}
      {isExpanded && (
        <div className="border-t border-[var(--border-primary)] bg-[var(--bg-tertiary)]/50">
          <ExpandedFieldsSection
            expandedFields={expandedFields}
            getColumnInfo={getColumnInfo}
            lookupRelation={lookupRelation}
            relationData={relationData}
            onQuickEdit={onQuickEdit}
            translations={translations}
          />
        </div>
      )}

      {/* ═══ System dates ═══ */}
      {isExpanded && (createdAt || updatedAt) && (
        <SystemDatesRow createdAt={createdAt} updatedAt={updatedAt} />
      )}

      {/* ═══ Assigned users ═══ */}
      <AssignedUsersRow
        assignedResolved={assignedResolved}
        assignedArray={assignedArray}
        assignedFieldName={assignedFieldName}
        allAssignedOptions={allAssignedOptions}
        showAssignedEditor={showAssignedEditor}
        setShowAssignedEditor={setShowAssignedEditor}
        showAssignedAddSelect={showAssignedAddSelect}
        setShowAssignedAddSelect={setShowAssignedAddSelect}
        assignedButtonRef={assignedButtonRef}
        itemId={item.id}
        onQuickEdit={onQuickEdit}
        onOpenChat={onOpenChat}
      />

      {/* ═══ STATUS BAR (bottom) ═══ */}
      <CardStatusBar
        itemId={item.id}
        adrLabel={adrLabel}
        adrRelTableId={adrRelTableId}
        adrValue={adrValue}
        typeLabel={typeLabel}
        typeValue={typeValue}
        typeRelation={typeRelation}
        typeRelOptions={typeRelOptions}
        showTypeSelect={showTypeSelect}
        setShowTypeSelect={setShowTypeSelect}
        typeButtonRef={typeButtonRef}
        onQuickEdit={onQuickEdit}
      />
    </div>
  );
}
