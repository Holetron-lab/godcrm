import React from 'react';
import { Loader2 } from 'lucide-react';
import type { CSVFileData } from './types';

interface CsvCreatingSectionProps {
  csvFiles: CSVFileData[];
  t: (key: string, params?: Record<string, unknown>) => string;
}

export const CsvCreatingSection = ({ csvFiles, t }: CsvCreatingSectionProps) => {
  return (
    <section className="flex flex-col items-center justify-center py-12 space-y-4">
      <Loader2 className="w-12 h-12 text-[var(--color-primary-500)] animate-spin" />
      <p className="text-lg font-medium text-[var(--text-primary)]">
        {csvFiles.length > 1 ? t('tables.create.creatingTables').replace('{count}', String(csvFiles.length)) : t('tables.create.creatingTable')}
      </p>
      <p className="text-sm text-[var(--text-secondary)]">
        {t('tables.create.creatingColumnsAndImporting').replace('{count}', String(csvFiles.reduce((sum, f) => sum + Math.max(0, f.data.length - 1), 0)))}
      </p>
    </section>
  );
};
