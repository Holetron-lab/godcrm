/**
 * MoveTablesModal - реюзнутый вариант из Space Manager (MoveItemsModal)
 * Показывает дерево Space -> Project -> Folder, позволяет выбрать цель и выполнить batch move.
 */

import { logger } from '@/shared/utils/logger';
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/shared/components/ui/Modal';
import { Button } from '@/shared/components/ui/Button';
import { 
  Folder, 
  ChevronRight, 
  ChevronDown, 
  Loader2, 
  AlertCircle,
  Database,
  Globe,
  CheckSquare,
  Square
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { apiClient } from '@/shared/utils/apiClient';

interface Space {
  id: number;
  name: string;
  icon: string;
}

interface TreeNode {
  id: string;
  name: string;
  icon?: string;
  type: 'project' | 'folder' | 'table' | 'widget';
  children: TreeNode[];
}

interface MoveTablesModalProps {
  open: boolean;
  onClose: () => void;
  tableIds: number[];
  currentSpaceId: number;
  onSuccess: () => void;
}

export const MoveTablesModal = ({
  open,
  onClose,
  tableIds,
  currentSpaceId,
  onSuccess
}: MoveTablesModalProps) => {
  const { t } = useLanguage();
  const tSafe = (key: string, fallback: string) => {
    const value = t(key);
    return value === key ? fallback : value;
  };

  const [spaces, setSpaces] = useState<Space[]>([]);
  const [spaceTrees, setSpaceTrees] = useState<Record<number, TreeNode[]>>({});
  const [loadingSpaces, setLoadingSpaces] = useState(false);
  const [loadingTree, setLoadingTree] = useState(false);
  const [isMoving, setIsMoving] = useState(false);

  const [expandedSpaces, setExpandedSpaces] = useState<Set<number>>(new Set([currentSpaceId]));
  const [expandedProjects, setExpandedProjects] = useState<Set<number>>(new Set());

  const [selectedSpaceId, setSelectedSpaceId] = useState<number | null>(currentSpaceId);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);

  // Load spaces on open
  useEffect(() => {
    if (open) {
      loadSpaces().finally(() => {
        loadTreeForSpace(currentSpaceId);
      });
      // ensure current space expanded
      setExpandedSpaces(new Set([currentSpaceId]));
      setSelectedSpaceId(currentSpaceId);
      setSelectedProjectId(null);
      setSelectedFolderId(null);
    }
  }, [open, currentSpaceId]);

  const loadSpaces = async () => {
    setLoadingSpaces(true);
    try {
      const response = await apiClient.request<{ data: Space[] }>('/spaces');
      const data = response.data || (response as { data: Space[] }).data;
      if (Array.isArray(data)) {
        setSpaces(data as Space[]);
      }
    } catch (error) {
      logger.error('Failed to load spaces:', error);
      toast.error(t('common.loadError') || 'Failed to load spaces');
    } finally {
      setLoadingSpaces(false);
    }
  };

  // Auto-load tree for the selected space when modal is open
  useEffect(() => {
    if (open && selectedSpaceId && !spaceTrees[selectedSpaceId]?.length) {
      loadTreeForSpace(selectedSpaceId);
    }
  }, [open, selectedSpaceId, spaceTrees]);

  const loadTreeForSpace = async (spaceId: number) => {
    // Prevent double loads
    if (spaceTrees[spaceId]?.length) return;
    setLoadingTree(true);
    try {
      const response = await apiClient.request<{ data: TreeNode[] }>(`/spaces/${spaceId}/tree`);
      const tree = response.data || (response as any).data || [];
      setSpaceTrees((prev) => ({ ...prev, [spaceId]: tree }));
    } catch (error) {
      logger.error('Failed to load tree:', error);
      toast.error(t('common.loadError') || 'Failed to load tree');
    } finally {
      setLoadingTree(false);
    }
  };

  const toggleSpaceExpand = (spaceId: number) => {
    setExpandedSpaces((prev) => {
      const next = new Set(prev);
      if (next.has(spaceId)) {
        next.delete(spaceId);
      } else {
        next.add(spaceId);
        loadTreeForSpace(spaceId);
      }
      return next;
    });
  };

  const toggleProjectExpand = (projectId: number) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

  const getProjects = (spaceId: number): TreeNode[] => {
    return (spaceTrees[spaceId] || []).filter((n) => n.type === 'project');
  };

  const renderFolders = (
    nodes: TreeNode[],
    projectId: number,
    depth: number,
    spaceId: number
  ): JSX.Element[] => {
    return nodes
      .filter((n) => n.type === 'folder')
      .flatMap((folder) => {
        const isVirtual = folder.id.startsWith('virtual:');
        const [, rawId] = folder.id.split(':');
        const folderId = Number.parseInt(rawId ?? '', 10);
        const isSelectable = !isVirtual && !Number.isNaN(folderId);
        const isSelected = selectedProjectId === projectId && selectedFolderId === folderId;
        const hasSub = folder.children?.some((c) => c.type === 'folder');
        return [
          <div
            key={`folder-${folder.id}`}
            onClick={() => {
              if (!isSelectable) return;
              setSelectedSpaceId(spaceId);
              setSelectedProjectId(projectId);
              setSelectedFolderId(folderId);
            }}
            style={{ paddingLeft: `${depth * 16 + 12}px` }}
            className={`
              flex items-center gap-2 py-2 pr-3 cursor-pointer
              ${isSelected ? 'bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]' : 'hover:bg-[var(--bg-secondary)]'}
              ${!isSelectable ? 'opacity-60 cursor-default' : ''}
            `}
          >
            {isSelectable ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedSpaceId(spaceId);
                  setSelectedProjectId(projectId);
                  setSelectedFolderId(folderId);
                }}
                className="p-0.5 rounded hover:bg-[var(--bg-tertiary)]"
              >
                {isSelected ? (
                  <CheckSquare className="w-4 h-4 text-[var(--accent-primary)]" />
                ) : (
                  <Square className="w-4 h-4 text-[var(--text-tertiary)]" />
                )}
              </button>
            ) : (
              <span className="w-4 h-4" />
            )}
            <Folder className="w-4 h-4" />
            <span className="text-sm truncate">{folder.name}</span>
          </div>,
          ...(hasSub ? renderFolders(folder.children, projectId, depth + 1, spaceId) : [])
        ];
      });
  };

  const handleMove = async () => {
    if (!selectedSpaceId || !selectedProjectId) {
      toast.error(tSafe('schemaEditor.selectProject', 'Please select a target project'));
      return;
    }
    if (tableIds.length === 0) {
      toast.error(tSafe('schemaEditor.noTablesSelected', 'No tables selected to move'));
      return;
    }
    setIsMoving(true);
    try {
      const items = tableIds.map((id) => ({ type: 'table', id }));
      const response = await apiClient.request(`/spaces/${selectedSpaceId}/batch`, {
        method: 'POST',
        body: JSON.stringify({
          operation: 'move',
          items,
          target: {
            project_id: selectedProjectId,
            folder_id: selectedFolderId
          }
        })
      });
      const payload = response as any;
      if (payload?.success === false) {
        toast.error(payload?.error?.message || tSafe('common.error', 'Failed to move tables'));
        return;
      }

      const successCount = Array.isArray(payload?.data?.success)
        ? payload.data.success.length
        : tableIds.length;
      const failedCount = Array.isArray(payload?.data?.failed)
        ? payload.data.failed.length
        : 0;

      if (successCount > 0) {
        const successLabel = tSafe(
          'schemaEditor.tablesMoved',
          `${successCount} table(s) moved successfully`
        ).replace('{count}', String(successCount));
        toast.success(successLabel);
        onSuccess();
        onClose();
      }

      if (failedCount > 0 && successCount === 0) {
        toast.error(tSafe('common.error', 'Failed to move tables'));
      } else if (failedCount > 0) {
        toast.error(tSafe('common.error', 'Some tables failed to move'));
      }
    } catch (error: unknown) {
      logger.error('Move failed:', error);
      const errorMessage = error instanceof Error ? error.message : tSafe('common.error', 'Failed to move tables');
      toast.error(errorMessage);
    } finally {
      setIsMoving(false);
    }
  };

  // Показываем корректное число таблиц даже если перевод вернул {count}
  const infoTemplate = tSafe(
    'schemaEditor.movingTables',
    `Moving ${tableIds.length} table(s) to a new location.`
  ) ||
    `Moving ${tableIds.length} table(s) to a new location.`;
  const infoText = infoTemplate.replace('{count}', String(tableIds.length));

  return (
    <Modal
      open={open}
      onOpenChange={(isOpen) => !isOpen && onClose()}
      title={tSafe('schemaEditor.moveTables', 'Move Tables')}
      size="md"
    >
      <div className="space-y-4">
        <div className="flex items-start gap-2 p-3 bg-[var(--bg-secondary)] rounded-lg">
          <AlertCircle className="w-5 h-5 text-[var(--accent-primary)] flex-shrink-0 mt-0.5" />
          <div className="text-sm text-[var(--text-secondary)]">{infoText}</div>
        </div>

        <div className="max-h-[350px] overflow-y-auto border border-[var(--border-primary)] rounded-lg">
          {loadingSpaces ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-[var(--accent-primary)]" />
            </div>
          ) : (
            spaces.map((space) => {
              const isSpaceExpanded = expandedSpaces.has(space.id);
              const spaceProjects = getProjects(space.id);
              return (
                <div key={space.id}>
                  <div
                    className={`
                      flex items-center gap-2 px-3 py-2 cursor-pointer border-b border-[var(--border-secondary)]
                      bg-[var(--bg-secondary)]
                      ${space.id === currentSpaceId ? 'ring-1 ring-inset ring-[var(--accent-primary)]/30' : ''}
                    `}
                    onClick={() => toggleSpaceExpand(space.id)}
                  >
                    <button className="p-0.5">
                      {isSpaceExpanded ? (
                        <ChevronDown className="w-4 h-4 text-[var(--text-secondary)]" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-[var(--text-secondary)]" />
                      )}
                    </button>
                    <Globe className="w-4 h-4 text-[var(--accent-primary)]" />
                    <span className="text-lg">{space.icon}</span>
                    <span className="text-sm font-medium text-[var(--text-primary)]">{space.name}</span>
                    {space.id === currentSpaceId && (
                      <span className="text-xs text-[var(--accent-primary)] ml-auto">
                        {tSafe('common.current', 'current')}
                      </span>
                    )}
                  </div>

                  {isSpaceExpanded && (
                    <div className="ml-4 border-l border-[var(--border-secondary)]">
                      {loadingTree && spaceProjects.length === 0 ? (
                        <div className="flex items-center gap-2 px-4 py-2 text-sm text-[var(--text-tertiary)]">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          {tSafe('common.loading', 'Loading...')}
                        </div>
                      ) : spaceProjects.length === 0 ? (
                        <div className="px-4 py-2 text-sm text-[var(--text-tertiary)] italic">
                          {tSafe('common.noProjects', 'No projects')}
                        </div>
                      ) : (
                        spaceProjects.map((project) => {
                          const [, rawProjectId] = project.id.split(':');
                          const projectId = Number.parseInt(rawProjectId ?? '', 10);
                          if (Number.isNaN(projectId)) {
                            return null;
                          }
                          const hasFolders = project.children?.some((c) => c.type === 'folder');
                          const isProjectExpanded = expandedProjects.has(projectId);
                          const isProjectSelected =
                            selectedProjectId === projectId && !selectedFolderId;

                          return (
                            <div key={project.id}>
                              <div
                                className={`
                                  flex items-center gap-2 px-3 py-2 cursor-pointer
                                  ${isProjectSelected
                                    ? 'bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]'
                                    : 'hover:bg-[var(--bg-secondary)]'}
                                `}
                              >
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedSpaceId(space.id);
                                    setSelectedProjectId(projectId);
                                    setSelectedFolderId(null);
                                  }}
                                  className="p-1 rounded hover:bg-[var(--bg-tertiary)]"
                                >
                                  {isProjectSelected ? (
                                    <CheckSquare className="w-4 h-4 text-[var(--accent-primary)]" />
                                  ) : (
                                    <Square className="w-4 h-4 text-[var(--text-tertiary)]" />
                                  )}
                                </button>

                                {hasFolders ? (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedSpaceId(space.id);
                                      setSelectedProjectId(projectId);
                                      setSelectedFolderId(null);
                                      toggleProjectExpand(projectId);
                                    }}
                                    className="p-1 hover:bg-[var(--bg-tertiary)] rounded"
                                  >
                                    {isProjectExpanded ? (
                                      <ChevronDown className="w-4 h-4 text-[var(--text-secondary)]" />
                                    ) : (
                                      <ChevronRight className="w-4 h-4 text-[var(--text-secondary)]" />
                                    )}
                                  </button>
                                ) : (
                                  <span className="w-6" />
                                )}

                                <div
                                  onClick={() => {
                                    setSelectedSpaceId(space.id);
                                    setSelectedProjectId(projectId);
                                    setSelectedFolderId(null);
                                  }}
                                  className="flex-1 flex items-center gap-2"
                                >
                                  <Database className="w-4 h-4 text-[var(--accent-primary)]" />
                                  <span className="text-lg">{project.icon}</span>
                                  <span className="text-sm font-medium text-[var(--text-primary)]">
                                    {project.name}
                                  </span>
                                  <span className="text-xs text-[var(--text-tertiary)]">(root)</span>
                                </div>
                              </div>

                              {hasFolders && isProjectExpanded && (
                                <div className="ml-6 border-l border-[var(--border-secondary)]">
                                  {renderFolders(project.children, projectId, 0, space.id)}
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {tSafe('common.cancel', 'Cancel')}
          </Button>
          <Button onClick={handleMove} disabled={!selectedProjectId || isMoving || tableIds.length === 0}>
            {isMoving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="ml-2">
                  {tSafe(
                    'schemaEditor.movingTables',
                    `Moving ${tableIds.length} table(s) to a new location.`
                  ).replace('{count}', String(tableIds.length))}
                </span>
              </>
            ) : (
              tSafe('common.move', 'Move')
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default MoveTablesModal;
