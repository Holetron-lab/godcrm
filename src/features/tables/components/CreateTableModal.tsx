import { useEffect, useMemo, useState, useRef } from 'react';
import { logger } from '@/shared/utils/logger';
import { Input, Select, Modal } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { useDataSources } from '@/features/data-sources/hooks/useDataSources';
import { dataSourcesApi } from '@/features/data-sources/api/dataSourcesApi';
import { useSpacesQuery } from '@/features/spaces/hooks/useSpacesQuery';
import { useAuthStore } from '@/features/auth/store/authStore';
import { EmojiPicker } from './UniversalTable/EmojiPicker';
import { TableMenuWidgetToggle } from './TableMenuWidgetToggle';
import type {
  ColumnDefinitionInput,
  TableHierarchyConfig
} from '../types/table.types';
import { getColumnTypeOptions, getColumnTypeOptionsForCSV } from '@/shared/types';
import { useTablesStore } from '../store/tablesStore';

// Extracted modules
import type { CreateTableModalProps, CSVFileData, NotionImportLogEntry } from './CreateTableModal/types';
import { cloneDefaultColumns, slugify } from './CreateTableModal/constants';
import { useCsvHandlers } from './CreateTableModal/useCsvHandlers';
import { useNotionImport } from './CreateTableModal/useNotionImport';
import { useCsvCreate } from './CreateTableModal/useCsvCreate';
import { CsvUploadSection } from './CreateTableModal/CsvUploadSection';
import { CsvConfigureSection } from './CreateTableModal/CsvConfigureSection';
import { CsvCreatingSection } from './CreateTableModal/CsvCreatingSection';
import { ExternalTableSection } from './CreateTableModal/ExternalTableSection';
import { LocalTableColumnEditor } from './CreateTableModal/LocalTableColumnEditor';

