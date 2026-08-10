import React, { useState, useMemo } from 'react';
import { Loader2, X } from 'lucide-react';
import { useAllTables } from '@/features/tables/hooks/useAllTables';

interface FilesSourceConfig {
  tableId: number;
  tableName: string;
  tableIcon?: string;
  projectId: number;
}

interface FilesSourceInlineSelectorProps {
  defaultSpaceId?: number;
  onSelect: (config: FilesSourceConfig) => void;
  onCancel: () => void;
  showHeader?: boolean;
}

export function FilesSourceInlineSelector({ 
  defaultSpaceId, 
  onSelect, 
  onCancel, 
  showHeader = true 
}: FilesSourceInlineSelectorProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<number | null>(null);
  
  const { data: allTablesData, isLoading } = useAllTables();
  
  // Filter spaces
  const filteredSpaces = useMemo(() => {
    if (!allTablesData?.spacesWithTables) return [];
    if (!defaultSpaceId) return allTablesData.spacesWithTables;
    return allTablesData.spacesWithTables.filter(s => s.id === defaultSpaceId);
  }, [allTablesData, defaultSpaceId]);
  
  // Get tables for selected project (filter for Files-like tables)
  const projectTables = useMemo(() => {
    if (!selectedProjectId || !allTablesData?.spacesWithTables) return [];
    for (const space of allTablesData.spacesWithTables) {
      const project = space.projects.find(p => p.id === selectedProjectId);
      if (project) return project.tables || [];
    }
    return [];
  }, [selectedProjectId, allTablesData]);
  
  // Get selected table info
  const selectedTable = useMemo(() => {
    if (!selectedTableId) return null;
    return allTablesData?.flat?.find(t => t.id === String(selectedTableId));
  }, [selectedTableId, allTablesData]);
  
  const handleSave = () => {
    if (!selectedTable || !selectedProjectId) return;
    onSelect({
      tableId: Number(selectedTable.id),
      tableName: selectedTable.displayName || selectedTable.name,
      tableIcon: selectedTable.icon || '📁',
      projectId: selectedProjectId
    });
  };
  
  if (isLoading) {
    return (
      <div className="p-3 rounded-lg bg-[var(--bg-tertiary)] flex items-center justify-center">
        <Loader2 className="w-4 h-4 animate-spin text-[var(--text-tertiary)]" />
      </div>
    );
  }
  
  return (
    <div className="p-3 rounded-lg bg-[var(--bg-tertiary)] space-y-3">
      {/* Header with close button */}
      {showHeader && (
        <div className="flex items-center justify-between">
          <label className="text-xs text-[var(--text-tertiary)]">Проект</label>
          <button
            onClick={onCancel}
            className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      
      {/* Project selector with label if no header */}
      {!showHeader && <label className="block text-xs text-[var(--text-tertiary)]">Проект</label>}
      {/* Project selector */}
      <select
        value={selectedProjectId || ''}
        onChange={(e) => {
          setSelectedProjectId(e.target.value ? Number(e.target.value) : null);
          setSelectedTableId(null);
        }}
        className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--bg-secondary)] text-[var(--text-primary)] border border-[var(--border-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/30"
      >
        <option value="">— Выберите проект —</option>
        {filteredSpaces.map(space => (
          <optgroup key={space.id} label={`${space.icon || '📁'} ${space.name}`}>
            {space.projects.map(project => (
              <option key={project.id} value={project.id}>
                {project.icon || '📂'} {project.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      
      {/* Table selector */}
      <div>
        <label className="block text-xs text-[var(--text-tertiary)] mb-1">Таблица файлов</label>
        <select
          value={selectedTableId || ''}
          onChange={(e) => setSelectedTableId(e.target.value ? Number(e.target.value) : null)}
          disabled={!selectedProjectId}
          className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--bg-secondary)] text-[var(--text-primary)] border border-[var(--border-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/30 disabled:opacity-50"
        >
          <option value="">— Выберите таблицу —</option>
          {projectTables.map(table => (
            <option key={table.id} value={table.id}>
              {table.icon || '📋'} {table.displayName || table.name}
            </option>
          ))}
        </select>
      </div>
      
      {/* Save button only */}
      <div className="flex justify-end pt-1">
        <button
          onClick={handleSave}
          disabled={!selectedTableId}
          className="px-3 py-1.5 text-xs bg-[var(--color-primary-500)] text-white rounded-lg hover:bg-[var(--color-primary-600)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Сохранить
        </button>
      </div>
    </div>
  );
}