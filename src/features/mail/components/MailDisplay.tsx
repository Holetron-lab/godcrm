import { Reply, Forward, Archive, Trash2 } from 'lucide-react';
import { Avatar } from '@/shared/components/ui/Avatar';
import { Button } from '@/shared/components/ui';
import type { MailMessage } from '../types';

interface MailDisplayProps {
  message: MailMessage | null;
}

export function MailDisplay({ message }: MailDisplayProps) {
  if (!message) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm text-[var(--text-tertiary)]">
        Select a message to read
      </div>
    );
  }

  return (
    <article className="flex h-full flex-col">
      <header className="flex items-start gap-3 border-b border-[var(--border-primary)] p-4">
        <Avatar name={message.fromName} size={40} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-[var(--text-primary)]">{message.subject}</h2>
          <p className="truncate text-sm text-[var(--text-secondary)]">
            {message.fromName}{' '}
            <span className="text-[var(--text-tertiary)]">&lt;{message.fromAddress}&gt;</span>
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          <Button variant="ghost" size="sm" aria-label="Reply">
            <Reply size={16} />
          </Button>
          <Button variant="ghost" size="sm" aria-label="Forward">
            <Forward size={16} />
          </Button>
          <Button variant="ghost" size="sm" aria-label="Archive">
            <Archive size={16} />
          </Button>
          <Button variant="ghost" size="sm" aria-label="Delete">
            <Trash2 size={16} />
          </Button>
        </div>
      </header>
      <div className="flex-1 overflow-auto whitespace-pre-wrap p-6 text-sm leading-relaxed text-[var(--text-primary)]">
        {message.body}
      </div>
    </article>
  );
}
