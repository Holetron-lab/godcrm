import { useRef, useEffect, useCallback } from 'react';
import {
  Bot,
  Send,
  Zap,
  Loader2,
  X,
  Paperclip,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import type { AIAgent } from './types';
import { getFileIcon } from './MessageBubble';

export interface ChatInputProps {
  currentAgent: AIAgent | null;
  inputValue: string;
  onInputChange: (value: string) => void;
  attachments: File[];
  onAttachmentsChange: (attachments: File[]) => void;
  isLoading: boolean;
  agentMode: boolean;
  onToggleAgentMode: () => void;
  markdownEnabled: boolean;
  onToggleMarkdown: () => void;
  onSendMessage: (e?: React.FormEvent) => void;
}

export function ChatInput({
  currentAgent,
  inputValue,
  onInputChange,
  attachments,
  onAttachmentsChange,
  isLoading,
  agentMode,
  onToggleAgentMode,
  markdownEnabled,
  onToggleMarkdown,
  onSendMessage,
}: ChatInputProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resizeInput = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    const maxHeight = 72;
    const nextHeight = Math.min(input.scrollHeight, maxHeight);
    input.style.height = `${nextHeight}px`;
    input.style.overflowY = input.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, []);

  useEffect(() => {
    resizeInput();
  }, [inputValue, resizeInput]);

  return (
    <div className="p-3 bg-[var(--bg-primary)] border-t border-[var(--border-primary)]">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-xs text-[var(--color-primary-500)]">
          <Bot className="w-3.5 h-3.5" />
          <span>{currentAgent?.name || 'Business CRM'}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleMarkdown}
            className={cn(
              "text-[11px] font-semibold uppercase tracking-wide transition-colors",
              markdownEnabled
                ? "text-[var(--color-primary-500)]"
                : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            )}
            title={markdownEnabled ? "Markdown: ON" : "Markdown: OFF"}
          >
            md
          </button>
          {/* Agent Mode Toggle */}
          <button
            onClick={onToggleAgentMode}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors",
              agentMode
                ? "text-orange-500 bg-orange-500/10 hover:bg-orange-500/20"
                : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
            )}
            title={agentMode ? "Agent Mode: ON (with tools)" : "Agent Mode: OFF (simple chat)"}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Agent</span>
          </button>
        </div>
      </div>

      <div className="bg-[var(--bg-tertiary)] rounded-xl border border-[var(--border-primary)] overflow-hidden">
        {attachments.length > 0 && (
          <div className="px-3 pt-2 flex flex-wrap gap-2">
            {attachments.map((file, index) => (
              <div
                key={`${file.name}-${index}`}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[var(--bg-secondary)] text-xs text-[var(--text-secondary)]"
              >
                {getFileIcon(file.type)}
                <span className="max-w-[100px] truncate">{file.name}</span>
                <button
                  onClick={() => onAttachmentsChange(attachments.filter((_, i) => i !== index))}
                  className="p-0.5 rounded hover:bg-[var(--bg-primary)] text-[var(--text-tertiary)] hover:text-[var(--color-error)]"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={onSendMessage} className="flex items-center gap-2 p-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              onAttachmentsChange([...attachments, ...files]);
              e.target.value = '';
            }}
            accept="image/*,.pdf,.txt,.md,.json,.csv"
          />

          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSendMessage();
              }
            }}
            placeholder="Задайте любой вопрос..."
            disabled={!currentAgent || isLoading}
            rows={1}
            className="flex-1 bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none resize-none text-sm py-1"
            style={{ minHeight: '24px', maxHeight: '72px' }}
          />

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
              title="Attach"
            >
              <Paperclip className="w-4 h-4" />
            </button>

            <button
              type="submit"
              disabled={!currentAgent || isLoading || (!inputValue.trim() && attachments.length === 0)}
              className={cn(
                'p-1.5 rounded-lg transition-colors',
                !currentAgent || isLoading || (!inputValue.trim() && attachments.length === 0)
                  ? 'text-[var(--text-tertiary)] cursor-not-allowed'
                  : 'bg-purple-500 text-white hover:bg-purple-600'
              )}
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
