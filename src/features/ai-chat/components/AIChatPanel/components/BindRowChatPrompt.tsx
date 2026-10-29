import { useLanguage } from '@/shared/i18n/LanguageContext';
/**
 * BindRowChatPrompt — small inline confirmation dialog rendered when the user
 * clicks a row that has no chat WHILE they are sitting in a chat that has no
 * bound row. Three actions:
 *   - Привязать этот чат   → bind current conversation to that row
 *   - Создать новый чат    → ensure-row-chat (lazy create)
 *   - Отмена
 */
import { Modal } from '@/shared/components/ui/Modal';
import { Link2, Plus } from 'lucide-react';

interface BindRowChatPromptProps {
  rowTitle: string;
  onBindCurrent: () => void;
  onCreateNew: () => void;
  onClose: () => void;
}

export function BindRowChatPrompt({ rowTitle, onBindCurrent, onCreateNew, onClose }: BindRowChatPromptProps) {
  const { t } = useLanguage();
  return (
    <Modal
      open
      onOpenChange={open => { if (!open) onClose(); }}
      title={t('aiChat.ui.thisRowHasNoChat')}
      description={rowTitle}
      size="sm"
    >
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onBindCurrent}
          className="w-full flex items-center gap-2 px-3 py-2 rounded text-sm bg-[var(--color-primary-500)]/15 text-[var(--color-primary-400)] hover:bg-[var(--color-primary-500)]/25 transition-colors"
        >
          <Link2 className="w-4 h-4" />
          <span>{t('aiChat.ui.linkThisChatToTheRow')}</span>
        </button>
        <button
          type="button"
          onClick={onCreateNew}
          className="w-full flex items-center gap-2 px-3 py-2 rounded text-sm bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>{t('aiChat.ui.createANewChat')}</span>
        </button>
      </div>
    </Modal>
  );
}
