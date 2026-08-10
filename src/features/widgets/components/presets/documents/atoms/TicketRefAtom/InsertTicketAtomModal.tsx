/**
 * InsertTicketAtomModal — `/ticket` slash-command insert UI for the
 * ticket-as-atom feature (ADR-0012 Phase 5 / M4 frontend).
 *
 * Search the project's tickets table → pick a ticket → choose mode → insert.
 * Insertion is a two-step flow:
 *   1. Create a row in atoms_v2 (table 3574) with the canonical
 *      `{ type: 'ticket_ref', widget_ref, doc_id, props: { ticket_id, mode, display_mode } }`
 *      payload. The backend validates the props and hydrates a snapshot when
 *      mode != 'live' (see backend/services/atoms/ticket-ref-serializer.js).
 *   2. Create a document item with `level: 'atom'` and `atom_ref` pointing at
 *      the new atoms_v2 row.
 */

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Search, Ticket as TicketIcon, X } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { apiClient } from '@/shared/utils/apiClient';
import { logger } from '@/shared/utils/logger';
import { useDocumentsContext } from '../../DocumentsContext';
import { useTicketConfig } from '../../content/ticketUtils';
import type { DocumentItem, TicketRow } from '../../../../../types/documents.types';
import { useAtomMutations } from './useAtomRow';
import type { TicketRefMode } from './types';
import { resolveOrderForInsert, type InsertPosition } from '../../utils/orderUtils';

interface InsertTicketAtomModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Anchor for ordering — same shape used by DocumentsContent's add-item flow. */
  anchor?: { afterItemId?: number; beforeItemId?: number };
  /** Pre-fill mode (used when invoked with a known default). */
  defaultMode?: TicketRefMode;
}

interface TicketsListResponse {
  rows?: Array<{
    id: number;
    data?: Record<string, unknown>;
    [k: string]: unknown;
  }>;
}

const MODE_OPTIONS: Array<{ value: TicketRefMode; label: string; description: string }> = [
  { value: 'live', label: 'Live', description: 'Всегда подгружать актуальные данные тикета.' },
  { value: 'snapshot', label: 'Snapshot', description: 'Сохранить снимок тикета и не делать запросов.' },
  { value: 'hybrid', label: 'Hybrid', description: 'Снимок + фоновое обновление при открытии.' },
];

