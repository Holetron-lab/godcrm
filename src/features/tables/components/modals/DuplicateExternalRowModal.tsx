import { useState, useEffect, useMemo } from 'react';
import { Modal, Button, Input } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { ColumnModel } from '../../types/table.types';
import { FieldRenderer } from './FieldRenderer';

interface DuplicateExternalRowModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (data: Record<string, unknown>) => void;
  rowData: Record<string, unknown>;
  columns: ColumnModel[];
  idColumn: string;
  existingIds: (string | number)[];
}

export const DuplicateExternalRowModal = ({ 
  isOpen, 
  onClose, 
  onConfirm, 
  rowData,
  columns,
  idColumn,
  existingIds 
}: DuplicateExternalRowModalProps) => {
  const { t } = useLanguage();
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [password, setPassword] = useState('');
  
  // Check if this is users table (has password column)
  const hasPasswordColumn = useMemo(() => 
    columns.some(col => col.type === 'password' || col.name?.toLowerCase().includes('password')),
    [columns]
  );

  // Initialize form data when modal opens
  useEffect(() => {
    if (!isOpen) return;
    
    // Normalize data: copy all rowData values and map them to column IDs
    const initialData: Record<string, unknown> = {};
    
    // First, copy all raw rowData
    if (rowData) {
      Object.entries(rowData).forEach(([key, value]) => {
        initialData[key] = value;
      });
    }
    
    // Also map by column id if data exists by column name
    columns.forEach(col => {
      // Skip password and ID - password entered manually, ID auto-generated
      if (col.type === 'password' || col.name?.toLowerCase().includes('password')) {
        return;
      }
      if (col.name?.toLowerCase() === 'id') {
        return; // Skip ID - will be auto-generated on backend
      }
      
      if (rowData) {
        // Check multiple possible keys where data might be stored
        const valueById = rowData[col.id];
        const valueByName = rowData[col.name];
        const valueByDisplayName = rowData[col.displayName || ''];
        
        const value = valueById ?? valueByName ?? valueByDisplayName;
        if (value !== undefined) {
          initialData[col.id] = value;
        }
      }
    });
    
    // Remove ID from data - it will be auto-generated
    delete initialData['id'];
    delete initialData[idColumn];
    const idCol = columns.find(c => c.name?.toLowerCase() === 'id');
    if (idCol) {
      delete initialData[idCol.id];
    }
    
    setFormData(initialData);
    setPassword(''); // Reset password field
  }, [isOpen, rowData, idColumn, columns]);

  const handleChange = (columnId: string, value: unknown) => {
    setFormData(prev => ({ ...prev, [columnId]: value }));
  };

  const handleSubmit = () => {
    const dataToSubmit = { ...formData };
    // Remove undefined values
    Object.keys(dataToSubmit).forEach(key => {
      if (dataToSubmit[key] === undefined) {
        delete dataToSubmit[key];
      }
    });
    // Add password if present
    if (hasPasswordColumn && password) {
      const passwordCol = columns.find(col => col.type === 'password' || col.name?.toLowerCase().includes('password'));
      if (passwordCol) {
        dataToSubmit[passwordCol.id] = password;
        dataToSubmit[passwordCol.name] = password;
      }
    }
    // Don't close here - let parent close after successful save
    onConfirm(dataToSubmit);
  };

  const renderField = (column: ColumnModel) => {
    // Try to get value by column.id first, then by column.name (for compatibility)
    const value = formData[column.id] ?? formData[column.name] ?? formData[column.displayName || ''];
    const fieldKey = column.id; // Always use column.id for storing data
    
    // All fields use FieldRenderer
    return (
      <FieldRenderer
        key={column.id}
        column={column}
        value={value}
        onChange={(val) => handleChange(fieldKey, val)}
      />
    );
  };

  // Filter columns - show visible columns, exclude readonly, password and ID
  const editableColumns = columns.filter(col => {
    if (col.isVisible === false) return false;
    const lowerName = (col.name || '').toLowerCase();
    if (lowerName === 'id') return false; // ID is auto-generated
    if (lowerName === 'created_at' || lowerName === 'updated_at') return false;
    if (col.type === 'password' || lowerName.includes('password')) return false; // Password handled separately
    return true;
  });

  // Separate checkbox columns from other columns
  const checkboxColumns = editableColumns.filter(col => col.type === 'checkbox');
  const otherColumns = editableColumns.filter(col => col.type !== 'checkbox');

  return (
    <Modal 
      open={isOpen} 
      onOpenChange={(open) => !open && onClose()} 
      title={t('rowActions.duplicateModalTitle') || 'Дублировать строку'}
    >
      <div className="space-y-4 max-h-[60vh] overflow-y-auto">
        <p className="text-sm text-[var(--text-secondary)]">
          Все поля заполнены значениями из оригинальной строки. ID будет создан автоматически.
        </p>
        
        <div className="space-y-3">
          {otherColumns.map(column => renderField(column))}
        </div>

        {/* Checkboxes in one row */}
        {checkboxColumns.length > 0 && (
          <div className="flex flex-wrap gap-4 pt-2">
            {checkboxColumns.map(column => {
              const value = formData[column.id] ?? formData[column.name];
              return (
                <FieldRenderer
                  key={column.id}
                  column={column}
                  value={value}
                  onChange={(val) => handleChange(column.id, val)}
                />
              );
            })}
          </div>
        )}

        {/* Password field for users table */}
        {hasPasswordColumn && (
          <div className="space-y-1 pt-2">
            <label className="block text-sm font-medium text-[var(--text-primary)]">
              Пароль <span className="text-red-500">*</span>
            </label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Введите пароль для нового пользователя"
            />
            <p className="text-xs text-[var(--text-tertiary)]">
              Пароль не копируется — введите новый пароль для дублируемого пользователя
            </p>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-4 border-t border-[var(--border-primary)]">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel') || 'Отмена'}
          </Button>
          <Button 
            variant="primary" 
            onClick={handleSubmit}
            disabled={hasPasswordColumn && !password}
          >
            {t('rowActions.createDuplicate') || 'Создать дубликат'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
