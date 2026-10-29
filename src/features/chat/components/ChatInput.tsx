/**
 * ChatInput - Input component for sending messages
 * @see ADR-069-MODULE-INTEGRATION.md
 * 
 * Performance optimizations (ADR-069 TASK-018):
 * - Debounce protection prevents double-click/rapid submissions
 * - isSending state disables input during send
 */
import { useState, useCallback, useRef, KeyboardEvent } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { Button } from '@/shared/components/ui/Button';
import { getChatSendMode, useChatSendShortcut } from '@/shared/hooks/useChatSendShortcut';

export interface ChatInputProps {
  onSend: (content: string) => void;
  isSending?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

// Debounce delay to prevent double-clicks
const DEBOUNCE_DELAY = 300;

export function ChatInput({
  onSend,
  isSending = false,
  disabled = false,
  placeholder = 'Введите сообщение...',
  className = '',
}: ChatInputProps) {
  const [value, setValue] = useState('');
  const { preferences } = useChatSendShortcut();
  const lastSendTime = useRef<number>(0);

  const handleSend = useCallback(() => {
    const now = Date.now();
    // Debounce protection: prevent rapid submissions
    if (now - lastSendTime.current < DEBOUNCE_DELAY) return;
    if (!value.trim() || isSending || disabled) return;
    
    lastSendTime.current = now;
    onSend(value.trim());
    setValue('');
  }, [value, isSending, disabled, onSend]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter' && e.shiftKey === (getChatSendMode(preferences) === 'shift-enter') && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend, preferences]);

  return (
    <div className={`flex gap-2 px-4 py-3 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)] ${className}`}>
      <textarea
        rows={2}
        aria-label={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled || isSending}
        className="min-w-0 flex-1 resize-none rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-primary-500)] disabled:opacity-50"
      />
      <Button
        aria-label="Отправить сообщение"
        title="Отправить сообщение"
        onClick={handleSend}
        disabled={!value.trim() || isSending || disabled}
        size="sm"
        variant="primary"
        className="px-3"
      >
        {isSending ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Send className="w-4 h-4" />
        )}
      </Button>
    </div>
  );
}
