import { Link2, ChevronDown } from 'lucide-react';
import type { CSVFileData, NotionImportLogEntry } from './types';

interface CsvNotionImportPanelProps {
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
  setNotionImportPanelVisible: React.Dispatch<React.SetStateAction<boolean>>;
  t: (key: string, params?: Record<string, string | number>) => string;
}

export const CsvNotionImportPanel = ({
  notionImportLog,
  notionImportLogExpanded,
  setNotionImportLogExpanded,
  csvFilesBeforeNotionImport,
  notionValueDisplay,
  setNotionValueDisplay,
  notionOutputFormat,
  setNotionOutputFormat,
  notionCreateIdColumn,
  setNotionCreateIdColumn,
  applyNotionTransform,
  updateNotionIdsByName,
  undoNotionImport,
  setNotionImportPanelVisible,
  t,
}: CsvNotionImportPanelProps) => {
  return (
    <div className="rounded-lg bg-gradient-to-r from-purple-500/10 to-indigo-500/10 border border-purple-500/40 overflow-hidden">
      <div className="px-3 py-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-purple-200 flex items-center gap-2">
            <Link2 className="w-4 h-4" />
            Notion Import
          </span>
          {notionImportLog.length > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <span className="px-2 py-0.5 rounded bg-green-500/20 text-green-300 border border-green-500/30">
                ✓ {notionImportLog.filter(l => l.resolved).length}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={notionValueDisplay}
            onChange={(e) => setNotionValueDisplay(e.target.value as 'names' | 'notion_id')}
            className="text-xs px-2 py-1 rounded bg-[var(--bg-primary)] text-[var(--text-primary)] border border-purple-500/30 cursor-pointer"
            title={t('tables.create.whatToSave')}
            style={{ colorScheme: 'dark' }}
          >
            <option value="names">🏷️ {t('tables.create.names')}</option>
            <option value="notion_id">🔑 Notion ID</option>
          </select>
          <select
            value={notionOutputFormat}
            onChange={(e) => setNotionOutputFormat(e.target.value as 'comma' | 'json' | 'semicolon')}
            className="text-xs px-2 py-1 rounded bg-[var(--bg-primary)] text-[var(--text-primary)] border border-purple-500/30 cursor-pointer"
            title={t('tables.create.format')}
            style={{ colorScheme: 'dark' }}
          >
            <option value="comma">a, b</option>
            <option value="json">["a","b"]</option>
            <option value="semicolon">a; b</option>
          </select>
          <label
            className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded border transition-colors cursor-pointer ${
              notionValueDisplay === 'notion_id'
                ? 'bg-gray-500/10 text-gray-400 border-gray-500/20 cursor-not-allowed'
                : 'bg-purple-500/10 text-purple-300 border-purple-500/30 hover:bg-purple-500/20'
            }`}
            title={notionValueDisplay === 'notion_id' ? t('tables.create.notionIdAlreadyInValues') : t('tables.create.createNotionIdColumn')}
          >
            <input
              type="checkbox"
              checked={notionCreateIdColumn}
              onChange={(e) => setNotionCreateIdColumn(e.target.checked)}
              disabled={notionValueDisplay === 'notion_id'}
              className="w-3 h-3 rounded"
            />
            <span>+notion_id</span>
          </label>
          <button type="button" onClick={applyNotionTransform}
            className="text-sm px-2.5 py-1 rounded bg-green-500/20 text-green-300 hover:bg-green-500/30 border border-green-500/30 transition-colors"
            title={t('tables.create.applyTransform')}
          >▶</button>
          <button type="button" onClick={updateNotionIdsByName}
            className="text-sm px-2.5 py-1 rounded bg-primary-500/20 text-primary-300 hover:bg-primary-500/30 border border-primary-500/30 transition-colors"
            title={t('tables.create.updateNotionIdsByName')}
          >🔄</button>
          {csvFilesBeforeNotionImport && (
            <button type="button" onClick={undoNotionImport}
              className="text-xs px-2 py-1 rounded bg-red-500/20 text-red-300 hover:bg-red-500/30 border border-red-500/30 transition-colors"
              title={t('tables.create.undoTransform')}
            >↩</button>
          )}
          <button type="button" onClick={() => setNotionImportPanelVisible(false)}
            className="text-xs px-2 py-1 rounded bg-gray-500/20 text-gray-300 hover:bg-gray-500/30 border border-gray-500/30 transition-colors"
          >✕</button>
        </div>
      </div>

      {notionImportLog.length > 0 && (
        <div className="px-3 pb-2 border-t border-purple-500/30">
          <div
            className="pt-2 flex items-center justify-between cursor-pointer"
            onClick={() => setNotionImportLogExpanded(!notionImportLogExpanded)}
          >
            <span className="text-xs text-purple-300/70">
              {t('tables.create.log')} ({notionImportLog.length})
            </span>
            <ChevronDown className={`w-3 h-3 text-purple-300 transition-transform ${notionImportLogExpanded ? 'rotate-180' : ''}`} />
          </div>
          {notionImportLogExpanded && (
            <div className="mt-2 max-h-[100px] overflow-y-auto text-xs space-y-0.5 font-mono">
              {notionImportLog.map((entry, i) => (
                <div key={i} className={`py-0.5 ${entry.resolved ? 'text-green-400' : 'text-red-400'}`}>
                  {entry.text}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
