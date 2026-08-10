/**
 * AccordionChatItem - TASK-043
 * 
 * Chat item with expandable accordion showing participants.
 * - Click on chat → opens the chat
 * - Click on expand → shows all participants
 */

import { useState } from 'react';
import {
  ChevronDown,
  Users,
  Trash2,
  Link2
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { Avatar } from '@/shared/components/ui/Avatar';

// Types
interface ChatParticipant {
  user_id: number;
  name: string;
  email?: string;
  avatar_url?: string;
  role?: string;
  user_type?: string;
}

interface ChatConversation {
  id: number;
  title: string;
  type: string;
  agentIcon?: string;
  agentName?: string;
  messagesCount: number;
  updatedAt: string;
  participants?: ChatParticipant[];
  space_id?: number;
  spaceName?: string;
  /** Bound row label, e.g. "Tickets #123" */
  boundRowLabel?: string;
}

interface AccordionChatItemProps {
  conversation: ChatConversation;
  isActive: boolean;
  onSelect: (id: number) => void;
  onDelete: (id: number) => void;
}

export function AccordionChatItem({
  conversation,
  isActive,
  onSelect,
  onDelete,
}: AccordionChatItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const participants = conversation.participants || [];
  const participantCount = participants.length;

  const handleExpandClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
      return 'Вчера';
    } else if (diffDays < 7) {
      return date.toLocaleDateString('ru-RU', { weekday: 'short' });
    } else {
      return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
    }
  };

  return (
    <div className="border-b border-[var(--border-secondary)] last:border-b-0">
      {/* Main row */}
      <div
        className={cn(
          "flex items-center gap-3 px-3 py-2.5 hover:bg-[var(--bg-tertiary)] transition-colors group",
          isActive && "bg-[var(--color-primary-500)]/10"
        )}
      >
        {/* Click area for selecting chat */}
        <button
          onClick={() => onSelect(conversation.id)}
          className="flex-1 flex items-center gap-3 min-w-0 text-left"
        >
          {/* Icon */}
          <div className="w-8 h-8 rounded-lg bg-[var(--bg-tertiary)] flex items-center justify-center text-sm flex-shrink-0">
            {conversation.agentIcon || '💬'}
          </div>
          
          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-[var(--text-primary)] truncate">
              {conversation.title}
            </div>
            <div className="flex items-center gap-2 text-[10px] text-[var(--text-tertiary)] flex-wrap">
              {conversation.agentName && (
                <span>{conversation.agentName}</span>
              )}
              {conversation.boundRowLabel && (
                <>
                  <span>•</span>
                  <span className="inline-flex items-center gap-0.5 text-[var(--color-primary-400)]">
                    <Link2 className="w-2.5 h-2.5" />
                    <span className="truncate max-w-[120px]">{conversation.boundRowLabel}</span>
                  </span>
                </>
              )}
              {conversation.spaceName && (
                <>
                  <span>•</span>
                  <span className="truncate">{conversation.spaceName}</span>
                </>
              )}
              <span>•</span>
              <span>{conversation.messagesCount} сообщ.</span>
            </div>
          </div>
        </button>

        {/* Date */}
        <span className="text-[10px] text-[var(--text-tertiary)] tabular-nums flex-shrink-0">
          {formatDate(conversation.updatedAt)}
        </span>

        {/* Expand button - shows participant count */}
        {participantCount > 0 && (
          <button
            onClick={handleExpandClick}
            className={cn(
              "flex items-center gap-1 px-1.5 py-1 rounded text-xs transition-colors",
              isExpanded 
                ? "bg-[var(--color-primary-500)]/20 text-[var(--color-primary-500)]"
                : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
            )}
            title={isExpanded ? 'Свернуть' : 'Показать участников'}
          >
            <Users className="w-3.5 h-3.5" />
            <span>{participantCount}</span>
            <ChevronDown className={cn(
              "w-3 h-3 transition-transform",
              isExpanded && "rotate-180"
            )} />
          </button>
        )}

        {/* Delete button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(conversation.id);
          }}
          className="p-1 rounded opacity-0 group-hover:opacity-100 text-[var(--text-tertiary)] hover:text-red-400 hover:bg-red-500/10 transition-all"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Accordion content - participants */}
      {isExpanded && participantCount > 0 && (
        <div className="bg-[var(--bg-tertiary)] border-t border-[var(--border-secondary)]">
          <div className="px-4 py-1.5 text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide">
            Участники ({participantCount})
          </div>
          {participants.map(participant => {
            const isAgent = participant.user_type === 'agent';
            return (
              <div
                key={participant.user_id}
                className="flex items-center gap-2 px-4 py-2 pl-8"
              >
                <Avatar
                  url={participant.avatar_url}
                  name={participant.name}
                  size={24}
                  color={isAgent ? '#a855f7' : '#3b82f6'}
                />
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-[var(--text-secondary)] truncate block">
                    {participant.name}
                  </span>
                </div>
                {participant.role && participant.role !== 'member' && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] text-[var(--text-tertiary)]">
                    {participant.role === 'admin' ? 'Админ' : participant.role}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default AccordionChatItem;
