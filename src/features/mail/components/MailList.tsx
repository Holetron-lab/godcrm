import { cn } from '@/shared/utils/cn';
import type { MailMessage } from '../types';

interface MailListProps {
  messages: MailMessage[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function MailList({ messages, selectedId, onSelect }: MailListProps) {
  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-[var(--text-tertiary)]">
        No messages in this folder
      </div>
    );
  }

  return (
    <ul role="list" className="flex flex-col divide-y divide-[var(--border-primary)]">
      {messages.map((message) => {
        const active = message.id === selectedId;
        return (
          <li key={message.id}>
            <button
              type="button"
              aria-current={active ? 'true' : undefined}
              onClick={() => onSelect(message.id)}
              className={cn(
                'flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors',
                active ? 'bg-[var(--bg-tertiary)]' : 'hover:bg-[var(--bg-secondary)]'
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'truncate text-sm',
                    message.read ? 'text-[var(--text-secondary)]' : 'font-semibold text-[var(--text-primary)]'
                  )}
                >
                  {message.fromName}
                </span>
                {!message.read && (
                  <span
                    className="h-2 w-2 flex-shrink-0 rounded-full bg-[var(--color-primary-600)]"
                    aria-label="Unread"
                  />
                )}
                <span className="ml-auto flex-shrink-0 text-xs text-[var(--text-tertiary)]">
                  {formatDate(message.date)}
                </span>
              </div>
              <span
                className={cn(
                  'truncate text-sm',
                  message.read ? 'text-[var(--text-secondary)]' : 'text-[var(--text-primary)]'
                )}
              >
                {message.subject}
              </span>
              <span className="line-clamp-2 text-xs text-[var(--text-tertiary)]">{message.preview}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
