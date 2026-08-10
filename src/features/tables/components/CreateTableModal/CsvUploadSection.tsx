import React from 'react';
import { Upload, AlertCircle } from 'lucide-react';

interface CsvUploadSectionProps {
  handleCsvDragOver: (e: React.DragEvent) => void;
  handleCsvDrop: (e: React.DragEvent) => void;
  handleCsvFileUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  targetProjectId: number | null;
  t: (key: string, params?: Record<string, unknown>) => string;
}

export const CsvUploadSection = ({
  handleCsvDragOver,
  handleCsvDrop,
  handleCsvFileUpload,
  targetProjectId,
  t,
}: CsvUploadSectionProps) => {
  return (
    <section className="flex-1 flex flex-col space-y-4 min-h-0">
      <div
        onDragOver={handleCsvDragOver}
        onDrop={handleCsvDrop}
        className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-[var(--border-primary)] rounded-xl p-8 text-center hover:border-[var(--color-primary-500)] hover:bg-[var(--color-primary-500)]/5 transition-all cursor-pointer min-h-[200px]"
      >
        <input
          type="file"
          accept=".csv"
          multiple
          onChange={handleCsvFileUpload}
          className="hidden"
          id="csv-create-upload"
        />
        <label htmlFor="csv-create-upload" className="cursor-pointer flex flex-col items-center">
          <Upload className="w-12 h-12 mb-4 text-[var(--text-tertiary)]" />
          <p className="text-lg font-medium text-[var(--text-primary)] mb-2">
            {t('tables.create.dropCsvHere')}
          </p>
          <p className="text-sm text-[var(--text-secondary)]">
            {t('tables.create.orClickToSelect')}
          </p>
        </label>
      </div>

      <div className="text-sm text-[var(--text-tertiary)] text-center flex-shrink-0">
        {t('tables.create.autoStructure')}
      </div>

      {!targetProjectId && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 flex-shrink-0">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm">{t('tables.create.selectProjectForTable')}</span>
        </div>
      )}
    </section>
  );
};
