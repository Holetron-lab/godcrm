import { useToast, type Toast } from '@/shared/hooks/useToast';
import { Avatar } from '@/shared/components/ui/Avatar';

// Deterministic hsl from a string — mirrors ChatMessageList/ForwardedQuoteBlock
// so the same agent paints the same color across surfaces.
function hashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 65%, 55%)`;
}

export const ToastContainer = () => {
  const { toasts, removeToast, handleChatToastClick } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2 max-w-[360px]">
      {toasts.map((toast) =>
        toast.type === 'chat' && toast.chat ? (
          <ChatToast
            key={toast.id}
            toast={toast}
            onClick={() => handleChatToastClick(toast)}
            onDismiss={() => removeToast(toast.id)}
          />
        ) : (
          <button
            key={toast.id}
            type="button"
            className={`rounded-lg px-4 py-3 text-sm text-white shadow-lg transition-all ${
              toast.type === 'success'
                ? 'bg-green-500'
                : toast.type === 'error'
                  ? 'bg-red-500'
                  : 'bg-primary-500'
            }`}
            onClick={() => removeToast(toast.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                removeToast(toast.id);
              }
            }}
            aria-label="Dismiss notification"
          >
            {toast.message}
          </button>
        ),
      )}
    </div>
  );
};

interface ChatToastProps {
  toast: Toast;
  onClick: () => void;
  onDismiss: () => void;
}

function ChatToast({ toast, onClick, onDismiss }: ChatToastProps) {
  const meta = toast.chat!;
  const collapsed = (meta.collapsedCount ?? 0) > 5;
  const accent = meta.accentColor || hashColor(meta.senderName);

  return (
    <div
      className="flex items-start gap-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] px-3 py-2.5 shadow-lg text-left cursor-pointer hover:bg-[var(--bg-tertiary)] transition-colors"
      style={{ borderLeft: `4px solid ${accent}` }}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Open chat with ${meta.senderName}`}
    >
      <Avatar
        url={meta.senderAvatarUrl}
        emoji={meta.agentIcon}
        name={meta.senderName}
        color={accent}
        size={32}
      />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-[var(--text-primary)] truncate">
          {meta.senderName}
          {collapsed && (
            <span className="ml-1 text-[var(--text-tertiary)] font-normal">
              · {meta.collapsedCount} new
            </span>
          )}
        </div>
        <div className="text-xs text-[var(--text-secondary)] line-clamp-1 break-words">
          {toast.message}
        </div>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-lg leading-none p-0.5 flex-shrink-0"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
