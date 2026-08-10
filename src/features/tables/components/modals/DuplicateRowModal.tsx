import { useState, useEffect, useMemo } from 'react';
import { Modal, Button } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { FieldRenderer } from './FieldRenderer';
import type { ColumnModel } from '../../types/table.types';

interface DuplicateRowModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (data: Record<string, unknown>) => void;
  rowData: Record<string, unknown>;
  columns: ColumnModel[];
  existingIds: string[];
}

// System columns that are auto-generated
const AUTO_GENERATED_COLUMNS = ['created_at', 'updated_at'];

// Sensitive columns that should not be copied when duplicating
const SENSITIVE_COLUMNS = ['password'];

export const DuplicateRowModal = ({ 
  isOpen, 
  onClose, 
  onConfirm, 
  rowData,
  columns,
  existingIds 
}: DuplicateRowModalProps) => {
  const { t } = useLanguage();
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [initialized, setInitialized] = useState(false);

  // Initialize form data when modal opens AND columns are loaded
  useEffect(() => {
    if (isOpen && columns.length > 0 && rowData && !initialized) {
      // Copy all data except auto-generated and sensitive columns
      const initialData: Record<string, unknown> = {};
      columns.forEach(col => {
        const fieldKey = col.name || col.id;
        if (!AUTO_GENERATED_COLUMNS.includes(fieldKey)) {
          // Don't copy sensitive columns - they must be filled manually
          if (SENSITIVE_COLUMNS.includes(fieldKey) || col.type === 'password') {
            initialData[fieldKey] = '';
          } else {
            initialData[fieldKey] = rowData[fieldKey] ?? '';
          }
        }
      });
      setFormData(initialData);
      setInitialized(true);
    }
    
    // Reset initialized flag when modal closes
    if (!isOpen) {
      setInitialized(false);
    }
  }, [isOpen, columns, rowData, existingIds]);

  const handleChange = (fieldKey: string, value: unknown) => {
    setFormData(prev => ({ ...prev, [fieldKey]: value }));
  };
  
  // Check if all required passwords are filled
  const hasEmptyPassword = useMemo(() => {
    return columns.some(col => {
      const fieldKey = col.name || col.id;
      return col.type === 'password' && !formData[fieldKey];
    });
  }, [columns, formData]);

  const handleSubmit = () => {
    if (hasEmptyPassword) return;
    
    // Submit data without ID - let backend auto-generate
    onConfirm(formData);
    onClose();
  };

  // Filter columns to show (exclude auto-generated and id)
  const visibleColumns = useMemo(() => columns.filter(col => {
    const name = col.name || '';
    return col.isVisible !== false && !AUTO_GENERATED_COLUMNS.includes(name) && name !== 'id';
  }), [columns]);

  // Separate checkbox columns from other columns
  const checkboxColumns = useMemo(() => visibleColumns.filter(col => col.type === 'checkbox'), [visibleColumns]);
  const otherColumns = useMemo(() => visibleColumns.filter(col => col.type !== 'checkbox'), [visibleColumns]);

  return (
    <Modal 
      open={isOpen} 
      onOpenChange={(open) => !open && onClose()} 
      title={t('rowActions.duplicateModalTitle') || 'Дублирование строки'}
      size="lg"
    >
      <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
        <p className="text-sm text-[var(--text-secondary)]">
          Все поля заполнены значениями из оригинальной строки. Измените данные при необходимости.
        </p>

        {/* Other fields (non-checkbox) */}
        <div className="space-y-4">
          {otherColumns.map(column => {
            const fieldKey = column.name || column.id;
            const value = formData[fieldKey];
            const isPasswordEmpty = column.type === 'password' && !value;
            
            return (
              <div key={column.id}>
                <label className="mb-1.5 block text-sm font-medium text-[var(--text-primary)]">
                  {column.displayName || column.name}
                  {(column.isRequired || column.type === 'password') && <span className="ml-1 text-red-500">*</span>}
                </label>
                <FieldRenderer
                  column={column}
                  value={value}
                  onChange={(newValue) => handleChange(fieldKey, newValue)}
                  showLabel={false}
                  highlighted={isPasswordEmpty}
                />
                {isPasswordEmpty && (
                  <p className="mt-1 text-xs text-amber-500">
                    Пароль необходимо задать заново
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Checkboxes in one row */}
        {checkboxColumns.length > 0 && (
          <div className="flex flex-wrap gap-4 pt-2">
            {checkboxColumns.map(column => {
              const fieldKey = column.name || column.id;
              const value = formData[fieldKey];
              return (
                <FieldRenderer
                  key={column.id}
                  column={column}
                  value={value}
                  onChange={(val) => handleChange(fieldKey, val)}
                />
              );
            })}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-4 border-t border-[var(--border-primary)]">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel') || 'Отмена'}
          </Button>
          <Button 
            variant="primary" 
            onClick={handleSubmit}
            disabled={hasEmptyPassword}
          >
            {t('rowActions.duplicateRow') || 'Создать дубликат'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
