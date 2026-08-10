/**
 * NewChatDialog Component
 * ADR-024: Unified chat model — agents are just participants
 *
 * Replaces the "New AI Chat" flow with a unified "New Chat" dialog
 * that allows selecting both human contacts and AI agents as participants.
 * Creates chat with type=chat (not ai_chat), agent starts responding after first message.
 */

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { cn } from '@/shared/utils/cn';
import {
  Search,
  X,
  Bot,
  User,
  Users,
  Check,
  Loader2,
  MessageSquarePlus,
} from 'lucide-react';
import type { AIAgent } from '../types';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

interface AvailableUser {
  id: number;
  name: string;
  email?: string;
  avatar_url?: string;
  managed_by_agent_table_id?: number | null;
}

export interface SelectedParticipant {
  /** Participant's user-account ID (works for both humans and agent-users) */
  id: number;
  name: string;
  type: 'user' | 'agent';
  icon?: string;
  description?: string;
  avatarUrl?: string;
  email?: string;
}

export interface NewChatDialogProps {
  /** Whether the dialog is visible */
  isOpen: boolean;
  /** Agents from AIChatContext (already loaded) */
  agents: AIAgent[];
  /** Current space ID for fetching available users */
  spaceId?: number;
  /** Called when the user confirms participant selection and wants to start a chat */
  onStartChat: (participants: SelectedParticipant[]) => void;
  /** Called when the dialog is closed without starting a chat */
  onClose: () => void;
}

// ──────────────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────────────

