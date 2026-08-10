import React from 'react';
import { MessageCircle, Paperclip } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { useAIChat } from '@/features/ai-chat';
import { useDocumentsContext } from '../DocumentsContext';
import { useDocumentChat } from '../useDocumentChat';
import type { DocumentRegistryItem } from '../../../../types/documents.types';
import { StatusDropdown } from './StatusDropdown';

interface SidebarDocRowProps {
  doc: DocumentRegistryItem;
  indented?: boolean;
}

export function SidebarDocRow({ doc, indented = false }: SidebarDocRowProps) {
  const ctx = useDocumentsContext();
  const { openDocumentChat } = useDocumentChat();
  const { attachRowToMessage } = useAIChat();

  return (
    <div
      onClick={() => {
        ctx.setSelectedDocumentId(doc.id);
        ctx.setAtomsViewMode(false);
      }}
      className={cn(
        'w-full flex items-start gap-2 p-2.5 rounded-lg hover:bg-[var(--bg-tertiary)] text-left transition-colors cursor-pointer group',
        indented && 'pl-7',
        ctx.isMobile && !indented && 'min-h-[44px] active:bg-[var(--bg-tertiary)]'
      )}
    >
      <span className="text-xl shrink-0 mt-0.5">{doc.icon || '📄'}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className="font-medium truncate flex-1">{doc.name}</div>
          <StatusDropdown doc={doc} registryTableId={ctx.registryTableId} onUpdate={ctx.refresh} />
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          {doc.description && (
            <div className="text-xs text-[var(--text-tertiary)] truncate flex-1">
              {doc.description}
            </div>
          )}
          {/* Chat + attach are internal affordances — hidden on the public
              surface (ADR-0060). */}
          {ctx.dataSource !== 'public' && (
            <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity ml-auto">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  openDocumentChat(doc.id, doc.name || '');
                }}
                className="w-5 h-5 rounded-full bg-blue-500/20 hover:bg-blue-500/30 flex items-center justify-center text-blue-400 transition-colors"
                title="Open document chat"
              >
                <MessageCircle className="w-3 h-3" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  attachRowToMessage({
                    table_id: ctx.registryTableId || 0,
                    row_id: doc.id,
                    table_name: 'Documents',
                    table_icon: '📄',
                    row_title: doc.name || `#${doc.id}`,
                  });
                }}
                className="w-5 h-5 rounded-full bg-green-500/20 hover:bg-green-500/30 flex items-center justify-center text-green-400 transition-colors"
                title="Attach to message"
              >
                <Paperclip className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
