import { useRequestedFocus } from '@/shared/hooks/useRequestedFocus';
import { useWorkspaceUsers } from '@/features/users/hooks/useWorkspaceUsers';
import { useIsPublicReadOnly } from '@/features/public/PublicViewContext';
import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import * as Popover from '@radix-ui/react-popover';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { COLUMN_COLORS } from '@/features/tables/components/columns-editing/constants';
import { isValidHex } from '@/features/tables/utils/color-utils';
import { Plus, ChevronDown, ChevronRight, Trash2, ExternalLink, MessageCircle, Paperclip, X, Check, Calendar, Move, AlertCircle } from 'lucide-react';
import { EmojiPicker } from '@/features/tables/components/UniversalTable/EmojiPicker';
import { hexToRgba, formatShortDate, isOverdue, formatDateForInput, resolveCardTitle } from './kanban-utils';
import type { ExpandableCardProps, ColumnInfo } from './kanban-types';
import { ExpandedFieldsSection, SystemDatesRow, CardStatusBar, AssignedUsersRow } from './KanbanCardExpanded';

export function ExpandableCard({
  item,
  cardTitleColumn,
  cardSubtitleColumn,
  assigneeColumn,
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
  const { t } = useLanguage();
  const [editingField, setEditingField] = useState<string | null>(null);
  const requestedFocusRef = useRequestedFocus<HTMLTextAreaElement>(editingField);
  const [editValue, setEditValue] = useState<string>('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showCornerConfirm, setShowCornerConfirm] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showPrioritySelect, setShowPrioritySelect] = useState(false);
  const [showTypeSelect, setShowTypeSelect] = useState(false);
  const [showAssignedEditor, setShowAssignedEditor] = useState(false);
  const [showAssignedAddSelect, setShowAssignedAddSelect] = useState(false);
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
    ? (currentColorValue && isValidHex(currentColorValue) ? currentColorValue : null)
    : (colorOptions.find((o) => o.value === currentColorValue)?.color || null);

  // Emoji
  const currentEmoji = emojiColumn ? (item.data?.[emojiColumn] as string) || '' : (item.data?.icon as string) || (item.data?.emoji as string) || '';

  const handleStartEdit = (field: string, currentValue: unknown) => {
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

  // Explicit mapping wins; old boards retain their conventional column names.
  const assignedColInfo = assigneeColumn ? getColumnInfo(assigneeColumn)
    : getColumnInfo('assigned_to') || getColumnInfo('assigned') || getColumnInfo('assignee');
  const assignedFieldName = assigneeColumn || assignedColInfo?.name ||
    ['assigned_to', 'assigned', 'assignee'].find(name => item.data?.[name] != null) || 'assigned_to';
  const assignedRawValue = item.data?.[assignedFieldName];
  const assignedRelTableId = assignedColInfo?.config?.relation?.enabled
    ? assignedColInfo.config.relation.tableId
    : assignedColInfo?.config?.relatedTableId || (assignedColInfo?.type === 'relation' ? assignedColInfo.config?.tableId : undefined);
  const publicReadOnly = useIsPublicReadOnly();
  const systemAssignee = ['user', 'person', 'text'].includes(assignedColInfo?.type || '') && !assignedRelTableId && !assignedColInfo?.config?.options?.length &&
    (!assignedColInfo?.config?.person?.source || assignedColInfo.config.person.source === 'system');
  const users = useWorkspaceUsers(Boolean(systemAssignee && !publicReadOnly));
  const allAssignedOptions = assignedRelTableId && relationData
    ? Array.from(relationData.get(String(assignedRelTableId))?.entries() || []).map(([value, opt]) => ({ value, label: opt.label, color: opt.color }))
    : systemAssignee && !publicReadOnly
      ? (users.data || []).map(user => ({ value: String(user.id), label: user.name }))
      : assignedColInfo?.config?.options || [];
  const assignedArray: string[] = Array.isArray(assignedRawValue)
    ? assignedRawValue.map(String)
    : (assignedRawValue ? [String(assignedRawValue)] : []);
  const assignedResolved = assignedArray.map(value =>
    allAssignedOptions.find(option => option.value === value) || { value, label: value }
  );
  const assignedValue = assignedResolved.length > 0 ? assignedResolved.map(a => a.label).join(', ') : null;

  // Description
  const description = item.data?.[cardSubtitleColumn || 'description'] || item.data?.description || '';

  // Card border style
  const cardBorderStyle = currentColor ? { borderLeftColor: currentColor, borderLeftWidth: '4px' } : {};

  // Build tooltip with all ticket data
  const buildTooltip = (): string => {
    const parts: string[] = [];
    parts.push(`#${item.id} — ${resolveCardTitle(item.data, cardTitleColumn)}`);
    if (description) parts.push(`${t('kanban.description')}: ${String(description).slice(0, 200)}`);
    if (startDate) parts.push(`${t('kanban.startDate')}: ${formatShortDate(startDate)}`);
    if (endDate) parts.push(`${t('kanban.deadline')}: ${formatShortDate(endDate)}`);
    if (priorityLabel) parts.push(`${t('kanban.priority')}: ${priorityLabel}`);
    if (phaseOption?.label) parts.push(`${t('kanban.phase')}: ${phaseOption.label}`);
    if (assignedValue) parts.push(`${t('kanban.assignee')}: ${assignedValue}`);
    if (updatedAt) parts.push(`${t('kanban.updatedAt')}: ${formatShortDate(updatedAt)}`);
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
      className={`group relative bg-[var(--bg-primary)] rounded-lg border border-[var(--border-primary)] shadow-sm hover:shadow-md transition-all select-none ${
        isDragging ? 'opacity-50 scale-105' : ''
      } ${isExpanded ? 'ring-2 ring-[var(--color-primary-500)]/30' : ''}`}
    >
      {/* ═══ Corner delete (✕ top-right) — only when deletion is allowed ═══ */}
      {onDelete && (
        <div role="presentation" className="absolute top-1 right-1 z-20" onClick={(e) => e.stopPropagation()}>
          {showCornerConfirm ? (
            <div className="flex items-center gap-0.5 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-md shadow-lg px-1.5 py-1">
              <span className="text-[10px] text-red-400 mr-0.5 whitespace-nowrap">{t('kanban.deleteTicketConfirm')}</span>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(); setShowCornerConfirm(false); }}
                className="p-0.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition"
                title={t('kanban.confirmDelete')}
              >
                <Check className="w-3 h-3" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setShowCornerConfirm(false); }}
                className="p-0.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] transition"
                title={t('common.cancel')}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); setShowCornerConfirm(true); }}
              className="p-0.5 rounded-full bg-[var(--bg-primary)]/80 text-[var(--text-tertiary)] hover:text-red-400 hover:bg-red-500/15 opacity-0 group-hover:opacity-100 focus:opacity-100 transition shadow-sm"
              title={t('kanban.deleteTicket')}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* ═══ ROW 1: Emoji + Title ═══ */}
      <div className="flex items-start gap-2 p-2 pb-1.5 mb-[5px] border-b border-[var(--border-secondary)]">
        <div role="presentation" className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
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
                ref={requestedFocusRef}
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
              title={t('kanban.startDate')}
              onClick={(e) => e.stopPropagation()}
            />
          ) : scheduledDateColumn ? (
            <input
              type="datetime-local"
              value=""
              onChange={(e) => { if (onQuickEdit) onQuickEdit(scheduledDateColumn, e.target.value ? new Date(e.target.value).toISOString() : null); }}
              className="kanban-date-input bg-transparent border-none text-[11px] text-[var(--text-tertiary)] focus:outline-none cursor-pointer p-0 flex-1 min-w-0 opacity-40"
              title={t('kanban.setStartDate')}
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
              title={t('kanban.deadline')}
              onClick={(e) => e.stopPropagation()}
            />
          ) : dueDateColumn ? (
            <input
              type="datetime-local"
              value=""
              onChange={(e) => { if (onQuickEdit) onQuickEdit(dueDateColumn, e.target.value ? new Date(e.target.value).toISOString() : null); }}
              className="kanban-date-input bg-transparent border-none text-[11px] text-[var(--text-tertiary)] focus:outline-none cursor-pointer p-0 flex-1 min-w-0 opacity-40"
              title={t('kanban.setDeadline')}
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
          title={isExpanded ? t('kanban.collapse') : t('kanban.expand')}
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
          title={t('kanban.drag')}
          {...dragHandleListeners}
          {...dragHandleAttributes}
        >
          <Move className="w-3.5 h-3.5" />
        </div>

        {/* Color picker: use the table palette and preserve select option values. */}
        {colorColumn && onQuickEdit && !publicReadOnly && (
          <Popover.Root open={showColorPicker} onOpenChange={setShowColorPicker}>
            <Popover.Trigger asChild>
              <button type="button" onClick={event => event.stopPropagation()}
                aria-label={t('kanban.cardColor')} title={t('kanban.cardColor')}
                className="p-1 rounded hover:bg-[var(--bg-tertiary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-primary-500)]">
                <span aria-hidden="true" className="w-3.5 h-3.5 rounded-full border border-[var(--border-primary)] block"
                  style={{ backgroundColor: currentColor || 'var(--bg-tertiary)' }} />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content aria-label={t('kanban.cardColor')} sideOffset={4} collisionPadding={8}
                onClick={event => event.stopPropagation()}
                className="z-[9999] max-w-[calc(100vw-16px)] rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-2 shadow-xl">
                <div className="grid grid-cols-6 gap-1">
                  {(colorColType === 'select'
                    ? [{ value: null, label: t('colors.noColor'), color: undefined }, ...colorOptions]
                    : COLUMN_COLORS.map(color => ({ value: color, label: color || t('colors.noColor'), color }))
                  ).map(option => (
                    <button key={option.value || 'none'} type="button"
                      aria-label={option.label} title={option.label} aria-pressed={(currentColorValue || null) === option.value}
                      onClick={() => { onQuickEdit(colorColumn, option.value); setShowColorPicker(false); }}
                      className="h-6 w-6 rounded border border-[var(--border-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-primary-500)]"
                      style={{ backgroundColor: option.color || 'var(--bg-tertiary)' }}>
                      {(currentColorValue || null) === option.value && <Check className="mx-auto h-3 w-3 rounded bg-[var(--bg-primary)] text-[var(--text-primary)]" aria-hidden="true" />}
                      {!option.value && currentColorValue && <X className="mx-auto h-3 w-3 text-[var(--text-primary)]" aria-hidden="true" />}
                    </button>
                  ))}
                </div>
                {colorColType !== 'select' && <label className="mt-2 flex items-center gap-2 text-xs text-[var(--text-primary)]">
                  {t('kanban.customColor')}
                  <input type="color" defaultValue={currentColor || '#000000'}
                    onChange={event => onQuickEdit(colorColumn, event.target.value)} className="h-7 w-8 cursor-pointer" />
                </label>}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        )}

        {/* Priority select in toolbar */}
        {onQuickEdit && (
          <div className="relative">
            <button
              ref={priorityButtonRef}
              onClick={(e) => { e.stopPropagation(); setShowPrioritySelect(!showPrioritySelect); }}
              className="p-1 rounded hover:bg-[var(--bg-tertiary)] transition flex items-center gap-0.5"
              title={priorityLabel ? `${t('kanban.priority')}: ${priorityLabel}` : t('kanban.priority')}
              style={priorityColor ? { color: priorityColor } : undefined}
            >
              <AlertCircle className="w-3.5 h-3.5" style={!priorityColor ? { color: 'var(--text-tertiary)' } : undefined} />
              {priorityLabel && <span className="text-[10px] font-medium max-w-[50px] truncate">{priorityLabel}</span>}
            </button>
            {showPrioritySelect && priorityRelOptions.length > 0 && createPortal(
              <div role="presentation" className="fixed inset-0 z-[9998]" onClick={(e) => { e.stopPropagation(); setShowPrioritySelect(false); }}>
          <button type="button" aria-label="Закрыть выбор приоритета" className="absolute inset-0 h-full w-full" />
              <div role="presentation"
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
                    {t('kanban.none')}
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
                <span className="text-[10px] text-red-400 mr-1">{t('kanban.deleteConfirm')}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(); setShowDeleteConfirm(false); }}
                  className="p-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition"
                  title={t('kanban.confirm')}
                >
                  <Check className="w-3 h-3" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(false); }}
                  className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] transition"
                  title={t('common.cancel')}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(true); }}
                className="p-1 rounded hover:bg-red-500/15 text-[var(--text-tertiary)] hover:text-red-400 transition"
                title={t('common.delete')}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* ═══ ROW 3: Status (shown when grouping is NOT by status/state) ═══ */}
      {groupColumn !== 'state' && groupColumn !== 'status' && Boolean(phaseValue) && (() => {
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
                ref={requestedFocusRef}
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
            <button type="button"
              className={`text-xs text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap cursor-text hover:bg-[var(--bg-tertiary)]/50 rounded px-1 -mx-1 py-0.5 transition ${isExpanded ? '' : 'line-clamp-3'}`}
              onClick={() => handleStartEdit(cardSubtitleColumn || 'description', description)}
            >
              {String(description)}
            </button>
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
                ref={requestedFocusRef}
              />
              <div className="flex justify-end gap-1">
                <button onClick={handleSaveEdit} className="px-2 py-0.5 text-[10px] bg-[var(--color-primary-500)] text-white rounded">{translations.save}</button>
                <button onClick={handleCancelEdit} className="px-2 py-0.5 text-[10px] text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] rounded">{translations.cancel}</button>
              </div>
            </div>
          ) : (
            <button type="button"
              className="text-xs text-[var(--text-tertiary)] italic cursor-text hover:bg-[var(--bg-tertiary)]/50 rounded px-1 -mx-1 py-0.5"
              onClick={() => handleStartEdit(cardSubtitleColumn, '')}
            >
              {translations.noDescription}
            </button>
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
      {isExpanded && Boolean(createdAt || updatedAt) && (
        <SystemDatesRow createdAt={createdAt} updatedAt={updatedAt} />
      )}

      {/* ═══ Assigned users ═══ */}
      {systemAssignee && !publicReadOnly && (
        <div className="px-2 text-xs text-[var(--text-secondary)]" role="status">
          {users.isLoading ? t('kanban.loadingAssignees') : users.isError ? (
            <>{t('kanban.assigneesError')} <button type="button" className="underline" onClick={event => { event.stopPropagation(); void users.refetch(); }}>{t('kanban.retry')}</button></>
          ) : users.data?.length === 0 ? t('kanban.noAssignees') : null}
        </div>
      )}
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
        onQuickEdit={publicReadOnly ? undefined : onQuickEdit}
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
