import { useState, useEffect, useMemo } from 'react';
import { Settings2 } from 'lucide-react';
import { Modal, Button } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { FieldRenderer } from './FieldRenderer';
import { FormBuilder, type FormTypeValue } from '../FormBuilder';
import { DynamicFormRenderer } from '../FormBuilder/DynamicFormRenderer';
import { useFormConfig, useSaveFormConfig } from '../../hooks/useFormConfig';
import type { ColumnModel } from '../../types/table.types';
import type { FormConfig } from '../../types/form-config.types';

interface AddRowModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (data: Record<string, unknown>) => void;
  columns: ColumnModel[];
  prefilledData?: Record<string, unknown>;
  existingIds?: string[];
  tableId?: string | number;
  tableName?: string;
}

// System columns that shouldn't be shown in add form
const HIDDEN_COLUMNS = ['created_at', 'updated_at'];

export const AddRowModal = ({ 
  isOpen, 
  onClose, 
  onConfirm, 
  columns,
  prefilledData,
  existingIds = [],
  tableId,
  tableName
}: AddRowModalProps) => {
  const { t } = useLanguage();
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [initialized, setInitialized] = useState(false);
  const [showFormBuilder, setShowFormBuilder] = useState(false);

  // Load form config from DB
  const { data: formConfigData } = useFormConfig(tableId || '', 'add_row');
  const { mutate: saveFormConfig } = useSaveFormConfig();

  // Get the actual config (null if not customized)
  const formConfig = formConfigData?.data?.config || null;

  // Map prefilled keys (column.id or column.name) → column.id so we can
  // force-show fields hidden in form config when the caller pre-set their value.
  const prefilledColumnIds = useMemo(() => {
    const ids = new Set<string>();
    if (!prefilledData) return ids;
    for (const col of columns) {
      if (prefilledData[col.id] !== undefined || prefilledData[col.name] !== undefined) {
        ids.add(col.id);
      }
    }
    return ids;
  }, [columns, prefilledData]);

  // Initialize form data when modal opens AND columns are loaded
  useEffect(() => {
    if (isOpen && columns.length > 0 && !initialized) {
      const initialData: Record<string, unknown> = {};
      columns.forEach(col => {
        const fieldKey = col.id; // Use column ID for consistency
        // Skip ID - it's auto-generated
        if ((col.name || '').toLowerCase() === 'id') return;
        
        // Use prefilled data if available
        if (prefilledData && (prefilledData[fieldKey] !== undefined || prefilledData[col.name] !== undefined)) {
          initialData[fieldKey] = prefilledData[fieldKey] ?? prefilledData[col.name];
        } else if (col.defaultValue !== undefined) {
          initialData[fieldKey] = col.defaultValue;
        } else if (col.type === 'checkbox') {
          initialData[fieldKey] = false;
        } else if (col.type === 'multi-select') {
          initialData[fieldKey] = [];
        } else {
          initialData[fieldKey] = '';
        }
      });
      setFormData(initialData);
      setInitialized(true);
    }
    
    // Reset initialized flag when modal closes
    if (!isOpen) {
      setInitialized(false);
    }
  }, [isOpen, columns, existingIds, prefilledData, initialized]);

  const handleChange = (fieldKey: string, value: unknown) => {
    setFormData(prev => ({ ...prev, [fieldKey]: value }));
  };

  // Check if all required fields (like password) are filled.
  // Only validate columns actually shown in the form — hidden required columns
  // (e.g. backend-defaulted `state` on Tickets) must not block submission.
  const hasEmptyRequiredFields = useMemo(() => {
    const customFields = formConfig?.fields;
    const useCustomForm = !!(customFields && customFields.length > 0);

    let columnsToValidate: ColumnModel[];
    if (useCustomForm) {
      const visibleColumnIds = new Set(
        customFields!
          .filter(f => !f.hidden || prefilledColumnIds.has(f.columnId))
          .map(f => f.columnId)
      );
      columnsToValidate = columns.filter(col => visibleColumnIds.has(col.id));
    } else {
      columnsToValidate = columns.filter(col => {
        const name = (col.name || '').toLowerCase();
        return col.isVisible !== false && !HIDDEN_COLUMNS.includes(name) && name !== 'id';
      });
    }

    const isEmpty = (v: unknown) =>
      v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

    return columnsToValidate.some(col => {
      const fieldKey = col.id;
      // Password is always required for new rows
      if (col.type === 'password' && isEmpty(formData[fieldKey])) return true;
      // Other required fields
      if (col.isRequired && isEmpty(formData[fieldKey])) return true;
      return false;
    });
  }, [columns, formData, formConfig, prefilledColumnIds]);

  const handleSubmit = () => {
    if (hasEmptyRequiredFields) return;
    
    // Filter out empty values and system columns, but keep required fields
    const dataToSubmit: Record<string, unknown> = {};
    
    Object.entries(formData).forEach(([key, value]) => {
      const column = columns.find(c => c.id === key);
      if (!column) return;
      
      const colName = (column.name || '').toLowerCase();
      if (HIDDEN_COLUMNS.includes(colName)) return;
      if (colName === 'id') return;
      
      if (value !== null && value !== undefined) {
        // Keep even empty strings for password fields so backend validates
        if (column.type === 'password' || value !== '') {
          // Use column name as key for API
          dataToSubmit[column.name || key] = value;
        }
      }
    });
    
    // Don't close here - let parent close after successful save
    onConfirm(dataToSubmit);
  };

  // Filter columns to show (exclude system columns and ID)
  const editableColumns = useMemo(() => columns.filter(col => {
    const name = (col.name || '').toLowerCase();
    return col.isVisible !== false && !HIDDEN_COLUMNS.includes(name) && name !== 'id';
  }), [columns]);
  
  // Separate checkbox columns from other columns  
  const checkboxColumns = useMemo(() => editableColumns.filter(col => col.type === 'checkbox'), [editableColumns]);
  const otherColumns = useMemo(() => editableColumns.filter(col => col.type !== 'checkbox'), [editableColumns]);

  // Handle form config save
  const handleSaveFormConfig = (config: FormConfig, formTypes: FormTypeValue[]) => {
    if (tableId) {
      // Use first form type for backward compatibility, but pass all types
      const primaryType = formTypes[0] || 'add_row';
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
        title={tableName ? `${t('rowActions.addRow') || 'Добавить строку'} → ${tableName}` : (t('rowActions.addRow') || 'Добавить строку')}
        size={getModalSize()}
      >
        <div className="flex flex-col" style={{ height: 'calc(70vh - 80px)', maxHeight: '600px' }}>
          <p className="text-sm text-[var(--text-secondary)] mb-4 flex-shrink-0">
            {t('rowActions.addRowDescription') || 'Заполните поля ниже, чтобы создать новую строку.'}
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
                mode="add"
                prefilledColumnIds={prefilledColumnIds}
              />
            ) : (
              <>
                {/* Regular fields */}
                <div className="space-y-4">
                  {otherColumns.map(column => {
                    const value = formData[column.id];
                    
                    return (
                      <div key={column.id}>
                        <label className="mb-1.5 block text-sm font-medium text-[var(--text-primary)]">
                          {column.displayName || column.name}
                          {column.isRequired && <span className="ml-1 text-red-500">*</span>}
                        </label>
                        <FieldRenderer
                          column={column}
                          value={value}
                          onChange={(newValue) => handleChange(column.id, newValue)}
                          showLabel={false}
                        />
                      </div>
                    );
                  })}
                </div>

                {/* Checkboxes section */}
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

            {editableColumns.length === 0 && (
              <p className="text-center text-[var(--text-tertiary)] py-8">
                Нет доступных полей для заполнения
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
                disabled={hasEmptyRequiredFields}
              >
                {t('rowActions.addRow') || 'Добавить строку'}
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
          initialFormType="add_row"
          tableName={tableName}
          tableId={typeof tableId === 'string' ? parseInt(tableId) : tableId}
          sampleData={prefilledData || {}}
        />
      )}
    </>
  );
};
