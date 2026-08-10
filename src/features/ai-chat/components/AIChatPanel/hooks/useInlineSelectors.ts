/**
 * useInlineSelectors Hook
 * Handles TasksSource and FilesSource inline selector logic
 */

import { useState, useCallback } from 'react';
import { TasksSourceConfig, FilesSourceConfig } from '../types';

export function useInlineSelectors() {
  const [tasksSource, setTasksSource] = useState<TasksSourceConfig | undefined>();
  const [filesSource, setFilesSource] = useState<FilesSourceConfig | undefined>();
  const [showTasksSelector, setShowTasksSelector] = useState(false);
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [taskProjectId, setTaskProjectId] = useState<number | null>(null);

  // Auto-mapping functionality for tasks table
  const autoMapTasksTable = useCallback((tables: Array<{ id: number; name: string; icon?: string }>) => {
    // Look for tables that might contain tasks
    const taskTable = tables.find(table => 
      table.name.toLowerCase().includes('task') ||
      table.name.toLowerCase().includes('todo') ||
      table.name.toLowerCase().includes('issue')
    );
    
    if (taskTable) {
      setTasksSource({
        tableId: taskTable.id,
        tableName: taskTable.name,
        tableIcon: taskTable.icon || 'list',
        displayColumn: 'title' // Default display column
      });
    }
  }, []);

  // Auto-mapping functionality for files table
  const autoMapFilesTable = useCallback((tables: Array<{ id: number; name: string; icon?: string; project_id?: number }>) => {
    // Look for tables that might contain files
    const filesTable = tables.find(table => 
      table.name.toLowerCase().includes('file') ||
      table.name.toLowerCase().includes('document') ||
      table.name.toLowerCase().includes('attachment')
    );
    
    if (filesTable) {
      setFilesSource({
        tableId: filesTable.id,
        tableName: filesTable.name,
        tableIcon: filesTable.icon || 'file',
        projectId: filesTable.project_id
      });
    }
  }, []);

  return {
    tasksSource,
    filesSource,
    showTasksSelector,
    showFilePicker,
    taskProjectId,
    setTasksSource,
    setFilesSource,
    setShowTasksSelector,
    setShowFilePicker,
    setTaskProjectId,
    autoMapTasksTable,
    autoMapFilesTable
  };
}