import { useMemo } from 'react';
import { Table, Link2, ChevronDown, X } from 'lucide-react';
import { EmojiPicker } from '../UniversalTable/EmojiPicker';
import { TableMenuWidgetToggle } from '../TableMenuWidgetToggle';
import { ColorPicker } from './ColorPicker';
import { CsvFileTabs } from './CsvFileTabs';
import { CsvNotionImportPanel } from './CsvNotionImportPanel';
import { isNotionRelationColumn } from './notion-utils';
import { toNotionKey, getIdFromNameId } from './notion-utils';
import type { CSVFileData, CSVColumnDefinition, NotionImportLogEntry } from './types';

interface CsvConfigureSectionProps {
  // CSV files state
  csvFiles: CSVFileData[];
  setCsvFiles: React.Dispatch<React.SetStateAction<CSVFileData[]>>;
  currentCsvFileIndex: number;
  setCurrentCsvFileIndex: React.Dispatch<React.SetStateAction<number>>;
  currentCsvFile: CSVFileData | undefined;
  csvData: string[][];
  csvHeaders: string[];
  csvColumnDefinitions: CSVColumnDefinition[];

  // Scroll state
  csvTabsRef: React.RefObject<HTMLDivElement>;
  canScrollCsvTabsLeft: boolean;
  canScrollCsvTabsRight: boolean;
  selectedTabLeftHidden: boolean;
  selectedTabRightHidden: boolean;
  scrollCsvTabs: (direction: 'left' | 'right') => void;
  updateCsvTabsScroll: () => void;

  // CSV handlers
  handleCsvFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  updateCurrentCsvFile: (updates: Partial<CSVFileData>) => void;
  handleCsvMenuToggle: (checked: boolean) => void;
  updateCsvColumn: (colIndex: number, field: keyof CSVColumnDefinition, value: CSVColumnDefinition[keyof CSVColumnDefinition]) => void;
  toggleColumnExpanded: (colIndex: number) => void;

  // Parent state setters
  setBasic: React.Dispatch<React.SetStateAction<{ displayName: string; name: string; description: string; icon: string; color: string }>>;
  setCsvStep: React.Dispatch<React.SetStateAction<'upload' | 'configure' | 'creating'>>;
  setExpandedColumns: React.Dispatch<React.SetStateAction<Set<number>>>;

  // First row / headers
  useFirstRowAsHeaders: boolean;
  setUseFirstRowAsHeaders: React.Dispatch<React.SetStateAction<boolean>>;

  // Notion import
  notionImportPanelVisible: boolean;
  setNotionImportPanelVisible: React.Dispatch<React.SetStateAction<boolean>>;
  notionImportLog: NotionImportLogEntry[];
  notionImportLogExpanded: boolean;
  setNotionImportLogExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  csvFilesBeforeNotionImport: CSVFileData[] | null;
  notionValueDisplay: 'names' | 'notion_id';
  setNotionValueDisplay: React.Dispatch<React.SetStateAction<'names' | 'notion_id'>>;
  notionOutputFormat: 'comma' | 'json' | 'semicolon';
  setNotionOutputFormat: React.Dispatch<React.SetStateAction<'comma' | 'json' | 'semicolon'>>;
  notionCreateIdColumn: boolean;
  setNotionCreateIdColumn: React.Dispatch<React.SetStateAction<boolean>>;
  applyNotionTransform: () => void;
  updateNotionIdsByName: () => void;
  undoNotionImport: () => void;
  notionNameColumnMap: Record<string, string>;
  setNotionNameColumnMap: React.Dispatch<React.SetStateAction<Record<string, string>>>;

  // Column state
  expandedColumns: Set<number>;
  columnPreviewIndex: Record<string, number>;
  setColumnPreviewIndex: React.Dispatch<React.SetStateAction<Record<string, number>>>;

  // Column type options
  CSV_COLUMN_TYPES: Array<{ value: string; label: string }>;

  // Translation
  t: (key: string, params?: Record<string, string | number>) => string;
}

