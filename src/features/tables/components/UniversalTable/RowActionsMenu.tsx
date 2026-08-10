import { MoreVertical, Copy, Trash2, Pencil, MessageCircle, MessageCirclePlus, Paperclip, CheckCircle2, Circle } from 'lucide-react';
import { DropdownMenu, Button } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';

interface RowActionsMenuProps {
  onEdit?: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onOpenChat?: () => void;
  onAttachToChat?: () => void;
  onAttachToMessage?: () => void;
  onToggleSelection?: () => void;
  isSelected?: boolean;
}

export const RowActionsMenu = ({ onEdit, onDuplicate, onDelete, onOpenChat, onAttachToChat, onAttachToMessage, onToggleSelection, isSelected }: RowActionsMenuProps) => {
  const { t } = useLanguage();

  const items = [
    ...(onOpenChat ? [{
      label: t('rowActions.openChat') || 'Open chat',
      value: 'openChat',
      icon: <MessageCircle className="h-4 w-4" />,
      onSelect: onOpenChat
    }] : []),
    ...(onAttachToChat ? [{
      label: t('rowActions.attachToChat') || 'Attach to chat',
      value: 'attachToChat',
      icon: <MessageCirclePlus className="h-4 w-4" />,
      onSelect: onAttachToChat
    }] : []),
    ...(onAttachToMessage ? [{
      label: t('rowActions.attachToMessage') || 'Attach to message',
      value: 'attachToMessage',
      icon: <Paperclip className="h-4 w-4" />,
      onSelect: onAttachToMessage
    }] : []),
    ...(onToggleSelection ? [{
      label: isSelected
        ? (t('rowActions.deselectRow') || 'Deselect row')
        : (t('rowActions.selectRow') || 'Select row'),
      value: 'toggleSelect',
      icon: isSelected
        ? <CheckCircle2 className="h-4 w-4" />
        : <Circle className="h-4 w-4" />,
      onSelect: onToggleSelection
    }] : []),
    ...(onEdit ? [{
      label: t('rowActions.editRow') || 'Редактировать',
      value: 'edit',
      icon: <Pencil className="h-4 w-4" />,
      onSelect: onEdit
    }] : []),
    {
      label: t('rowActions.duplicateRow') || 'Дублировать',
      value: 'duplicate',
      icon: <Copy className="h-4 w-4" />,
      onSelect: onDuplicate
    },
    {
      label: t('rowActions.deleteRow') || 'Удалить',
      value: 'delete',
      icon: <Trash2 className="h-4 w-4" />,
      danger: true,
      onSelect: onDelete
    }
  ];

  return (
    <DropdownMenu
      trigger={
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-primary)] transition hover:bg-[var(--bg-tertiary)]"
          data-testid="row-actions-menu"
        >
          <MoreVertical className="h-5 w-5" />
        </button>
      }
      items={items}
    />
  );
};
