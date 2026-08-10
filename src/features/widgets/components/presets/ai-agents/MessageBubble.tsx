import {
  Bot,
  User,
  AlertCircle,
  Wrench,
  Zap,
  FileText,
  Image as ImageIcon,
  File,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { MarkdownPreview, type CheckboxClickInfo } from '@/shared/components/MarkdownPreview';
import type { ChatMessage } from './types';

export interface MessageBubbleProps {
  message: ChatMessage;
  getFileIcon: (type: string) => React.ReactNode;
  formatFileSize: (bytes: number) => string;
  markdownEnabled: boolean;
  onCheckboxClick?: (info: CheckboxClickInfo) => void;
  currentUser?: { name: string; id: number };
}

export function MessageBubble({ message, getFileIcon, formatFileSize, markdownEnabled, onCheckboxClick, currentUser }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isError = !!message.error;

  return (
    <div className={cn('flex gap-3', isUser && 'flex-row-reverse')}>
      <div
        className={cn(
          'w-8 h-8 rounded-full flex items-center justify-center shrink-0',
          isUser
            ? 'bg-[var(--color-primary-500)]'
            : 'bg-gradient-to-br from-purple-500 to-primary-500'
        )}
      >
        {isUser ? (
          <User className="w-4 h-4 text-white" />
        ) : (
          <Bot className="w-4 h-4 text-white" />
        )}
      </div>

      <div className={cn('flex-1 min-w-0', isUser && 'flex flex-col items-end')}>
        {!isUser && message.agentName && (
          <div className="text-xs text-[var(--text-tertiary)] mb-1">{message.agentName}</div>
        )}

        <div
          className={cn(
            'px-3 py-2 rounded-2xl max-w-[85%] break-words',
            isUser
              ? 'bg-[var(--color-primary-500)] text-white rounded-br-sm'
              : isError
              ? 'bg-[var(--color-error)]/10 text-[var(--color-error)] rounded-bl-sm'
              : 'bg-[var(--bg-secondary)] text-[var(--text-primary)] rounded-bl-sm border border-[var(--border-secondary)]'
          )}
        >
          {message.isStreaming && !message.content ? (
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-current animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 rounded-full bg-current animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 rounded-full bg-current animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          ) : isError ? (
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="text-sm">{message.error}</span>
            </div>
          ) : markdownEnabled && !isUser ? (
            <MarkdownPreview content={message.content || ''} className="text-sm" onCheckboxClick={onCheckboxClick} currentUser={currentUser} />
          ) : (
            <div className="text-sm whitespace-pre-wrap">{message.content}</div>
          )}

          {message.toolResults && message.toolResults.length > 0 && (
            <div className="mt-2 pt-2 border-t border-[var(--border-primary)]">
              <div className="flex items-center gap-1 text-xs text-[var(--text-tertiary)] mb-1">
                <Wrench className="w-3 h-3" />
                <span>Использовано {message.toolResults.length} инструментов</span>
                {message.iterations && <span className="ml-1">({message.iterations} итераций)</span>}
              </div>
              <div className="space-y-1">
                {message.toolResults.map((tr, idx) => (
                  <details key={idx} className="text-xs">
                    <summary className="cursor-pointer hover:text-[var(--color-primary-500)] flex items-center gap-1">
                      <Zap className="w-3 h-3 text-orange-500" />
                      <span className="font-medium">{tr.tool}</span>
                    </summary>
                    <div className="ml-4 mt-1 p-2 bg-[var(--bg-tertiary)] rounded text-[var(--text-tertiary)] overflow-x-auto">
                      <pre className="text-[10px]">{JSON.stringify(tr.result, null, 2).substring(0, 500)}</pre>
                    </div>
                  </details>
                ))}
              </div>
            </div>
          )}
        </div>

        {message.attachments && message.attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {message.attachments.map((att) => (
              <div
                key={att.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-secondary)]"
              >
                {getFileIcon(att.type)}
                <div className="min-w-0">
                  <div className="text-xs font-medium text-[var(--text-primary)] truncate max-w-[100px]">
                    {att.name}
                  </div>
                  <div className="text-xs text-[var(--text-tertiary)]">{formatFileSize(att.size)}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)] mt-1">
          <span>
            {new Date(message.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit'
            })}
          </span>
          {!isUser && message.iterations && message.iterations > 0 && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[10px]">
              <Zap className="w-3 h-3 text-orange-500" />
              {message.iterations} итер.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function getFileIcon(type: string) {
  if (type.startsWith('image/')) return <ImageIcon className="w-4 h-4" />;
  if (type.includes('pdf') || type.includes('document')) return <FileText className="w-4 h-4" />;
  return <File className="w-4 h-4" />;
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