export function NewChatDialog({
  isOpen,
  agents,
  spaceId,
  onStartChat,
  onClose,
}: NewChatDialogProps) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<SelectedParticipant[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  // Focus search on open
  useEffect(() => {
    if (isOpen) {
      setSearch('');
      setSelected([]);
      const raf = requestAnimationFrame(() => searchRef.current?.focus());
      return () => cancelAnimationFrame(raf);
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // ── Fetch available users (includes agent-users with managed_by_agent_table_id) ──
  const { data: availableUsers = [], isLoading: isLoadingUsers } = useQuery({
    queryKey: ['new-chat-dialog-users', spaceId],
    queryFn: async () => {
      if (!spaceId) {
        // Fallback: fetch all users
        const response = await apiClient.get<{ success: boolean; data: AvailableUser[] }>('/users');
        return response.success ? response.data : [];
      }
      const response = await apiClient.get<{
        success: boolean;
        data: { users: AvailableUser[]; source: string; table_id: number | null };
      }>(`/access/space/${spaceId}/available-users`);
      return response.success && response.data?.users ? response.data.users : [];
    },
    enabled: isOpen,
    staleTime: 30_000,
  });

  // ── Separate human users from agent-users ──
  const humanUsers = useMemo(
    () => availableUsers.filter(u => !u.managed_by_agent_table_id),
    [availableUsers],
  );

  // Build a lookup: agent name → available user (for agent-user entries in the users list)
  const agentUserByName = useMemo(() => {
    const map = new Map<string, AvailableUser>();
    availableUsers
      .filter(u => u.managed_by_agent_table_id)
      .forEach(u => map.set(u.name.toLowerCase(), u));
    return map;
  }, [availableUsers]);

  // ── Filter by search ──
  const filteredAgents = useMemo(() => {
    if (!search.trim()) return agents;
    const q = search.toLowerCase();
    return agents.filter(
      a =>
        a.name.toLowerCase().includes(q) ||
        a.description?.toLowerCase().includes(q),
    );
  }, [agents, search]);

  const filteredHumans = useMemo(() => {
    if (!search.trim()) return humanUsers;
    const q = search.toLowerCase();
    return humanUsers.filter(
      u =>
        u.name.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q),
    );
  }, [humanUsers, search]);

  // ── Selection helpers ──
  const isSelected = useCallback(
    (type: 'user' | 'agent', id: number) =>
      selected.some(p => p.type === type && p.id === id),
    [selected],
  );

  const toggleAgent = useCallback(
    (agent: AIAgent) => {
      // Find the agent's user-account ID from the available users list (by name match)
      const agentUser = agentUserByName.get(agent.name.toLowerCase());

      if (!agentUser) {
        // If agent has no corresponding user-account, skip (shouldn't happen for properly configured agents)
        return;
      }

      const participant: SelectedParticipant = {
        id: agentUser.id,
        name: agent.name,
        type: 'agent',
        icon: agent.icon,
        description: agent.description,
      };

      setSelected(prev => {
        const alreadySelected = prev.some(p => p.type === 'agent' && p.id === agentUser.id);
        if (alreadySelected) {
          return prev.filter(p => !(p.type === 'agent' && p.id === agentUser.id));
        }
        return [...prev, participant];
      });
    },
    [agentUserByName],
  );

  const toggleUser = useCallback((user: AvailableUser) => {
    const participant: SelectedParticipant = {
      id: user.id,
      name: user.name,
      type: 'user',
      avatarUrl: user.avatar_url ?? undefined,
      email: user.email,
    };

    setSelected(prev => {
      const alreadySelected = prev.some(p => p.type === 'user' && p.id === user.id);
      if (alreadySelected) {
        return prev.filter(p => !(p.type === 'user' && p.id === user.id));
      }
      return [...prev, participant];
    });
  }, []);

  const removeParticipant = useCallback((type: 'user' | 'agent', id: number) => {
    setSelected(prev => prev.filter(p => !(p.type === type && p.id === id)));
  }, []);

  const handleStartChat = useCallback(() => {
    if (selected.length === 0) return;
    onStartChat(selected);
    onClose();
  }, [selected, onStartChat, onClose]);

  if (!isOpen) return null;

  const isLoading = isLoadingUsers;
  const hasAgents = agents.length > 0;
  const hasHumans = humanUsers.length > 0;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-label="Новый чат"
      >
        <div className="w-full max-w-md bg-[var(--bg-secondary)] rounded-xl shadow-2xl border border-[var(--border-primary)] flex flex-col max-h-[80vh]">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-secondary)]">
            <div className="flex items-center gap-2">
              <MessageSquarePlus className="w-5 h-5 text-[var(--color-primary-500)]" />
              <h2 className="text-base font-semibold text-[var(--text-primary)]">Новый чат</h2>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
              aria-label="Закрыть"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Search */}
          <div className="px-4 py-2.5 border-b border-[var(--border-secondary)]">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Поиск агентов и людей..."
                className="w-full pl-8 pr-8 py-2 text-sm rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/40"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                  aria-label="Очистить поиск"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Selected participants chips */}
          {selected.length > 0 && (
            <div className="px-4 py-2 border-b border-[var(--border-secondary)] flex flex-wrap gap-1.5">
              {selected.map(p => (
                <span
                  key={`${p.type}-${p.id}`}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium",
                    p.type === 'agent'
                      ? "bg-purple-500/15 text-purple-400 border border-purple-500/30"
                      : "bg-blue-500/15 text-blue-400 border border-blue-500/30",
                  )}
                >
                  {p.type === 'agent' ? (
                    <span className="text-sm leading-none">{p.icon || '🤖'}</span>
                  ) : (
                    <User className="w-3 h-3" />
                  )}
                  {p.name}
                  <button
                    onClick={() => removeParticipant(p.type, p.id)}
                    className="ml-0.5 opacity-60 hover:opacity-100 transition-opacity"
                    aria-label={`Удалить ${p.name}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="w-5 h-5 animate-spin text-[var(--text-tertiary)]" />
              </div>
            ) : (
              <>
                {/* Agents section */}
                {hasAgents && filteredAgents.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 px-4 py-2 bg-[var(--bg-tertiary)]/50">
                      <Bot className="w-3.5 h-3.5 text-purple-400" />
                      <span className="text-[11px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
                        Агенты
                      </span>
                      <span className="ml-auto text-[11px] text-[var(--text-tertiary)]">
                        {filteredAgents.length}
                      </span>
                    </div>
                    {filteredAgents.map(agent => {
                      const agentUser = agentUserByName.get(agent.name.toLowerCase());
                      const agentUserId = agentUser?.id;
                      const sel = agentUserId !== undefined && isSelected('agent', agentUserId);
                      const isUnavailable = !agentUser;

                      return (
                        <button
                          key={agent.id}
                          onClick={() => toggleAgent(agent)}
                          disabled={isUnavailable}
                          className={cn(
                            "w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--bg-tertiary)] transition-colors text-left",
                            sel && "bg-purple-500/8",
                            isUnavailable && "opacity-40 cursor-not-allowed",
                          )}
                          title={isUnavailable ? 'Агент ещё не появился в списке пользователей' : undefined}
                        >
                          {/* Icon */}
                          <div className={cn(
                            "w-9 h-9 rounded-full flex items-center justify-center text-lg flex-shrink-0",
                            sel
                              ? "bg-purple-500/25 ring-2 ring-purple-500/50"
                              : "bg-purple-500/12",
                          )}>
                            {agent.icon || '🤖'}
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                                {agent.name}
                              </span>
                              <span className="flex-shrink-0 px-1.5 py-0.5 text-[10px] rounded bg-purple-500/15 text-purple-400 font-medium">
                                AI
                              </span>
                            </div>
                            {agent.description && (
                              <p className="text-xs text-[var(--text-tertiary)] truncate mt-0.5">
                                {agent.description}
                              </p>
                            )}
                          </div>

                          {/* Check */}
                          {sel && (
                            <Check className="w-4 h-4 text-purple-400 flex-shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Empty state for agents */}
                {hasAgents && filteredAgents.length === 0 && search && (
                  <div className="px-4 py-3 text-xs text-[var(--text-tertiary)]">
                    Агенты не найдены
                  </div>
                )}

                {/* Divider between sections */}
                {hasAgents && filteredAgents.length > 0 && filteredHumans.length > 0 && (
                  <div className="border-t border-[var(--border-secondary)]" />
                )}

                {/* People section */}
                {hasHumans && filteredHumans.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 px-4 py-2 bg-[var(--bg-tertiary)]/50">
                      <Users className="w-3.5 h-3.5 text-blue-400" />
                      <span className="text-[11px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">
                        Люди
                      </span>
                      <span className="ml-auto text-[11px] text-[var(--text-tertiary)]">
                        {filteredHumans.length}
                      </span>
                    </div>
                    {filteredHumans.map(user => {
                      const sel = isSelected('user', user.id);
                      return (
                        <button
                          key={user.id}
                          onClick={() => toggleUser(user)}
                          className={cn(
                            "w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--bg-tertiary)] transition-colors text-left",
                            sel && "bg-blue-500/8",
                          )}
                        >
                          {/* Avatar */}
                          <div className={cn(
                            "w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0",
                            sel
                              ? "ring-2 ring-blue-500/50"
                              : "",
                          )}>
                            {user.avatar_url ? (
                              <img
                                src={user.avatar_url}
                                alt={user.name}
                                className="w-9 h-9 rounded-full object-cover"
                              />
                            ) : (
                              <div className={cn(
                                "w-9 h-9 rounded-full flex items-center justify-center",
                                sel ? "bg-blue-500/25" : "bg-blue-500/12",
                              )}>
                                <User className="w-4 h-4 text-blue-400" />
                              </div>
                            )}
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium text-[var(--text-primary)] truncate block">
                              {user.name}
                            </span>
                            {user.email && (
                              <span className="text-xs text-[var(--text-tertiary)] truncate block mt-0.5">
                                {user.email}
                              </span>
                            )}
                          </div>

                          {/* Check */}
                          {sel && (
                            <Check className="w-4 h-4 text-blue-400 flex-shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Empty state for people */}
                {hasHumans && filteredHumans.length === 0 && search && filteredAgents.length === 0 && (
                  <div className="py-8 text-center text-sm text-[var(--text-tertiary)]">
                    Ничего не найдено по запросу «{search}»
                  </div>
                )}

                {/* No data at all */}
                {!hasAgents && !hasHumans && !isLoading && (
                  <div className="py-8 text-center text-sm text-[var(--text-tertiary)]">
                    Нет доступных участников
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-[var(--border-secondary)] flex items-center justify-between gap-3">
            <span className="text-xs text-[var(--text-tertiary)]">
              {selected.length === 0
                ? 'Выберите участников'
                : `Выбрано: ${selected.length}`}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-sm rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                Отмена
              </button>
              <button
                onClick={handleStartChat}
                disabled={selected.length === 0}
                className={cn(
                  "flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors",
                  selected.length > 0
                    ? "bg-[var(--color-primary-500)] text-white hover:bg-[var(--color-primary-600)]"
                    : "bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] cursor-not-allowed",
                )}
              >
                <MessageSquarePlus className="w-4 h-4" />
                Начать чат
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
