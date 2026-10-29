import React, { useState } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { Avatar } from '@/shared/components/ui/Avatar';
import { ACCESS_LEVEL_LABELS, ACCESS_LEVEL_LABELS_EN } from '@/shared/types/user-access.types';
import { useMentionUsers, type MentionUserInfo } from './MentionUsersContext';
import { useMentionSpaceLevel } from './useMentionSpaceLevel';

interface MentionTooltipProps {
  slug?: string;
  info?: MentionUserInfo;
  children: React.ReactElement;
}

/** One hover/focus card for invocation pills and message avatars. */
export const MentionTooltip: React.FC<MentionTooltipProps> = ({ slug, info: sender, children }) => {
  const { t, language } = useLanguage();
  const [open, setOpen] = useState(false);
  const { getBySlug, spaceId } = useMentionUsers();
  const info = sender || (slug ? getBySlug(slug) : null);
  const membership = useMentionSpaceLevel(info?.userId, open, spaceId);
  const ru = language === 'ru';
  if (!info) return children;

  const level = membership.error ? (ru ? 'Не удалось загрузить уровень' : 'Could not load access level')
    : membership.loading ? (ru ? 'Загрузка уровня…' : 'Loading access level…')
      : membership.level === 'not_member' ? (ru ? 'Не добавлен в спейс' : 'Not added to this space')
        : membership.level === 'unknown' ? (ru ? 'Уровень неизвестен' : 'Access level unknown')
          : (ru ? ACCESS_LEVEL_LABELS : ACCESS_LEVEL_LABELS_EN)[membership.level];
  const imageIcon = !!info.icon && /^(\/|https?:\/\/|data:)/.test(info.icon);
  const status = info.isActive === true ? (ru ? 'Активен' : 'Active')
    : info.isActive === false ? (ru ? 'Неактивен' : 'Inactive')
      : (ru ? 'Статус неизвестен' : 'Status unknown');

  return (
    <Tooltip.Provider delayDuration={300}>
      <Tooltip.Root open={open} onOpenChange={setOpen}>
        <Tooltip.Trigger asChild tabIndex={0}>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content side="top" sideOffset={8} collisionPadding={8}
            className="z-[9999] w-56 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3 text-xs text-[var(--text-primary)] shadow-xl">
            <div className="flex items-start gap-2.5">
              <Avatar url={info.avatar || (imageIcon ? info.icon : undefined)} emoji={imageIcon ? undefined : info.icon} name={info.name} color={info.color} size={36} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{info.name}</div>
                <div className="text-[var(--text-secondary)]">{info.type === 'agent' ? t('aiChat.ui.agent') : t('aiChat.ui.user')}</div>
                {info.model && <div className="truncate text-[var(--text-secondary)]">{info.model}</div>}
                {info.description && <div className="mt-1 line-clamp-2">{info.description}</div>}
              </div>
            </div>
            <div className="mt-2 space-y-1 border-t border-[var(--border-primary)] pt-2">
              {info.type === 'agent' && <div>{ru ? 'Статус агента' : 'Agent status'}: {status}</div>}
              <div>{membership.spaceName || (ru ? 'Текущий спейс' : 'Current space')}: {level}</div>
            </div>
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
};

export default MentionTooltip;
