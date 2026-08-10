import { useAIChat } from '@/features/ai-chat';
import { MessageCircle } from 'lucide-react';
import { useChatUnreadSummary } from '@/shared/hooks/useChatUnreadSummary';

export const FloatingChatButton = () => {
  const { toggleChat, isOpen } = useAIChat();
  const { total } = useChatUnreadSummary({ enabled: !isOpen });

  if (isOpen) return null;

  const badge = total > 0 ? (total >= 100 ? '99+' : String(total)) : null;

  return (
    <button
      onClick={toggleChat}
      className="fixed bottom-[70px] right-[10px] z-40 w-10 h-10 flex items-center justify-center rounded-xl shadow-md bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-primary)] transition-colors"
      title={badge ? `Open AI Chat (${total} unread)` : 'Open AI Chat'}
    >
      <MessageCircle className="w-5 h-5" />
      {badge && (
        <span
          className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold leading-[18px] text-center shadow-sm ring-2 ring-[var(--bg-secondary)]"
          aria-label={`${total} unread messages`}
        >
          {badge}
        </span>
      )}
    </button>
  );
};
