import { useState, useMemo, useRef, useEffect } from 'react';
import {
  Plus,
  Save,
  Undo,
  Redo,
  LayoutGrid,
  Link2,
  X,
  Check,
  Trash2,
  ChevronDown,
  ChevronRight,
  MousePointer2,
  RefreshCw,
  FolderInput,
  Spline,
  Settings2,
  Circle,
  Square,
  Diamond,
  ArrowRight,
  Minus,
  Grip,
  Palette,
  FolderTree,
  Map as MapIcon,
} from 'lucide-react';
import { useSchemaEditorStore } from '../../store/schemaEditorStore';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { Button } from '@/shared/components/ui/Button';
import { LayoutSettingsModal, type LayoutSettings } from '../modals/LayoutSettingsModal';
import { CreateTableModal } from '@/features/tables/components/CreateTableModal';
import type { EdgeShapeType, LineStyleType, EndpointMarkerType } from '../../types/schema-editor.types';

interface EditorToolbarProps {
  onApplyLayout?: (settings: LayoutSettings) => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onFitView?: () => void;
  selectedTables?: Set<number>;
  onBulkDelete?: () => void;
  onBulkMove?: () => void;
  onClearSelection?: () => void;
  miniMapVisible?: boolean;
  onToggleMiniMap?: () => void;
  zoomLevel?: number;
  onZoomChange?: (value: number) => void;
}

