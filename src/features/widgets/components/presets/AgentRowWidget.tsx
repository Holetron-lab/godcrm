/**
 * Agent Roster widget — agents of a space rendered as full-width rows.
 *
 * One row carries what the chat mention hover-card (MentionTooltip) shows —
 * avatar, name, description, model, operator, active state — laid out across
 * the whole row instead of a 224px card, plus a ⋯ menu with the server-authorized
 * passport action (ADR-165 WP-4).
 *
 * Source of data: `GET /ai/agents/:spaceId` (already resolves model_name /
 * provider_name), so the widget needs no table mapping and works in any space.
 * `config.space_id` pins it to a foreign space; default is the current one.
 */

import { useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { IdCard, Loader2, MoreHorizontal, ShieldCheck, ShieldOff } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { apiClient } from '@/shared/utils/apiClient';
import { Avatar } from '@/shared/components/ui/Avatar';
import { DropdownMenu, type DropdownMenuItem } from '@/shared/components/ui/DropdownMenu';
import { useCurrentSpace } from '@/features/spaces/store/spacesStore';
import { usePassportAuthority } from '@/features/ai-chat/hooks/usePassportAuthority';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { Button } from '@/shared/components/ui/Button';
import type { PresetWidgetProps } from '../../types/widget.types';

interface RosterAgent {
  id: number;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  is_active?: boolean;
  model_name?: string;
  provider_name?: string;
}

/** Agent user row behind an agent — carries the passport handle, if any. */
interface AgentUser {
  id: number;
  handle?: string | null;
  managed_by_agent_row_id?: number | null;
}

export function AgentRowWidget({ widget }: PresetWidgetProps) {
  const currentSpace = useCurrentSpace();
  const queryClient = useQueryClient();
  const spaceId = Number(widget?.config?.space_id) || currentSpace?.id || null;

  const { t } = useLanguage();
  const authority = usePassportAuthority('space_id', spaceId);
  const canManagePassport = authority.allowed;

  const { data: agents = [], isLoading, error } = useQuery({
    queryKey: ['agent-roster', 'agents', spaceId],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: { agents: RosterAgent[] } }>(
        `/ai/agents/${spaceId}`
      );
      return res.success ? res.data?.agents ?? [] : [];
    },
    enabled: !!spaceId,
  });

  const passportUsers = useQuery({
    queryKey: ['agent-roster', 'agent-users', spaceId],
    queryFn: async () => {
      const res = await apiClient.get<{ success: boolean; data: AgentUser[] }>(
        `/users/agents?spaceId=${spaceId}`
      );
      if (!res.success || !Array.isArray(res.data)) throw new Error(t('aiChat.ui.passportLoadFailed'));
      return res.data;
    },
    enabled: !!spaceId && canManagePassport,
  });

  const userByAgentRow = useMemo(() => {
    const map = new Map<number, AgentUser>();
    for (const u of passportUsers.data ?? []) {
      if (u.managed_by_agent_row_id) map.set(u.managed_by_agent_row_id, u);
    }
    return map;
  }, [passportUsers.data]);

  const refreshPassports = () => {
    void queryClient.invalidateQueries({ queryKey: ['agent-roster', 'agent-users'] });
    for (const key of ['users-for-mentions', 'chat-space-users', 'chat-all-users']) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
    void queryClient.invalidateQueries({ queryKey: ['passport-authority'] });
  };

  const issuePassport = async (agent: RosterAgent, user: AgentUser) => {
    try {
      await apiClient.post(`/users/${user.id}/passport`, {});
      toast.success(`Паспорт выдан: ${agent.name}`);
    } catch (err) {
      toast.error(`Не удалось выдать паспорт: ${(err as Error).message}`);
    } finally {
      refreshPassports();
    }
  };

  const revokePassport = async (agent: RosterAgent, user: AgentUser) => {
    if (!window.confirm(`Отозвать паспорт @${user.handle} у агента «${agent.name}»?`)) return;
    try {
      await apiClient.delete(`/users/${user.id}/passport`);
      toast.success(`Паспорт отозван: ${agent.name}`);
    } catch (err) {
      toast.error(`Не удалось отозвать паспорт: ${(err as Error).message}`);
    } finally {
      refreshPassports();
    }
  };

  const menuItemsFor = (agent: RosterAgent): DropdownMenuItem[] => {
    if (!canManagePassport || passportUsers.isPending || passportUsers.isError) return [];
    const user = userByAgentRow.get(agent.id);
    if (!user) {
      return [
        {
          label: 'Выдать паспорт',
          value: 'issue',
          icon: <ShieldCheck size={14} />,
          onSelect: () =>
            toast.error('У агента нет учётной записи — сначала создайте agent-user'),
        },
      ];
    }
    return user.handle
      ? [
          {
            label: 'Отозвать паспорт',
            value: 'revoke',
            icon: <ShieldOff size={14} />,
            danger: true,
            onSelect: () => revokePassport(agent, user),
          },
        ]
      : [
          {
            label: 'Выдать паспорт',
            value: 'issue',
            icon: <ShieldCheck size={14} />,
            onSelect: () => issuePassport(agent, user),
          },
        ];
  };

  if (!spaceId) {
    return <RosterNotice text="Пространство не выбрано" />;
  }
  if (isLoading) {
    return (
      <RosterNotice
        text="Загрузка агентов…"
        icon={<Loader2 size={16} className="animate-spin" />}
      />
    );
  }
  if (error) {
    return <RosterNotice text="Не удалось загрузить агентов" tone="error" />;
  }
  if (agents.length === 0) {
    return <RosterNotice text="В этом пространстве нет агентов" />;
  }

  return (
    <div className="h-full overflow-y-auto">
      {authority.hint && <div role={authority.isError ? 'alert' : 'status'} className="px-3 py-2 text-xs text-[var(--text-secondary)]">
        {authority.hint} {authority.isError && <Button type="button" size="sm" variant="ghost" onClick={() => void authority.refetch()}>{t('aiChat.ui.retry')}</Button>}
      </div>}
      {canManagePassport && passportUsers.isError && <div role="alert" className="px-3 py-2 text-xs text-[var(--text-secondary)]">
        {t('aiChat.ui.passportLoadFailed')} <Button type="button" size="sm" variant="ghost" onClick={() => void passportUsers.refetch()}>{t('aiChat.ui.retry')}</Button>
      </div>}
    <ul className="divide-y divide-[var(--border-primary)]">
      {agents.map((agent) => {
        const items = menuItemsFor(agent);
        const handle = userByAgentRow.get(agent.id)?.handle;
        const isActive = agent.is_active !== false;

        return (
          <li key={agent.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-[var(--bg-secondary)]">
            <Avatar emoji={agent.icon} name={agent.name} color={agent.color} size={36} />

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold text-[var(--text-primary)]">
                  {agent.name}
                </span>
                {handle && (
                  <span
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)] bg-[var(--bg-tertiary)]"
                    title="Паспорт выдан"
                  >
                    <IdCard size={11} aria-hidden="true" />@{handle}
                  </span>
                )}
              </div>

              <div className="truncate text-xs text-[var(--text-secondary)]">
                AI Agent
                {agent.model_name && <span className="opacity-60"> · {agent.model_name}</span>}
                {agent.provider_name && <span className="opacity-60"> · {agent.provider_name}</span>}
              </div>

              {agent.description && (
                <div
                  className="truncate text-xs leading-relaxed text-[var(--text-secondary)]"
                  title={agent.description}
                >
                  {agent.description}
                </div>
              )}
            </div>

            <div className="flex flex-shrink-0 items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              <span
                aria-hidden="true"
                className={cn('h-1.5 w-1.5 rounded-full', isActive ? 'bg-green-500' : 'bg-gray-500')}
              />
              <span className="hidden sm:inline">{isActive ? 'Active' : 'Inactive'}</span>
            </div>

            {items.length > 0 && (
              <DropdownMenu
                items={items}
                trigger={
                  <button
                    type="button"
                    aria-label={`Действия: ${agent.name}`}
                    className="flex-shrink-0 rounded p-1.5 text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-primary-500)]"
                  >
                    <MoreHorizontal size={16} />
                  </button>
                }
              />
            )}
          </li>
        );
      })}
    </ul>
    </div>
  );
}

function RosterNotice({
  text,
  icon,
  tone = 'muted',
}: {
  text: string;
  icon?: ReactNode;
  tone?: 'muted' | 'error';
}) {
  return (
    <div
      className={cn(
        'flex h-full items-center justify-center gap-2 text-sm',
        tone === 'error' ? 'text-[var(--color-error)]' : 'text-[var(--text-tertiary)]'
      )}
    >
      {icon}
      {text}
    </div>
  );
}

export default AgentRowWidget;
