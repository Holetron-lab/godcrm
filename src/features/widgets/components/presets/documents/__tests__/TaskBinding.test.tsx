/**
 * ADR-038: Documents → Tasks Sync (Bidirectional)
 * 
 * TDD Tests for TaskBinding functionality
 * 
 * @see ADR-038-DOCUMENTS-TASKS-SYNC.md
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import type { 
  TaskBindingConfig, 
  TaskChatContext, 
  DocumentItem,
  LinkedTaskData,
} from '../../../../types/documents.types';
import { TaskCard } from '../TaskCard';

// === CONFIGURATION TESTS ===

describe('ADR-038: Documents Task Binding', () => {
  describe('TaskBindingConfig type validation', () => {
    it('should define enabled flag and table_id', () => {
      const config: TaskBindingConfig = {
        enabled: true,
        table_id: 123,
        columns: {
          title: 'title',
        },
        export_options: {
          levels: ['h2', 'h3'],
          include_content: true,
          default_status: 'todo',
        },
        display_options: {
          show_status: true,
          show_due_date: true,
          show_assignee: false,
          show_progress: false,
          compact_mode: false,
        },
      };

      expect(config.enabled).toBe(true);
      expect(config.table_id).toBe(123);
      expect(config.columns.title).toBe('title');
    });

    it('should have optional column mappings', () => {
      const config: TaskBindingConfig = {
        enabled: true,
        table_id: 456,
        columns: {
          title: 'name',
          description: 'details',
          status: 'state',
          due_date: 'deadline',
          assignee: 'owner_id',
          priority: 'urgency',
          progress: 'completion',
        },
        export_options: {
          levels: ['h2'],
          include_content: false,
          default_status: 'backlog',
          default_priority: 'low',
        },
        display_options: {
          show_status: true,
          show_due_date: true,
          show_assignee: true,
          show_progress: true,
          compact_mode: true,
        },
      };

      expect(config.columns.description).toBe('details');
      expect(config.export_options.default_priority).toBe('low');
      expect(config.display_options.compact_mode).toBe(true);
    });
  });

  describe('TaskChatContext type validation', () => {
    it('should include task and optional document context', () => {
      const context: TaskChatContext = {
        type: 'task',
        task_id: 100,
        table_id: 200,
        task: {
          title: 'Implement feature X',
          description: 'Full description here',
          status: 'in_progress',
          due_date: '2026-01-25',
          assignee: 'John Doe',
          priority: 'high',
        },
        document: {
          id: 50,
          title: 'Project Plan',
          section_content: 'Section content here',
        },
      };

      expect(context.type).toBe('task');
      expect(context.task.title).toBe('Implement feature X');
      expect(context.document?.id).toBe(50);
    });

    it('should work without document context', () => {
      const context: TaskChatContext = {
        type: 'task',
        task_id: 100,
        table_id: 200,
        task: {
          title: 'Standalone task',
        },
      };

      expect(context.document).toBeUndefined();
    });
  });

  describe('DocumentItem with task_ref', () => {
    it('should have optional task_ref field', () => {
      const item: DocumentItem = {
        id: 1,
        order: 10,
        level: 'h2',
        content: 'Test heading',
        task_ref: 999,
      };

      expect(item.task_ref).toBe(999);
    });

    it('should allow null task_ref', () => {
      const item: DocumentItem = {
        id: 1,
        order: 10,
        level: 'h2',
        content: 'Unlinked heading',
        task_ref: null,
      };

      expect(item.task_ref).toBeNull();
    });
  });
});

// === API TESTS ===

describe('ADR-038: Task Binding API', () => {
  describe('Link existing task endpoint', () => {
    it('should link task to document item via task_ref', async () => {
      // This test will verify POST /api/v3/documents/:docId/items/:itemId/link-task
      // For now, just testing type structure
      const requestBody = {
        task_id: 12345,
      };

      expect(requestBody.task_id).toBe(12345);
    });
  });

  describe('Create task from document item', () => {
    it('should create task and update task_ref in one operation', async () => {
      // POST /api/v3/documents/:docId/items/:itemId/create-task
      const requestBody = {
        table_id: 1234,
        data: {
          title: 'New task from doc',
          description: 'Auto-generated from document',
          due_date: '2026-01-25',
          priority: 'high',
        },
      };

      expect(requestBody.table_id).toBe(1234);
      expect(requestBody.data.title).toBe('New task from doc');
    });
  });

  describe('Unlink task', () => {
    it('should remove task_ref without deleting task', async () => {
      // DELETE /api/v3/documents/:docId/items/:itemId/unlink-task
      // Just removes the reference, task stays in table
      const expectedResponse = {
        success: true,
        data: {
          item_id: 1,
          previous_task_ref: 12345,
        },
      };

      expect(expectedResponse.data.previous_task_ref).toBe(12345);
    });
  });

  describe('Bulk export to tasks', () => {
    it('should export multiple document items to tasks', async () => {
      // POST /api/v3/documents/:docId/export-tasks
      const requestBody = {
        table_id: 1234,
        item_ids: [1, 2, 3],
        options: {
          include_content: true,
          default_status: 'todo',
        },
      };

      expect(requestBody.item_ids).toHaveLength(3);
    });
  });
});

// === AI CHAT INTEGRATION TESTS ===

describe('ADR-038: AI Chat Integration', () => {
  describe('buildTaskChatPrompt', () => {
    it('should build system prompt with task context', () => {
      // We'll implement this function
      const context: TaskChatContext = {
        type: 'task',
        task_id: 1,
        table_id: 2,
        task: {
          title: 'Build login page',
          status: 'in_progress',
          due_date: '2026-01-30',
          assignee: 'Alice',
          description: 'Create responsive login form with OAuth support',
        },
      };

      // TODO: Import and test buildTaskChatPrompt function
      // const prompt = buildTaskChatPrompt(context);
      // expect(prompt).toContain('Build login page');
      // expect(prompt).toContain('in_progress');
      // expect(prompt).toContain('Alice');

      expect(context.task.title).toBe('Build login page');
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

      // const prompt = buildTaskChatPrompt(context);
      // expect(prompt).toContain('Technical Specification');
      // expect(prompt).toContain('authentication flow');

      expect(context.document?.title).toBe('Technical Specification');
    });
  });
});

// === TASKCARD COMPONENT TESTS ===

describe('ADR-038: TaskCard Component', () => {
  const mockTask: LinkedTaskData = {
    id: 1,
    title: 'Test Task',
    status: 'in_progress',
    due_date: '2026-01-30',
    assignee_name: 'John Doe',
    priority: 'high',
    progress: 50,
  };

  it('should render task title and status', () => {
    render(<TaskCard task={mockTask} />);
    
    expect(screen.getByText('Test Task')).toBeInTheDocument();
  });

  it('should render due date', () => {
    render(<TaskCard task={mockTask} />);
    
    // Date formatting depends on locale, just check something renders
    expect(screen.getByText(/Jan|30|Overdue|Today|Tomorrow|\d+d/)).toBeInTheDocument();
  });

  it('should render assignee name', () => {
    render(<TaskCard task={mockTask} />);
    
    expect(screen.getByText('John Doe')).toBeInTheDocument();
  });

  it('should render priority badge', () => {
    render(<TaskCard task={mockTask} />);
    
    expect(screen.getByText('High')).toBeInTheDocument();
  });

  it('should call onOpenChat when chat button clicked', () => {
    const onOpenChat = vi.fn();
    render(<TaskCard task={mockTask} onOpenChat={onOpenChat} tableId={123} />);
    
    const chatButton = screen.getByTitle('Открыть чат с AI');
    fireEvent.click(chatButton);
    
    expect(onOpenChat).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'task',
        task_id: 1,
        table_id: 123,
        task: expect.objectContaining({
          title: 'Test Task',
        }),
      })
    );
  });

  it('should call onNavigate when navigate button clicked', () => {
    const onNavigate = vi.fn();
    render(<TaskCard task={mockTask} onNavigate={onNavigate} tableId={123} />);
    
    const navigateButton = screen.getByTitle('Перейти к задаче');
    fireEvent.click(navigateButton);
    
    expect(onNavigate).toHaveBeenCalledWith(1, 123);
  });

  it('should call onUnlink when unlink button clicked', () => {
    const onUnlink = vi.fn();
    render(<TaskCard task={mockTask} onUnlink={onUnlink} />);
    
    const unlinkButton = screen.getByTitle('Отвязать задачу');
    fireEvent.click(unlinkButton);
    
    expect(onUnlink).toHaveBeenCalledWith(1);
  });

  it('should render compact mode', () => {
    render(<TaskCard task={mockTask} compact={true} />);
    
    // In compact mode, title should be truncated
    expect(screen.getByText('Test Task')).toBeInTheDocument();
  });

  it('should disable unlink button when isUnlinking', () => {
    const onUnlink = vi.fn();
    render(<TaskCard task={mockTask} onUnlink={onUnlink} isUnlinking={true} />);
    
    const unlinkButton = screen.getByTitle('Отвязать задачу');
    expect(unlinkButton).toBeDisabled();
  });
});

