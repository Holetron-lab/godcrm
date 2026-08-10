/**
 * TicketCardContent - Reusable ticket/task card content
 * 
 * Used in:
 * - Documents widget (TicketsListView) - as accordion content
 * - Kanban widget (CardDetailModal) - as modal content
 * - Timeline widget - as inline card
 * 
 * Features:
 * - Status dropdown with color indicators
 * - Priority selector
 * - Due date / deadline display and edit
 * - Document binding display
 * - Description with expand/collapse
 * - Chat button (opens chat panel)
 * - Created by / Updated info
 */

import { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDown,
  ChevronUp,
  Calendar,
  Clock,
  MessageCircle,
  ExternalLink,
  Paperclip,
  FileText,
  User,
  Users,
  AlertCircle,
  Check,
  X,
  Edit2,
  Plus,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { formatDate } from '@/shared/utils/dateFormat';
import { MarkdownPreview } from '@/shared/components/MarkdownPreview';
import { TicketSealSection } from '@/shared/components/TicketSealSection';
import { useLanguage } from '@/shared/i18n/LanguageContext';

// ============ TYPES ============

export interface TicketDictItem {
  id: number;
  name?: string;
  icon?: string;
  color?: string;
  [key: string]: unknown;
}

export interface TicketData {
  id: number;
  title: string;
  description?: string;
  type?: number;
  state?: number;
  priority?: number;
  created_date?: string;
  due_date?: string;
  deadline?: string;
  created_by?: number;
  created_by_name?: string;
  updated_at?: string;
  document_id?: number;
  document_title?: string;
  /** ADR-0002 §8 Phase 4 — TOTP-signed seal columns. Populated only on rows
   *  from Tickets table (1708); harmless on other tables. */
  sealed_at?: string | null;
  sealed_by?: string | number | null;
  [key: string]: unknown;
}

export interface TicketCardContentProps {
  /** Ticket data */
  ticket: TicketData;
  
  /** Dictionaries for lookups */
  types?: TicketDictItem[];
  states?: TicketDictItem[];
  priorities?: TicketDictItem[];

  /** Assignee picker — options come from the relation table; the current
   * value is an array of stringified ids; null clears the field. */
  assignedOptions?: Array<{ value: string; label: string; color?: string }>;
  assignedValue?: string[];
  onAssignedChange?: (value: Array<string | number> | null) => void;

  /** Layout mode */
  mode: 'accordion' | 'modal' | 'inline';

  /** Whether expanded (for accordion mode) */
  isExpanded?: boolean;

  /** Callbacks */
  onStatusChange?: (newStatusId: number) => void;
  onPriorityChange?: (newPriorityId: number) => void;
  onDueDateChange?: (newDate: string) => void;
  onOpenChat?: () => void;
  onOpenFull?: () => void;
  onAttachToMessage?: () => void;
  onOpenDocument?: (documentId: number) => void;
  onEdit?: () => void;
  /** Callback when description content changes (e.g. checkbox toggle) */
  onDescriptionChange?: (newContent: string) => void;

  /** Show/hide sections */
  showDescription?: boolean;
  showDates?: boolean;
  showDocumentBinding?: boolean;
  showChatButton?: boolean;
  showEditButton?: boolean;
  /** ADR-0002 §8 Phase 4 — render the seal/un-seal section. Only meaningful for
   *  rows from the Tickets table (1708). The button itself appears only when
   *  the ticket is in `done`-equivalent state (computed inside this component
   *  from ticket.state via the supplied states[] dictionary). */
  showSeal?: boolean;
  /** Optional callback invoked after a successful seal so the parent can
   *  refetch / invalidate caches above and beyond the global invalidations
   *  the section already triggers. */
  onSealed?: () => void;

  /** Compact mode - less padding, smaller text */
  compact?: boolean;
}

// ============ HELPERS ============

const STATE_COLORS: Record<string, string> = {
  backlog: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  'in progress': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  'in-progress': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  review: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  done: 'bg-green-500/20 text-green-400 border-green-500/30',
  closed: 'bg-green-500/20 text-green-400 border-green-500/30',
  'on hold': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  todo: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  open: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  new: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'text-red-500',
  high: 'text-orange-500',
  medium: 'text-yellow-500',
  low: 'text-green-500',
  none: 'text-gray-400',
};

const TYPE_ICONS: Record<string, string> = {
  bug: '🐛',
  story: '📖',
  task: '✅',
  spike: '🔬',
  feature: '✨',
  improvement: '📈',
  epic: '🏔️',
};

function getStateName(stateId: number | undefined, states: TicketDictItem[], notSelected: string): string {
  if (!stateId) return notSelected;
  const item = states.find(s => s.id === stateId);
  return (item?.name as string) || notSelected;
}

function getStateColor(stateId: number | undefined, states: TicketDictItem[]): string {
  if (!stateId) return STATE_COLORS.backlog;
  const item = states.find(s => s.id === stateId);
  const name = (item?.name || '').toLowerCase();
  return STATE_COLORS[name] || STATE_COLORS.backlog;
}

function getPriorityName(priorityId: number | undefined, priorities: TicketDictItem[], notSelected: string): string {
  if (!priorityId) return notSelected;
  const item = priorities.find(p => p.id === priorityId);
  return (item?.name as string) || notSelected;
}

function getPriorityColor(priorityId: number | undefined, priorities: TicketDictItem[]): string {
  if (!priorityId) return PRIORITY_COLORS.none;
  const item = priorities.find(p => p.id === priorityId);
  const name = (item?.name || '').toLowerCase();
  return PRIORITY_COLORS[name] || PRIORITY_COLORS.none;
}

function getTypeName(typeId: number | undefined, types: TicketDictItem[]): string {
  if (!typeId) return '';
  const item = types.find(t => t.id === typeId);
  return (item?.name as string) || '';
}

function getTypeIcon(typeId: number | undefined, types: TicketDictItem[]): string {
  if (!typeId) return '📋';
  const item = types.find(t => t.id === typeId);
  const icon = item?.icon;
  if (icon) return icon as string;
  const name = (item?.name || '').toLowerCase();
  return TYPE_ICONS[name] || '📋';
}

function isOverdue(dueDate: string | undefined): boolean {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date();
}

function getDaysUntilDue(dueDate: string | undefined): number | null {
  if (!dueDate) return null;
  const due = new Date(dueDate);
  const now = new Date();
  const diff = due.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// ============ COMPONENT ============

export function TicketCardContent({
  ticket,
  types = [],
  states = [],
  priorities = [],
  assignedOptions = [],
  assignedValue = [],
  onAssignedChange,
  mode,
  isExpanded = true,
  onStatusChange,
  onPriorityChange,
  onDueDateChange,
  onOpenChat,
  onOpenFull,
  onAttachToMessage,
  onOpenDocument,
  onEdit,
  onDescriptionChange,
  showDescription = true,
  showDates = true,
  showDocumentBinding = true,
  showChatButton = true,
  showEditButton = true,
  showSeal = false,
  onSealed,
  compact = false,
}: TicketCardContentProps) {
  const { language } = useLanguage();
  const t = (ru: string, en: string) => (language === 'ru' ? ru : en);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [showPriorityDropdown, setShowPriorityDropdown] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [showAssignedEditor, setShowAssignedEditor] = useState(false);
  const [showAssignedAddSelect, setShowAssignedAddSelect] = useState(false);

  // Portal refs and positions
  const statusButtonRef = useRef<HTMLButtonElement>(null);
  const priorityButtonRef = useRef<HTMLButtonElement>(null);
  const assignedAddBtnRef = useRef<HTMLButtonElement>(null);
  const statusDropdownRef = useRef<HTMLDivElement>(null);
  const priorityDropdownRef = useRef<HTMLDivElement>(null);
  const [statusDropdownPos, setStatusDropdownPos] = useState({ top: 0, left: 0 });
  const [priorityDropdownPos, setPriorityDropdownPos] = useState({ top: 0, left: 0 });

  const assignedResolved = assignedValue.map(v => {
    const opt = assignedOptions.find(o => o.value === v);
    return { value: v, label: opt?.label || v, color: opt?.color };
  });

  // Close dropdowns on outside click
  useEffect(() => {
    if (!showStatusDropdown && !showPriorityDropdown) return;
    
    const handleClickOutside = (e: MouseEvent) => {
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
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showStatusDropdown, showPriorityDropdown]);

  const stateName = getStateName(ticket.state, states, t('Не выбрано', 'Not selected'));
  const stateColor = getStateColor(ticket.state, states);
  const priorityName = getPriorityName(ticket.priority, priorities, t('Не выбрано', 'Not selected'));
  const priorityColor = getPriorityColor(ticket.priority, priorities);
  const typeName = getTypeName(ticket.type, types);
  const typeIcon = getTypeIcon(ticket.type, types);
  
  const dueDate = ticket.due_date || ticket.deadline;
  const overdue = isOverdue(dueDate);
  const daysUntil = getDaysUntilDue(dueDate);

  const descriptionTruncated = useMemo(() => {
    if (!ticket.description) return '';
    if (ticket.description.length <= 150 || descriptionExpanded) return ticket.description;
    return ticket.description.slice(0, 150) + '...';
  }, [ticket.description, descriptionExpanded]);

  // Padding based on mode and compact
  const padding = compact ? 'p-2' : mode === 'modal' ? 'p-4' : 'p-3';
  const textSize = compact ? 'text-xs' : 'text-sm';
  const labelSize = compact ? 'text-[10px]' : 'text-xs';

  return (
    <div className={cn('flex flex-col h-full min-h-[140px]', padding)}>
      {/* Main content area - grows */}
      <div className="flex-1 space-y-2">
      
      {/* Header: Title with inline metadata */}
      {(mode === 'inline' || mode === 'modal') && (
        <div className="space-y-1.5">
          {/* Row 1: Type icon + Title + Chat button */}
          <div className="flex items-start gap-2">
            <span className="text-base shrink-0 mt-0.5" title={typeName}>{typeIcon}</span>
            <h3 className={cn('font-medium line-clamp-2 flex-1', compact ? 'text-sm' : 'text-sm')}>
              {ticket.title}
            </h3>
            <div className="flex items-center gap-0.5 shrink-0">
              {onOpenFull && (
                <button
                  onClick={onOpenFull}
                  className="p-1 rounded hover:bg-gray-500/20 text-[var(--text-tertiary)] transition-colors"
                  title={t('Открыть', 'Open')}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              )}
              {showChatButton && onOpenChat && (
                <button
                  onClick={onOpenChat}
                  className="p-1 rounded hover:bg-blue-500/20 text-blue-400 transition-colors"
                  title={t('Открыть чат', 'Open chat')}
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                </button>
              )}
              {onAttachToMessage && (
                <button
                  onClick={onAttachToMessage}
                  className="p-1 rounded hover:bg-green-500/20 text-green-400 transition-colors"
                  title={t('Прикрепить к сообщению', 'Attach to message')}
                >
                  <Paperclip className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
          
          {/* Row 2: ID + Status dropdown + Priority dropdown */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* ID badge */}
            <span className={cn('font-mono text-blue-400', labelSize)}>#{ticket.id}</span>
            
            {/* Status dropdown */}
            <div className="relative">
              <button
                ref={statusButtonRef}
                onClick={(e) => { 
                  e.stopPropagation(); 
                  if (!showStatusDropdown && statusButtonRef.current) {
                    const rect = statusButtonRef.current.getBoundingClientRect();
                    setStatusDropdownPos({ top: rect.bottom + 4, left: rect.left });
                  }
                  setShowStatusDropdown(!showStatusDropdown); 
                }}
                disabled={!onStatusChange}
                className={cn(
                  'px-2 py-0.5 rounded border flex items-center gap-1 transition-colors',
                  stateColor,
                  onStatusChange && 'hover:opacity-80 cursor-pointer',
                  !onStatusChange && 'cursor-default',
                  labelSize, 'font-medium'
                )}
              >
                {stateName}
                {onStatusChange && <ChevronDown className="w-3 h-3" />}
              </button>
              
              {showStatusDropdown && onStatusChange && createPortal(
                <div 
                  ref={statusDropdownRef}
                  className="fixed z-[9999] bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-xl py-1 min-w-[140px]"
                  style={{ top: statusDropdownPos.top, left: statusDropdownPos.left }}
                >
                  {states.map(state => (
                    <button
                      key={state.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onStatusChange(state.id);
                        setShowStatusDropdown(false);
                      }}
                      className={cn(
                        'w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[var(--bg-tertiary)] transition-colors',
                        textSize
                      )}
                    >
                      <span className={cn(
                        'w-2 h-2 rounded-full',
                        getStateColor(state.id, states).replace('text-', 'bg-').split(' ')[0]
                      )} />
                      {state.name}
                      {ticket.state === state.id && <Check className="w-3 h-3 ml-auto text-green-400" />}
                    </button>
                  ))}
                </div>,
                document.body
              )}
            </div>
            
            {/* Priority dropdown */}
            <div className="relative">
                <button
                  ref={priorityButtonRef}
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    if (!showPriorityDropdown && priorityButtonRef.current) {
                      const rect = priorityButtonRef.current.getBoundingClientRect();
                      setPriorityDropdownPos({ top: rect.bottom + 4, left: rect.left });
                    }
                    setShowPriorityDropdown(!showPriorityDropdown); 
                  }}
                  disabled={!onPriorityChange}
                  className={cn(
                    'px-2 py-0.5 flex items-center gap-1 rounded border border-transparent',
                    priorityColor,
                    onPriorityChange && 'hover:border-current cursor-pointer',
                    labelSize
                  )}
                >
                  <AlertCircle className="w-3 h-3" />
                  {priorityName}
                  {onPriorityChange && <ChevronDown className="w-3 h-3" />}
                </button>
                
                {showPriorityDropdown && onPriorityChange && createPortal(
                  <div 
                    ref={priorityDropdownRef}
                    className="fixed z-[9999] bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-xl py-1 min-w-[120px]"
                    style={{ top: priorityDropdownPos.top, left: priorityDropdownPos.left }}
                  >
                    {priorities.map(p => (
                      <button
                        key={p.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onPriorityChange(p.id);
                          setShowPriorityDropdown(false);
                        }}
                        className={cn(
                          'w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-[var(--bg-tertiary)] transition-colors',
                          textSize
                        )}
                      >
                        <AlertCircle className={cn('w-3 h-3', getPriorityColor(p.id, priorities))} />
                        {p.name}
                      </button>
                    ))}
                  </div>,
                  document.body
                )}
            </div>
            
            {/* Due date inline */}
            {showDates && dueDate && (
              <span className={cn(
                'flex items-center gap-1',
                overdue ? 'text-red-400' : 'text-[var(--text-tertiary)]',
                labelSize
              )}>
                <Calendar className="w-3 h-3" />
                {formatDate(dueDate, 'short')}
              </span>
            )}
          </div>
        </div>
      )}
      
      {/* Document binding */}
      {showDocumentBinding && ticket.document_id && (
        <div className={cn(
          'flex items-center gap-2 px-2 py-1.5 rounded bg-[var(--bg-tertiary)]',
          labelSize
        )}>
          <FileText className="w-3.5 h-3.5 text-purple-400" />
          <span className="text-[var(--text-tertiary)]">{t('Документ:', 'Document:')}</span>
          {onOpenDocument ? (
            <button
              onClick={() => onOpenDocument(ticket.document_id!)}
              className="text-purple-400 hover:underline"
            >
              {ticket.document_title || `#${ticket.document_id}`}
            </button>
          ) : (
            <span className="text-[var(--text-secondary)]">
              {ticket.document_title || `#${ticket.document_id}`}
            </span>
          )}
        </div>
      )}
      
      {/* Description */}
      {showDescription && ticket.description && (
        <div className="space-y-1">
          <div className={cn('text-[var(--text-secondary)] line-clamp-3', textSize)}>
            <MarkdownPreview content={descriptionTruncated} onContentChange={descriptionExpanded || (ticket.description?.length ?? 0) <= 150 ? onDescriptionChange : undefined} />
          </div>
          {ticket.description.length > 150 && (
            <button
              onClick={() => setDescriptionExpanded(!descriptionExpanded)}
              className={cn('text-blue-400 hover:underline flex items-center gap-1', labelSize)}
            >
              {descriptionExpanded ? (
                <>{t('Свернуть', 'Collapse')} <ChevronUp className="w-3 h-3" /></>
              ) : (
                <>{t('Показать всё', 'Show all')} <ChevronDown className="w-3 h-3" /></>
              )}
            </button>
          )}
        </div>
      )}
      </div>
      
      {/* Footer - fixed at bottom */}
      {showDates && (
        <div className={cn(
          'flex items-center justify-between gap-2 mt-auto pt-2 border-t border-[var(--border-secondary)] text-[var(--text-tertiary)]',
          labelSize
        )}>
          <div className="flex items-center gap-3 flex-wrap min-h-[1.5rem]">
            {ticket.created_date && (
              <div className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                <span>{formatDate(ticket.created_date, 'short')}</span>
              </div>
            )}
            {ticket.created_by_name && (
              <div className="flex items-center gap-1">
                <User className="w-3 h-3" />
                <span>{ticket.created_by_name}</span>
              </div>
            )}
            {/* Assignees — chips + edit, lives inline next to the date */}
            {(onAssignedChange || assignedResolved.length > 0) && (
              <div className="flex items-center gap-1 flex-wrap">
                <Users className="w-3 h-3 shrink-0" />
                {showAssignedEditor && onAssignedChange ? (
                  <>
                    {assignedResolved.map(user => (
                      <span
                        key={user.value}
                        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
                        style={user.color ? { color: user.color } : undefined}
                      >
                        <span className="truncate max-w-[80px]">{user.label}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const next = assignedValue.filter(v => v !== user.value);
                            onAssignedChange(next.length > 0 ? next : null);
                          }}
                          className="text-red-400 hover:text-red-300 ml-0.5"
                          title={t('Убрать', 'Remove')}
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </span>
                    ))}
                    <button
                      ref={assignedAddBtnRef}
                      onClick={(e) => { e.stopPropagation(); setShowAssignedAddSelect(!showAssignedAddSelect); }}
                      className="w-5 h-5 rounded-full border border-dashed border-[var(--color-primary-500)]/40 bg-[var(--color-primary-500)]/5 flex items-center justify-center text-[var(--color-primary-400)] hover:text-[var(--color-primary-500)] hover:border-[var(--color-primary-500)] transition"
                      title={t('Добавить', 'Add')}
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowAssignedEditor(false); setShowAssignedAddSelect(false); }}
                      className="ml-1 p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                      title={t('Готово', 'Done')}
                    >
                      <Check className="w-3 h-3" />
                    </button>
                  </>
                ) : (
                  <>
                    {assignedResolved.length > 0 ? (
                      assignedResolved.map(user => (
                        <span
                          key={user.value}
                          className="px-1.5 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
                          style={user.color ? { color: user.color } : undefined}
                        >
                          {user.label}
                        </span>
                      ))
                    ) : onAssignedChange ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); setShowAssignedEditor(true); }}
                        className="text-[var(--text-quaternary)] hover:text-[var(--color-primary-500)] transition italic"
                        title={t('Назначить', 'Assign')}
                      >
                        {t('+ назначить', '+ assign')}
                      </button>
                    ) : null}
                    {onAssignedChange && assignedResolved.length > 0 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setShowAssignedEditor(true); }}
                        className="p-0.5 text-[var(--text-tertiary)] hover:text-[var(--color-primary-500)] transition"
                        title={t('Изменить', 'Edit')}
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          {ticket.updated_at && (
            <div className="flex items-center gap-1 text-[var(--text-quaternary)] shrink-0">
              <span>{t('обновлён', 'updated')} {formatDate(ticket.updated_at, 'short')}</span>
            </div>
          )}
        </div>
      )}

      {/* ADR-0002 §8 Phase 4 — TOTP-act seal section. Visible only on Tickets
          rows (caller passes `showSeal`). Sealed badge is always rendered when
          `sealed_at` is set; the action button only when the ticket is in a
          'done'-equivalent state (matched by name in the dictionary, since
          state-id varies between databases). */}
      {showSeal && (() => {
        const stateMeta = states.find(s => s.id === ticket.state);
        const stateName = String(stateMeta?.name || '').toLowerCase();
        const isDoneLike = ['done', 'closed', 'completed'].includes(stateName);
        const showButton = isDoneLike && !ticket.sealed_at;
        const showBadge = !!ticket.sealed_at;
        if (!showBadge && !showButton) return null;
        return (
          <div className={cn(
            'flex items-center gap-2 mt-2 pt-2 border-t border-[var(--border-secondary)]',
          )}>
            <TicketSealSection
              ticketId={ticket.id}
              sealedAt={ticket.sealed_at ?? null}
              sealedBy={ticket.sealed_by ?? null}
              hideButton={!showButton}
              onSealed={onSealed}
              compact={compact}
            />
          </div>
        );
      })()}

      {showAssignedAddSelect && onAssignedChange && createPortal(
        <div className="fixed inset-0 z-[9998]" onClick={(e) => { e.stopPropagation(); setShowAssignedAddSelect(false); }}>
          <div
            className="fixed z-[9999]"
            style={{
              top: (assignedAddBtnRef.current?.getBoundingClientRect().bottom || 0) + 4,
              left: (assignedAddBtnRef.current?.getBoundingClientRect().left || 0),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-xl p-1 w-[200px] max-h-[220px] overflow-y-auto">
              {assignedOptions
                .filter(opt => !assignedValue.includes(opt.value))
                .map(opt => (
                  <button
                    key={opt.value}
                    onClick={(e) => {
                      e.stopPropagation();
                      onAssignedChange([...assignedValue, opt.value]);
                      setShowAssignedAddSelect(false);
                    }}
                    className="w-full text-left px-2 py-1 text-[11px] hover:bg-[var(--bg-tertiary)] rounded transition truncate"
                    style={opt.color ? { color: opt.color } : undefined}
                  >
                    {opt.label}
                  </button>
                ))}
              {assignedOptions.filter(opt => !assignedValue.includes(opt.value)).length === 0 && (
                <div className="px-2 py-1 text-[11px] text-[var(--text-tertiary)] italic">
                  {assignedOptions.length === 0 ? t('Нет доступных пользователей', 'No available users') : t('Все добавлены', 'All added')}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export default TicketCardContent;
