/**
 * ADR-025: CSV Import Component
 * Drag-and-drop file upload for Hevy/Strong exports
 */

import { useCallback, useState, DragEvent, ChangeEvent } from 'react';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/shared/components/ui/Button';
import { useImportCSV } from '../api/fitnessApi';
import type { CSVImportResult } from '../types';

export interface CSVImportProps {
  spaceId: number;
  onSuccess?: (result: CSVImportResult) => void;
  onError?: (error: Error) => void;
  className?: string;
}

export function CSVImport({ spaceId, onSuccess, onError, className }: CSVImportProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [result, setResult] = useState<CSVImportResult | null>(null);
  const importMutation = useImportCSV();

  const handleFile = useCallback(async (file: File) => {
    try {
      const importResult = await importMutation.mutateAsync({ spaceId, file });
      setResult(importResult);
      onSuccess?.(importResult);
    } catch (err) {
      onError?.(err as Error);
    }
  }, [spaceId, importMutation, onSuccess, onError]);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].name.endsWith('.csv')) {
      handleFile(files[0]);
    }
  }, [handleFile]);

  const handleInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFile(files[0]);
    }
    // Reset input
    e.target.value = '';
  }, [handleFile]);

  return (
    <div className={cn('rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6', className)}>
      <h3 className="mb-2 font-semibold text-[var(--text-primary)]">Импорт тренировок</h3>
      <p className="mb-4 text-sm text-[var(--text-secondary)]">
        Загрузите CSV-экспорт из Hevy, Strong или другого фитнес-приложения
      </p>

      {/* Drop zone */}
      <label
        className={cn(
          'flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors cursor-pointer',
          isDragging 
            ? 'border-[var(--color-primary-500)] bg-[var(--color-primary-500)]/5' 
            : 'border-[var(--border-primary)] hover:border-[var(--text-muted)]'
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleInputChange}
          disabled={importMutation.isPending}
        />
        
        {importMutation.isPending ? (
          <>
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--text-muted)] border-t-[var(--color-primary-500)]" />
            <p className="mt-2 text-sm text-[var(--text-secondary)]">Импортируем...</p>
          </>
        ) : (
          <>
            <svg className="h-10 w-10 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} 
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" 
              />
            </svg>
            <p className="mt-2 text-sm text-[var(--text-primary)]">
              Перетащите CSV сюда или <span className="text-[var(--color-primary-500)]">выберите файл</span>
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Поддерживаются форматы: Hevy, Strong
            </p>
          </>
        )}
      </label>

      {/* Success result */}
      {result && (
        <div className="mt-4 rounded-lg bg-green-500/10 p-4 text-sm">
          <p className="font-medium text-green-600">✅ Импорт завершён!</p>
          <ul className="mt-2 space-y-1 text-[var(--text-secondary)]">
            <li>Формат: <span className="font-medium">{result.format_detected}</span></li>
            <li>Тренировок: <span className="font-medium">{result.workouts_created}</span></li>
            <li>Подходов: <span className="font-medium">{result.sets_created}</span></li>
            {result.rows_skipped > 0 && (
              <li className="text-yellow-600">Пропущено строк: {result.rows_skipped}</li>
            )}
          </ul>
        </div>
      )}

      {/* Error */}
      {importMutation.isError && (
        <div className="mt-4 rounded-lg bg-red-500/10 p-4 text-sm">
          <p className="font-medium text-red-600">❌ Ошибка импорта</p>
          <p className="mt-1 text-[var(--text-secondary)]">
            {importMutation.error?.message || 'Неизвестная ошибка'}
          </p>
        </div>
      )}
    </div>
  );
}
