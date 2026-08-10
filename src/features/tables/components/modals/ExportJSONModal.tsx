import { Modal, Button } from '@/shared/components/ui';
import { logger } from '@/shared/utils/logger';
import { Download, FileJson2, AlertTriangle, Check, Shield, FileCode } from 'lucide-react';
import { useState, useMemo } from 'react';
import { cn } from '@/shared/utils/cn';
import { useQuery } from '@tanstack/react-query';

export type ExportMode = 'full' | 'schema_only' | 'sanitized';

interface ExportJSONModalProps {
  isOpen: boolean;
  onClose: () => void;
  tableId: string;
  tableName: string;
  rowsCount: number;
}

export const ExportJSONModal = ({
  isOpen,
  onClose,
  tableId,
  tableName,
  rowsCount,
}: ExportJSONModalProps) => {
  const [mode, setMode] = useState<ExportMode>('full');
  const [isExporting, setIsExporting] = useState(false);

  // Fetch sensitive columns info
  const { data: sensitiveInfo, isLoading: sensitiveLoading } = useQuery({
    queryKey: ['sensitiveColumns', tableId],
    queryFn: async () => {
      const res = await fetch(`/api/v3/tables/${tableId}/sensitive-columns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch sensitive columns');
      const json = await res.json();
      return json.data as { 
        sensitiveColumns: string[]; 
        hasCredentials: boolean;
        recommendation: string;
      };
    },
    enabled: isOpen && !!tableId,
  });

  const hasSensitiveData = sensitiveInfo?.sensitiveColumns && sensitiveInfo.sensitiveColumns.length > 0;

  // Mode options
  const modeOptions = useMemo(() => [
    { 
      value: 'full' as ExportMode, 
      label: 'Полный экспорт', 
      description: 'Все данные включая конфиденциальные',
      icon: FileJson2,
      color: 'text-green-500',
      warning: hasSensitiveData,
    },
    { 
      value: 'sanitized' as ExportMode, 
      label: 'Без паролей/токенов', 
      description: 'Скрывает конфиденциальные поля',
      icon: Shield,
      color: 'text-blue-500',
      warning: false,
    },
    { 
      value: 'schema_only' as ExportMode, 
      label: 'Только схема', 
      description: 'Структура таблицы без данных',
      icon: FileCode,
      color: 'text-purple-500',
      warning: false,
    },
  ], [hasSensitiveData]);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const res = await fetch(`/api/v3/tables/${tableId}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ mode }),
      });
      
      if (!res.ok) {
        throw new Error('Export failed');
      }
      
      const data = await res.json();
      
      // Create filename
      const date = new Date().toISOString().slice(0, 10);
      const modeSuffix = mode === 'full' ? '' : `_${mode}`;
      const filename = `${tableName}${modeSuffix}_${date}.json`;
      
      // Download as JSON file
      const blob = new Blob([JSON.stringify(data.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      onClose();
    } catch (error) {
      logger.error('Export failed:', error);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Modal 
      open={isOpen} 
      onOpenChange={(open) => !open && onClose()} 
      title="Экспорт в JSON"
      size="md"
    >
      <div className="space-y-6">
        {/* Table info */}
        <div className="flex items-center gap-3 p-3 bg-[var(--bg-secondary)] rounded-lg">
          <FileJson2 className="w-8 h-8 text-[var(--color-primary-500)]" />
          <div>
            <div className="font-medium text-[var(--text-primary)]">{tableName}</div>
            <div className="text-sm text-[var(--text-tertiary)]">{rowsCount} строк</div>
          </div>
        </div>

        {/* Sensitive data warning */}
        {hasSensitiveData && (
          <div className="flex items-start gap-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-amber-600 dark:text-amber-400">
                Обнаружены конфиденциальные данные
              </div>
              <div className="text-sm text-[var(--text-secondary)] mt-1">
                Колонки: {sensitiveInfo!.sensitiveColumns.join(', ')}
              </div>
              <div className="text-sm text-[var(--text-tertiary)] mt-1">
                {sensitiveInfo!.recommendation}
              </div>
            </div>
          </div>
        )}

        {/* Mode selector */}
        <div>
          <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
            Режим экспорта:
          </label>
          <div className="space-y-2">
            {modeOptions.map(option => {
              const Icon = option.icon;
              return (
                <label 
                  key={option.value} 
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-lg cursor-pointer transition border",
                    mode === option.value 
                      ? "bg-[var(--color-primary-500)]/10 border-[var(--color-primary-500)]/30"
                      : "hover:bg-[var(--bg-tertiary)] border-transparent"
                  )}
                >
                  <input
                    type="radio"
                    name="exportMode"
                    value={option.value}
                    checked={mode === option.value}
                    onChange={() => setMode(option.value)}
                    className="w-4 h-4 text-[var(--color-primary-500)]"
                  />
                  <Icon className={cn("w-5 h-5", option.color)} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-[var(--text-primary)]">{option.label}</span>
                      {option.warning && (
                        <AlertTriangle className="w-4 h-4 text-amber-500" />
                      )}
                    </div>
                    <span className="block text-xs text-[var(--text-tertiary)]">
                      {option.description}
                    </span>
                  </div>
                  {mode === option.value && (
                    <Check className="w-5 h-5 text-[var(--color-primary-500)]" />
                  )}
                </label>
              );
            })}
          </div>
        </div>

        <hr className="border-[var(--border-primary)]" />

        {/* Footer with buttons */}
        <div className="flex justify-end gap-3">
          <Button
            onClick={onClose}
            variant="secondary"
          >
            Отмена
          </Button>
          <Button
            onClick={handleExport}
            variant="primary"
            className="gap-2"
            disabled={isExporting || sensitiveLoading}
          >
            <Download className="w-4 h-4" />
            {isExporting ? 'Экспорт...' : 'Экспортировать'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default ExportJSONModal;
