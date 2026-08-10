/**
 * ParticipantSelector Component
 * ADR-024: Chat & Message Architecture
 * 
 * Select chat participants: Users AND AI Agents
 * Replaces the old "Agent Selector" approach
 */

import { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { cn } from '@/shared/utils/cn';
import { 
  Search,
  X,
  User,
  Bot,
  Users,
  ChevronDown,
  Check,
  Loader2
} from 'lucide-react';

interface UserInfo {
  id: number;
  name: string;
  email?: string;
  avatar_url?: string;
  status?: 'online' | 'offline' | 'away';
}

interface AgentInfo {
  id: number;
  name: string;
  avatar?: string;
  description?: string;
  type?: string;
}

export type ParticipantType = 'user' | 'agent';

export interface Participant {
  type: ParticipantType;
  id: number;
  name: string;
  avatar?: string;
  email?: string;
  avatarUrl?: string;
  status?: string;
  description?: string;
}

export interface ParticipantSelectorProps {
  value?: Participant | null;
  participants?: Participant[];
  selectedParticipants?: Participant[];
  onSelect?: (participant: Participant) => void;
  onMultiSelect?: (participants: Participant[]) => void;
  onParticipantsChange?: (participants: Participant[]) => void;
  multiSelect?: boolean;
  showAgents?: boolean;
  showUsers?: boolean;
  maxParticipants?: number;
  placeholder?: string;
  showStatus?: boolean;
  filterType?: ParticipantType | 'all';
  excludeIds?: { users?: number[]; agents?: number[] };
  className?: string;
}

export function ParticipantSelector({
  value,
  participants = [],
  selectedParticipants = [],
  onSelect,
  onMultiSelect,
  onParticipantsChange,
  multiSelect = false,
  showAgents = true,
  showUsers = true,
  maxParticipants,
  placeholder = 'Выберите участника...',
  showStatus = true,
  filterType = 'all',
  excludeIds = {},
  className
}: ParticipantSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'users' | 'agents'>(
    filterType === 'all' ? 'all' : filterType === 'user' ? 'users' : 'agents'
  );
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch users
  const { data: users = [], isLoading: isLoadingUsers } = useQuery({
    queryKey: ['users-for-chat'],
    queryFn: async () => {
      const response = await apiClient.get<{ success: boolean; data: UserInfo[] }>('/users');
      return response.success ? response.data : [];
    },
    enabled: isOpen && (filterType === 'all' || filterType === 'user')
  });

  // Fetch agents
  const { data: agents = [], isLoading: isLoadingAgents } = useQuery({
    queryKey: ['ai-agents-for-chat'],
    queryFn: async () => {
      const response = await apiClient.get<{ success: boolean; data: AgentInfo[] }>('/ai-agents');
      return response.success ? response.data : [];
    },
    enabled: isOpen && (filterType === 'all' || filterType === 'agent')
  });

  // Convert to unified Participant format
  const allParticipants = useMemo(() => {
    const result: Participant[] = [];
    
    // Add users
    if (filterType === 'all' || filterType === 'user') {
      users.forEach(user => {
        if (!excludeIds.users?.includes(user.id)) {
          result.push({
            type: 'user',
            id: user.id,
            name: user.name,
            avatar: user.avatar_url,
            status: user.status || 'offline'
          });
        }
      });
    }
    
    // Add agents
    if (filterType === 'all' || filterType === 'agent') {
      agents.forEach(agent => {
        if (!excludeIds.agents?.includes(agent.id)) {
          result.push({
            type: 'agent',
            id: agent.id,
            name: agent.name,
            avatar: agent.avatar,
            description: agent.description
          });
        }
      });
    }
    
    return result;
  }, [users, agents, filterType, excludeIds]);

  // Filter by search query and tab
  const filteredParticipants = useMemo(() => {
    return allParticipants.filter(p => {
      // Filter by tab
      if (activeTab === 'users' && p.type !== 'user') return false;
      if (activeTab === 'agents' && p.type !== 'agent') return false;
      
      // Filter by search
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return p.name.toLowerCase().includes(query) ||
               (p.description?.toLowerCase().includes(query));
      }
      return true;
    });
  }, [allParticipants, activeTab, searchQuery]);

  // Check if participant is selected (for multi-select)
  const isSelected = (p: Participant) => {
    return participants.some(sp => sp.type === p.type && sp.id === p.id);
  };

  // Handle selection
  const handleSelect = (p: Participant) => {
    if (multiSelect && onMultiSelect) {
      const isAlreadySelected = isSelected(p);
      if (isAlreadySelected) {
        onMultiSelect(participants.filter(sp => !(sp.type === p.type && sp.id === p.id)));
      } else {
        onMultiSelect([...participants, p]);
      }
    } else if (onSelect) {
      onSelect(p);
      setIsOpen(false);
      setSearchQuery('');
    }
  };

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearchQuery('');
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const isLoading = isLoadingUsers || isLoadingAgents;

  const renderParticipantIcon = (p: Participant) => {
    if (p.type === 'agent') {
      return <Bot className="w-4 h-4 text-purple-500" />;
    }
    return <User className="w-4 h-4 text-blue-500" />;
  };

  const renderStatusDot = (status?: string) => {
    if (!showStatus || !status) return null;
    const colors: Record<string, string> = {
      online: 'bg-green-500',
      away: 'bg-yellow-500',
      offline: 'bg-gray-400'
    };
    return (
      <span className={cn(
        "w-2 h-2 rounded-full",
        colors[status] || colors.offline
      )} />
    );
  };

  return (
    <div ref={dropdownRef} className={cn("relative", className)}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] hover:bg-[var(--bg-tertiary)] transition-colors text-sm w-full"
      >
        {value ? (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {value.avatar ? (
              <img
                src={value.avatar}
                alt={value.name}
                className="w-5 h-5 rounded-full object-cover"
              />
            ) : (
              renderParticipantIcon(value)
            )}
            <span className="text-[var(--text-primary)] truncate">{value.name}</span>
            {showStatus && value.status && renderStatusDot(value.status)}
          </div>
        ) : multiSelect && participants.length > 0 ? (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Users className="w-4 h-4 text-[var(--text-tertiary)]" />
            <span className="text-[var(--text-primary)]">
              {participants.length} участник(ов)
            </span>
          </div>
        ) : (
          <span className="text-[var(--text-tertiary)] flex-1 text-left">{placeholder}</span>
        )}
        <ChevronDown className={cn(
          "w-4 h-4 text-[var(--text-tertiary)] transition-transform flex-shrink-0",
          isOpen && "rotate-180"
        )} />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-lg overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b border-[var(--border-secondary)]">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
              <input
                ref={inputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Поиск..."
                className="w-full pl-8 pr-3 py-1.5 text-sm rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Tabs */}
          {filterType === 'all' && (
            <div className="flex border-b border-[var(--border-secondary)]">
              {[
                { key: 'all', label: 'Все' },
                { key: 'users', label: 'Пользователи' },
                { key: 'agents', label: 'AI Агенты' }
              ].map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key as typeof activeTab)}
                  className={cn(
                    "flex-1 px-3 py-2 text-xs font-medium transition-colors",
                    activeTab === tab.key
                      ? "text-[var(--color-primary-500)] border-b-2 border-[var(--color-primary-500)]"
                      : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}

          {/* List */}
          <div className="max-h-64 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="w-5 h-5 animate-spin text-[var(--text-tertiary)]" />
              </div>
            ) : filteredParticipants.length === 0 ? (
              <div className="py-6 text-center text-sm text-[var(--text-tertiary)]">
                {searchQuery ? 'Не найдено' : 'Нет участников'}
              </div>
            ) : (
              filteredParticipants.map(p => {
                const selected = multiSelect ? isSelected(p) : value?.type === p.type && value?.id === p.id;
                return (
                  <button
                    key={`${p.type}-${p.id}`}
                    onClick={() => handleSelect(p)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[var(--bg-tertiary)] transition-colors",
                      selected && "bg-[var(--color-primary-50)]"
                    )}
                  >
                    {/* Avatar/Icon */}
                    <div className="relative flex-shrink-0">
                      {p.avatar ? (
                        <img
                          src={p.avatar}
                          alt={p.name}
                          className="w-8 h-8 rounded-full object-cover"
                        />
                      ) : (
                        <div className={cn(
                          "w-8 h-8 rounded-full flex items-center justify-center",
                          p.type === 'agent' ? "bg-purple-100" : "bg-blue-100"
                        )}>
                          {renderParticipantIcon(p)}
                        </div>
                      )}
                      {showStatus && p.type === 'user' && (
                        <span className={cn(
                          "absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-[var(--bg-secondary)]",
                          p.status === 'online' ? "bg-green-500" : 
                          p.status === 'away' ? "bg-yellow-500" : "bg-gray-400"
                        )} />
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0 text-left">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                          {p.name}
                        </span>
                        {p.type === 'agent' && (
                          <span className="px-1.5 py-0.5 text-[10px] rounded bg-purple-100 text-purple-700">
                            AI
                          </span>
                        )}
                      </div>
                      {p.description && (
                        <div className="text-xs text-[var(--text-tertiary)] truncate">
                          {p.description}
                        </div>
                      )}
                    </div>

                    {/* Check mark for multi-select */}
                    {multiSelect && selected && (
                      <Check className="w-4 h-4 text-[var(--color-primary-500)] flex-shrink-0" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