export const CreateTableModal = ({ open, onOpenChange, projectId, projects, onOpenDataSourceWizard }: CreateTableModalProps) => {
  const { t, language } = useLanguage();
  const globalError = useTablesStore((state) => state.error);

  // Column type options from shared types
  const columnTypeOptions = useMemo(() => getColumnTypeOptions(language as 'ru' | 'en'), [language]);
  const CSV_COLUMN_TYPES = useMemo(() => getColumnTypeOptionsForCSV(language as 'ru' | 'en'), [language]);

  const hierarchyOptions: Array<{ label: string; value: TableHierarchyConfig['mode']; description: string }> = [
    { label: t('tables.hierarchy.flat.label'), value: 'flat', description: t('tables.hierarchy.flat.description') },
    { label: t('tables.hierarchy.nested.label'), value: 'nested', description: t('tables.hierarchy.nested.description') }
  ];
  const user = useAuthStore((state) => state.user);
  const workspaceId = projectId?.toString() || '1';
  const { dataSources } = useDataSources(workspaceId);

  // === State ===
  const [tableType, setTableType] = useState<'local' | 'external' | 'csv'>('local');
  const [selectedDataSource, setSelectedDataSource] = useState<string>('');
  const [selectedExternalTable, setSelectedExternalTable] = useState<string>('');
  const [externalTables, setExternalTables] = useState<string[]>([]);
  const [relatedTables, setRelatedTables] = useState<string[]>([]);
  const [selectedRelatedTables, setSelectedRelatedTables] = useState<string[]>([]);

  // CSV state
  const [csvStep, setCsvStep] = useState<'upload' | 'configure' | 'creating'>('upload');
  const [csvFiles, setCsvFiles] = useState<CSVFileData[]>([]);
  const [currentCsvFileIndex, setCurrentCsvFileIndex] = useState(0);
  const [useFirstRowAsHeaders, setUseFirstRowAsHeaders] = useState(true);
  const [csvCreating, setCsvCreating] = useState(false);

  // Notion Import state
  const [notionImportLog, setNotionImportLog] = useState<NotionImportLogEntry[]>([]);
  const [csvFilesBeforeNotionImport, setCsvFilesBeforeNotionImport] = useState<CSVFileData[] | null>(null);
  const csvTabsRef = useRef<HTMLDivElement>(null);
  const [canScrollCsvTabsLeft, setCanScrollCsvTabsLeft] = useState(false);
  const [canScrollCsvTabsRight, setCanScrollCsvTabsRight] = useState(false);
  const [selectedTabLeftHidden, setSelectedTabLeftHidden] = useState(false);
  const [selectedTabRightHidden, setSelectedTabRightHidden] = useState(false);
  const [expandedColumns, setExpandedColumns] = useState<Set<number>>(new Set());
  const [expandedLocalColumns, setExpandedLocalColumns] = useState<Set<number>>(new Set());
  const [columnPreviewIndex, setColumnPreviewIndex] = useState<Record<string, number>>({});
  const [notionImportLogExpanded, setNotionImportLogExpanded] = useState(false);
  const [columnEmojiPicker, setColumnEmojiPicker] = useState<number | null>(null);
  const [emojiPickerPosition, setEmojiPickerPosition] = useState<{ top: number; left: number } | null>(null);
  const [localColumnEmojiPicker, setLocalColumnEmojiPicker] = useState<number | null>(null);
  const [localEmojiPickerPosition, setLocalEmojiPickerPosition] = useState<{ top: number; left: number } | null>(null);
  const [targetSpaceId, setTargetSpaceId] = useState<number | null>(null);
  // Global Notion import settings
  const [notionValueDisplay, setNotionValueDisplay] = useState<'names' | 'notion_id'>('notion_id');
  const [notionOutputFormat, setNotionOutputFormat] = useState<'comma' | 'json' | 'semicolon'>('comma');
  const [notionCreateIdColumn, setNotionCreateIdColumn] = useState(true);
  const [notionImportPanelVisible, setNotionImportPanelVisible] = useState(false);
  const [notionNameColumnMap, setNotionNameColumnMap] = useState<Record<string, string>>({});

  // Current CSV file helpers
  const currentCsvFile = csvFiles[currentCsvFileIndex];
  const csvData = currentCsvFile?.data || [];
  const csvHeaders = currentCsvFile?.headers || [];
  const csvColumnDefinitions = currentCsvFile?.columnDefinitions || [];

  // Basic form state
  const [basic, setBasic] = useState({
    displayName: '',
    name: '',
    description: '',
    icon: '📋',
    color: '#6366f1'
  });
  const [showInMenu, setShowInMenu] = useState(false);
  const [menuWidgetTitle, setMenuWidgetTitle] = useState('');
  const [menuWidgetIcon, setMenuWidgetIcon] = useState('');
  const [menuWidgetDescription, setMenuWidgetDescription] = useState('');
  const [menuTitleTouched, setMenuTitleTouched] = useState(false);
  const [menuIconTouched, setMenuIconTouched] = useState(false);
  const [menuDescriptionTouched, setMenuDescriptionTouched] = useState(false);
  const [hierarchy, setHierarchy] = useState<TableHierarchyConfig>({ mode: 'flat' });
  const [columns, setColumns] = useState<ColumnDefinitionInput[]>(() => cloneDefaultColumns());
  const [targetProjectId, setTargetProjectId] = useState<number | null>(projectId ?? null);

  const derivedName = useMemo(() => basic.name || slugify(basic.displayName || 'custom_table'), [basic]);

  // Load spaces for project filtering
  const { data: spaces = [] } = useSpacesQuery();

  // Filter projects by selected space
  const filteredProjects = useMemo(() => {
    if (!projects) return [];
    if (!targetSpaceId) return projects;
    return projects.filter(p => p.space_id === targetSpaceId);
  }, [projects, targetSpaceId]);

  const resetState = () => {
    setTableType('local');
    setSelectedDataSource('');
    setSelectedExternalTable('');
    setExternalTables([]);
    setRelatedTables([]);
    setSelectedRelatedTables([]);
    setCsvStep('upload');
    setCsvFiles([]);
    setCurrentCsvFileIndex(0);
    setCsvCreating(false);
    setUseFirstRowAsHeaders(true);
    setNotionImportLog([]);
    setCsvFilesBeforeNotionImport(null);
    setExpandedColumns(new Set());
    setExpandedLocalColumns(new Set());
    setColumnPreviewIndex({});
    setNotionImportLogExpanded(false);
    setColumnEmojiPicker(null);
    setEmojiPickerPosition(null);
    setLocalColumnEmojiPicker(null);
    setLocalEmojiPickerPosition(null);
    setTargetSpaceId(null);
    setBasic({ displayName: '', name: '', description: '', icon: '📋', color: '#6366f1' });
    setShowInMenu(false);
    setMenuWidgetTitle('');
    setMenuWidgetIcon('');
    setMenuWidgetDescription('');
    setMenuTitleTouched(false);
    setMenuIconTouched(false);
    setMenuDescriptionTouched(false);
    setHierarchy({ mode: 'flat' });
    setColumns(cloneDefaultColumns());
    setTargetProjectId(projectId ?? null);
  };

  // === Effects ===
  useEffect(() => {
    if (!open) {
      resetState();
      return;
    }
    setTargetProjectId(projectId ?? null);
    if (projectId && projects) {
      const project = projects.find(p => p.id === projectId);
      if (project && project.space_id) {
        setTargetSpaceId(project.space_id);
      }
    }
  }, [open, projectId, projects]);

  useEffect(() => {
    if (!showInMenu) return;
    if (!menuTitleTouched) setMenuWidgetTitle(basic.displayName);
    if (!menuIconTouched) setMenuWidgetIcon(basic.icon);
    if (!menuDescriptionTouched) setMenuWidgetDescription(basic.description);
  }, [basic.displayName, basic.icon, basic.description, showInMenu, menuTitleTouched, menuIconTouched, menuDescriptionTouched]);

  // === Extracted hooks ===
  const {
    handleCsvFileUpload, handleCsvDragOver, handleCsvDrop,
    updateCsvColumn, updateCurrentCsvFile, handleCsvMenuToggle,
    updateCsvTabsScroll, scrollCsvTabs, toggleColumnExpanded,
  } = useCsvHandlers({
    csvFiles, setCsvFiles, currentCsvFileIndex, setCurrentCsvFileIndex,
    setCsvStep, setBasic, csvTabsRef,
    setCanScrollCsvTabsLeft, setCanScrollCsvTabsRight,
    setSelectedTabLeftHidden, setSelectedTabRightHidden,
    expandedColumns, setExpandedColumns,
  });

  const {
    processNotionImport, undoNotionImport, updateNotionIdsByName,
    applyNotionTransform, detectOtherColumns,
  } = useNotionImport({
    csvFiles, setCsvFiles, useFirstRowAsHeaders, currentCsvFileIndex,
    csvFilesBeforeNotionImport, setCsvFilesBeforeNotionImport,
    notionImportLog, setNotionImportLog,
    expandedColumns, setExpandedColumns,
    notionValueDisplay, notionOutputFormat, notionCreateIdColumn,
    notionNameColumnMap, setNotionImportPanelVisible,
  });

  const { handleCsvCreate, handleSubmit, createTable } = useCsvCreate({
    csvFiles, csvFilesBeforeNotionImport, targetProjectId, useFirstRowAsHeaders,
    setCsvCreating, setCsvStep, resetState, onOpenChange,
    tableType, basic, derivedName, hierarchy, columns,
    selectedDataSource, selectedExternalTable, selectedRelatedTables,
    showInMenu, menuWidgetTitle, menuWidgetIcon, menuWidgetDescription, slugify,
  });

  // CSV tabs scroll sync
  useEffect(() => {
    updateCsvTabsScroll();
  }, [updateCsvTabsScroll, csvFiles.length, currentCsvFileIndex]);

  // Fetch external tables
  useEffect(() => {
    if (!selectedDataSource) {
      setExternalTables([]);
      setRelatedTables([]);
      return;
    }
    const fetchTables = async () => {
      try {
        const tables = await dataSourcesApi.listTables(selectedDataSource);
        setExternalTables(tables.map(t => t.name));
      } catch (error) {
        logger.error('Failed to fetch tables:', error);
        setExternalTables([]);
      }
    };
    fetchTables();
  }, [selectedDataSource]);

  // Find related tables
  useEffect(() => {
    if (!selectedExternalTable || externalTables.length === 0) {
      setRelatedTables([]);
      setSelectedRelatedTables([]);
      return;
    }
    const baseTableName = selectedExternalTable;
    const related = externalTables.filter(table =>
      table !== baseTableName &&
      (table.startsWith(baseTableName + '_') || baseTableName.startsWith(table + '_'))
    );
    setRelatedTables(related);
    setSelectedRelatedTables(related);
  }, [selectedExternalTable, externalTables]);

  // === Local table handlers ===
  const toggleRelatedTable = (tableName: string) => {
    setSelectedRelatedTables(prev =>
      prev.includes(tableName)
        ? prev.filter(t => t !== tableName)
        : [...prev, tableName]
    );
  };

  const updateColumn = (index: number, updater: (column: ColumnDefinitionInput) => ColumnDefinitionInput) => {
    setColumns((prev) => prev.map((column, idx) => (idx === index ? updater(column) : column)));
  };

  const handleAddColumn = () => {
    setColumns((prev) => [
      ...prev,
      {
        name: `column_${prev.length + 1}`,
        displayName: `Column ${prev.length + 1}`,
        type: 'text',
        config: {
          appearance: {
            align: 'left',
            indicator: { type: 'emoji', value: '🆕' }
          }
        },
        width: 180,
        isVisible: true
      }
    ]);
  };

  const handleRemoveColumn = (index: number) => {
    setColumns((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== index)));
  };

  const errorMessage = (createTable.error instanceof Error ? createTable.error.message : null) || globalError;

  const isSubmitDisabled = useMemo(() => {
    if (tableType === 'csv') {
      return csvCreating || !basic.displayName.trim() || !targetProjectId || csvStep !== 'configure';
    }
    return createTable.isLoading || !basic.displayName.trim();
  }, [tableType, csvCreating, basic.displayName, targetProjectId, csvStep, createTable.isLoading]);

  const submitLabel = useMemo(() => {
    if (tableType === 'csv') {
      return csvCreating ? t('tables.create.creating') : t('tables.create.createTables');
    }
    return createTable.isLoading ? t('tables.create.creating') : t('tables.create.createTable');
  }, [tableType, csvCreating, createTable.isLoading, t]);

  // ============ RENDER ============
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('tables.create.title')}
      description={t('tables.create.description')}
      size="xl"
      fixedHeight
      heightOffset={120}
      primaryAction={tableType !== 'csv' || csvStep === 'configure' ? {
        label: submitLabel,
        onClick: handleSubmit,
        disabled: isSubmitDisabled
      } : undefined}
      secondaryAction={{
        label: t('tables.create.cancel'),
        variant: 'ghost',
        onClick: () => onOpenChange(false)
      }}
    >
      <div className="flex flex-col h-full space-y-4">
        {/* Table Type Selection */}
        {!(tableType === 'csv' && csvFiles.length > 0) && (
        <section className="space-y-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setTableType('local')}
              className={`flex-1 flex items-center gap-3 rounded-lg border p-3 transition ${
                tableType === 'local'
                  ? 'border-[var(--color-primary-500)] bg-[var(--color-primary-500)]/10'
                  : 'border-[var(--border-primary)] hover:border-[var(--color-primary-300)]'
              }`}
            >
              <span className="text-xl">📋</span>
              <div className="text-left">
                <div className="text-sm font-medium text-[var(--text-primary)]">{t('tables.create.localTable')}</div>
                <div className="text-[10px] text-[var(--text-tertiary)]">{t('tables.create.localTableDesc')}</div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setTableType('external')}
              className={`flex-1 flex items-center gap-3 rounded-lg border p-3 transition ${
                tableType === 'external'
                  ? 'border-[var(--color-primary-500)] bg-[var(--color-primary-500)]/10'
                  : 'border-[var(--border-primary)] hover:border-[var(--color-primary-300)]'
              }`}
            >
              <span className="text-xl">🔗</span>
              <div className="text-left">
                <div className="text-sm font-medium text-[var(--text-primary)]">{t('tables.create.externalTable')}</div>
                <div className="text-[10px] text-[var(--text-tertiary)]">{t('tables.create.externalTableDesc')}</div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setTableType('csv')}
              className={`flex-1 flex items-center gap-3 rounded-lg border p-3 transition ${
                tableType === 'csv'
                  ? 'border-[var(--color-primary-500)] bg-[var(--color-primary-500)]/10'
                  : 'border-[var(--border-primary)] hover:border-[var(--color-primary-300)]'
              }`}
            >
              <span className="text-xl">📄</span>
              <div className="text-left">
                <div className="text-sm font-medium text-[var(--text-primary)]">{t('tables.create.fromCsv')}</div>
                <div className="text-[10px] text-[var(--text-tertiary)]">{t('tables.create.fromCsvDesc')}</div>
              </div>
            </button>
          </div>
        </section>
        )}

        {/* CSV Upload & Configure */}
        {tableType === 'csv' && (
          <>
            {csvStep === 'upload' && (
              <CsvUploadSection
                handleCsvDragOver={handleCsvDragOver}
                handleCsvDrop={handleCsvDrop}
                handleCsvFileUpload={handleCsvFileUpload}
                targetProjectId={targetProjectId}
                t={t}
              />
            )}

            {csvStep === 'configure' && (
              <CsvConfigureSection
                csvFiles={csvFiles}
                setCsvFiles={setCsvFiles}
                currentCsvFileIndex={currentCsvFileIndex}
                setCurrentCsvFileIndex={setCurrentCsvFileIndex}
                currentCsvFile={currentCsvFile}
                csvData={csvData}
                csvHeaders={csvHeaders}
                csvColumnDefinitions={csvColumnDefinitions}
                csvTabsRef={csvTabsRef}
                canScrollCsvTabsLeft={canScrollCsvTabsLeft}
                canScrollCsvTabsRight={canScrollCsvTabsRight}
                selectedTabLeftHidden={selectedTabLeftHidden}
                selectedTabRightHidden={selectedTabRightHidden}
                scrollCsvTabs={scrollCsvTabs}
                updateCsvTabsScroll={updateCsvTabsScroll}
                handleCsvFileUpload={handleCsvFileUpload}
                updateCurrentCsvFile={updateCurrentCsvFile}
                handleCsvMenuToggle={handleCsvMenuToggle}
                updateCsvColumn={updateCsvColumn}
                toggleColumnExpanded={toggleColumnExpanded}
                setBasic={setBasic}
                setCsvStep={setCsvStep}
                setExpandedColumns={setExpandedColumns}
                useFirstRowAsHeaders={useFirstRowAsHeaders}
                setUseFirstRowAsHeaders={setUseFirstRowAsHeaders}
                notionImportPanelVisible={notionImportPanelVisible}
                setNotionImportPanelVisible={setNotionImportPanelVisible}
                notionImportLog={notionImportLog}
                notionImportLogExpanded={notionImportLogExpanded}
                setNotionImportLogExpanded={setNotionImportLogExpanded}
                csvFilesBeforeNotionImport={csvFilesBeforeNotionImport}
                notionValueDisplay={notionValueDisplay}
                setNotionValueDisplay={setNotionValueDisplay}
                notionOutputFormat={notionOutputFormat}
                setNotionOutputFormat={setNotionOutputFormat}
                notionCreateIdColumn={notionCreateIdColumn}
                setNotionCreateIdColumn={setNotionCreateIdColumn}
                applyNotionTransform={applyNotionTransform}
                updateNotionIdsByName={updateNotionIdsByName}
                undoNotionImport={undoNotionImport}
                notionNameColumnMap={notionNameColumnMap}
                setNotionNameColumnMap={setNotionNameColumnMap}
                expandedColumns={expandedColumns}
                columnPreviewIndex={columnPreviewIndex}
                setColumnPreviewIndex={setColumnPreviewIndex}
                CSV_COLUMN_TYPES={CSV_COLUMN_TYPES}
                t={t}
              />
            )}

            {csvStep === 'creating' && (
              <CsvCreatingSection csvFiles={csvFiles} t={t} />
            )}
          </>
        )}

        {/* External Table Selection */}
        {tableType === 'external' && (
          <ExternalTableSection
            selectedDataSource={selectedDataSource}
            setSelectedDataSource={setSelectedDataSource}
            selectedExternalTable={selectedExternalTable}
            setSelectedExternalTable={setSelectedExternalTable}
            dataSources={dataSources}
            externalTables={externalTables}
            t={t}
          />
        )}

        {/* Basic info - only for local and external tables */}
        {tableType !== 'csv' && (
        <section className="space-y-3">
          <div className="grid gap-3 grid-cols-2">
            {spaces.length > 0 && (
              <Select
                label={t('tables.create.space')}
                value={targetSpaceId !== null ? String(targetSpaceId) : ''}
                onChange={(value) => { setTargetSpaceId(value ? Number(value) : null); setTargetProjectId(null); }}
                options={spaces.map((space) => ({ label: `${space.name} (${space.id})`, value: String(space.id) }))}
                placeholder={t('tables.create.allSpaces')}
              />
            )}
            {projects && projects.length > 0 && (
              <Select
                label={t('tables.create.project')}
                value={targetProjectId !== null ? String(targetProjectId) : ''}
                onChange={(value) => setTargetProjectId(value ? Number(value) : null)}
                options={filteredProjects.map((project) => ({ label: `${project.name} (${project.id})`, value: String(project.id) }))}
                placeholder={t('tables.create.selectProject')}
              />
            )}
          </div>

          <div className="grid gap-3 grid-cols-2">
            <div className="flex items-start gap-3">
              <div className="w-16">
                <label className="text-xs mb-1 block text-[var(--text-secondary)]">{t('tables.create.icon')}</label>
                <EmojiPicker value={basic.icon} onChange={(emoji) => setBasic((prev) => ({ ...prev, icon: emoji }))} compact portal />
              </div>
              <div className="flex-1 min-w-0 ml-5">
                <label className="text-xs mb-1 block text-[var(--text-secondary)]">{t('tables.create.name')}</label>
                <input type="text" placeholder={t('tables.create.namePlaceholder')} value={basic.displayName}
                  onChange={(event) => setBasic((prev) => ({ ...prev, displayName: event.target.value }))}
                  className="w-full h-10 px-3 rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-sm" />
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <label className="text-xs mb-1 block text-[var(--text-secondary)]">{t('tables.create.systemName')}</label>
                <input type="text" placeholder="auto" value={basic.name}
                  onChange={(event) => setBasic((prev) => ({ ...prev, name: event.target.value }))}
                  className="w-full h-10 px-3 rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-xs font-mono" />
              </div>
              <div className="w-16">
                <label className="text-xs mb-1 block text-[var(--text-secondary)]">{t('tables.create.color')}</label>
                <input type="color" value={basic.color}
                  onChange={(event) => setBasic((prev) => ({ ...prev, color: event.target.value }))}
                  className="w-full h-10 rounded-md border border-[var(--border-primary)] cursor-pointer" />
              </div>
            </div>
          </div>

          <div>
            <label className="text-xs mb-1 block text-[var(--text-secondary)]">{t('tables.create.descriptionLabel')}</label>
            <textarea placeholder={t('tables.create.tableDescPlaceholder')} value={basic.description}
              onChange={(event) => setBasic((prev) => ({ ...prev, description: event.target.value }))}
              rows={3} className="w-full px-3 py-2 rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-sm resize-none" />
          </div>

          <TableMenuWidgetToggle checked={showInMenu} onCheckedChange={setShowInMenu} description={t('tables.create.showInMenuDesc')} />
          {showInMenu && (
            <div className="grid gap-3 grid-cols-[auto,1fr] items-end">
              <div>
                <label className="text-xs mb-1 block text-[var(--text-secondary)]">{t('tables.create.widgetIcon')}</label>
                <EmojiPicker value={menuWidgetIcon || basic.icon}
                  onChange={(emoji) => { setMenuWidgetIcon(emoji); setMenuIconTouched(true); }}
                  compact label="" size="md" portal />
              </div>
              <div>
                <label className="text-xs mb-1 block text-[var(--text-secondary)]">{t('tables.create.widgetName')}</label>
                <input type="text" placeholder={t('tables.create.widgetExampleName')} value={menuWidgetTitle}
                  onChange={(event) => { setMenuWidgetTitle(event.target.value); setMenuTitleTouched(true); }}
                  className="w-full h-10 px-3 rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-sm" />
              </div>
              <div className="col-span-2">
                <label className="text-xs mb-1 block text-[var(--text-secondary)]">{t('tables.create.widgetDescription')}</label>
                <textarea placeholder={t('tables.create.widgetDescPlaceholder')} value={menuWidgetDescription}
                  onChange={(event) => { setMenuWidgetDescription(event.target.value); setMenuDescriptionTouched(true); }}
                  rows={2} className="w-full px-3 py-2 rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] text-sm resize-none" />
              </div>
            </div>
          )}

          {tableType === 'external' && (
            <button type="button"
              onClick={() => { if (onOpenDataSourceWizard) { onOpenChange(false); onOpenDataSourceWizard(); } }}
              className="w-full flex items-start gap-3 p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)] hover:border-[var(--accent-primary)] transition cursor-pointer text-left"
            >
              <span className="text-2xl">🗄️</span>
              <div>
                <h4 className="font-medium text-[var(--text-primary)]">{t('tables.create.addSource')}</h4>
                <p className="text-sm text-[var(--text-secondary)] mt-1">{t('tables.create.addSourceDesc')}</p>
              </div>
            </button>
          )}
        </section>
        )}

        {/* Hierarchy section - only for local tables */}
        {tableType === 'local' && (
          <section className="space-y-3">
            <div className="flex gap-1 p-1 bg-[var(--bg-tertiary)] rounded-lg">
              {hierarchyOptions.map((option) => (
                <button key={option.value} type="button"
                  onClick={() => setHierarchy((prev) => ({ ...prev, mode: option.value }))}
                  className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition ${
                    hierarchy.mode === option.value
                      ? 'bg-[var(--bg-primary)] text-[var(--text-primary)] shadow-sm'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >{option.label}</button>
              ))}
            </div>
            {hierarchy.mode !== 'flat' && (
              <div className="grid gap-3 grid-cols-2">
                <Input label="Parent key" placeholder="parent_id" value={hierarchy.parentField ?? ''}
                  onChange={(event) => setHierarchy((prev) => ({ ...prev, parentField: event.target.value }))}
                  description={t('tables.create.parentFieldDesc')} />
                <Input label="Child key / relation" placeholder="child_ids" value={hierarchy.childField ?? ''}
                  onChange={(event) => setHierarchy((prev) => ({ ...prev, childField: event.target.value }))}
                  description={t('tables.create.nestedColumnDesc')} />
              </div>
            )}
          </section>
        )}

        {/* Columns section - only for local tables */}
        {tableType === 'local' && (
          <LocalTableColumnEditor
            columns={columns}
            expandedLocalColumns={expandedLocalColumns}
            setExpandedLocalColumns={setExpandedLocalColumns}
            updateColumn={updateColumn}
            handleAddColumn={handleAddColumn}
            handleRemoveColumn={handleRemoveColumn}
            columnTypeOptions={columnTypeOptions}
            t={t}
          />
        )}
        {errorMessage && <p className="text-sm text-[var(--color-error)]">{errorMessage}</p>}
      </div>
    </Modal>
  );
};
