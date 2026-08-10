import { Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import type { CSVFileData } from './types';

interface CsvFileTabsProps {
  csvFiles: CSVFileData[];
  setCsvFiles: React.Dispatch<React.SetStateAction<CSVFileData[]>>;
  currentCsvFileIndex: number;
  setCurrentCsvFileIndex: React.Dispatch<React.SetStateAction<number>>;
  csvTabsRef: React.RefObject<HTMLDivElement>;
  canScrollCsvTabsLeft: boolean;
  canScrollCsvTabsRight: boolean;
  selectedTabLeftHidden: boolean;
  selectedTabRightHidden: boolean;
  scrollCsvTabs: (direction: 'left' | 'right') => void;
  updateCsvTabsScroll: () => void;
  handleCsvFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  setBasic: React.Dispatch<React.SetStateAction<{ displayName: string; name: string; description: string; icon: string; color: string }>>;
  setCsvStep: React.Dispatch<React.SetStateAction<'upload' | 'configure' | 'creating'>>;
  t: (key: string, params?: Record<string, string | number>) => string;
}

export const CsvFileTabs = ({
  csvFiles,
  setCsvFiles,
  currentCsvFileIndex,
  setCurrentCsvFileIndex,
  csvTabsRef,
  canScrollCsvTabsLeft,
  canScrollCsvTabsRight,
  selectedTabLeftHidden,
  selectedTabRightHidden,
  scrollCsvTabs,
  updateCsvTabsScroll,
  handleCsvFileUpload,
  setBasic,
  setCsvStep,
  t,
}: CsvFileTabsProps) => {
  return (
    <div className="sticky top-0 z-20 -mx-2 px-2 pb-2 bg-[var(--bg-primary)]">
      <div className="flex items-center gap-2 h-12">
        <button
          type="button"
          onClick={() => scrollCsvTabs('left')}
          disabled={!canScrollCsvTabsLeft}
          className={`h-10 w-5 rounded-md border border-[var(--border-primary)] transition ${
            canScrollCsvTabsLeft
              ? 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
              : 'text-[var(--text-tertiary)] opacity-40 cursor-not-allowed'
          } ${selectedTabLeftHidden ? 'text-[var(--color-primary-500)] border-[var(--color-primary-500)]' : ''}`}
          title={t('tables.create.scrollLeft')}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div
          ref={csvTabsRef}
          onScroll={updateCsvTabsScroll}
          className="flex-1 overflow-x-auto overflow-y-hidden h-12 pb-2"
        >
          <div className="flex gap-1 p-1 bg-[var(--bg-secondary)] rounded-lg h-10">
            {csvFiles.map((file, idx) => (
              <div
                key={file.id}
                className={`group flex items-center gap-1 px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-all ${
                  idx === currentCsvFileIndex
                    ? 'bg-[var(--color-primary-500)] text-white'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setCurrentCsvFileIndex(idx);
                    setBasic(prev => ({
                      ...prev,
                      displayName: file.tableDisplayName,
                      name: file.tableName,
                      icon: file.icon
                    }));
                  }}
                  className="flex items-center gap-2"
                  data-csv-tab={idx}
                >
                  <span className="max-w-[120px] truncate">{file.tableDisplayName}</span>
                  <span className="text-xs opacity-70">({file.data.length - 1})</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCsvFiles(prev => {
                      const newFiles = prev.filter((_, i) => i !== idx);
                      if (newFiles.length === 0) {
                        setCsvStep('upload');
                        return [];
                      }
                      if (currentCsvFileIndex >= newFiles.length) {
                        setCurrentCsvFileIndex(newFiles.length - 1);
                      }
                      return newFiles;
                    });
                  }}
                  className={`ml-1 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity ${
                    idx === currentCsvFileIndex
                      ? 'hover:bg-white/20 text-white/70 hover:text-white'
                      : 'hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-red-400'
                  }`}
                  title={t('tables.create.removeFile')}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={() => scrollCsvTabs('right')}
          disabled={!canScrollCsvTabsRight}
          className={`h-10 w-5 rounded-md border border-[var(--border-primary)] transition ${
            canScrollCsvTabsRight
              ? 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
              : 'text-[var(--text-tertiary)] opacity-40 cursor-not-allowed'
          } ${selectedTabRightHidden ? 'text-[var(--color-primary-500)] border-[var(--color-primary-500)]' : ''}`}
          title={t('tables.create.scrollRight')}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <label
          htmlFor="csv-add-more-files"
          className="flex items-center justify-center h-10 w-10 rounded-md border border-[var(--border-primary)] text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] cursor-pointer transition-all"
          title={t('tables.create.addCsvFiles')}
        >
          <Plus className="w-5 h-5" />
          <input
            type="file"
            accept=".csv"
            multiple
            onChange={handleCsvFileUpload}
            className="hidden"
            id="csv-add-more-files"
          />
        </label>
      </div>
    </div>
  );
};