export const EditorToolbar = ({
  onApplyLayout,
  onZoomIn,
  onZoomOut,
  onFitView,
  selectedTables,
  onBulkDelete,
  onBulkMove,
  onClearSelection,
  miniMapVisible = true,
  onToggleMiniMap,
  zoomLevel = 1,
  onZoomChange,
}: EditorToolbarProps) => {
  const { t } = useLanguage();
  const { 
    saveLayout, 
    pendingConnections, 
    removePendingConnection,
    clearPendingConnections,
    applyPendingConnections,
    selectedColumnKey,
    clearColumnSelection,
    nodes,
    refreshSchema,
    edgeShape,
    lineStyle,
    setEdgeShape,
    setLineStyle,
    edgeStyleConfig,
    setEdgeStyleConfig,
    showProjectBoundaries,
    toggleProjectBoundaries,
    navTree,
  } = useSchemaEditorStore();

  const [showPendingDropdown, setShowPendingDropdown] = useState(false);
  const [showShapeDropdown, setShowShapeDropdown] = useState(false);
  const [showLineStyleDropdown, setShowLineStyleDropdown] = useState(false);
  const [showLayoutModal, setShowLayoutModal] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // New Table dropdown state
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [showCreateTableModal, setShowCreateTableModal] = useState(false);
  const projectDropdownRef = useRef<HTMLDivElement>(null);
  
  // Extract projects from navTree
  const projects = useMemo(() => {
    return navTree
      .filter(node => node.type === 'project')
      .map(node => ({
        id: node.numericId,
        name: node.displayName || node.name,
        icon: node.icon || '📁',
      }));
  }, [navTree]);
  
  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (projectDropdownRef.current && !projectDropdownRef.current.contains(e.target as Node)) {
        setShowProjectDropdown(false);
      }
    };
    if (showProjectDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showProjectDropdown]);

  // Handle project selection
  const handleSelectProject = (projectId: number) => {
    setSelectedProjectId(projectId);
    setShowProjectDropdown(false);
    setShowCreateTableModal(true);
  };

  // Edge SHAPE options (path/curve type - direction of bend only)
  const edgeShapeOptions: { value: EdgeShapeType; label: string; icon: React.ReactNode }[] = [
    { value: 'rounded', label: 'Скругление', icon: <Spline className="w-3.5 h-3.5" /> },
    { value: 'bezier', label: 'Безье', icon: <span className="text-xs">~</span> },
    { value: 'straight', label: 'Минимал', icon: <Minus className="w-3.5 h-3.5" /> },
    { value: 'angular', label: 'Плата', icon: <Grip className="w-3.5 h-3.5" /> },
  ];

  // Line STYLE options (visual appearance)
  const lineStyleOptions: { value: LineStyleType; label: string; icon: React.ReactNode }[] = [
    { value: 'solid', label: 'Сплошная', icon: <div className="w-4 h-0.5 bg-current" /> },
    { value: 'dashed', label: 'Пунктир', icon: <div className="w-4 h-0.5 border-t-2 border-current border-dashed" /> },
    { value: 'thin', label: 'Тонкая', icon: <div className="w-4 h-px bg-current" /> },
    { value: 'animated', label: 'Живая', icon: <span className="text-xs animate-pulse">⟿</span> },
    { value: 'gradient', label: 'Градиент', icon: <span className="text-xs">◐</span> },
    { value: 'pulse', label: 'Пульсация', icon: <span className="text-xs animate-pulse">●</span> },
  ];

  // Endpoint marker options
  const endpointOptions: { value: EndpointMarkerType; label: string; icon: React.ReactNode }[] = [
    { value: 'dot', label: 'Круг', icon: <Circle className="w-3 h-3" /> },
    { value: 'square', label: 'Квадрат', icon: <Square className="w-3 h-3" /> },
    { value: 'diamond', label: 'Ромб', icon: <Diamond className="w-3 h-3" /> },
    { value: 'arrow', label: 'Стрелка', icon: <ArrowRight className="w-3 h-3" /> },
    { value: 'none', label: 'Нет', icon: <Minus className="w-3 h-3" /> },
  ];

  const currentShapeOption = edgeShapeOptions.find(o => o.value === edgeShape);
  const currentLineStyleOption = lineStyleOptions.find(o => o.value === lineStyle);
  const zoomPercent = Math.round((Number.isFinite(zoomLevel) ? zoomLevel : 1) * 100);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshSchema();
    } finally {
      setIsRefreshing(false);
    }
  };

  // Get selected table and column info
  const selectedInfo = useMemo(() => {
    if (!selectedColumnKey) return null;
    const [tableIdStr, columnName] = selectedColumnKey.split(':');
    const tableId = parseInt(tableIdStr);
    const node = nodes.find(n => n.data.tableId === tableId);
    if (!node) return null;
    const column = node.data.columns.find(c => c.name === columnName);
    return {
      tableName: node.data.displayName || node.data.name,
      tableId,
      columnName,
      columnDisplayName: column?.displayName || columnName,
    };
  }, [selectedColumnKey, nodes]);

  const handleSave = async () => {
    await saveLayout();
  };

  const handleApplyConnections = async () => {
    await applyPendingConnections();
    setShowPendingDropdown(false);
  };

  return (
    <div className="flex items-center justify-between px-4 py-3 h-[58px] border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
      {/* Left actions */}
      <div className="flex items-center gap-1">
        {/* New Table with Project Dropdown */}
        <div className="relative" ref={projectDropdownRef}>
          <button
            onClick={() => setShowProjectDropdown(!showProjectDropdown)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium
              bg-emerald-600 dark:bg-[var(--accent-primary)] text-white hover:bg-emerald-700 dark:hover:bg-[var(--accent-primary-hover)] transition-colors"
            title={t('schemaEditor.newTable')}
          >
            <Plus className="w-4 h-4" />
            <span>{t('schemaEditor.newTable')}</span>
            <ChevronDown className={`w-3.5 h-3.5 ml-0.5 transition-transform ${showProjectDropdown ? 'rotate-180' : ''}`} />
          </button>
          
          {/* Project Selection Dropdown */}
          {showProjectDropdown && (
            <div className="absolute top-full left-0 mt-1 w-56 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl z-50 overflow-hidden">
              <div className="px-3 py-2 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
                <div className="text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wide flex items-center gap-1.5">
                  <FolderTree className="w-3.5 h-3.5" />
                  Выберите проект
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto py-1">
                {projects.length === 0 ? (
                  <div className="px-3 py-4 text-center text-sm text-[var(--text-tertiary)]">
                    Нет доступных проектов
                  </div>
                ) : (
                  projects.map(project => (
                    <button
                      key={project.id}
                      onClick={() => handleSelectProject(project.id)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[var(--bg-secondary)] transition-colors"
                    >
                      <span className="text-base">{project.icon}</span>
                      <span className="text-sm text-[var(--text-primary)] truncate flex-1">{project.name}</span>
                      <span className="text-xs text-[var(--text-tertiary)]">#{project.id}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <div className="w-px h-6 bg-[var(--border-primary)] mx-2" />

        {/* Save */}
        <button
          onClick={handleSave}
          className="p-2 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
          title={t('schemaEditor.saveLayout')}
        >
          <Save className="w-4 h-4" />
        </button>

        {/* Refresh */}
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className={`p-2 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors ${isRefreshing ? 'animate-spin' : ''}`}
          title={t('common.refresh')}
        >
          <RefreshCw className="w-4 h-4" />
        </button>

        {/* Undo/Redo */}
        <button
          className="p-2 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors opacity-50"
          title={t('schemaEditor.undo')}
          disabled
        >
          <Undo className="w-4 h-4" />
        </button>
        <button
          className="p-2 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors opacity-50"
          title={t('schemaEditor.redo')}
          disabled
        >
          <Redo className="w-4 h-4" />
        </button>

        <div className="w-px h-6 bg-[var(--border-primary)] mx-2" />

        {/* Layout Settings Button */}
        <button
          onClick={() => setShowLayoutModal(true)}
          className="p-2 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
          title={t('schemaEditor.autoLayout')}
        >
          <LayoutGrid className="w-4 h-4" />
        </button>

        {/* Project Boundaries Toggle */}
        <button
          onClick={toggleProjectBoundaries}
          className={`p-2 rounded-md transition-colors ${
            showProjectBoundaries 
              ? 'bg-[var(--accent-primary)]/20 text-[var(--accent-primary)]' 
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
          }`}
          title="Обводка проектов"
        >
          <Palette className="w-4 h-4" />
        </button>

        {/* Bulk Selection Actions */}
        {selectedTables && selectedTables.size > 0 && (
          <>
            <div className="w-px h-6 bg-[var(--border-primary)] mx-2" />
            <span className="text-xs text-[var(--text-secondary)] whitespace-nowrap">
              {t('schemaEditor.selected')}: {selectedTables.size}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={onBulkMove}
              className="h-7 px-2 text-xs gap-1"
              title={t('schemaEditor.bulkMove')}
            >
              <FolderInput className="w-3.5 h-3.5" />
              {t('schemaEditor.bulkMove')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onBulkDelete}
              className="h-7 px-2 text-xs gap-1 hover:bg-red-500/20 hover:text-red-500"
              title={t('schemaEditor.bulkDelete')}
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t('schemaEditor.bulkDelete')}
            </Button>
            <button
              onClick={onClearSelection}
              className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              title={t('common.cancel')}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>

      {/* Right - Selection info and Pending Connections */}
      <div className="flex items-center gap-3 ml-auto">
        {/* Selected column info - static element to avoid toolbar shift */}
        {selectedInfo ? (
          <div
            onClick={clearColumnSelection}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] border border-[var(--accent-primary)]/30 hover:bg-[var(--accent-primary)]/30 transition-colors cursor-pointer"
            title={t('schemaEditor.clickToCancel')}
          >
            <MousePointer2 className="w-4 h-4" />
            <span>{selectedInfo.tableName}.{selectedInfo.columnDisplayName}</span>
            <X className="w-3.5 h-3.5 ml-1" />
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-tertiary)]">
            <MousePointer2 className="w-4 h-4" />
            <span>{t('schemaEditor.clickToConnect')}</span>
          </div>
        )}

        {/* Pending Connections - static container with clickable area */}
        <div className="relative">
          <div
            onClick={() => setShowPendingDropdown(!showPendingDropdown)}
            className={`
              flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer
              ${pendingConnections.length > 0
                ? 'bg-primary-500/20 text-primary-400 border border-primary-500/30 hover:bg-primary-500/30'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
              }
            `}
          >
            <Link2 className="w-4 h-4" />
            <span>{t('schemaEditor.connections')}</span>
            {pendingConnections.length > 0 && (
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary-500 text-white text-xs font-bold">
                {pendingConnections.length}
              </span>
            )}
            <ChevronDown className="w-3.5 h-3.5 ml-1" />
          </div>

          {/* Dropdown */}
          {showPendingDropdown && (
            <div
              className="absolute top-full left-0 mt-1 w-80 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl z-50"
              style={{ transform: 'translateX(-50px)' }}
            >
              <div className="p-3 border-b border-[var(--border-primary)]">
                <h3 className="text-sm font-medium text-[var(--text-primary)]">
                  {t('schemaEditor.pendingConnections')}
                </h3>
                <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                  {t('schemaEditor.pendingConnectionsHint')}
                </p>
              </div>

              {pendingConnections.length === 0 ? (
                <div className="p-4 text-center text-sm text-[var(--text-tertiary)]">
                  {t('schemaEditor.noPendingConnections')}
                </div>
              ) : (
                <>
                  <div className="max-h-64 overflow-y-auto">
                    {pendingConnections.map((conn) => (
                      <div
                        key={conn.id}
                        className="flex items-center gap-2 px-3 py-2 hover:bg-[var(--bg-secondary)] border-b border-[var(--border-primary)] last:border-b-0"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-[var(--text-primary)] truncate">
                            {conn.sourceTableName}.{conn.sourceColumn}
                          </div>
                          <div className="text-xs text-[var(--text-tertiary)]">
                            → {conn.targetTableName}.{conn.targetColumn}
                          </div>
                        </div>
                        <button
                          onClick={() => removePendingConnection(conn.id)}
                          className="p-1 rounded hover:bg-red-500/20 text-[var(--text-tertiary)] hover:text-red-400 transition-colors"
                          title="Remove"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>

                  <div className="p-3 border-t border-[var(--border-primary)] flex items-center gap-2">
                    <button
                      onClick={clearPendingConnections}
                      className="flex-1 px-3 py-1.5 rounded-md text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
                    >
                      {t('schemaEditor.clearAll')}
                    </button>
                    <button
                      onClick={handleApplyConnections}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-[var(--accent-primary)] text-white hover:bg-[var(--accent-primary-hover)] transition-colors"
                    >
                      <Check className="w-4 h-4" />
                      {t('schemaEditor.applyAll')}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        <div className="w-px h-6 bg-[var(--border-primary)] mx-1" />

        {/* Tools: Line style + Shape + Mini map + Zoom slider */}
        <div className="flex items-center gap-2">
          {/* Line Style Selector */}
          <div className="relative">
            <button
              type="button"
              onClick={() => { setShowLineStyleDropdown(!showLineStyleDropdown); setShowShapeDropdown(false); }}
              className={`
                flex items-center gap-1 px-2 py-1.5 rounded-md transition-colors cursor-pointer
                ${showLineStyleDropdown
                  ? 'bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] ring-1 ring-[var(--accent-primary)]/40 ring-inset'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                }
              `}
              title="Стиль линии"
            >
              {currentLineStyleOption?.icon}
              <ChevronDown className="w-3 h-3" />
            </button>
            
            {showLineStyleDropdown && (
              <div className="absolute top-full left-0 mt-1 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl z-50 min-w-[130px]">
                {lineStyleOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => { setLineStyle(option.value); setShowLineStyleDropdown(false); }}
                    className={`
                      flex items-center gap-2 w-full px-3 py-2 text-left text-sm transition-colors
                      ${lineStyle === option.value 
                        ? 'bg-[var(--accent-primary)]/20 text-[var(--accent-primary)]' 
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                      }
                    `}
                  >
                    {option.icon}
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Edge Shape Selector */}
          <div className="relative">
            <button
              type="button"
              onClick={() => { setShowShapeDropdown(!showShapeDropdown); setShowLineStyleDropdown(false); }}
              className={`
                flex items-center gap-1 px-2 py-1.5 rounded-md transition-colors cursor-pointer
                ${showShapeDropdown
                  ? 'bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] ring-1 ring-[var(--accent-primary)]/40 ring-inset'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
                }
              `}
              title="Форма связи"
            >
              {currentShapeOption?.icon}
              <ChevronDown className="w-3 h-3" />
            </button>
            
            {showShapeDropdown && (
              <div className="absolute top-full left-0 mt-1 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl z-50 min-w-[120px]">
                {edgeShapeOptions.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => { setEdgeShape(option.value); setShowShapeDropdown(false); }}
                    className={`
                      flex items-center gap-2 w-full px-3 py-2 text-left text-sm transition-colors
                      ${edgeShape === option.value 
                        ? 'bg-[var(--accent-primary)]/20 text-[var(--accent-primary)]' 
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                      }
                    `}
                  >
                    {option.icon}
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="w-px h-5 bg-[var(--border-primary)]" />

          <button
            type="button"
            onClick={() => onToggleMiniMap?.()}
            className={`flex h-7 w-7 items-center justify-center rounded-md text-xs transition-colors ${
              miniMapVisible
                ? 'bg-[var(--accent-primary)]/20 text-[var(--accent-primary)]'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
            }`}
            title={miniMapVisible ? t('schemaEditor.minimapHide') : t('schemaEditor.minimapShow')}
          >
            <MapIcon className="w-3.5 h-3.5" />
          </button>

          <span className="text-xs text-[var(--text-tertiary)] w-10 text-right">
            {zoomPercent}%
          </span>
          <input
            type="range"
            min={0.25}
            max={2}
            step={0.05}
            value={zoomLevel}
            onChange={(e) => onZoomChange?.(parseFloat(e.target.value))}
            disabled={!onZoomChange}
            className="w-28 h-1 accent-[var(--color-primary-500)] disabled:opacity-50"
            style={{ accentColor: 'var(--color-primary-500)' }}
          />
        </div>
      </div>

      {/* Layout Settings Modal */}
      <LayoutSettingsModal
        open={showLayoutModal}
        onOpenChange={setShowLayoutModal}
        onApply={(settings) => onApplyLayout?.(settings)}
      />
      
      {/* Create Table Modal */}
      <CreateTableModal
        open={showCreateTableModal}
        onOpenChange={(open) => {
          setShowCreateTableModal(open);
          if (!open) {
            // Refresh schema when modal closes (in case table was created)
            refreshSchema();
          }
        }}
        projectId={selectedProjectId}
        projects={projects}
      />
    </div>
  );
};
