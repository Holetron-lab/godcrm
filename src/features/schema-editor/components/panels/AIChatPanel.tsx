import { useState } from 'react';
import { Bot, Send, Loader2 } from 'lucide-react';

interface AIChatPanelProps {
  spaceId: number;
}

/**
 * AI Chat Panel for Schema Editor
 * Provides AI assistance for database schema design
 */
export const AIChatPanel = ({ spaceId }: AIChatPanelProps) => {
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<
    Array<{ role: 'user' | 'assistant'; content: string }>
  >([
    {
      role: 'assistant',
      content:
        'Привет! Я помогу спроектировать схему базы данных. Вы можете попросить меня:\n\n• Создать таблицу\n• Добавить колонку\n• Связать таблицы\n• Спроектировать схему по описанию',
    },
  ]);

  const handleSend = async () => {
    if (!message.trim() || isLoading) return;

    const userMessage = message.trim();
    setMessage('');
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);

    // TODO: Integrate with actual AI service
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content:
            'Понял! Работаю над вашим запросом... (AI интеграция в процессе разработки)',
        },
      ]);
      setIsLoading(false);
    }, 1000);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="h-full flex flex-col bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
        <Bot className="w-4 h-4 text-[var(--accent-primary)]" />
        <h3 className="text-sm font-medium text-[var(--text-primary)]">
          AI Schema Assistant
        </h3>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[90%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-[var(--accent-primary)] text-white'
                  : 'bg-[var(--bg-secondary)] text-[var(--text-primary)]'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-[var(--bg-secondary)] rounded-lg px-3 py-2">
              <Loader2 className="w-4 h-4 animate-spin text-[var(--text-secondary)]" />
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-[var(--border-primary)]">
        <div className="flex items-end gap-2">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Опишите таблицу или связь..."
            rows={2}
            className="flex-1 resize-none px-3 py-2 rounded-lg text-sm
              bg-[var(--bg-secondary)] border border-[var(--border-primary)]
              text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]
              focus:outline-none focus:border-[var(--accent-primary)] transition-colors"
          />
          <button
            onClick={handleSend}
            disabled={!message.trim() || isLoading}
            className="p-2 rounded-lg bg-[var(--accent-primary)] text-white
              hover:bg-[var(--accent-primary-hover)] disabled:opacity-50
              disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-[var(--text-tertiary)] mt-1.5">
          Нажмите Enter для отправки
        </p>
      </div>
    </div>
  );
};
