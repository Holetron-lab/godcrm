import {
  Trash2,
  MessageSquare,
  ChevronDown,
  Loader2,
  X,
  GripVertical,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import type { Conversation } from './types';

interface EnrichedConversation extends Conversation {
  agentName?: string;
}

export interface HistorySidebarProps {
  sidebarWidth: number;
  isResizing: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onCollapse: () => void;
  isLoadingConversations: boolean;
  enrichedConversations: EnrichedConversation[];
  selectedConversationId: number | null;
  expandedConversation: number | null;
  onExpandConversation: (id: number | null) => void;
  onSelectConversation: (id: number) => void;
  onDeleteConversation: (id: number) => void;
}

export function HistorySidebar({
  sidebarWidth,
  isResizing,
  onMouseDown,
  onCollapse,
  isLoadingConversations,
  enrichedConversations,
  selectedConversationId,
  expandedConversation,
  onExpandConversation,
  onSelectConversation,
  onDeleteConversation,
}: HistorySidebarProps) {
  return (
    <>
      {/* Resize Handle */}
      <div
        onMouseDown={onMouseDown}
        className={cn(
          "w-1 cursor-col-resize hover:bg-[var(--color-primary-500)]/50 transition-colors flex items-center justify-center group",
          isResizing && "bg-[var(--color-primary-500)]/50"
        )}
      >
        <div className="w-4 h-8 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <GripVertical className="w-3 h-3 text-[var(--text-tertiary)]" />
        </div>
      </div>

      {/* Sidebar */}
      <div
        className="border-l border-[var(--border-primary)] bg-[var(--bg-secondary)] flex flex-col"
        style={{ width: sidebarWidth }}
      >
        <div className="px-3 py-2 border-b border-[var(--border-primary)] flex items-center justify-between">
          <h3 className="font-medium text-sm text-[var(--text-primary)]">История чатов</h3>
          <button
            onClick={onCollapse}
            className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
            title="Скрыть"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {isLoadingConversations ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-[var(--text-tertiary)]" />
            </div>
          ) : enrichedConversations.length === 0 ? (
            <div className="text-sm text-[var(--text-tertiary)] text-center py-8">
              Нет сохранённых чатов
            </div>
          ) : (
            <div className="space-y-1">
              {enrichedConversations.map((conv) => (
                <div key={conv.id} className="border border-[var(--border-secondary)] rounded-lg overflow-hidden">
                  <button
                    onClick={() => onExpandConversation(expandedConversation === conv.id ? null : conv.id)}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--bg-tertiary)] transition-colors",
                      selectedConversationId === conv.id && "bg-[var(--color-primary-50)]"
                    )}
                  >
                    <MessageSquare className="w-4 h-4 flex-shrink-0 text-[var(--text-tertiary)]" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate text-[var(--text-primary)]">{conv.title}</div>
                      <div className="text-xs text-[var(--text-tertiary)]">
                        {conv.messagesCount} сообщ.
                      </div>
                    </div>
                    <ChevronDown className={cn(
                      "w-4 h-4 text-[var(--text-tertiary)] transition-transform",
                      expandedConversation === conv.id && "rotate-180"
                    )} />
                  </button>

                  {expandedConversation === conv.id && (
                    <div className="px-3 py-2 bg-[var(--bg-primary)] border-t border-[var(--border-secondary)]">
                      <div className="text-xs text-[var(--text-tertiary)] mb-2">
                        <div className="mb-1">
                          <span className="font-medium">Агент:</span> {conv.agentName || '—'}
                        </div>
                        <div className="mb-1">
                          <span className="font-medium">Создан:</span>{' '}
                          {new Date(conv.createdAt).toLocaleString('ru-RU', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </div>
                        <div>
                          <span className="font-medium">Обновлён:</span>{' '}
                          {new Date(conv.updatedAt).toLocaleString('ru-RU', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </div>
                      </div>
                      <div className="flex gap-1 mt-2">
                        <button
                          onClick={() => onSelectConversation(conv.id)}
                          className="flex-1 px-2 py-1 bg-[var(--color-primary-500)] text-white rounded text-xs hover:opacity-90"
                        >
                          Открыть
                        </button>
                        <button
                          onClick={() => onDeleteConversation(conv.id)}
                          className="px-2 py-1 bg-[var(--color-error)]/10 text-[var(--color-error)] rounded text-xs hover:bg-[var(--color-error)]/20"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
