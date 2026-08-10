/**
 * AttachPopup — Unified Attach Popup for Chat
 *
 * Replaces separate "select from library" and "paperclip" buttons
 * with a single tabbed popup:
 *   - Files: Upload from device OR select from library (files API)
 *   - Text: Paste a text/string snippet as context
 *   - Tasks: Bind rows from a tasks/tickets table
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Paperclip,
  X,
  Upload,
  FolderOpen,
  FileText,
  Table2,
  Search,
  Loader2,
  Plus,
  Settings,
  Trash2,
  ChevronLeft
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { getFileIcon, formatFileSize } from '@/shared/utils/fileHelpers';
import { useQuery } from '@tanstack/react-query';
import { filesApi, type FileModel } from '@/features/files/api/filesApi';
import { apiClient } from '@/shared/utils/apiClient';
import { FilesSourceInlineSelector } from '@/features/ai-chat/components/FilesSourceInlineSelector';
import { spaceManagerApi } from '@/features/space-manager/api/spaceManagerApi';
import type { TreeNode } from '@/features/space-manager/types/space-manager.types';
import type {
  BoundRow,
  FilesSource,
  ProjectFile,
  Space
} from '../../types';

// ─── Types ───────────────────────────────────────────────────

type AttachTab = 'files' | 'text' | 'rows';

interface TextSnippet {
  id: string;
  content: string;
  label?: string;
}

interface AttachPopupProps {
  isOpen: boolean;
  onClose: () => void;

  // File upload
  onFileSelect: (files: File[]) => void;
  fileInputRef: React.RefObject<HTMLInputElement>;

  // Library (files from API)
  filesSource: FilesSource | undefined;
  setFilesSource: (source: FilesSource | undefined) => void;
  currentSpace: Space | null;

  // Bound rows (tasks + library files)
  boundRows: BoundRow[];
  setBoundRows: (rows: BoundRow[] | ((prev: BoundRow[]) => BoundRow[])) => void;

  // Text snippets
  textSnippets: TextSnippet[];
  onAddTextSnippet: (snippet: TextSnippet) => void;
  onRemoveTextSnippet: (id: string) => void;
}

// ─── Component ───────────────────────────────────────────────

export const AttachPopup: React.FC<AttachPopupProps> = ({
  isOpen,
  onClose,
  onFileSelect,
  fileInputRef,
  filesSource,
  setFilesSource,
  currentSpace,
  boundRows,
  setBoundRows,
  textSnippets,
  onAddTextSnippet,
  onRemoveTextSnippet,
}) => {
  const [activeTab, setActiveTab] = useState<AttachTab>('files');
  const [filesSearch, setFilesSearch] = useState('');
  const [textInput, setTextInput] = useState('');
  const [textLabel, setTextLabel] = useState('');
  const [rowsSearch, setRowsSearch] = useState('');
  const [rowsTableId, setRowsTableId] = useState<number | null>(null);
  const [rowsTableName, setRowsTableName] = useState<string>('');
  const [rowsTableIcon, setRowsTableIcon] = useState<string>('📋');
  const popupRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay to avoid closing immediately on the click that opens
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Fetch files from library — try table-specific first, then project, then space fallback
  const { data: libraryFiles = [], isLoading: isLoadingFiles } = useQuery({
    queryKey: ['attach-popup-files', filesSource?.tableId, filesSource?.projectId, currentSpace?.id],
    queryFn: async () => {
      // 1. Try table-specific query (most precise — files uploaded to specific table)
      if (filesSource?.tableId) {
        const response = await filesApi.list({ tableId: filesSource.tableId, limit: 100 });
        if (response.files?.length) return response.files;
      }
      // 2. Fallback to project (files in project folder)
      if (filesSource?.projectId) {
        const response = await filesApi.list({ projectId: filesSource.projectId, limit: 100 });
        if (response.files?.length) return response.files;
      }
      // 3. Final fallback to space (all files in space)
      if (currentSpace?.id) {
        const response = await filesApi.list({ spaceId: currentSpace.id, limit: 100 });
        return response.files || [];
      }
      return [];
    },
    enabled: isOpen && activeTab === 'files' && (!!filesSource?.tableId || !!filesSource?.projectId || !!currentSpace?.id),
  });

  // Fetch rows for selected table
  const { data: tableRows = [], isLoading: isLoadingRows } = useQuery({
    queryKey: ['attach-popup-rows', rowsTableId],
    queryFn: async () => {
      if (!rowsTableId) return [];
      const response = await apiClient.get<{ success: boolean; data: { rows: Array<{ id: number; data: Record<string, unknown> }> } }>(
        `/tables/${rowsTableId}/rows?limit=50`
      );
      return response.data?.rows || [];
    },
    enabled: isOpen && activeTab === 'rows' && !!rowsTableId,
  });

  const filteredFiles = libraryFiles.filter((file: FileModel) => {
    if (!filesSearch.trim()) return true;
    const name = (file.name || file.original_name || file.originalName || '').toLowerCase();
    return name.includes(filesSearch.toLowerCase());
  });

  const filteredRows = tableRows.filter((row: { id: number; data: Record<string, unknown> }) => {
    if (!rowsSearch.trim()) return true;
    const data = row.data || {};
    const searchStr = Object.values(data).join(' ').toLowerCase();
    return searchStr.includes(rowsSearch.toLowerCase());
  });

  const handleUploadClick = () => {
    fileInputRef.current?.click();
    onClose();
  };

  const handleLibraryFileSelect = useCallback((file: FileModel) => {
    if (filesSource?.tableId) {
      const binding: BoundRow = {
        table_id: filesSource.tableId,
        row_id: Number(file.id) || 0,
        table_name: filesSource.tableName,
        table_icon: filesSource.tableIcon || '📁',
        row_title: file.name || file.original_name || file.originalName || 'File',
      };
      setBoundRows((prev: BoundRow[]) => [...prev, binding]);
    }
    onClose();
  }, [filesSource, setBoundRows, onClose]);

  const handleAddText = useCallback(() => {
    if (!textInput.trim()) return;
    const snippet: TextSnippet = {
      id: `text_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      content: textInput.trim(),
      label: textLabel.trim() || undefined,
    };
    onAddTextSnippet(snippet);
    setTextInput('');
    setTextLabel('');
    onClose();
  }, [textInput, textLabel, onAddTextSnippet, onClose]);

  const handleRowSelect = useCallback((row: { id: number; data: Record<string, unknown> }) => {
    if (!rowsTableId) return;
    const data = row.data || {};
    const title = data.title || data.name || data.Name || data.Title || data.subject || data.Subject || `#${row.id}`;
    const binding: BoundRow = {
      table_id: rowsTableId,
      row_id: row.id,
      table_name: rowsTableName || 'Table',
      table_icon: rowsTableIcon || '📋',
      row_title: String(title),
    };
    setBoundRows((prev: BoundRow[]) => [...prev, binding]);
    onClose();
  }, [rowsTableId, rowsTableName, rowsTableIcon, setBoundRows, onClose]);

  if (!isOpen) return null;

  const tabs: { id: AttachTab; label: string; icon: React.ReactNode }[] = [
    { id: 'files', label: 'Files', icon: <FolderOpen className="w-3.5 h-3.5" /> },
    { id: 'text', label: 'Text', icon: <FileText className="w-3.5 h-3.5" /> },
    { id: 'rows', label: 'Rows', icon: <Table2 className="w-3.5 h-3.5" /> },
  ];

  return (
    <div
      ref={popupRef}
      className="absolute bottom-full left-0 right-0 mb-1 mx-2 z-50 rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-secondary)] shadow-xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-150"
    >
      {/* Tab Header */}
      <div className="flex items-center border-b border-[var(--border-secondary)] bg-[var(--bg-tertiary)]">
        <div className="flex items-center flex-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2',
                activeTab === tab.id
                  ? 'text-[var(--color-primary-500)] border-[var(--color-primary-500)]'
                  : 'text-[var(--text-tertiary)] border-transparent hover:text-[var(--text-primary)]'
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          className="p-2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Tab Content */}
      <div className="max-h-64 overflow-y-auto">
        {/* ═══════════════ FILES TAB ═══════════════ */}
        {activeTab === 'files' && (
          <div>
            {/* Upload from device button */}
            <button
              onClick={handleUploadClick}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--bg-tertiary)] border-b border-[var(--border-secondary)] transition-colors"
            >
              <div className="w-8 h-8 rounded-lg bg-[var(--color-primary-500)]/10 flex items-center justify-center">
                <Upload className="w-4 h-4 text-[var(--color-primary-500)]" />
              </div>
              <div>
                <div className="text-sm text-[var(--text-primary)] font-medium">Upload from device</div>
                <div className="text-[10px] text-[var(--text-tertiary)]">Images, PDF, text, CSV, JSON</div>
              </div>
            </button>

            {/* Library section */}
            {filesSource ? (
              <>
                <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-secondary)] bg-[var(--bg-tertiary)]">
                  <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-tertiary)] flex-shrink-0">
                    <FolderOpen className="w-3 h-3" />
                    <span>{filesSource.tableIcon || '📁'} {filesSource.tableName}</span>
                  </div>
                  <div className="flex-1 relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[var(--text-tertiary)]" />
                    <input
                      type="text"
                      value={filesSearch}
                      onChange={(e) => setFilesSearch(e.target.value)}
                      placeholder="Search files..."
                      className="w-full pl-7 pr-2 py-1 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30"
                    />
                  </div>
                  <button
                    onClick={() => setFilesSource(undefined)}
                    className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] flex-shrink-0"
                    title="Change source"
                  >
                    <Settings className="w-3 h-3" />
                  </button>
                </div>
                <div>
                  {isLoadingFiles ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="w-5 h-5 animate-spin text-[var(--text-tertiary)]" />
                    </div>
                  ) : filteredFiles.length === 0 ? (
                    <div className="py-6 text-center text-xs text-[var(--text-tertiary)]">
                      No files in project
                    </div>
                  ) : (
                    filteredFiles.map((file: FileModel) => (
                      <button
                        key={file.id}
                        onClick={() => handleLibraryFileSelect(file)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-[var(--bg-tertiary)] border-b border-[var(--border-secondary)] last:border-0 transition-colors"
                      >
                        <span className="text-lg flex-shrink-0">
                          {getFileIcon(file.mimeType || file.mime_type || '')}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-[var(--text-primary)] truncate">
                            {file.original_name || file.originalName || file.name}
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-[var(--text-tertiary)]">
                            <span>{formatFileSize(file.size)}</span>
                            <span>·</span>
                            <span>{(file.mimeType || file.mime_type || 'unknown').split('/').pop()}</span>
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </>
            ) : (
              /* No source configured — show inline selector */
              <div className="p-3">
                <div className="flex items-center gap-2 mb-2 text-xs text-[var(--text-tertiary)]">
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>Select a file library source</span>
                </div>
                <FilesSourceInlineSelector
                  defaultSpaceId={currentSpace?.id}
                  onSelect={(config) => {
                    setFilesSource(config);
                  }}
                  onCancel={onClose}
                  showHeader={false}
                />
              </div>
            )}
          </div>
        )}

        {/* ═══════════════ TEXT TAB ═══════════════ */}
        {activeTab === 'text' && (
          <div className="p-3 space-y-3">
            <div className="text-xs text-[var(--text-tertiary)]">
              Attach a text snippet as context for the AI
            </div>

            {/* Label (optional) */}
            <input
              type="text"
              value={textLabel}
              onChange={(e) => setTextLabel(e.target.value)}
              placeholder="Label (optional)"
              className="w-full px-3 py-1.5 text-xs rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30"
            />

            {/* Text content */}
            <textarea
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Paste or type text here..."
              rows={4}
              className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30 resize-none font-mono"
            />

            <div className="flex items-center justify-between">
              <span className="text-[10px] text-[var(--text-tertiary)]">
                {textInput.length > 0 ? `${textInput.length} chars` : ''}
              </span>
              <button
                onClick={handleAddText}
                disabled={!textInput.trim()}
                className="px-3 py-1.5 text-xs font-medium bg-[var(--color-primary-500)] text-white rounded-lg hover:bg-[var(--color-primary-600)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Attach text
              </button>
            </div>

            {/* Already attached snippets */}
            {textSnippets.length > 0 && (
              <div className="pt-2 border-t border-[var(--border-secondary)]">
                <div className="text-[10px] text-[var(--text-tertiary)] mb-1.5 uppercase tracking-wider">
                  Attached snippets ({textSnippets.length})
                </div>
                <div className="space-y-1">
                  {textSnippets.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-[var(--bg-tertiary)] group"
                    >
                      <FileText className="w-3 h-3 text-[var(--text-tertiary)] flex-shrink-0" />
                      <span className="flex-1 text-xs text-[var(--text-secondary)] truncate">
                        {s.label || s.content.slice(0, 50)}
                      </span>
                      <button
                        onClick={() => onRemoveTextSnippet(s.id)}
                        className="p-0.5 text-[var(--text-tertiary)] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════ ROWS TAB ═══════════════ */}
        {activeTab === 'rows' && (
          <div>
            {rowsTableId ? (
              <>
                {/* Header with table name, search, and back button */}
                <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-secondary)] bg-[var(--bg-tertiary)]">
                  <button
                    onClick={() => { setRowsTableId(null); setRowsSearch(''); }}
                    className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] flex-shrink-0"
                    title="Back to tables"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-tertiary)] flex-shrink-0">
                    <span>{rowsTableIcon}</span>
                    <span>{rowsTableName}</span>
                  </div>
                  <div className="flex-1 relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[var(--text-tertiary)]" />
                    <input
                      type="text"
                      value={rowsSearch}
                      onChange={(e) => setRowsSearch(e.target.value)}
                      placeholder="Search rows..."
                      className="w-full pl-7 pr-2 py-1 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)]/30"
                    />
                  </div>
                </div>
                <div>
                  {isLoadingRows ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="w-5 h-5 animate-spin text-[var(--text-tertiary)]" />
                    </div>
                  ) : filteredRows.length === 0 ? (
                    <div className="py-6 text-center text-xs text-[var(--text-tertiary)]">
                      No rows found
                    </div>
                  ) : (
                    filteredRows.map((row: { id: number; data: Record<string, unknown> }) => {
                      const data = row.data || {};
                      const title = data.title || data.name || data.Name || data.Title || data.subject || data.Subject || `#${row.id}`;
                      const status = data.status || data.Status || '';
                      const isAlreadyBound = boundRows.some(
                        (br) => br.table_id === rowsTableId && br.row_id === row.id
                      );
                      return (
                        <button
                          key={row.id}
                          onClick={() => !isAlreadyBound && handleRowSelect(row)}
                          disabled={isAlreadyBound}
                          className={cn(
                            'w-full flex items-center gap-3 px-3 py-2.5 text-left border-b border-[var(--border-secondary)] last:border-0 transition-colors',
                            isAlreadyBound
                              ? 'opacity-50 cursor-not-allowed bg-[var(--bg-tertiary)]'
                              : 'hover:bg-[var(--bg-tertiary)]'
                          )}
                        >
                          <span className="text-xs text-[var(--text-tertiary)] flex-shrink-0 w-6 text-right">
                            #{row.id}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-[var(--text-primary)] truncate">
                              {String(title)}
                            </div>
                            {status && (
                              <div className="text-[10px] text-[var(--text-tertiary)]">
                                {String(status)}
                              </div>
                            )}
                          </div>
                          {isAlreadyBound && (
                            <span className="text-[10px] text-green-500 flex-shrink-0">attached</span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </>
            ) : (
              /* Universal table picker — loads all tables from space */
              <UniversalTablePicker
                spaceId={currentSpace?.id}
                onSelect={(tableId, tableName, tableIcon) => {
                  setRowsTableId(tableId);
                  setRowsTableName(tableName);
                  setRowsTableIcon(tableIcon);
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Mini sub-component: Universal Table Picker ──────────────

interface UniversalTablePickerProps {
  spaceId?: number;
  onSelect: (tableId: number, tableName: string, tableIcon: string) => void;
}

/** Recursively extract all table nodes from the space tree */
function extractTables(nodes: TreeNode[]): Array<{ id: number; name: string; icon: string; projectName?: string }> {
  const tables: Array<{ id: number; name: string; icon: string; projectName?: string }> = [];

  function walk(items: TreeNode[], currentProject?: string) {
    for (const node of items) {
      if (node.type === 'table') {
        // node.id is "table:123" format
        const numericId = parseInt(String(node.id).replace('table:', ''), 10);
        if (!isNaN(numericId)) {
          tables.push({
            id: numericId,
            name: node.name,
            icon: node.icon || '📋',
            projectName: currentProject,
          });
        }
      }
      if (node.children?.length) {
        walk(node.children, node.type === 'project' ? node.name : currentProject);
      }
    }
  }

  walk(nodes);
  return tables;
}

function UniversalTablePicker({ spaceId, onSelect }: UniversalTablePickerProps) {
  const [search, setSearch] = useState('');

  const { data: spaceTables = [], isLoading } = useQuery({
    queryKey: ['attach-popup-space-tables', spaceId],
    queryFn: async () => {
      if (!spaceId) return [];
      const tree = await spaceManagerApi.getTree(spaceId);
      return extractTables(tree);
    },
    enabled: !!spaceId,
    staleTime: 60_000, // cache for 1 min
  });

  const filtered = spaceTables.filter((t) => {
    if (!search.trim()) return true;
    return t.name.toLowerCase().includes(search.toLowerCase()) ||
           (t.projectName || '').toLowerCase().includes(search.toLowerCase());
  });

  // Group by project
  const grouped = filtered.reduce<Record<string, typeof filtered>>((acc, table) => {
    const key = table.projectName || 'Other';
    if (!acc[key]) acc[key] = [];
    acc[key].push(table);
    return acc;
  }, {});

  return (
    <div>
      {/* Search */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-secondary)] bg-[var(--bg-tertiary)]">
        <Search className="w-3.5 h-3.5 text-[var(--text-tertiary)] flex-shrink-0" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tables..."
          className="flex-1 py-1 text-xs bg-transparent text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none"
          autoFocus
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-[var(--text-tertiary)]" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-6 text-center text-xs text-[var(--text-tertiary)]">
          {search ? 'No tables match your search' : 'No tables in this space'}
        </div>
      ) : (
        Object.entries(grouped).map(([projectName, tables]) => (
          <div key={projectName}>
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] bg-[var(--bg-tertiary)] border-b border-[var(--border-secondary)]">
              {projectName}
            </div>
            {tables.map((table) => (
              <button
                key={table.id}
                onClick={() => onSelect(table.id, table.name, table.icon)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-[var(--bg-tertiary)] transition-colors text-left border-b border-[var(--border-secondary)] last:border-0"
              >
                <span className="text-base flex-shrink-0">{table.icon}</span>
                <span className="flex-1 text-[var(--text-primary)] truncate">{table.name}</span>
                <span className="text-[10px] text-[var(--text-tertiary)] flex-shrink-0">#{table.id}</span>
              </button>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

export type { TextSnippet };
