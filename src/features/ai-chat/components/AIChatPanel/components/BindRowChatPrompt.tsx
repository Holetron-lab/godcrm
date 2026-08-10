/**
 * BindRowChatPrompt — small inline confirmation dialog rendered when the user
 * clicks a row that has no chat WHILE they are sitting in a chat that has no
 * bound row. Three actions:
 *   - Привязать этот чат   → bind current conversation to that row
 *   - Создать новый чат    → ensure-row-chat (lazy create)
 *   - Отмена
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { Link2, Plus, X } from 'lucide-react';

interface BindRowChatPromptProps {
  rowTitle: string;
  onBindCurrent: () => void;
  onCreateNew: () => void;
  onClose: () => void;
}

export function BindRowChatPrompt({ rowTitle, onBindCurrent, onCreateNew, onClose }: BindRowChatPromptProps) {
  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-[320px] rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="text-sm text-[var(--text-primary)]">
            У строки нет чата:
            <div className="mt-1 text-xs text-[var(--text-tertiary)] truncate" title={rowTitle}>{rowTitle}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 -m-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]"
            title="Закрыть"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onBindCurrent}
            className="w-full flex items-center gap-2 px-3 py-2 rounded text-sm bg-[var(--color-primary-500)]/15 text-[var(--color-primary-400)] hover:bg-[var(--color-primary-500)]/25 transition-colors"
          >
            <Link2 className="w-4 h-4" />
            <span>Привязать этот чат к строке</span>
          </button>
          <button
            type="button"
            onClick={onCreateNew}
            className="w-full flex items-center gap-2 px-3 py-2 rounded text-sm bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Создать новый чат</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
