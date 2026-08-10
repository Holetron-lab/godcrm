/**
 * buildTaskChatPrompt Tests - ADR-038
 * 
 * @see ADR-038-DOCUMENTS-TASKS-SYNC.md
 */
import { describe, it, expect } from 'vitest';
import { 
  buildTaskChatPrompt, 
  buildTaskChatSummary,
  buildTaskChatTools,
  TASK_CHAT_ACTIONS,
} from '../buildTaskChatPrompt';
import type { TaskChatContext } from '../../types/documents.types';

describe('buildTaskChatPrompt', () => {
  it('should include task title and status', () => {
    const context: TaskChatContext = {
      type: 'task',
      task_id: 1,
      table_id: 2,
      task: {
        title: 'Build login page',
        status: 'in_progress',
      },
    };

    const prompt = buildTaskChatPrompt(context);
    
    expect(prompt).toContain('Build login page');
    expect(prompt).toContain('in_progress');
  });

  it('should include assignee and priority', () => {
    const context: TaskChatContext = {
      type: 'task',
      task_id: 1,
      table_id: 2,
      task: {
        title: 'Test Task',
        assignee: 'Alice',
        priority: 'high',
      },
    };

    const prompt = buildTaskChatPrompt(context);
    
    expect(prompt).toContain('Alice');
    expect(prompt).toContain('high');
  });

  it('should include due date', () => {
    const context: TaskChatContext = {
      type: 'task',
      task_id: 1,
      table_id: 2,
      task: {
        title: 'Test Task',
        due_date: '2026-01-30',
      },
    };

    const prompt = buildTaskChatPrompt(context);
    
    expect(prompt).toContain('2026-01-30');
  });

  it('should include description if provided', () => {
    const context: TaskChatContext = {
      type: 'task',
      task_id: 1,
      table_id: 2,
      task: {
        title: 'Test Task',
        description: 'Create responsive login form with OAuth support',
      },
    };

    const prompt = buildTaskChatPrompt(context);
    
    expect(prompt).toContain('Create responsive login form with OAuth support');
  });

  it('should include document context when available', () => {
    const context: TaskChatContext = {
      type: 'task',
      task_id: 1,
      table_id: 2,
      task: {
        title: 'Task from doc',
      },
      document: {
        id: 100,
        title: 'Technical Specification',
        section_content: 'This section describes the authentication flow...',
      },
    };

    const prompt = buildTaskChatPrompt(context);
    
    expect(prompt).toContain('Technical Specification');
    expect(prompt).toContain('authentication flow');
  });

  it('should include suggested actions', () => {
    const context: TaskChatContext = {
      type: 'task',
      task_id: 1,
      table_id: 2,
      task: {
        title: 'Test',
      },
    };

    const prompt = buildTaskChatPrompt(context);
    
    expect(prompt).toContain('Разбить на подзадачи');
    expect(prompt).toContain('Предложить решение');
    expect(prompt).toContain('Написать код');
  });

  it('should handle missing optional fields gracefully', () => {
    const context: TaskChatContext = {
      type: 'task',
      task_id: 1,
      table_id: 2,
      task: {
        title: 'Minimal Task',
      },
    };

    const prompt = buildTaskChatPrompt(context);
    
    expect(prompt).toContain('Minimal Task');
    expect(prompt).toContain('Не указан');
    expect(prompt).toContain('Не назначен');
  });
});

describe('buildTaskChatSummary', () => {
  it('should return title only for minimal task', () => {
    const context: TaskChatContext = {
      type: 'task',
      task_id: 1,
      table_id: 2,
      task: {
        title: 'Simple Task',
      },
    };

    const summary = buildTaskChatSummary(context);
    
    expect(summary).toBe('Simple Task');
  });

  it('should include status in brackets', () => {
    const context: TaskChatContext = {
      type: 'task',
      task_id: 1,
      table_id: 2,
      task: {
        title: 'Task',
        status: 'done',
      },
    };

    const summary = buildTaskChatSummary(context);
    
    expect(summary).toBe('Task [done]');
  });

  it('should include assignee with arrow', () => {
    const context: TaskChatContext = {
      type: 'task',
      task_id: 1,
      table_id: 2,
      task: {
        title: 'Task',
        status: 'in_progress',
        assignee: 'Bob',
      },
    };

    const summary = buildTaskChatSummary(context);
    
    expect(summary).toBe('Task [in_progress] → Bob');
  });
});

describe('TASK_CHAT_ACTIONS', () => {
  it('should define common task actions', () => {
    const actionNames = TASK_CHAT_ACTIONS.map(a => a.name);
    
    expect(actionNames).toContain('create_subtask');
    expect(actionNames).toContain('update_task_status');
    expect(actionNames).toContain('add_comment');
    expect(actionNames).toContain('estimate_time');
    expect(actionNames).toContain('set_priority');
    expect(actionNames).toContain('set_due_date');
  });
});

describe('buildTaskChatTools', () => {
  it('should return array of function definitions', () => {
    const tools = buildTaskChatTools();
    
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
  });

  it('should have correct tool structure', () => {
    const tools = buildTaskChatTools();
    const createSubtask = tools.find(t => t.function.name === 'create_subtask');
    
    expect(createSubtask).toBeDefined();
    expect(createSubtask?.type).toBe('function');
    expect(createSubtask?.function.description).toBe('Создать подзадачу');
    expect(createSubtask?.function.parameters.type).toBe('object');
  });
});
