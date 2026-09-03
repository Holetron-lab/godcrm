/**
 * AddAgentSettings — Settings → Add Agent sub-tab (ADR-0079 §2).
 *
 * Lists Tier-B agents that are still locked in the current Space and lets
 * the user unlock them on demand (no promo code required). Counterpart to
 * the promo path (MASTERMIND / MESHOK at /auth/register, ADR-0070).
 *
 * Contract with backend (Ralph, P0+P1+P4):
 *   GET  /api/v3/ai/agents/:spaceId?include_locked=true
 *        → returns ALL bound agents, including those with visibility='locked'.
 *   POST /api/v3/ai/agents/:spaceId/:agentId/unlock
 *        → flips the binding to visibility='unlocked'.
 *
 * Defensive: if backend doesn't yet honour `include_locked`, the list shows
 * "Все агенты уже разблокированы" — no errors, no broken UI.
 */

import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bot, Lock, Loader2, ShieldCheck, Plus } from 'lucide-react';
import { apiClient } from '@/shared/utils/apiClient';
import { useCurrentSpace } from '@/features/spaces/store/spacesStore';
import { Button } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import type { AIAgent } from '@/features/ai-chat/types';

interface AgentsResponse {
  success: boolean;
  data: { agents: AIAgent[] };
}

async function fetchLockedAgents(spaceId: number): Promise<AIAgent[]> {
  const resp = await apiClient.get<AgentsResponse>(
    `/ai/agents/${spaceId}?include_locked=true`,
  );
  const agents = resp?.data?.agents ?? [];
  return agents.filter((a) => a.visibility === 'locked');
}

export function AddAgentSettings() {
  const { language } = useLanguage();
  const t = (ru: string, en: string) => (language === 'ru' ? ru : en);
  const currentSpace = useCurrentSpace();
  const spaceId = currentSpace?.id;
  const queryClient = useQueryClient();

  const { data: lockedAgents = [], isLoading, isError } = useQuery({
    queryKey: ['add-agent-locked', spaceId],
    queryFn: () => fetchLockedAgents(spaceId!),
    enabled: !!spaceId,
    staleTime: 30_000,
  });

  const unlockMutation = useMutation({
    mutationFn: async (agentId: number) => {
      await apiClient.post(`/ai/agents/${spaceId}/${agentId}/unlock`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['add-agent-locked', spaceId] });
      queryClient.invalidateQueries({ queryKey: ['ai-agents-for-chat-panel', spaceId] });
    },
  });

  const sortedAgents = useMemo(
    () => [...lockedAgents].sort((a, b) => a.name.localeCompare(b.name)),
    [lockedAgents],
  );

  return (
    <div
      id="add-agent"
      className="rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6 shadow-sm scroll-mt-6"
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h3 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Plus className="h-5 w-5 text-primary-500" />
            Add Agent
          </h3>
          <p className="text-sm text-[var(--text-secondary)]">
            {t('Подключи дополнительных агентов в этот Space', 'Add extra agents to this Space')}
          </p>
        </div>
      </div>

      {/* Body */}
      {!spaceId ? (
        <p className="text-sm text-[var(--text-tertiary)]">{t('Выбери Space, чтобы управлять агентами.', 'Select a Space to manage agents.')}</p>
      ) : isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-[var(--text-secondary)]" />
        </div>
      ) : isError ? (
        <p className="text-sm text-red-500">
          {t('Не удалось загрузить список агентов. Попробуй обновить страницу.', 'Failed to load the agent list. Try refreshing the page.')}
        </p>
      ) : sortedAgents.length === 0 ? (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-secondary)]">
          <ShieldCheck className="h-5 w-5 text-emerald-500 flex-shrink-0" />
          <p className="text-sm text-[var(--text-secondary)]">
            {t('Все доступные агенты уже разблокированы в этом Space.', 'All available agents are already unlocked in this Space.')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {sortedAgents.map((agent) => (
            <div
              key={agent.id}
              className="flex items-start gap-3 p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-secondary)]"
            >
              <div className="text-2xl flex-shrink-0">
                {agent.icon || <Bot className="h-6 w-6 text-[var(--text-tertiary)]" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="text-sm font-semibold text-[var(--text-primary)] truncate">
                    {agent.name}
                  </h4>
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 border border-amber-200">
                    <Lock className="h-2.5 w-2.5" /> locked
                  </span>
                </div>
                {agent.description && (
                  <p className="text-xs text-[var(--text-secondary)] line-clamp-2 mb-3">
                    {agent.description}
                  </p>
                )}
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => unlockMutation.mutate(agent.id)}
                  disabled={unlockMutation.isPending}
                >
                  {unlockMutation.isPending && unlockMutation.variables === agent.id ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : null}
                  {t('Разблокировать', 'Unlock')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
