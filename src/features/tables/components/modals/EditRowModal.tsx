import { useState, useEffect, useMemo } from 'react';
import { Settings2 } from 'lucide-react';
import { Modal, Button, Input } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { FieldRenderer } from './FieldRenderer';
import { FormBuilder, type FormTypeValue } from '../FormBuilder';
import { DynamicFormRenderer } from '../FormBuilder/DynamicFormRenderer';
import { useFormConfig, useSaveFormConfig } from '../../hooks/useFormConfig';
import type { ColumnModel } from '../../types/table.types';
import type { FormConfig } from '../../types/form-config.types';

interface EditRowModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => void;
  columns: ColumnModel[];
  rowData: Record<string, unknown>;
  rowId: string;
  tableId?: string | number;
  tableName?: string;
}

// System columns that shouldn't be edited
const READONLY_COLUMNS = ['id', 'created_at', 'updated_at'];

// Check if column is password type
const isPasswordColumn = (col: ColumnModel) => 
  col.type === 'password' || (col.name || '').toLowerCase().includes('password');

export const EditRowModal = ({ 
  isOpen, 
  onClose, 
  onSave, 
  columns,
  rowData,
  rowId,
  tableId,
  tableName
}: EditRowModalProps) => {
  const { t } = useLanguage();
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [newPassword, setNewPassword] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [showFormBuilder, setShowFormBuilder] = useState(false);

  // Load form config from DB
  const { data: formConfigData } = useFormConfig(tableId || '', 'edit_row');
  const { mutate: saveFormConfig } = useSaveFormConfig();

  // Get the actual config (null if not customized)
  const formConfig = formConfigData?.data?.config || null;

  // Find password column if exists
  const passwordColumn = useMemo(() => 
    columns.find(col => isPasswordColumn(col)), 
    [columns]
  );

  // Initialize form data when modal opens
  useEffect(() => {
    if (isOpen && rowData) {
      const initialData: Record<string, unknown> = {};
      
      columns.forEach(col => {
        // Skip password columns - they're handled separately
        if (isPasswordColumn(col)) return;
        
        // Try to get value by column.id first, then by column.name
        const value = rowData[col.id] ?? rowData[col.name] ?? rowData[col.displayName || ''];
        initialData[col.id] = value;
      });
      
      setFormData(initialData);
      setNewPassword(''); // Reset password field
      setHasChanges(false);
    }
  }, [isOpen, rowData, columns]);

  const handleChange = (fieldKey: string, value: unknown) => {
    setFormData(prev => ({ ...prev, [fieldKey]: value }));
    setHasChanges(true);
  };

  const handlePasswordChange = (value: string) => {
    setNewPassword(value);
    setHasChanges(true);
  };

  const handleSubmit = () => {
    // Build data to submit
    const dataToSubmit: Record<string, unknown> = {};
    
    Object.entries(formData).forEach(([key, value]) => {
      const col = columns.find(c => c.id === key);
      if (!col) return;
      
      const colName = (col.name || '').toLowerCase();
      // Skip readonly columns
      if (READONLY_COLUMNS.includes(colName)) return;
      // Skip password columns - handled separately
      if (isPasswordColumn(col)) return;
      // Skip undefined values
      if (value === undefined) return;
      
      // Include all editable values
      dataToSubmit[key] = value;
    });
    
    // Add password only if a new one was entered
    if (passwordColumn && newPassword.trim()) {
      dataToSubmit[passwordColumn.id] = newPassword;
    }
    
    // Don't close modal here - let parent handle it after successful save
    onSave(dataToSubmit);
  };

  // Filter columns - exclude readonly, password, show visible
  const editableColumns = useMemo(() => columns.filter(col => {
    if (col.isVisible === false) return false;
    const name = (col.name || '').toLowerCase();
    // Don't allow editing system columns, but show ID as readonly
    if (name === 'created_at' || name === 'updated_at') return false;
    // Password is handled separately
    if (isPasswordColumn(col)) return false;
    return true;
  }), [columns]);
  
  // Separate: ID column (readonly), checkbox columns, other columns
  const idColumn = useMemo(() => editableColumns.find(col => 
    (col.name || '').toLowerCase() === 'id'
  ), [editableColumns]);
  
  const checkboxColumns = useMemo(() => 
    editableColumns.filter(col => col.type === 'checkbox' && (col.name || '').toLowerCase() !== 'id'), 
    [editableColumns]
  );
  
  const otherColumns = useMemo(() => 
    editableColumns.filter(col => col.type !== 'checkbox' && (col.name || '').toLowerCase() !== 'id'), 
    [editableColumns]
  );

  // Handle form config save
  const handleSaveFormConfig = (config: FormConfig, formTypes: FormTypeValue[]) => {
    if (tableId) {
      // Use first form type for backward compatibility, but pass all types
      const primaryType = formTypes[0] || 'edit_row';
      saveFormConfig({ tableId, formType: primaryType, formTypes, config });
    }
  };

  // Check if we have a custom form config
  const hasCustomForm = formConfig && formConfig.fields && formConfig.fields.length > 0;

  // Map FormConfig modalSize to Modal size prop
  const getModalSize = (): 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full' => {
    if (!hasCustomForm) return 'md';
    const configSize = formConfig?.settings?.modalSize;
    if (configSize && ['sm', 'md', 'lg', 'xl', '2xl', 'full'].includes(configSize)) {
      return configSize as 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
    }
    return 'lg';
  };

  return (
    <>
      <Modal 
        open={isOpen} 
        onOpenChange={(open) => !open && onClose()} 
        title={t('rowActions.editRow') || 'Редактировать строку'}
        size={getModalSize()}
      >
        <div className="flex flex-col" style={{ height: 'calc(70vh - 80px)', maxHeight: '600px' }}>
          <p className="text-sm text-[var(--text-secondary)] mb-4 flex-shrink-0">
            {t('rowActions.editRowDescription') || 'Измените данные строки и нажмите "Сохранить".'}
          </p>
          
          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto min-h-0 pr-2">
            {/* Custom Form (from FormBuilder) */}
            {hasCustomForm ? (
              <DynamicFormRenderer
                config={formConfig}
                columns={columns}
                formData={formData}
                onChange={(fieldId, value) => handleChange(fieldId, value)}
                mode="edit"
              />
            ) : (
              <>
                {/* ID field - readonly */}
                {idColumn && (
                  <div className="space-y-1 mb-3">
                    <label className="block text-sm font-medium text-[var(--text-primary)]">
                      {idColumn.displayName || idColumn.name}
                    </label>
                    <div className="px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">
                      {String(formData[idColumn.id] || rowId)}
                    </div>
                  </div>
                )}
                
                {/* Editable fields */}
                <div className="space-y-3">
                  {otherColumns.map(column => {
                    const value = formData[column.id];
                    const isReadonly = column.isReadonly || (column as any).is_external;
                    
                    return (
                      <FieldRenderer
                        key={column.id}
                        column={column}
                        value={value}
                        onChange={(newValue) => handleChange(column.id, newValue)}
                        disabled={isReadonly}
                      />
                    );
                  })}
                </div>

                {/* Checkboxes in one row */}
                {checkboxColumns.length > 0 && (
                  <div className="flex flex-wrap gap-4 pt-2">
                    {checkboxColumns.map(column => {
                      const value = formData[column.id];
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
              </>
            )}

            {/* Password field - separate, empty by default (only when NOT using custom form) */}
            {passwordColumn && !hasCustomForm && (
              <div className="space-y-1 pt-2">
                <label className="block text-sm font-medium text-[var(--text-primary)]">
                  {passwordColumn.displayName || passwordColumn.name || 'Пароль'}
                </label>
                <FieldRenderer
                  column={passwordColumn}
                  value={newPassword}
                  onChange={(val) => handlePasswordChange(String(val))}
                />
                <p className="text-xs text-[var(--text-tertiary)]">
                  Введите новый пароль для изменения или оставьте пустым
                </p>
              </div>
            )}

            {editableColumns.length === 0 && !passwordColumn && (
              <p className="text-center text-[var(--text-tertiary)] py-8">
                Нет доступных полей для редактирования
              </p>
            )}
          </div>

          {/* Fixed footer with buttons */}
          <div className="flex justify-between items-center pt-4 mt-4 border-t border-[var(--border-primary)] flex-shrink-0">
            {/* Edit Form Button (left) */}
            {tableId && (
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => setShowFormBuilder(true)}
                className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              >
                <Settings2 className="w-4 h-4 mr-1.5" />
                Редактировать форму
              </Button>
            )}
            {!tableId && <div />}

            {/* Save/Cancel buttons (right) */}
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose}>
                {t('common.cancel') || 'Отмена'}
              </Button>
              <Button 
                variant="primary" 
                onClick={handleSubmit}
                disabled={!hasChanges}
              >
                {t('common.save') || 'Сохранить'}
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Form Builder Modal */}
      {showFormBuilder && tableId && (
        <FormBuilder
          isOpen={showFormBuilder}
          onClose={() => setShowFormBuilder(false)}
          onSave={handleSaveFormConfig}
          columns={columns}
          initialConfig={formConfig}
          initialFormType="edit_row"
          tableName={tableName}
          tableId={typeof tableId === 'string' ? parseInt(tableId) : tableId}
          sampleData={rowData}
        />
      )}
    </>
  );
};
