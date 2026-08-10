/**
 * Convert to Ticket Modal - Create a ticket from document element
 * Uses ticket_binding config or auto-discovery for table/column mapping
 */

import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  X,
  Save,
  ChevronUp,
  ChevronDown,
  RefreshCw,
  Ticket,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { logger } from '@/shared/utils/logger';
import { apiClient } from '@/shared/utils/apiClient';
import { useDocumentsContext } from '../DocumentsContext';
import { useTicketConfig, useTicketDictionaries } from '../content/ticketUtils';
import type { DocumentItem, TicketDictItem } from '../../../../types/documents.types';

export function ConvertToTicketModal() {
  const ctx = useDocumentsContext();
  const queryClient = useQueryClient();
  const item = ctx.convertToTicketItem;

  // Get ticket config (auto-discovered or configured)
  const { config: ticketConfig, isLoading: isConfigLoading } = useTicketConfig(ctx.config);
  const { types, states, priorities, isLoading: isDictsLoading } = useTicketDictionaries(ticketConfig);

  // Get parent heading (h1/h2/h3) for default title
  const getParentHeading = (targetItem: DocumentItem, items: DocumentItem[]): string => {
    const itemIndex = items.findIndex(i => i.id === targetItem.id);
    for (let i = itemIndex - 1; i >= 0; i--) {
      if (items[i].level === 'h1' || items[i].level === 'h2' || items[i].level === 'h3') {
        return items[i].content || '';
      }
    }
    return 'New Ticket';
  };

  const parentHeading = item ? getParentHeading(item, ctx.items) : 'New Ticket';

  // Default selections from dictionaries
  const defaultType = useMemo(() => {
    const task = types.find(t => (t.name as string)?.toLowerCase() === 'task');
    return task?.id || types[0]?.id || 0;
  }, [types]);

  const defaultPriority = useMemo(() => {
    const medium = priorities.find(p => (p.name as string)?.toLowerCase() === 'medium');
    return medium?.id || priorities[0]?.id || 0;
  }, [priorities]);

  const defaultState = useMemo(() => {
    const backlog = states.find(s => (s.name as string)?.toLowerCase() === 'backlog');
    return backlog?.id || states[0]?.id || 0;
  }, [states]);

  // Form state
  const [title, setTitle] = useState(() => parentHeading);
  const [description, setDescription] = useState(() => item?.content || '');
  const [selectedType, setSelectedType] = useState(0);
  const [selectedPriority, setSelectedPriority] = useState(0);
  const [selectedState, setSelectedState] = useState(0);
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('');
  const [testSteps, setTestSteps] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Set defaults once dicts are loaded
  const effectiveType = selectedType || defaultType;
  const effectivePriority = selectedPriority || defaultPriority;
  const effectiveState = selectedState || defaultState;

  // Save handler
  const handleSave = async () => {
    if (ctx.isReadOnly) return; // ADR-0060 P6/P fail-closed guard
    if (!ticketConfig) return;
    setIsSaving(true);
    try {
      const cols = ticketConfig.columns;
      const rowData: Record<string, unknown> = {};

      rowData[cols.title] = title;
      if (cols.description) rowData[cols.description] = description;
      if (cols.type && effectiveType) rowData[cols.type] = effectiveType;
      if (cols.priority && effectivePriority) rowData[cols.priority] = effectivePriority;
      if (cols.state && effectiveState) rowData[cols.state] = effectiveState;
      if (cols.acceptance_criteria && acceptanceCriteria) rowData[cols.acceptance_criteria] = acceptanceCriteria;
      if (cols.test_steps && testSteps) rowData[cols.test_steps] = testSteps;
      if (cols.created_date) rowData[cols.created_date] = new Date().toISOString();

      // ADR-0012 / ADR-154: stamp parent_document_id so the doc-scoped ticket
      // resolver can find this ticket later. Source: the document the user is
      // currently viewing in the documents widget. Skip silently if unknown
      // (e.g. ticket created from a context without a selected document).
      if (ctx.selectedDocumentId != null) {
        rowData.parent_document_id = ctx.selectedDocumentId;
      }

      const response = await apiClient.post<{ success: boolean; data: { id: number } }>(
        `/tables/${ticketConfig.table_id}/rows`,
        { data: rowData }
      );

      const newTicketId = response?.data?.id;

      // Save ticket_ref back to the document content item
      const contentTableId = ctx.selectedDocument?.table_id || ctx.selectedDocument?.content_table_id;
      if (newTicketId && item?.id && contentTableId && ctx.selectedDocumentId) {
        try {
          await ctx.updateItem({
            documentId: ctx.selectedDocumentId,
            itemId: item.id,
            tableId: contentTableId,
            data: { ticket_ref: newTicketId },
          });
        } catch (linkError) {
          // Ticket was created but linking failed - warn but don't block
          logger.warn('Ticket created but failed to link to document item:', linkError);
        }
      }

      // Invalidate tickets cache so lists and counters refresh
      await queryClient.invalidateQueries({ queryKey: ['tickets'] });
      // Refresh document content to reflect the updated ticket_ref
      ctx.refresh();
      ctx.setShowConvertToTicketModal(false);
      ctx.setConvertToTicketItem(null);
    } catch (error) {
      logger.error('Failed to create ticket:', error);
    } finally {
      setIsSaving(false);
    }
  };

  if (!item) return null;

  const isLoading = isConfigLoading || isDictsLoading;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-primary)]">
          <div className="flex items-center gap-3">
            <Ticket className="w-5 h-5 text-green-500" />
            <span className="font-medium">Создать тикет</span>
          </div>
          <button
            onClick={() => { ctx.setShowConvertToTicketModal(false); ctx.setConvertToTicketItem(null); }}
            className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            </div>
          ) : !ticketConfig ? (
            <div className="text-center py-12 text-[var(--text-tertiary)]">
              <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p className="text-sm mb-1">Таблица тикетов не найдена</p>
              <p className="text-xs">Создайте таблицу "Tickets" или "Tasks" в проекте</p>
            </div>
          ) : (
            <>
              {/* Title */}
              <div>
                <label htmlFor="ticket-title" className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                  Что (заголовок)
                </label>
                <input
                  id="ticket-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Краткое описание задачи"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-sm focus:border-green-500 outline-none"
                />
              </div>

              {/* Description */}
              {ticketConfig.columns.description && (
                <div>
                  <label htmlFor="ticket-desc" className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                    Зачем (описание)
                  </label>
                  <textarea
                    id="ticket-desc"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Подробное описание задачи..."
                    rows={4}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-sm focus:border-green-500 outline-none resize-y"
                  />
                </div>
              )}

              {/* Type, Priority, State - in a row */}
              <div className="grid grid-cols-3 gap-4">
                {/* Type */}
                {types.length > 0 && (
                  <div>
                    <label htmlFor="ticket-type" className="block text-sm font-medium text-[var(--text-secondary)] mb-2">Тип</label>
                    <select
                      id="ticket-type"
                      value={effectiveType}
                      onChange={(e) => setSelectedType(Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-sm focus:border-green-500 outline-none"
                    >
                      {types.map((t: TicketDictItem) => (
                        <option key={t.id} value={t.id}>{(t.name as string) || `#${t.id}`}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Priority */}
                {priorities.length > 0 && (
                  <div>
                    <label htmlFor="ticket-priority" className="block text-sm font-medium text-[var(--text-secondary)] mb-2">Приоритет</label>
                    <select
                      id="ticket-priority"
                      value={effectivePriority}
                      onChange={(e) => setSelectedPriority(Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-sm focus:border-green-500 outline-none"
                    >
                      {priorities.map((p: TicketDictItem) => (
                        <option key={p.id} value={p.id}>{(p.name as string) || `#${p.id}`}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* State */}
                {states.length > 0 && (
                  <div>
                    <label htmlFor="ticket-state" className="block text-sm font-medium text-[var(--text-secondary)] mb-2">Статус</label>
                    <select
                      id="ticket-state"
                      value={effectiveState}
                      onChange={(e) => setSelectedState(Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-sm focus:border-green-500 outline-none"
                    >
                      {states.map((s: TicketDictItem) => (
                        <option key={s.id} value={s.id}>{(s.name as string) || `#${s.id}`}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Advanced fields */}
              {(ticketConfig.columns.acceptance_criteria || ticketConfig.columns.test_steps) && (
                <div className="border-t border-[var(--border-primary)] pt-4">
                  <button
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    Дополнительные поля
                  </button>

                  {showAdvanced && (
                    <div className="mt-4 space-y-4">
                      {ticketConfig.columns.acceptance_criteria && (
                        <div>
                          <label htmlFor="ticket-ac" className="block text-sm font-medium text-[var(--text-secondary)] mb-2">Критерии приемки</label>
                          <textarea
                            id="ticket-ac"
                            value={acceptanceCriteria}
                            onChange={(e) => setAcceptanceCriteria(e.target.value)}
                            placeholder="- [ ] Критерий 1&#10;- [ ] Критерий 2"
                            rows={3}
                            className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-sm focus:border-green-500 outline-none resize-y font-mono"
                          />
                        </div>
                      )}
                      {ticketConfig.columns.test_steps && (
                        <div>
                          <label htmlFor="ticket-ts" className="block text-sm font-medium text-[var(--text-secondary)] mb-2">Шаги тестирования</label>
                          <textarea
                            id="ticket-ts"
                            value={testSteps}
                            onChange={(e) => setTestSteps(e.target.value)}
                            placeholder="1. Открыть страницу&#10;2. Нажать кнопку&#10;3. Проверить результат"
                            rows={3}
                            className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-sm focus:border-green-500 outline-none resize-y font-mono"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-6 py-4 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)]">
          <button
            onClick={handleSave}
            disabled={isSaving || !title.trim() || !ticketConfig}
            className="flex-1 px-4 py-2 rounded-lg bg-green-500 hover:bg-green-600 text-white text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Создать тикет
          </button>
          <button
            onClick={() => { ctx.setShowConvertToTicketModal(false); ctx.setConvertToTicketItem(null); }}
            className="px-4 py-2 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-primary)] text-sm"
          >
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}
