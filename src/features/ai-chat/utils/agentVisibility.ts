/**
 * Agent visibility filter — ADR-0079 §2 (Agent Visibility Tiers).
 *
 * Tier-B agents (architect, developer-ralph, frontend-developer, sysadmin)
 * carry `visibility = 'locked'` on their per-space binding until the user
 * unlocks them (promo code MASTERMIND/MESHOK at register, or Settings →
 * Add Agent). Filter strips locked bindings from INVOCATION pickers
 * (@mentions, /commands, new-chat picker). Management surfaces
 * (Settings → Add Agent, owner agent list) should NOT use this filter —
 * they need to show locked bindings to enable unlock.
 *
 * Defensive contract: if `visibility` field is absent on a binding
 * (backend P0 not yet shipped), treat as visible. This keeps the picker
 * working during the rollout window.
 */

export type AgentVisibility = 'default' | 'unlocked' | 'locked';

export interface AgentVisibilityShape {
  visibility?: AgentVisibility | string | null;
}

export function isAgentInvokable<T extends AgentVisibilityShape>(agent: T): boolean {
  return agent.visibility !== 'locked';
}

export function filterInvokableAgents<T extends AgentVisibilityShape>(agents: T[]): T[] {
  return agents.filter(isAgentInvokable);
}
