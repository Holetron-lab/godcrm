/**
 * ContactsList Component v3
 * ADR-024: Chat Contacts with improved UX
 * 
 * Features:
 * - Chat history section at top
 * - Contacts with status dot on avatar
 * - User type as text label
 * - Working menu actions
 * - AI agents tab for quick chat
 * - Tasks tab with configurable columns
 */

import { logger } from '@/shared/utils/logger';
import { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { 
  Users,
  Bot,
  User,
  ListTodo,
  Search,
  Zap,
  X,
  ChevronRight,
  Loader2,
  Settings,
  Database,
  Table2,
  Hash,
  MoreVertical,
  MessageSquare,
  UserPlus,
  UserMinus,
  Calendar,
  History,
  Trash2
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { apiClient } from '@/shared/utils/apiClient';
import { AIAgent } from '../types';

export type ContactType = 'human' | 'agent-user';

export interface Contact {
  id: number;
  type: ContactType;
  name: string;
  email?: string;
  avatar?: string;
  status?: 'online' | 'offline' | 'away';
  agentTableId?: number;
  agentRowId?: number;
  lastMessage?: string;
  lastMessageTime?: Date;
  unreadCount?: number;
}

interface UserData {
  id: number;
  name: string;
  email?: string;
  avatar_url?: string;
  user_type?: 'human' | 'agent';
  managed_by_agent_table_id?: number;
  managed_by_agent_row_id?: number;
}

export interface TasksSourceConfig {
  tableId: number;
  tableName: string;
  tableIcon?: string;
  displayColumn?: string;
  deadlineColumn?: string;
  statusColumn?: string;
  priorityColumn?: string;
}

export interface Conversation {
  id: string;
  title: string;
  agentId?: number;
  agentName?: string;
  agentIcon?: string;
  messageCount?: number;
  lastMessageAt?: string;
  createdAt?: string;
}

export interface ContactsListProps {
  agents: AIAgent[];
  onSelectAgent: (agent: AIAgent) => void;
  onSelectUser?: (userId: number) => void;
  onSelectTask?: (taskId: number, tableId: number) => void;
  onConfigureTasks?: () => void;
  onAddToChat?: (userId: number) => void;
  onRemoveFromChat?: (userId: number) => void;
  onStartChatWithUser?: (userId: number) => void;
  // Conversations
  conversations?: Conversation[];
  currentConversationId?: string;
  onSelectConversation?: (id: string) => void;
  onDeleteConversation?: (id: string) => void;
  onNewConversation?: () => void;
  isLoadingConversations?: boolean;
  // Current state
  currentAgentId?: number;
  spaceId?: number;
  tasksSource?: TasksSourceConfig;
  chatParticipantIds?: number[];
  className?: string;
}

type TabKey = 'contacts' | 'ai-chat' | 'tasks';
type ContactFilter = 'all' | 'humans' | 'agents';

// Contact Menu Component
function ContactMenu({ 
  contact, 
  isInChat,
  onAddToChat, 
  onRemoveFromChat,
  onStartChat 
}: { 
  contact: Contact;
  isInChat: boolean;
  onAddToChat?: () => void;
  onRemoveFromChat?: () => void;
  onStartChat?: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleStartChat = (e: React.MouseEvent) => {
    e.stopPropagation();
    logger.debug('[ContactMenu] Start chat with', contact.name);
    onStartChat?.();
    setIsOpen(false);
  };

  const handleAddToChat = (e: React.MouseEvent) => {
    e.stopPropagation();
    logger.debug('[ContactMenu] Add to chat', contact.name);
    onAddToChat?.();
    setIsOpen(false);
  };

  const handleRemoveFromChat = (e: React.MouseEvent) => {
    e.stopPropagation();
    logger.debug('[ContactMenu] Remove from chat', contact.name);
    onRemoveFromChat?.();
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}
        className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
      >
        <MoreVertical className="w-4 h-4" />
      </button>
      
      {isOpen && (
        <div className="absolute right-0 top-full mt-1 z-50 w-48 py-1 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] shadow-lg">
          <button
            onClick={handleStartChat}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
          >
            <MessageSquare className="w-4 h-4" />
            Начать чат
          </button>
          {isInChat ? (
            <button
              onClick={handleRemoveFromChat}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-400 hover:bg-[var(--bg-tertiary)]"
            >
              <UserMinus className="w-4 h-4" />
              Удалить из чата
            </button>
          ) : (
            <button
              onClick={handleAddToChat}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
            >
              <UserPlus className="w-4 h-4" />
              Добавить в чат
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Status Dot on Avatar
function StatusDot({ status }: { status?: 'online' | 'offline' | 'away' }) {
  const colors = {
    online: 'bg-green-500',
    away: 'bg-yellow-500',
    offline: 'bg-gray-400'
  };
  return (
    <span className={cn(
      "absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-[var(--bg-secondary)]",
      colors[status || 'offline']
    )} />
  );
}

// User Type Label
function UserTypeLabel({ type }: { type: ContactType }) {
  if (type === 'agent-user') {
    return (
      <span className="text-[10px] text-purple-400">
        AI Агент
      </span>
    );
  }
  return (
    <span className="text-[10px] text-[var(--text-tertiary)]">
      Человек
    </span>
  );
}

export function ContactsList({
  agents,
  onSelectAgent,
  onSelectUser,
  onSelectTask,
  onConfigureTasks,
  onAddToChat,
  onRemoveFromChat,
  onStartChatWithUser,
  conversations = [],
  currentConversationId,
  onSelectConversation,
  onDeleteConversation,
  onNewConversation,
  isLoadingConversations,
  currentAgentId,
  spaceId,
  tasksSource,
  chatParticipantIds = [],
  className
}: ContactsListProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('contacts');
  const [searchQuery, setSearchQuery] = useState('');
  const [contactFilter, setContactFilter] = useState<ContactFilter>('all');
  const [showHistory, setShowHistory] = useState(conversations.length > 0);

  // Fetch ALL users
  const { data: users = [], isLoading: isLoadingUsers } = useQuery({
    queryKey: ['chat-users-all', spaceId],
    queryFn: async () => {
      const response = await apiClient.get<{
        success: boolean;
        data: UserData[];
      }>('/users');
      return response.success ? response.data : [];
    }
  });

  // Fetch tasks from configured table
  const { data: taskRows = [], isLoading: isLoadingTasks } = useQuery({
    queryKey: ['task-rows', tasksSource?.tableId],
    queryFn: async () => {
      if (!tasksSource?.tableId) return [];
      const response = await apiClient.get<{
        success: boolean;
        data: { rows: Array<{ id: number; data: Record<string, unknown> }> };
      }>(`/tables/${tasksSource.tableId}/rows?limit=100`);
      return response.success ? response.data.rows : [];
    },
    enabled: !!tasksSource?.tableId && activeTab === 'tasks'
  });

  // Convert users to contacts
  const allContacts: Contact[] = useMemo(() => {
    return users.map(user => ({
      id: user.id,
      type: user.managed_by_agent_table_id != null ? 'agent-user' as const : 'human' as const,
      name: user.name,
      email: user.email,
      avatar: user.avatar_url,
      agentTableId: user.managed_by_agent_table_id,
      agentRowId: user.managed_by_agent_row_id,
      status: 'offline' as const
    }));
  }, [users]);

  const humanContacts = useMemo(() => allContacts.filter(c => c.type === 'human'), [allContacts]);
  const agentUserContacts = useMemo(() => allContacts.filter(c => c.type === 'agent-user'), [allContacts]);

  // Filter contacts
  const filteredContacts = useMemo(() => {
    let contacts = allContacts;
    
    if (contactFilter === 'humans') {
      contacts = humanContacts;
    } else if (contactFilter === 'agents') {
      contacts = agentUserContacts;
    }
    
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      contacts = contacts.filter(c => 
        c.name.toLowerCase().includes(query) ||
        c.email?.toLowerCase().includes(query)
      );
    }
    
    return contacts;
  }, [allContacts, humanContacts, agentUserContacts, contactFilter, searchQuery]);

  // Filter AI agents
  const filteredAgents = useMemo(() => {
    if (!searchQuery.trim()) return agents;
    const query = searchQuery.toLowerCase();
    return agents.filter(a => 
      a.name.toLowerCase().includes(query) ||
      a.description?.toLowerCase().includes(query)
    );
  }, [agents, searchQuery]);

  // Filter conversations
  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const query = searchQuery.toLowerCase();
    return conversations.filter(c => 
      c.title.toLowerCase().includes(query) ||
      c.agentName?.toLowerCase().includes(query)
    );
  }, [conversations, searchQuery]);

  const handleContactClick = (contact: Contact) => {
    logger.debug('[ContactsList] Contact clicked', contact.name, contact.id);
    onSelectUser?.(contact.id);
  };

  const handleStartChat = (contact: Contact) => {
    logger.debug('[ContactsList] Start chat with', contact.name, contact.id);
    if (onStartChatWithUser) {
      onStartChatWithUser(contact.id);
    } else if (onSelectUser) {
      onSelectUser(contact.id);
    }
  };

  const handleTaskClick = (taskId: number) => {
    if (tasksSource) {
      onSelectTask?.(taskId, tasksSource.tableId);
    }
  };

  const tabs = [
    { key: 'contacts' as TabKey, label: 'Контакты', icon: <Users className="w-4 h-4" />, count: allContacts.length },
    { key: 'ai-chat' as TabKey, label: 'AI Чат', icon: <Zap className="w-4 h-4" />, count: agents.length },
    { key: 'tasks' as TabKey, label: 'Задачи', icon: <ListTodo className="w-4 h-4" /> },
  ];

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Chat History Section (collapsible) */}
      {conversations.length > 0 && (
        <div className="flex-shrink-0 border-b border-[var(--border-secondary)]">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="w-full flex items-center justify-between px-3 py-2 hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
              <History className="w-3.5 h-3.5" />
              <span>История чатов</span>
              <span className="px-1.5 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[10px]">
                {conversations.length}
              </span>
            </div>
            <ChevronRight className={cn(
              "w-4 h-4 text-[var(--text-tertiary)] transition-transform",
              showHistory && "rotate-90"
            )} />
          </button>
          
          {showHistory && (
            <div className="max-h-40 overflow-y-auto">
              {isLoadingConversations ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-4 h-4 animate-spin text-[var(--text-tertiary)]" />
                </div>
              ) : filteredConversations.length === 0 ? (
                <div className="px-3 py-3 text-xs text-[var(--text-tertiary)] text-center">
                  {searchQuery ? 'Не найдено' : 'Нет истории'}
                </div>
              ) : (
                filteredConversations.map(conv => (
                  <div
                    key={conv.id}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 hover:bg-[var(--bg-tertiary)] transition-colors group",
                      currentConversationId === conv.id && "bg-[var(--color-primary-500)]/10"
                    )}
                  >
                    <button
                      onClick={() => onSelectConversation?.(conv.id)}
                      className="flex-1 flex items-center gap-2 min-w-0 text-left"
                    >
                      <div className="w-7 h-7 rounded-lg bg-[var(--bg-tertiary)] flex items-center justify-center text-sm">
                        {conv.agentIcon || '💬'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-[var(--text-primary)] truncate">
                          {conv.title}
                        </div>
                        <div className="text-[10px] text-[var(--text-tertiary)]">
                          {conv.agentName} • {conv.messageCount || 0} сообщ.
                        </div>
                      </div>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onDeleteConversation?.(conv.id); }}
                      className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:text-red-400 transition-all"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex-shrink-0 flex border-b border-[var(--border-secondary)]">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 text-xs font-medium transition-colors',
              activeTab === tab.key
                ? 'text-[var(--color-primary-500)] border-b-2 border-[var(--color-primary-500)] -mb-px'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
            )}
          >
            {tab.icon}
            <span>{tab.label}</span>
            {tab.count !== undefined && (
              <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded-full bg-[var(--bg-tertiary)]">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex-shrink-0 p-2 border-b border-[var(--border-secondary)] bg-[var(--bg-secondary)]">
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                activeTab === 'contacts' ? 'Поиск контактов...' :
                activeTab === 'ai-chat' ? 'Поиск агентов...' :
                'Поиск задач...'
              }
              className="w-full pl-8 pr-8 py-1.5 text-sm rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] border-none focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/30"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          
          {/* Filter for Contacts tab */}
          {activeTab === 'contacts' && (
            <select
              value={contactFilter}
              onChange={(e) => setContactFilter(e.target.value as ContactFilter)}
              className="px-2 py-1.5 text-xs rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-primary)] border-none focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/30"
            >
              <option value="all">Все ({allContacts.length})</option>
              <option value="humans">Люди ({humanContacts.length})</option>
              <option value="agents">AI ({agentUserContacts.length})</option>
            </select>
          )}
          
          {/* Settings for Tasks tab */}
          {activeTab === 'tasks' && onConfigureTasks && (
            <button
              onClick={onConfigureTasks}
              className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              title="Настроить источник"
            >
              <Settings className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Contacts Tab */}
        {activeTab === 'contacts' && (
          isLoadingUsers ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-[var(--text-tertiary)]" />
            </div>
          ) : filteredContacts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full px-4 text-center">
              <Users className="w-10 h-10 text-[var(--text-tertiary)] mb-2" />
              <p className="text-sm text-[var(--text-tertiary)]">
                {searchQuery ? 'Ничего не найдено' : 'Нет контактов'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-secondary)]">
              {filteredContacts.map(contact => {
                const isInChat = chatParticipantIds.includes(contact.id);
                return (
                  <div
                    key={`${contact.type}-${contact.id}`}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 hover:bg-[var(--color-primary-500)]/5 transition-colors",
                      isInChat && "bg-[var(--color-primary-500)]/5"
                    )}
                  >
                    {/* Avatar with Status Dot */}
                    <button
                      onClick={() => handleContactClick(contact)}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left"
                    >
                      <div className="relative flex-shrink-0">
                        {contact.avatar ? (
                          <img
                            src={contact.avatar}
                            alt={contact.name}
                            className="w-9 h-9 rounded-full object-cover"
                          />
                        ) : (
                          <div className={cn(
                            'w-9 h-9 rounded-full flex items-center justify-center',
                            contact.type === 'agent-user'
                              ? 'bg-purple-500/20 text-purple-400'
                              : 'bg-blue-500/20 text-blue-400'
                          )}>
                            {contact.type === 'agent-user' ? (
                              <Bot className="w-4 h-4" />
                            ) : (
                              <User className="w-4 h-4" />
                            )}
                          </div>
                        )}
                        <StatusDot status={contact.status} />
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-[var(--text-primary)] truncate">
                            {contact.name}
                          </span>
                          {isInChat && (
                            <span className="flex-shrink-0 px-1 py-0.5 text-[8px] font-semibold rounded bg-green-500/20 text-green-400">
                              в чате
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <UserTypeLabel type={contact.type} />
                          {contact.email && (
                            <>
                              <span className="text-[var(--text-tertiary)]">•</span>
                              <span className="text-[10px] text-[var(--text-tertiary)] truncate">
                                {contact.email}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </button>

                    {/* Menu */}
                    <ContactMenu
                      contact={contact}
                      isInChat={isInChat}
                      onAddToChat={() => {
                        logger.debug('[ContactsList] onAddToChat callback', contact.id);
                        onAddToChat?.(contact.id);
                      }}
                      onRemoveFromChat={() => {
                        logger.debug('[ContactsList] onRemoveFromChat callback', contact.id);
                        onRemoveFromChat?.(contact.id);
                      }}
                      onStartChat={() => handleStartChat(contact)}
                    />
                  </div>
                );
              })}
            </div>
          )
        )}

        {/* AI Chat Tab */}
        {activeTab === 'ai-chat' && (
          filteredAgents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full px-4 text-center">
              <Bot className="w-10 h-10 text-[var(--text-tertiary)] mb-2" />
              <p className="text-sm text-[var(--text-tertiary)]">
                {searchQuery ? 'Агенты не найдены' : 'Нет доступных агентов'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border-secondary)]">
              {filteredAgents.map(agent => (
                <button
                  key={agent.id}
                  onClick={() => onSelectAgent(agent)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-3 transition-colors text-left',
                    currentAgentId === agent.id
                      ? 'bg-[var(--color-primary-500)]/10'
                      : 'hover:bg-[var(--color-primary-500)]/5'
                  )}
                >
                  <div className={cn(
                    'w-10 h-10 rounded-xl flex items-center justify-center text-xl',
                    currentAgentId === agent.id
                      ? 'bg-[var(--color-primary-500)]/20'
                      : 'bg-[var(--bg-tertiary)]'
                  )}>
                    {agent.icon || '🤖'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-[var(--text-primary)]">
                        {agent.name}
                      </span>
                      {currentAgentId === agent.id && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-primary-500)]/30 text-[var(--color-primary-400)]">
                          активен
                        </span>
                      )}
                    </div>
                    {agent.description && (
                      <p className="text-xs text-[var(--text-tertiary)] truncate">
                        {agent.description}
                      </p>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-[var(--text-tertiary)]" />
                </button>
              ))}
            </div>
          )
        )}

        {/* Tasks Tab */}
        {activeTab === 'tasks' && (
          tasksSource ? (
            <div className="divide-y divide-[var(--border-secondary)]">
              {/* Source header */}
              <div className="flex items-center justify-between px-3 py-2 bg-[var(--bg-tertiary)]">
                <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
                  <Table2 className="w-3.5 h-3.5" />
                  <span>{tasksSource.tableIcon || '📋'} {tasksSource.tableName}</span>
                </div>
              </div>
              
              {isLoadingTasks ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-[var(--text-tertiary)]" />
                </div>
              ) : taskRows.length === 0 ? (
                <div className="py-8 text-center text-sm text-[var(--text-tertiary)]">
                  Нет записей в таблице
                </div>
              ) : (
                taskRows.map(row => {
                  const displayCol = tasksSource.displayColumn || 'name';
                  const title = String(row.data[displayCol] || row.data['title'] || row.data['name'] || `#${row.id}`);
                  const deadline = tasksSource.deadlineColumn ? row.data[tasksSource.deadlineColumn] as string | null : null;
                  const status = tasksSource.statusColumn ? row.data[tasksSource.statusColumn] as string | null : null;
                  
                  return (
                    <button
                      key={row.id}
                      onClick={() => handleTaskClick(row.id)}
                      className="w-full flex items-center gap-3 px-3 py-3 hover:bg-[var(--color-primary-500)]/10 transition-colors text-left"
                    >
                      <div className="w-9 h-9 rounded-lg bg-[var(--color-primary-500)]/20 flex items-center justify-center text-[var(--color-primary-400)]">
                        <Hash className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-[var(--text-primary)] truncate block">
                          {title}
                        </span>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-[var(--text-tertiary)]">
                            #{row.id}
                          </span>
                          {deadline && (
                            <span className="flex items-center gap-1 text-xs text-[var(--text-tertiary)]">
                              <Calendar className="w-3 h-3" />
                              {String(deadline ?? '')}
                            </span>
                          )}
                          {status && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">
                              {String(status ?? '')}
                            </span>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[var(--text-tertiary)]" />
                    </button>
                  );
                })
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full px-4 text-center">
              <Database className="w-10 h-10 text-[var(--text-tertiary)] mb-3" />
              <p className="text-sm text-[var(--text-secondary)] mb-1">
                Источник не настроен
              </p>
              <p className="text-xs text-[var(--text-tertiary)] mb-4">
                Выберите таблицу для отображения записей
              </p>
              {onConfigureTasks && (
                <button
                  onClick={onConfigureTasks}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-primary-500)]/10 text-[var(--color-primary-500)] hover:bg-[var(--color-primary-500)]/20 transition-colors"
                >
                  <Settings className="w-4 h-4" />
                  <span className="text-sm font-medium">Настроить</span>
                </button>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}
