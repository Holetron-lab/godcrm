import { apiClient } from '@/shared/utils/apiClient';

/**
 * ADR-0079 §2.3 — unlock a locked Tier-B binding for the current user. The
 * server stores the slug in `users.agent_config.unlocked_agent_slugs`, so the
 * next agents fetch returns the row as `visibility: 'unlocked'`.
 */
export async function unlockAgent(spaceId: number, agentId: number): Promise<void> {
  const response = await apiClient.post<{ success: boolean }>(`/ai/agents/${spaceId}/${agentId}/unlock`);
  if (!response.success) throw new Error('Unable to unlock agent');
}