export const CsvConfigureSection = (props: CsvConfigureSectionProps) => {
  const {
    csvFiles, setCsvFiles, currentCsvFileIndex, setCurrentCsvFileIndex,
    currentCsvFile, csvData, csvHeaders, csvColumnDefinitions,
    csvTabsRef, canScrollCsvTabsLeft, canScrollCsvTabsRight,
    selectedTabLeftHidden, selectedTabRightHidden,
    scrollCsvTabs, updateCsvTabsScroll,
    handleCsvFileUpload, updateCurrentCsvFile, handleCsvMenuToggle,
    updateCsvColumn, toggleColumnExpanded,
    setBasic, setCsvStep, setExpandedColumns,
    useFirstRowAsHeaders, setUseFirstRowAsHeaders,
    notionImportPanelVisible, setNotionImportPanelVisible,
    notionImportLog, notionImportLogExpanded, setNotionImportLogExpanded,
    csvFilesBeforeNotionImport,
    notionValueDisplay, setNotionValueDisplay,
    notionOutputFormat, setNotionOutputFormat,
    notionCreateIdColumn, setNotionCreateIdColumn,
    applyNotionTransform, updateNotionIdsByName, undoNotionImport,
    notionNameColumnMap, setNotionNameColumnMap,
    expandedColumns, columnPreviewIndex, setColumnPreviewIndex,
    CSV_COLUMN_TYPES, t,
  } = props;

  const csvPreviewRows = useMemo(() => {
    if (csvData.length < 2) return [];
    const dataRows = useFirstRowAsHeaders ? csvData.slice(1) : csvData;
    return dataRows.slice(0, 3);
  }, [csvData, useFirstRowAsHeaders]);

  const csvDataRowsCount = useMemo(() => {
    return useFirstRowAsHeaders ? csvData.length - 1 : csvData.length;
  }, [csvData, useFirstRowAsHeaders]);

  return (
    <section className="space-y-4">
      {/* File Tabs */}
      <CsvFileTabs
        csvFiles={csvFiles}
        setCsvFiles={setCsvFiles}
        currentCsvFileIndex={currentCsvFileIndex}
        setCurrentCsvFileIndex={setCurrentCsvFileIndex}
        csvTabsRef={csvTabsRef}
        canScrollCsvTabsLeft={canScrollCsvTabsLeft}
        canScrollCsvTabsRight={canScrollCsvTabsRight}
        selectedTabLeftHidden={selectedTabLeftHidden}
        selectedTabRightHidden={selectedTabRightHidden}
        scrollCsvTabs={scrollCsvTabs}
        updateCsvTabsScroll={updateCsvTabsScroll}
        handleCsvFileUpload={handleCsvFileUpload}
        setBasic={setBasic}
        setCsvStep={setCsvStep}
        t={t}
      />

      {/* Table Info */}
      <div className="space-y-3 p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-[var(--text-secondary)] uppercase tracking-wide">
            {t('tables.create.tableInfo')} {csvFiles.length > 1 && `(${currentCsvFileIndex + 1}/${csvFiles.length})`}
          </h4>
          {csvFiles.length > 1 && (
            <span className="text-xs text-[var(--text-tertiary)]">
              {t('tables.create.willCreate', { count: csvFiles.length })}
            </span>
          )}
        </div>

        <div className="flex items-start gap-3">
          <div className="w-48">
            <label className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide mb-1 block">{t('tables.create.key')}</label>
            <input
              type="text"
              value={currentCsvFile?.tableName || ''}
              onChange={(e) => {
                const newKey = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_');
                updateCurrentCsvFile({ tableName: newKey });
                setBasic(prev => ({ ...prev, name: newKey }));
              }}
              className="w-full h-[30px] px-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)] text-sm font-mono text-[var(--text-primary)]"
              placeholder="table_key"
            />
          </div>
          <div className="w-16">
            <label className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide mb-1 block">{t('tables.create.icon')}</label>
            <EmojiPicker
              value={currentCsvFile?.icon || '📊'}
              onChange={(emoji) => {
                updateCurrentCsvFile({ icon: emoji });
                setBasic(prev => ({ ...prev, icon: emoji }));
              }}
              compact
              size="sm"
              portal
            />
          </div>
          <div className="flex-1">
            <label className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide mb-1 block">{t('tables.create.name')}</label>
            <input
              type="text"
              value={currentCsvFile?.tableDisplayName || ''}
              onChange={(e) => {
                updateCurrentCsvFile({
                  tableDisplayName: e.target.value,
                  tableName: e.target.value.toLowerCase().replace(/[^a-z0-9_]/gi, '_')
                });
                setBasic(prev => ({
                  ...prev,
                  displayName: e.target.value,
                  name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/gi, '_')
                }));
              }}
              placeholder={t('tables.create.namePlaceholder')}
              className="w-full h-[30px] px-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)]"
            />
          </div>
          <div className="w-28 flex-shrink-0">
            <label className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide mb-1 block">{t('tables.create.color')}</label>
            <ColorPicker
              value={currentCsvFile?.color || null}
              onChange={(color) => {
                updateCurrentCsvFile({ color });
              }}
              compact
            />
          </div>
        </div>

        <div>
          <label className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide mb-1 block">{t('tables.create.descriptionLabel')}</label>
          <input
            type="text"
            value={currentCsvFile?.tableDescription || ''}
            onChange={(e) => {
              updateCurrentCsvFile({ tableDescription: e.target.value });
              setBasic(prev => ({ ...prev, description: e.target.value }));
            }}
            placeholder={t('tables.create.descriptionPlaceholder')}
            className="w-full px-3 py-1.5 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)] text-sm text-[var(--text-secondary)]"
          />
        </div>

        <TableMenuWidgetToggle
          checked={currentCsvFile?.showInMenu ?? false}
          onCheckedChange={handleCsvMenuToggle}
          title={t('tables.create.showInMenu')}
          description={t('tables.create.showInMenuDesc')}
        />
        {currentCsvFile?.showInMenu && (
          <div className="grid gap-3 grid-cols-[auto,1fr] items-end">
            <div>
              <label className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide mb-1 block">
                {t('tables.create.widgetIcon')}
              </label>
              <EmojiPicker
                value={currentCsvFile.menuWidgetIcon || currentCsvFile.icon}
                onChange={(emoji) => updateCurrentCsvFile({ menuWidgetIcon: emoji })}
                compact
                size="sm"
                label=""
                portal
              />
            </div>
            <div>
              <label className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide mb-1 block">
                {t('tables.create.widgetName')}
              </label>
              <input
                type="text"
                placeholder={t('tables.create.widgetNamePlaceholder')}
                value={currentCsvFile.menuWidgetTitle}
                onChange={(event) => updateCurrentCsvFile({ menuWidgetTitle: event.target.value })}
                className="w-full h-[30px] px-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)]"
              />
            </div>
            <div className="col-span-2">
              <label className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide mb-1 block">
                {t('tables.create.widgetDescription')}
              </label>
              <textarea
                placeholder={t('tables.create.widgetDescPlaceholder')}
                value={currentCsvFile.menuWidgetDescription}
                onChange={(event) => updateCurrentCsvFile({ menuWidgetDescription: event.target.value })}
                rows={2}
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)] resize-none"
              />
            </div>
          </div>
        )}
      </div>

      {/* First Row as Headers */}
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={useFirstRowAsHeaders}
            onChange={(e) => setUseFirstRowAsHeaders(e.target.checked)}
            className="w-4 h-4 rounded border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--color-primary-500)]"
          />
          <span className="text-sm text-[var(--text-primary)]">
            {t('tables.create.useFirstRowAsHeaders')}
          </span>
        </label>

        <button
          type="button"
          onClick={() => setNotionImportPanelVisible(!notionImportPanelVisible)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-gradient-to-r from-purple-500/20 to-pink-500/20 border border-purple-500/30 text-purple-300 hover:from-purple-500/30 hover:to-pink-500/30 transition-all ${notionImportPanelVisible ? 'ring-2 ring-purple-500/50' : ''}`}
          title={t('tables.create.notionSettingsTitle')}
        >
          <Link2 className="w-3.5 h-3.5" />
          Notion Import
        </button>
      </div>

      {/* Notion Import Panel */}
      {notionImportPanelVisible && (
        <CsvNotionImportPanel
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
          setNotionImportPanelVisible={setNotionImportPanelVisible}
          t={t}
        />
      )}

      {/* Column Definitions */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-[var(--text-secondary)] uppercase tracking-wide">
            {t('tables.create.columns')} ({csvColumnDefinitions.filter(c => !c.excluded).length})
            {csvColumnDefinitions.some(c => c.excluded) && (
              <span className="ml-2 text-[var(--text-tertiary)] normal-case">
                / {csvColumnDefinitions.filter(c => c.excluded).length} {t('tables.create.excluded')}
              </span>
            )}
          </h4>
        </div>

        <div className="space-y-2">
          {[...csvColumnDefinitions]
            .filter(c => !c.excluded)
            .sort((a, b) => {
              if (a.name === 'notion_id') return -1;
              if (b.name === 'notion_id') return 1;
              const aColIdx = csvHeaders.indexOf(a.csvColumn);
              const bColIdx = csvHeaders.indexOf(b.csvColumn);
              const aValues = csvData.slice(1).map(row => row[aColIdx] || '');
              const bValues = csvData.slice(1).map(row => row[bColIdx] || '');
              const aLooksLikeRelation = notionImportPanelVisible && isNotionRelationColumn(aValues);
              const bLooksLikeRelation = notionImportPanelVisible && isNotionRelationColumn(bValues);
              const aIsRelation = a.type === 'relation' || a.isNotionRelation || aLooksLikeRelation;
              const bIsRelation = b.type === 'relation' || b.isNotionRelation || bLooksLikeRelation;
              const aResolved = aIsRelation && a.relationTargetFileId;
              const bResolved = bIsRelation && b.relationTargetFileId;
              if (aIsRelation && !aResolved && !(bIsRelation && !bResolved)) return -1;
              if (bIsRelation && !bResolved && !(aIsRelation && !aResolved)) return 1;
              if (aIsRelation && !bIsRelation) return -1;
              if (bIsRelation && !aIsRelation) return 1;
              return 0;
            })
            .map((def) => {
            const isExpanded = expandedColumns.has(def.colIndex);
            const colIdx = csvHeaders.indexOf(def.csvColumn);
            const columnValues = csvData.slice(1).map(row => row[colIdx] || '');
            const looksLikeRelation = notionImportPanelVisible && isNotionRelationColumn(columnValues);
            const isRelation = def.type === 'relation' || def.isNotionRelation || looksLikeRelation;
            const targetFile = csvFiles.find(f => f.id === def.relationTargetFileId);
            const isUnresolvedRelation = isRelation && !targetFile;
            const isNotionIdColumn = def.name === 'notion_id';

            return (
              <div
                key={`col-${def.colIndex}`}
                className={`rounded-lg bg-[var(--bg-secondary)] border overflow-hidden ${
                  isNotionIdColumn
                    ? 'border-green-500/70 bg-green-500/5'
                    : isUnresolvedRelation
                      ? 'border-red-500/70 bg-red-500/5'
                      : isRelation
                        ? 'border-purple-500/70 bg-purple-500/10'
                        : 'border-[var(--border-primary)]'
                }`}
              >
                <div className="p-2.5">
                  <div className="flex items-center gap-2">
                    {(() => {
                      const colIndex = csvHeaders.indexOf(def.csvColumn);
                      const sampleValue = csvData[1]?.[colIndex] || '';
                      const truncated = sampleValue.length > 100 ? sampleValue.slice(0, 100) + '...' : sampleValue;
                      const tooltipText = `${t('tables.create.details')}\n\n${t('tables.create.example')}:\n${truncated || `(${t('tables.create.empty')})`}`;
                      return (
                        <button type="button" onClick={() => toggleColumnExpanded(def.colIndex)}
                          className={`p-1 rounded hover:bg-[var(--bg-tertiary)] transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
                          title={tooltipText}
                        >
                          <ChevronDown className={`w-4 h-4 ${isUnresolvedRelation ? 'text-red-400' : 'text-[var(--text-tertiary)]'}`} />
                        </button>
                      );
                    })()}
                    <div className="w-28 px-2 py-1.5 rounded-md bg-[var(--bg-tertiary)]/50 text-xs font-mono text-[var(--text-tertiary)] truncate border border-transparent"
                      title={`${t('tables.create.sourceColumn')}: ${def.csvColumn}`}>{def.csvColumn}</div>
                    <span className="text-[var(--text-tertiary)] text-xs">→</span>
                    <input type="text" value={def.name}
                      onChange={(e) => { const newKey = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'); updateCsvColumn(def.colIndex, 'name', newKey); }}
                      placeholder="key"
                      className={`w-24 px-2 py-1.5 rounded-md bg-[var(--bg-primary)] border text-xs font-mono ${isUnresolvedRelation ? 'border-red-500/30 text-red-300' : 'border-[var(--border-primary)] text-[var(--text-primary)]'}`}
                      title={t('tables.create.columnKey')} />
                    <EmojiPicker value={def.emoji || ''} onChange={(emoji) => updateCsvColumn(def.colIndex, 'emoji', emoji)} compact size="sm" portal />
                    <input type="text" value={def.displayName}
                      onChange={(e) => { updateCsvColumn(def.colIndex, 'displayName', e.target.value); }}
                      placeholder={t('tables.create.displayName')}
                      className={`flex-1 min-w-0 px-2 py-1.5 rounded-md bg-[var(--bg-primary)] border text-sm ${isUnresolvedRelation ? 'border-red-500/30 text-red-200' : 'border-[var(--border-primary)] text-[var(--text-primary)]'}`} />
                    <select value={def.type}
                      onChange={(e) => { updateCsvColumn(def.colIndex, 'type', e.target.value); if (e.target.value === 'relation') { setExpandedColumns(prev => new Set([...prev, def.colIndex])); } }}
                      className={`w-28 px-2 py-1.5 rounded-md bg-[var(--bg-primary)] border text-xs ${isUnresolvedRelation ? 'border-red-500/50 text-red-300' : isRelation ? 'border-purple-500/50 text-purple-300' : 'border-[var(--border-primary)] text-[var(--text-primary)]'}`}
                    >
                      {CSV_COLUMN_TYPES.map(t => (<option key={t.value} value={t.value}>{t.label}</option>))}
                    </select>
                    {isRelation && targetFile && (
                      <span className="text-purple-400 text-xs font-medium cursor-help flex-shrink-0"
                        title={`${t('tables.create.relationWith')} "${targetFile.tableDisplayName}" ${t('tables.create.byColumn')} ${def.relationValueColumn || 'notion_id'}`}>ⓘ</span>
                    )}
                    <button type="button" onClick={() => updateCsvColumn(def.colIndex, 'excluded', true)}
                      className="p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0"
                      title={t('tables.create.excludeColumn')}>
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className={`px-3 pb-3 pt-0 border-t ${isUnresolvedRelation ? 'border-red-500/30 bg-red-500/5' : 'border-[var(--border-primary)] bg-[var(--bg-tertiary)]/50'}`}>
                    <div className="pt-3 space-y-3">
                      {isRelation ? (
                        <>
                          <div>
                            <label className={`text-xs mb-1 block ${isUnresolvedRelation ? 'text-red-300' : 'text-[var(--text-secondary)]'}`}>
                              {t('tables.create.relatedTable')} {isUnresolvedRelation && <span className="text-red-400">*{t('tables.create.required')}</span>}
                            </label>
                            <select value={def.relationTargetFileId || ''}
                              onChange={(e) => updateCsvColumn(def.colIndex, 'relationTargetFileId', e.target.value || undefined)}
                              className={`w-full px-3 py-2 rounded-lg bg-[var(--bg-primary)] border text-sm ${isUnresolvedRelation ? 'border-red-500/50 text-[var(--text-primary)]' : 'border-purple-500/30 text-[var(--text-primary)]'}`}
                            >
                              <option value="">— {t('tables.create.selectTable')} —</option>
                              {csvFiles.filter(f => f.id !== currentCsvFile?.id).map(f => (
                                <option key={f.id} value={f.id}>{f.icon} {f.tableDisplayName} ({f.data.length - 1} {t('tables.create.rows')})</option>
                              ))}
                            </select>
                          </div>

                          {targetFile && (() => {
                            const labelCol = def.relationLabelColumn || 'name';
                            const labelColIdx = targetFile.columnDefinitions.findIndex(c => c.name === labelCol);
                            const notionIdColIdx = targetFile.columnDefinitions.findIndex(c => c.name === 'notion_id');
                            let labelMatchesNotionId = false;
                            if (labelColIdx !== -1 && notionIdColIdx !== -1) {
                              const targetDataRows = useFirstRowAsHeaders ? targetFile.data.slice(1) : targetFile.data;
                              let matchCount = 0;
                              const checkCount = Math.min(5, targetDataRows.length);
                              for (let i = 0; i < checkCount; i++) {
                                const row = targetDataRows[i];
                                const labelValue = row[labelColIdx]?.trim().toLowerCase().replace(/[^a-z0-9\u0400-\u04ff]/gi, '_');
                                const notionIdValue = row[notionIdColIdx]?.toLowerCase() || '';
                                if (labelValue && notionIdValue.startsWith(labelValue.substring(0, 10))) matchCount++;
                              }
                              labelMatchesNotionId = checkCount > 0 && matchCount >= checkCount * 0.5;
                            }
                            return (
                            <>
                              <div className="grid grid-cols-3 gap-2">
                                <div>
                                  <label className="text-[10px] mb-1 block text-[var(--text-secondary)] uppercase tracking-wide">{t('tables.create.valueId')}</label>
                                  <select value={def.relationValueColumn || 'notion_id'}
                                    onChange={(e) => updateCsvColumn(def.colIndex, 'relationValueColumn', e.target.value)}
                                    className="w-full px-2 py-1.5 rounded-md bg-[var(--bg-primary)] border border-purple-500/30 text-xs text-[var(--text-primary)]"
                                  >
                                    <option value="notion_id">Notion ID</option>
                                    <option value="id">ID (row_id)</option>
                                    {targetFile.columnDefinitions.map(c => (<option key={c.csvColumn} value={c.name}>{c.displayName} ({c.type})</option>))}
                                  </select>
                                </div>
                                <div>
                                  <label className={`text-[10px] mb-1 block uppercase tracking-wide ${labelMatchesNotionId ? 'text-green-300' : 'text-[var(--text-secondary)]'}`}>
                                    {t('tables.create.display')} {labelMatchesNotionId && '✓'}
                                  </label>
                                  <select value={def.relationLabelColumn || 'name'}
                                    onChange={(e) => updateCsvColumn(def.colIndex, 'relationLabelColumn', e.target.value)}
                                    className={`w-full px-2 py-1.5 rounded-md bg-[var(--bg-primary)] border text-xs text-[var(--text-primary)] ${labelMatchesNotionId ? 'border-green-500/50 ring-1 ring-green-500/30' : 'border-purple-500/30'}`}
                                  >
                                    {targetFile.columnDefinitions.map(c => (<option key={c.csvColumn} value={c.name}>{c.displayName} ({c.type})</option>))}
                                  </select>
                                </div>
                                <div>
                                  <label className="text-[10px] mb-1 block text-[var(--text-secondary)] uppercase tracking-wide">{t('tables.create.formatLabel')}</label>
                                  <select value={def.relationStorageFormat || 'comma'}
                                    onChange={(e) => updateCsvColumn(def.colIndex, 'relationStorageFormat', e.target.value as 'comma' | 'json' | 'semicolon' | 'single')}
                                    className="w-full px-2 py-1.5 rounded-md bg-[var(--bg-primary)] border border-purple-500/30 text-xs text-[var(--text-primary)]"
                                  >
                                    <option value="comma">a, b</option>
                                    <option value="json">["a","b"]</option>
                                    <option value="semicolon">a; b</option>
                                    <option value="single">{t('tables.create.single')}</option>
                                  </select>
                                </div>
                              </div>
                              <div className="text-xs text-purple-200/70">
                                → {t('tables.create.relationWith')} "{targetFile.tableDisplayName}" {t('tables.create.byColumn')} {def.relationValueColumn || 'notion_id'}
                                {labelMatchesNotionId && <span className="text-green-300 ml-2">• {t('tables.create.namesMatchNotionId')}</span>}
                              </div>
                            </>
                            );
                          })()}
                        </>
                      ) : null}

                      {isNotionIdColumn && (
                        <div className="space-y-2 pt-2 border-t border-green-500/30">
                          <div className="flex items-center justify-between">
                            <label className="flex items-center gap-2 text-xs text-green-300 cursor-pointer">
                              <input type="checkbox"
                                checked={(def.reverseRelations?.length || 0) > 0}
                                onChange={(e) => {
                                  if (e.target.checked) { updateCsvColumn(def.colIndex, 'reverseRelations', [{ targetFileId: '', targetColumn: '' }]); }
                                  else { updateCsvColumn(def.colIndex, 'reverseRelations', []); }
                                }}
                                className="w-3 h-3 rounded"
                              />
                              <span className="font-medium">↩ {t('tables.create.reverseRelations')}</span>
                            </label>
                          </div>

                          {(def.reverseRelations?.length || 0) > 0 && (
                            <div className="space-y-2 pl-4">
                              {def.reverseRelations?.map((rr, rrIdx) => {
                                const rrTargetFile = csvFiles.find(f => f.id === rr.targetFileId);
                                return (
                                  <div key={rrIdx} className="p-2 rounded-lg bg-green-500/10 border border-green-500/20 space-y-2">
                                    <div className="flex items-center justify-between">
                                      <span className="text-[10px] text-green-300 uppercase tracking-wide">{t('tables.create.relation')} #{rrIdx + 1}</span>
                                      <button type="button" onClick={() => { const newRR = [...(def.reverseRelations || [])]; newRR.splice(rrIdx, 1); updateCsvColumn(def.colIndex, 'reverseRelations', newRR); }}
                                        className="text-red-400 hover:text-red-300 text-xs">✕</button>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                      <div>
                                        <label className="text-[10px] text-green-300/70 block mb-1">{t('tables.create.table')}</label>
                                        <select value={rr.targetFileId}
                                          onChange={(e) => { const newRR = [...(def.reverseRelations || [])]; newRR[rrIdx] = { ...rr, targetFileId: e.target.value, targetColumn: '' }; updateCsvColumn(def.colIndex, 'reverseRelations', newRR); }}
                                          className="w-full px-2 py-1 rounded text-xs bg-[var(--bg-primary)] border border-green-500/30 text-[var(--text-primary)]" style={{ colorScheme: 'dark' }}
                                        >
                                          <option value="">— {t('tables.create.select')} —</option>
                                          {csvFiles.filter(f => f.id !== currentCsvFile?.id).map(f => (<option key={f.id} value={f.id}>{f.icon} {f.tableDisplayName}</option>))}
                                        </select>
                                      </div>
                                      <div>
                                        <label className="text-[10px] text-green-300/70 block mb-1">{t('tables.create.column')}</label>
                                        <select value={rr.targetColumn}
                                          onChange={(e) => { const newRR = [...(def.reverseRelations || [])]; newRR[rrIdx] = { ...rr, targetColumn: e.target.value }; updateCsvColumn(def.colIndex, 'reverseRelations', newRR); }}
                                          className="w-full px-2 py-1 rounded text-xs bg-[var(--bg-primary)] border border-green-500/30 text-[var(--text-primary)]" style={{ colorScheme: 'dark' }}
                                          disabled={!rrTargetFile}
                                        >
                                          <option value="">— {t('tables.create.column')} —</option>
                                          {rrTargetFile?.columnDefinitions.map(c => (<option key={c.csvColumn} value={c.name}>{c.displayName}</option>))}
                                        </select>
                                      </div>
                                    </div>
                                    {rrTargetFile && rr.targetColumn && (
                                      <div className="text-[10px] text-green-300/60">
                                        ← {t('tables.create.writeToColumn').replace('{table}', rrTargetFile.tableDisplayName).replace('{column}', rr.targetColumn)}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                              <button type="button"
                                onClick={() => { const newRR = [...(def.reverseRelations || []), { targetFileId: '', targetColumn: '' }]; updateCsvColumn(def.colIndex, 'reverseRelations', newRR); }}
                                className="w-full py-1.5 text-xs text-green-300 bg-green-500/10 border border-dashed border-green-500/30 rounded-lg hover:bg-green-500/20 transition-colors"
                              >{t('tables.create.addReverseRelation')}</button>
                            </div>
                          )}

                          <div className="pt-2 border-t border-green-500/20">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[10px] text-green-300/70 uppercase tracking-wide">NAME</span>
                              <select value={notionNameColumnMap[currentCsvFile?.id || ''] || ''}
                                onChange={(e) => setNotionNameColumnMap(prev => ({ ...prev, [currentCsvFile?.id || '']: e.target.value }))}
                                className="flex-1 text-[10px] bg-green-500/10 border border-green-500/30 rounded px-1 py-0.5 text-green-300"
                              >
                                <option value="">{t('tables.create.selectColumn')}</option>
                                {csvColumnDefinitions.map(col => (<option key={col.csvColumn} value={col.csvColumn}>{col.displayName || col.csvColumn}</option>))}
                              </select>
                              <span className="text-[10px] text-green-300/50">→ NOTION_KEY → NOTION_ID</span>
                            </div>
                            <div className="max-h-40 overflow-y-auto space-y-1 text-xs">
                              {(() => {
                                const selectedNameCol = notionNameColumnMap[currentCsvFile?.id || ''];
                                let nameColIdx = selectedNameCol ? csvHeaders.indexOf(selectedNameCol) : -1;
                                if (nameColIdx === -1) {
                                  const autoDetect = csvColumnDefinitions.find(c => c.name === 'name' || c.displayName.toLowerCase() === 'name' || c.csvColumn.toLowerCase() === 'name');
                                  if (autoDetect) {
                                    nameColIdx = csvHeaders.indexOf(autoDetect.csvColumn);
                                    if (nameColIdx !== -1 && currentCsvFile?.id) { setNotionNameColumnMap(prev => ({ ...prev, [currentCsvFile.id]: autoDetect.csvColumn })); }
                                  }
                                }
                                const notionIdColDef = csvColumnDefinitions.find(c => c.name === 'notion_id' || c.csvColumn.toLowerCase() === 'notion_id');
                                const notionIdColIdx = notionIdColDef ? csvHeaders.indexOf(notionIdColDef.csvColumn) : -1;
                                const dataRows = csvData.slice(1);
                                const rows = dataRows.slice(0, 10);
                                if (nameColIdx === -1) return <div className="text-yellow-300/60">{t('tables.create.selectColumnWithName')}</div>;
                                return rows.map((row, idx) => {
                                  const name = row[nameColIdx] || '';
                                  const notionKey = toNotionKey(name);
                                  const notionId = notionIdColIdx !== -1 ? (row[notionIdColIdx] || '') : '';
                                  const hasValidId = notionId && /[a-f0-9]{32}/i.test(notionId);
                                  return (
                                    <div key={idx} className={`flex flex-wrap items-center gap-1 py-0.5 px-1 rounded ${hasValidId ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
                                      <span className="text-green-300/80 truncate max-w-[100px]" title={name}>{name || '—'}</span>
                                      <span className="text-green-500/40">→</span>
                                      <span className="text-primary-300/70 font-mono truncate max-w-[100px]" title={notionKey}>{notionKey || '—'}</span>
                                      <span className="text-green-500/40">→</span>
                                      <span className={`font-mono truncate max-w-[120px] ${hasValidId ? 'text-green-300/60' : 'text-red-300/60'}`} title={notionId}>
                                        {notionId ? (notionId.length > 12 ? notionId.substring(0, 12) + '...' : notionId) : `(${t('tables.create.empty')})`}
                                      </span>
                                    </div>
                                  );
                                });
                              })()}
                              {csvData.length > 11 && (
                                <div className="text-green-300/40 text-[10px]">{t('tables.create.andMore').replace('{count}', String(csvData.length - 11))}</div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {(() => {
                        const colIndex = csvHeaders.indexOf(def.csvColumn);
                        const dataRows = csvData.slice(1);
                        const totalRows = dataRows.length;
                        const currentIdx = columnPreviewIndex[def.csvColumn] || 0;
                        const rawValue = dataRows[currentIdx]?.[colIndex] || '—';
                        let displayValue = rawValue;
                        if (isRelation && targetFile && rawValue && rawValue !== '—') {
                          const parts = rawValue.split(',').map((n: string) => n.trim()).filter(Boolean);
                          const targetData = targetFile.data.slice(1);
                          const nameColIdx = targetFile.headers.indexOf('Name') !== -1 ? targetFile.headers.indexOf('Name') : 0;
                          let resultParts: string[] = [];
                          if (notionValueDisplay === 'names') {
                            resultParts = parts.map((p: string) => { const match = p.match(/^([^(]+)/); return match ? match[1].trim() : p; });
                          } else if (notionValueDisplay === 'notion_id') {
                            parts.forEach((name: string) => {
                              const cleanName = name.match(/^([^(]+)/)?.[1]?.trim() || name;
                              const row = targetData.find(r => r[nameColIdx]?.trim() === cleanName);
                              if (row) {
                                const notionIdValue = row[0];
                                const pureId = getIdFromNameId(notionIdValue);
                                if (notionIdValue && /^[a-f0-9]{32}$/i.test(pureId)) { resultParts.push(notionIdValue); }
                                else { resultParts.push(`(${cleanName})`); }
                              } else { resultParts.push(`⚠️${cleanName}`); }
                            });
                          } else { resultParts = parts; }
                          if (notionOutputFormat === 'json') { displayValue = JSON.stringify(resultParts); }
                          else if (notionOutputFormat === 'semicolon') { displayValue = resultParts.join('; '); }
                          else { displayValue = resultParts.join(', '); }
                        }
                        return (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-[var(--text-secondary)]">{t('tables.create.columnValues').replace('{count}', String(totalRows))}</span>
                              <div className="flex items-center gap-1">
                                <button type="button"
                                  onClick={() => setColumnPreviewIndex(prev => ({ ...prev, [def.csvColumn]: Math.max(0, (prev[def.csvColumn] || 0) - 1) }))}
                                  disabled={currentIdx === 0}
                                  className="px-2 py-0.5 text-xs rounded bg-[var(--bg-primary)] border border-[var(--border-primary)] disabled:opacity-30 hover:bg-[var(--bg-secondary)]"
                                >←</button>
                                <span className="text-xs text-[var(--text-secondary)] min-w-[60px] text-center">{currentIdx + 1} / {totalRows}</span>
                                <button type="button"
                                  onClick={() => setColumnPreviewIndex(prev => ({ ...prev, [def.csvColumn]: Math.min(totalRows - 1, (prev[def.csvColumn] || 0) + 1) }))}
                                  disabled={currentIdx >= totalRows - 1}
                                  className="px-2 py-0.5 text-xs rounded bg-[var(--bg-primary)] border border-[var(--border-primary)] disabled:opacity-30 hover:bg-[var(--bg-secondary)]"
                                >→</button>
                              </div>
                            </div>
                            <div className={`p-2 rounded-lg text-xs break-all max-h-20 overflow-y-auto ${isUnresolvedRelation ? 'bg-red-500/10 border border-red-500/30 text-red-200' : 'bg-[var(--bg-primary)] border border-[var(--border-primary)] text-[var(--text-primary)]'}`}>
                              {displayValue || <span className="text-[var(--text-tertiary)]">{t('tables.create.empty')}</span>}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Excluded Columns */}
          {csvColumnDefinitions.filter(c => c.excluded).map(def => {
            const isExpanded = expandedColumns.has(def.colIndex);
            const colIdx = csvHeaders.indexOf(def.csvColumn);
            const sampleValue = csvData[1]?.[colIdx] || '';
            const truncated = sampleValue.length > 100 ? sampleValue.slice(0, 100) + '...' : sampleValue;
            const tooltipText = `${t('tables.create.details')}\n\n${t('tables.create.example')}:\n${truncated || `(${t('tables.create.empty')})`}`;
            return (
              <div key={`excluded-${def.colIndex}`}
                className="rounded-lg bg-[var(--bg-tertiary)]/50 border border-dashed border-[var(--border-primary)] opacity-60 hover:opacity-100 transition-opacity overflow-hidden"
              >
                <div className="p-2.5">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => toggleColumnExpanded(def.colIndex)}
                      className={`p-1 rounded hover:bg-[var(--bg-tertiary)] transition-transform flex-shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
                      title={tooltipText}>
                      <ChevronDown className="w-4 h-4 text-[var(--text-tertiary)]" />
                    </button>
                    <div className="w-28 px-2 py-1.5 rounded-md bg-[var(--bg-tertiary)]/50 text-xs font-mono text-[var(--text-tertiary)] truncate border border-transparent"
                      title={`${t('tables.create.sourceColumn')}: ${def.csvColumn}`}>{def.csvColumn || `(${t('tables.create.empty')})`}</div>
                    <span className="text-[var(--text-tertiary)] text-xs">→</span>
                    <div className="w-24 px-2 py-1.5 rounded-md bg-[var(--bg-tertiary)]/30 border border-[var(--border-primary)] text-xs font-mono text-[var(--text-tertiary)]">{def.name}</div>
                    <div className="h-[30px] w-9 text-center text-base rounded-md border border-[var(--border-primary)] bg-[var(--bg-tertiary)]/30 flex items-center justify-center flex-shrink-0 text-[var(--text-tertiary)]">{def.emoji || '📁'}</div>
                    <div className="flex-1 min-w-0 px-2 py-1.5 rounded-md bg-[var(--bg-tertiary)]/30 border border-[var(--border-primary)] text-sm text-[var(--text-tertiary)] truncate">{def.displayName}</div>
                    <div className="w-28 px-2 py-1.5 rounded-md bg-[var(--bg-tertiary)]/30 border border-[var(--border-primary)] text-xs text-[var(--text-tertiary)]">
                      {CSV_COLUMN_TYPES.find(t => t.value === def.type)?.label || def.type}
                    </div>
                    <button type="button" onClick={() => updateCsvColumn(def.colIndex, 'excluded', false)}
                      className="p-1.5 rounded-md text-green-400 hover:text-green-300 hover:bg-green-500/10 transition-colors flex-shrink-0"
                      title={t('tables.create.returnColumn')}>↩</button>
                  </div>
                </div>
                {isExpanded && (
                  <div className="px-3 pb-3 pt-0 border-t border-[var(--border-primary)] bg-[var(--bg-tertiary)]/30">
                    <div className="pt-3">
                      {(() => {
                        const dataRows = csvData.slice(1);
                        const totalRows = dataRows.length;
                        const currentIdx = columnPreviewIndex[def.csvColumn] || 0;
                        const currentRow = dataRows[currentIdx];
                        const displayValue = currentRow?.[colIdx] || '';
                        return (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-[var(--text-tertiary)]">{t('tables.create.columnValues').replace('{count}', String(totalRows))}</span>
                              <div className="flex items-center gap-1">
                                <button type="button"
                                  onClick={() => setColumnPreviewIndex(prev => ({ ...prev, [def.csvColumn]: Math.max(0, (prev[def.csvColumn] || 0) - 1) }))}
                                  disabled={currentIdx === 0}
                                  className="px-2 py-0.5 text-xs rounded bg-[var(--bg-primary)] border border-[var(--border-primary)] disabled:opacity-30 hover:bg-[var(--bg-secondary)]"
                                >←</button>
                                <span className="text-xs text-[var(--text-tertiary)] min-w-[60px] text-center">{currentIdx + 1} / {totalRows}</span>
                                <button type="button"
                                  onClick={() => setColumnPreviewIndex(prev => ({ ...prev, [def.csvColumn]: Math.min(totalRows - 1, (prev[def.csvColumn] || 0) + 1) }))}
                                  disabled={currentIdx >= totalRows - 1}
                                  className="px-2 py-0.5 text-xs rounded bg-[var(--bg-primary)] border border-[var(--border-primary)] disabled:opacity-30 hover:bg-[var(--bg-secondary)]"
                                >→</button>
                              </div>
                            </div>
                            <div className="p-2 rounded-lg text-xs break-all max-h-20 overflow-y-auto bg-[var(--bg-primary)] border border-[var(--border-primary)] text-[var(--text-tertiary)]">
                              {displayValue || <span className="text-[var(--text-tertiary)]/50">{t('tables.create.empty')}</span>}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Preview */}
      <div className="sticky bottom-0 z-10 -mx-2 px-2 pt-3 pb-2 bg-[var(--bg-primary)] border-t border-[var(--border-primary)]">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Table className="w-4 h-4 text-[var(--text-secondary)]" />
            <h4 className="text-sm font-medium text-[var(--text-secondary)]">
              {t('tables.create.preview').replace('{count}', String(csvDataRowsCount))}
            </h4>
          </div>
          <div className="overflow-x-auto rounded-lg border border-[var(--border-primary)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--bg-secondary)]">
                <tr>
                  {csvColumnDefinitions.filter(d => !d.excluded).map(def => (
                    <th key={`th-${def.colIndex}`} className="px-3 py-2 text-left font-medium text-[var(--text-secondary)] whitespace-nowrap">{def.displayName}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {csvPreviewRows.map((row, i) => (
                  <tr key={i} className="border-t border-[var(--border-primary)]">
                    {csvColumnDefinitions.filter(d => !d.excluded).map((def) => {
                      const colIdx = csvHeaders.indexOf(def.csvColumn);
                      return (<td key={`td-${def.colIndex}`} className="px-3 py-2 text-[var(--text-primary)] whitespace-nowrap max-w-[150px] truncate">{row[colIdx] || '—'}</td>);
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
};
