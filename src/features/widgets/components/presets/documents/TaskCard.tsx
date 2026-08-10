/**
 * TaskCard Component - ADR-038
 * 
 * Displays linked task information inside document items
 * with action buttons: Chat (💬), Navigate (🔗), Unlink (×)
 * 
 * @see ADR-038-DOCUMENTS-TASKS-SYNC.md
 */

import { useState, useCallback } from 'react';
import { 
  MessageSquare, 
  ExternalLink, 
  X, 
  Calendar, 
  User, 
  Flag,
  Loader2,
  CheckCircle2,
  Circle,
  Clock,
  AlertCircle
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { logger } from '@/shared/utils/logger';
import type { LinkedTaskData, TaskChatContext } from '../../../types/documents.types';

// === STATUS CONFIG ===

const STATUS_CONFIG: Record<string, { 
  icon: typeof Circle; 
  color: string; 
  label: string 
}> = {
  todo: { icon: Circle, color: 'text-gray-400', label: 'To Do' },
  in_progress: { icon: Clock, color: 'text-blue-500', label: 'In Progress' },
  done: { icon: CheckCircle2, color: 'text-green-500', label: 'Done' },
  blocked: { icon: AlertCircle, color: 'text-red-500', label: 'Blocked' },
  // Default fallback
  default: { icon: Circle, color: 'text-gray-400', label: 'Unknown' },
};

const PRIORITY_CONFIG: Record<string, { color: string; label: string }> = {
  low: { color: 'text-gray-400', label: 'Low' },
  medium: { color: 'text-yellow-500', label: 'Medium' },
  high: { color: 'text-orange-500', label: 'High' },
  urgent: { color: 'text-red-500', label: 'Urgent' },
  default: { color: 'text-gray-400', label: '' },
};

// === TYPES ===

export interface TaskCardProps {
  task: LinkedTaskData;
  documentItem?: {
    id: number;
    content: string;
  };
  compact?: boolean;
  onOpenChat?: (context: TaskChatContext) => void;
  onNavigate?: (taskId: number, tableId?: number) => void;
  onUnlink?: (taskId: number) => void;
  isUnlinking?: boolean;
  tableId?: number;
}

// === COMPONENT ===

export function TaskCard({
  task,
  documentItem,
  compact = false,
  onOpenChat,
  onNavigate,
  onUnlink,
  isUnlinking = false,
  tableId,
}: TaskCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  // Get status config
  const statusKey = task.status?.toLowerCase().replace(/\s+/g, '_') || 'default';
  const statusConfig = STATUS_CONFIG[statusKey] || STATUS_CONFIG.default;
  const StatusIcon = statusConfig.icon;

  // Get priority config
  const priorityKey = task.priority?.toLowerCase() || 'default';
  const priorityConfig = PRIORITY_CONFIG[priorityKey] || PRIORITY_CONFIG.default;

  // Format due date
  const formatDueDate = (dateStr?: string) => {
    if (!dateStr) return null;
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diffDays = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      
      if (diffDays < 0) return { text: 'Overdue', color: 'text-red-500' };
      if (diffDays === 0) return { text: 'Today', color: 'text-orange-500' };
      if (diffDays === 1) return { text: 'Tomorrow', color: 'text-yellow-500' };
      if (diffDays <= 7) return { text: `${diffDays}d`, color: 'text-blue-500' };
      
      return { 
        text: date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }), 
        color: 'text-[var(--text-secondary)]' 
      };
    } catch {
      return null;
    }
  };

  const dueInfo = formatDueDate(task.due_date);

  // Handle chat click
  const handleChatClick = useCallback(() => {
    if (!onOpenChat) return;
    
    logger.debug({ taskId: task.id }, '[TaskCard] Opening chat');
    
    const context: TaskChatContext = {
      type: 'task',
      task_id: task.id,
      table_id: tableId || 0,
      task: {
        title: task.title,
        description: undefined, // Could be passed if available
        status: task.status,
        due_date: task.due_date,
        assignee: task.assignee_name,
        priority: task.priority,
      },
      document: documentItem ? {
        id: documentItem.id,
        title: documentItem.content,
      } : undefined,
    };
    
    onOpenChat(context);
  }, [onOpenChat, task, tableId, documentItem]);

  // Handle navigate click
  const handleNavigateClick = useCallback(() => {
    if (!onNavigate) return;
    logger.debug({ taskId: task.id }, '[TaskCard] Navigating to task');
    onNavigate(task.id, tableId);
  }, [onNavigate, task.id, tableId]);

  // Handle unlink click
  const handleUnlinkClick = useCallback(() => {
    if (!onUnlink || isUnlinking) return;
    logger.debug({ taskId: task.id }, '[TaskCard] Unlinking task');
    onUnlink(task.id);
  }, [onUnlink, task.id, isUnlinking]);

  // === COMPACT MODE ===
  if (compact) {
    return (
      <span 
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[var(--bg-tertiary)] text-xs"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <StatusIcon className={cn('w-3 h-3', statusConfig.color)} />
        <span className="text-[var(--text-secondary)] truncate max-w-[120px]">
          {task.title}
        </span>
        {dueInfo && (
          <span className={cn('text-[10px]', dueInfo.color)}>
            📅{dueInfo.text}
          </span>
        )}
        {task.assignee_name && (
          <span className="text-[10px] text-[var(--text-tertiary)]">
            👤{task.assignee_name.split(' ')[0]}
          </span>
        )}
        {isHovered && (
          <span className="flex items-center gap-0.5 ml-1">
            {onOpenChat && (
              <button
                onClick={handleChatClick}
                className="p-0.5 hover:bg-[var(--bg-hover)] rounded"
                title="Открыть чат с AI"
              >
                <MessageSquare className="w-3 h-3" />
              </button>
            )}
            {onNavigate && (
              <button
                onClick={handleNavigateClick}
                className="p-0.5 hover:bg-[var(--bg-hover)] rounded"
                title="Перейти к задаче"
              >
                <ExternalLink className="w-3 h-3" />
              </button>
            )}
          </span>
        )}
      </span>
    );
  }

  // === FULL MODE ===
  return (
    <div 
      className={cn(
        'mt-2 p-3 rounded-lg border',
        'bg-[var(--bg-secondary)] border-[var(--border-primary)]',
        'transition-all duration-150'
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Header Row */}
      <div className="flex items-center justify-between gap-2">
        {/* Left: Status + Title */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <StatusIcon className={cn('w-4 h-4 flex-shrink-0', statusConfig.color)} />
          <span 
            className="text-sm font-medium text-[var(--text-primary)] truncate"
            title={task.title}
          >
            {task.title}
          </span>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {onOpenChat && (
            <button
              onClick={handleChatClick}
              className={cn(
                'p-1.5 rounded-md transition-colors',
                'hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)]',
                'hover:text-[var(--text-primary)]'
              )}
              title="Открыть чат с AI"
            >
              <MessageSquare className="w-4 h-4" />
            </button>
          )}
          {onNavigate && (
            <button
              onClick={handleNavigateClick}
              className={cn(
                'p-1.5 rounded-md transition-colors',
                'hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)]',
                'hover:text-[var(--text-primary)]'
              )}
              title="Перейти к задаче"
            >
              <ExternalLink className="w-4 h-4" />
            </button>
          )}
          {onUnlink && (
            <button
              onClick={handleUnlinkClick}
              disabled={isUnlinking}
              className={cn(
                'p-1.5 rounded-md transition-colors',
                'hover:bg-red-500/10 text-[var(--text-tertiary)]',
                'hover:text-red-500',
                isUnlinking && 'opacity-50 cursor-not-allowed'
              )}
              title="Отвязать задачу"
            >
              {isUnlinking ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <X className="w-4 h-4" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Meta Row */}
      <div className="flex items-center gap-3 mt-2 text-xs text-[var(--text-secondary)]">
        {/* Due Date */}
        {dueInfo && (
          <div className={cn('flex items-center gap-1', dueInfo.color)}>
            <Calendar className="w-3 h-3" />
            <span>{dueInfo.text}</span>
          </div>
        )}

        {/* Assignee */}
        {task.assignee_name && (
          <div className="flex items-center gap-1">
            <User className="w-3 h-3" />
            <span>{task.assignee_name}</span>
          </div>
        )}

        {/* Priority */}
        {priorityConfig.label && (
          <div className={cn('flex items-center gap-1', priorityConfig.color)}>
            <Flag className="w-3 h-3" />
            <span>{priorityConfig.label}</span>
          </div>
        )}

        {/* Progress */}
        {typeof task.progress === 'number' && task.progress > 0 && (
          <div className="flex items-center gap-1">
            <div className="w-16 h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-500 rounded-full transition-all"
                style={{ width: `${Math.min(100, task.progress)}%` }}
              />
            </div>
            <span>{task.progress}%</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default TaskCard;