export function InsertTicketAtomModal({ isOpen, onClose, anchor, defaultMode }: InsertTicketAtomModalProps) {
  const ctx = useDocumentsContext();
  const { config: ticketConfig, isLoading: isConfigLoading } = useTicketConfig(ctx.config);
  const { createTicketRefAtom, isCreating } = useAtomMutations({ isReadOnly: ctx.isReadOnly });

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null);
  const [mode, setMode] = useState<TicketRefMode>(defaultMode ?? 'live');
  const [insertError, setInsertError] = useState<string | null>(null);

  // Reset when reopened
  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setDebouncedSearch('');
      setSelectedTicketId(null);
      setMode(defaultMode ?? 'live');
      setInsertError(null);
    }
  }, [isOpen, defaultMode]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(timer);
  }, [search]);

  const tableId = ticketConfig?.table_id;
  const titleCol = ticketConfig?.columns.title;
  const stateCol = ticketConfig?.columns.state;

  const ticketsQuery = useQuery<TicketRow[]>({
    queryKey: ['ticket-atom-search', tableId, debouncedSearch],
    queryFn: async () => {
      if (!tableId) return [];
      const qs = debouncedSearch.trim()
        ? `?search=${encodeURIComponent(debouncedSearch.trim())}&limit=10`
        : '?limit=10';
      const response = await apiClient.get<{ data: TicketsListResponse } | TicketsListResponse>(
        `/tables/${tableId}/rows${qs}`,
      );
      const payload = response as unknown as { data?: TicketsListResponse } & TicketsListResponse;
      const rows = payload?.data?.rows ?? payload?.rows ?? [];
      return rows.map(row => {
        const nested = (row as Record<string, unknown>).data;
        if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
          return { ...row, ...(nested as Record<string, unknown>), id: row.id } as TicketRow;
        }
        return row as TicketRow;
      });
    },
    enabled: isOpen && Boolean(tableId),
    staleTime: 15_000,
  });

  const tickets = ticketsQuery.data ?? [];
  const filteredTickets = useMemo(() => tickets.slice(0, 10), [tickets]);

  const handleInsert = async () => {
    if (!selectedTicketId) return;
    if (!ctx.selectedDocumentId || !ctx.selectedDocument?.content_table_id) return;
    if (!ctx.widgetId) {
      setInsertError('Не удалось определить widget id виджета документов.');
      return;
    }
    setInsertError(null);
    try {
      // 1. Create the atom row in atoms_v2 (table 3574). Backend validates +
      //    hydrates a snapshot when mode != 'live'.
      const atomResult = await createTicketRefAtom({
        widget_ref: ctx.widgetId,
        doc_id: ctx.selectedDocumentId,
        ticket_id: selectedTicketId,
        mode,
        display_mode: 'card',
      });
      if (!atomResult?.id) {
        setInsertError('Не удалось создать атом: backend не вернул id.');
        return;
      }

      // 2. Compute order — same logic as DocumentsContent.handleAddItem.
      const tableId = ctx.selectedDocument.content_table_id;
      const documentId = ctx.selectedDocumentId;
      const position: InsertPosition =
        anchor?.afterItemId != null
          ? { kind: 'after', afterId: anchor.afterItemId }
          : anchor?.beforeItemId != null
            ? { kind: 'before', beforeId: anchor.beforeItemId }
            : { kind: 'end' };
      const order = await resolveOrderForInsert(ctx.items, position, async (id, ord) => {
        await ctx.updateItem({ documentId, itemId: id, tableId, data: { order: ord } });
      });

      // 3. Create the document item that references the atom row.
      await ctx.addItem({
        documentId: ctx.selectedDocumentId,
        item: {
          order,
          level: 'atom',
          atom_ref: atomResult.id,
        } as Partial<DocumentItem>,
      });
      onClose();
    } catch (error) {
      logger.error('InsertTicketAtomModal: insert failed', { error });
      setInsertError(error instanceof Error ? error.message : 'Не удалось вставить тикет');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-primary)]">
          <div className="flex items-center gap-3">
            <TicketIcon className="w-5 h-5 text-blue-500" />
            <span className="font-medium">Вставить тикет</span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-blue-500/20 text-blue-400 font-mono">
              /ticket
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)]"
            aria-label="Закрыть"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="px-6 py-3 border-b border-[var(--border-primary)]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
            <input
              type="text"
              placeholder="Поиск тикетов..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
              className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-sm focus:outline-none focus:border-blue-500"
              data-testid="ticket-atom-search-input"
            />
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-4">
          {isConfigLoading || ticketsQuery.isLoading ? (
            <div className="text-center py-8 text-[var(--text-tertiary)]">
              <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin" />
              <p className="text-sm">Поиск тикетов…</p>
            </div>
          ) : !ticketConfig ? (
            <div className="text-center py-8 text-[var(--text-tertiary)]">
              <p className="text-sm mb-1">Таблица тикетов не найдена</p>
              <p className="text-xs">Создайте «Tickets» или «Tasks» в проекте.</p>
            </div>
          ) : filteredTickets.length === 0 ? (
            <div className="text-center py-8 text-[var(--text-tertiary)]">
              <TicketIcon className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">{debouncedSearch ? 'Тикеты не найдены' : 'Нет тикетов'}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredTickets.map((ticket) => {
                const title = (titleCol ? (ticket as Record<string, unknown>)[titleCol] : '') as string;
                const status = (stateCol ? (ticket as Record<string, unknown>)[stateCol] : '') as string;
                const isSelected = ticket.id === selectedTicketId;
                return (
                  <button
                    key={ticket.id}
                    type="button"
                    onClick={() => setSelectedTicketId(ticket.id)}
                    className={cn(
                      'w-full text-left p-3 rounded-lg border transition-colors',
                      isSelected
                        ? 'border-blue-500 bg-blue-500/5'
                        : 'border-[var(--border-primary)] hover:border-blue-500/40 hover:bg-blue-500/5',
                    )}
                    data-testid={`ticket-atom-search-result-${ticket.id}`}
                  >
                    <div className="flex items-start gap-2">
                      <TicketIcon className="w-3.5 h-3.5 text-blue-400 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] text-[var(--text-tertiary)]">#{ticket.id}</span>
                          {status && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">
                              {String(status)}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-sm text-[var(--text-primary)] truncate">
                          {title || `Тикет #${ticket.id}`}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Mode picker */}
        <div className="px-6 py-3 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)] space-y-2">
          <div className="text-[10px] uppercase font-mono text-[var(--text-tertiary)]">
            Режим
          </div>
          <div className="flex gap-2" role="radiogroup" aria-label="Режим тикет-атома">
            {MODE_OPTIONS.map(opt => (
              <label
                key={opt.value}
                className={cn(
                  'flex-1 flex flex-col items-start gap-0.5 px-3 py-2 rounded-lg border cursor-pointer text-xs transition-colors',
                  mode === opt.value
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)]',
                )}
              >
                <input
                  type="radio"
                  name="ticket-atom-mode"
                  value={opt.value}
                  checked={mode === opt.value}
                  onChange={() => setMode(opt.value)}
                  className="sr-only"
                  data-testid={`ticket-atom-mode-${opt.value}`}
                />
                <span className="font-medium">{opt.label}</span>
                <span className="text-[10px] text-[var(--text-tertiary)] leading-tight">{opt.description}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Error */}
        {insertError && (
          <div className="px-6 py-2 bg-red-500/10 border-t border-red-500/30 text-xs text-red-400">
            {insertError}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center gap-3 px-6 py-3 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)]">
          <button
            type="button"
            onClick={handleInsert}
            disabled={!selectedTicketId || isCreating}
            className="flex-1 px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            data-testid="ticket-atom-insert-button"
          >
            {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <TicketIcon className="w-4 h-4" />}
            Вставить
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-primary)] text-sm"
          >
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}

export default InsertTicketAtomModal;
