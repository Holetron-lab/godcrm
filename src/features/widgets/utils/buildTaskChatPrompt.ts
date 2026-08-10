/**
 * Task Chat Prompt Builder - ADR-038
 * 
 * Builds system prompts for AI chat with task context
 * 
 * @see ADR-038-DOCUMENTS-TASKS-SYNC.md
 */

import type { TaskChatContext } from '../types/documents.types';

/**
 * Build a system prompt for AI chat with task context
 * 
 * @param ctx - Task chat context including task data and optional document context
 * @returns Formatted system prompt string
 */
export function buildTaskChatPrompt(ctx: TaskChatContext): string {
  const lines: string[] = [
    'Ты помогаешь с задачей в проекте.',
    '',
    '## Контекст задачи',
    '',
    `**Название:** ${ctx.task.title}`,
    `**Статус:** ${ctx.task.status || 'Не указан'}`,
    `**Дедлайн:** ${ctx.task.due_date || 'Не указан'}`,
    `**Ответственный:** ${ctx.task.assignee || 'Не назначен'}`,
    `**Приоритет:** ${ctx.task.priority || 'Обычный'}`,
  ];

  if (ctx.task.description) {
    lines.push('');
    lines.push('**Описание:**');
    lines.push(ctx.task.description);
  }

  if (ctx.document) {
    lines.push('');
    lines.push(`## Контекст из документа "${ctx.document.title}"`);
    lines.push('');
    if (ctx.document.section_content) {
      lines.push(ctx.document.section_content);
    }
  }

  lines.push('');
  lines.push('Помоги пользователю с этой задачей. Можешь:');
  lines.push('- Разбить на подзадачи');
  lines.push('- Предложить решение');
  lines.push('- Написать код');
  lines.push('- Оценить сроки');
  lines.push('- Выявить риски');

  return lines.join('\n');
}

/**
 * Build a short context summary for display in chat header
 */
export function buildTaskChatSummary(ctx: TaskChatContext): string {
  const parts: string[] = [ctx.task.title];
  
  if (ctx.task.status) {
    parts.push(`[${ctx.task.status}]`);
  }
  
  if (ctx.task.assignee) {
    parts.push(`→ ${ctx.task.assignee}`);
  }
  
  return parts.join(' ');
}

/**
 * Available actions that AI can suggest for tasks
 */
export interface TaskChatAction {
  name: string;
  description: string;
  params: Record<string, string>;
}

export const TASK_CHAT_ACTIONS: TaskChatAction[] = [
  {
    name: 'create_subtask',
    description: 'Создать подзадачу',
    params: { title: 'string', description: 'string?' },
  },
  {
    name: 'update_task_status',
    description: 'Изменить статус задачи',
    params: { new_status: 'todo|in_progress|done|blocked' },
  },
  {
    name: 'add_comment',
    description: 'Добавить комментарий к задаче',
    params: { comment: 'string' },
  },
  {
    name: 'estimate_time',
    description: 'Оценить время выполнения',
    params: { hours: 'number' },
  },
  {
    name: 'set_priority',
    description: 'Установить приоритет',
    params: { priority: 'low|medium|high|urgent' },
  },
  {
    name: 'set_due_date',
    description: 'Установить дедлайн',
    params: { due_date: 'date' },
  },
];

/**
 * Build tools/functions schema for AI to use
 */
export function buildTaskChatTools(): Array<{
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description: string }>;
      required: string[];
    };
  };
}> {
  return TASK_CHAT_ACTIONS.map(action => ({
    type: 'function' as const,
    function: {
      name: action.name,
      description: action.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(action.params).map(([key, type]) => [
            key,
            {
              type: type.includes('|') ? 'string' : type.replace('?', ''),
              description: key,
            },
          ])
        ),
        required: Object.entries(action.params)
          .filter(([, type]) => !type.includes('?'))
          .map(([key]) => key),
      },
    },
  }));
}
