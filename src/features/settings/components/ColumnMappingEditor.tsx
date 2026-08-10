/**
 * ColumnMappingEditor - UI for mapping table columns to standard fields
 * Used in table settings to configure how columns map to common fields
 */
import React, { useState, useEffect } from 'react';
import { 
  useColumnMapping, 
  useColumnMappingDefaults, 
  useSaveColumnMapping 
} from '../hooks/useColumnMapping';
import { Button } from '@/shared/components/ui/Button';
import { Select, SelectOption } from '@/shared/components/ui/Select';
import { Loader2, Save, RotateCcw } from 'lucide-react';
import { logger } from '@/shared/utils/logger';

export interface ColumnMappingEditorProps {
  tableId: number;
  columns: Array<{ name: string; label?: string }>;
  onSave?: () => void;
  className?: string;
}

export function ColumnMappingEditor({
  tableId,
  columns,
  onSave,
  className = '',
}: ColumnMappingEditorProps) {
  const [localMappings, setLocalMappings] = useState<Record<string, string>>({});
  
  const { data: defaults, isLoading: isLoadingDefaults } = useColumnMappingDefaults();
  const { data: currentMapping, isLoading: isLoadingMapping } = useColumnMapping(tableId);
  const { mutate: saveMapping, isPending: isSaving } = useSaveColumnMapping(tableId);

  // Initialize local mappings when data loads
  useEffect(() => {
    if (currentMapping?.mappings) {
      setLocalMappings(currentMapping.mappings);
    }
  }, [currentMapping]);

  const handleMappingChange = (standardField: string, columnName: string) => {
    setLocalMappings(prev => ({
      ...prev,
      [standardField]: columnName === '__none__' ? '' : columnName,
    }));
  };

  const handleSave = () => {
    saveMapping(localMappings, {
      onSuccess: () => {
        logger.debug('Column mapping saved successfully');
        onSave?.();
      },
    });
  };

  const handleReset = () => {
    if (currentMapping?.mappings) {
      setLocalMappings(currentMapping.mappings);
    }
  };

  // Build select options from columns
  const columnOptions: SelectOption[] = [
    { value: '__none__', label: '— Не задано —' },
    ...columns.map(col => ({
      value: col.name,
      label: col.label || col.name,
    })),
  ];

  if (isLoadingDefaults || isLoadingMapping) {
    return (
      <div className={`flex items-center justify-center py-8 ${className}`}>
        <Loader2 className="w-6 h-6 animate-spin text-[var(--text-tertiary)]" />
      </div>
    );
  }

  if (!defaults) {
    return (
      <div className={`text-center py-8 text-[var(--text-tertiary)] ${className}`}>
        Не удалось загрузить настройки
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      <div className="space-y-4">
        {defaults.standardFields.map((field) => (
          <div 
            key={field.key}
            className="flex items-center gap-4"
          >
            <label className="w-40 text-sm text-[var(--text-primary)]">
              {field.label}
              {field.required && <span className="text-red-500 ml-1">*</span>}
            </label>
            
            <div className="w-64">
              <Select
                value={localMappings[field.key] || '__none__'}
                onChange={(value) => handleMappingChange(field.key, value)}
                options={columnOptions}
                placeholder="Выберите колонку"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 pt-4 border-t border-[var(--border-primary)]">
        <Button
          onClick={handleSave}
          disabled={isSaving}
          loading={isSaving}
          leftIcon={!isSaving ? <Save className="w-4 h-4" /> : undefined}
        >
          Сохранить
        </Button>
        
        <Button
          variant="secondary"
          onClick={handleReset}
          disabled={isSaving}
          leftIcon={<RotateCcw className="w-4 h-4" />}
        >
          Сбросить
        </Button>
      </div>
    </div>
  );
}
