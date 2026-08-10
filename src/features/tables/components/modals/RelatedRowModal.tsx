import { useState, useEffect, useMemo } from 'react';
import { logger } from '@/shared/utils/logger';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal, Button, Input } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { FieldRenderer } from './FieldRenderer';
import { FormBuilder, type FormTypeValue } from '../FormBuilder';
import { DynamicFormRenderer } from '../FormBuilder/DynamicFormRenderer';
import { useFormConfig, useSaveFormConfig } from '../../hooks/useFormConfig';
import { apiClient } from '@/shared/utils/apiClient';
import { tablesApi } from '../../api/tablesApi';
import type { ColumnModel } from '../../types/table.types';
import type { FormConfig } from '../../types/form-config.types';
import { Loader2, Settings2 } from 'lucide-react';

interface RelatedRowModalProps {
  isOpen: boolean;
  onClose: () => void;
  tableId: string;
  rowId: string;  // This can be actual row ID or a value to search for
  valueColumn?: string;  // Column to search by if rowId is a value
}

// System columns that shouldn't be edited
const READONLY_COLUMNS = ['id', 'created_at', 'updated_at'];

// Check if column is password type
const isPasswordColumn = (col: ColumnModel) => 
  col.type === 'password' || (col.name || '').toLowerCase().includes('password');

export const RelatedRowModal = ({ 
  isOpen, 
  onClose, 
  tableId,
  rowId,
  valueColumn
}: RelatedRowModalProps) => {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [newPassword, setNewPassword] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [actualRowId, setActualRowId] = useState<string>('');
  const [showFormBuilder, setShowFormBuilder] = useState(false);

  // Load form config from DB
  const { data: formConfigData } = useFormConfig(tableId || '', 'edit_row');
  const { mutate: saveFormConfig } = useSaveFormConfig();

  // Get the actual config (null if not customized)
  const formConfig = formConfigData?.data?.config || null;

  // Load table info
  const { data: tableInfo, isLoading: isLoadingTableInfo } = useQuery({
    queryKey: ['related-table-info', tableId],
    queryFn: async () => {
      const response = await apiClient.request<{ success: boolean; data: { id: number; name: string; description?: string } }>(
        `/tables/${tableId}`
      );
      return response.data;
    },
    enabled: isOpen && !!tableId,
  });

  // Load columns separately
  const { data: columnsData, isLoading: isLoadingColumns } = useQuery({
    queryKey: ['related-table-columns', tableId],
    queryFn: async () => {
      const response = await apiClient.request<{ data: ColumnModel[] }>(
        `/tables/${tableId}/columns`
      );
      return response.data;
    },
    enabled: isOpen && !!tableId,
  });

  // Load row data
  const { data: rowData, isLoading: isLoadingRow, error: rowError } = useQuery({
    queryKey: ['related-row', tableId, rowId, valueColumn],
    queryFn: async () => {
      const response = await apiClient.request<{ 
        data: { rows: Array<{ id: string; data: Record<string, unknown>; originalId?: string | number }> } | Array<Record<string, unknown>>
      }>(`/tables/${tableId}/rows?limit=5000`);
      
      const rows = Array.isArray(response.data) ? response.data : response.data.rows || [];
      
      // Find the specific row - search by valueColumn if provided, otherwise by id
      type RowData = { id?: string | number; data?: Record<string, unknown>; originalId?: string | number };
      const foundRow = rows.find((row: RowData) => {
        const rId = String(row.id ?? '');
        const rOriginalId = String(row.originalId ?? '');
        const rDataId = String(row.data?.id ?? '');
        const rowData = row.data && typeof row.data === 'object' ? row.data : row;
        
        // If valueColumn is specified, search by that column's value
        if (valueColumn) {
          const columnValue = String((rowData as Record<string, unknown>)[valueColumn] ?? '');
          if (columnValue === rowId) {
            // Store actual row ID for saving
            setActualRowId(rOriginalId || rId);
            return true;
          }
        }
        
        // Otherwise search by various IDs
        if (rId === rowId || rOriginalId === rowId || rDataId === rowId) {
          setActualRowId(rOriginalId || rId);
          return true;
        }
        
        return false;
      });
      
      if (!foundRow) {
        throw new Error(`Row ${rowId} not found in table ${tableId}`);
      }
      
      // Return the data object
      return foundRow.data || foundRow;
    },
    enabled: isOpen && !!tableId && !!rowId,
  });

  const columns = columnsData || [];
  const tableName = tableInfo?.displayName || tableInfo?.name || 'Таблица';
  const isLoadingTable = isLoadingTableInfo || isLoadingColumns;



  // Find password column if exists
  const passwordColumn = useMemo(() => 
    columns.find(col => isPasswordColumn(col)), 
    [columns]
  );

  // Initialize form data when row data is loaded
  useEffect(() => {
    if (isOpen && rowData && columns.length > 0) {
      const initialData: Record<string, unknown> = {};
      
      columns.forEach(col => {
        // Skip password columns - they're handled separately
        if (isPasswordColumn(col)) return;
        
        // Try to get value by column.id first, then by column.name
        const value = rowData[col.id] ?? rowData[col.name] ?? rowData[col.displayName || ''];
        initialData[col.id] = value;
      });
      
      setFormData(initialData);
      setNewPassword('');
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

  const handleSubmit = async () => {
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
    
    try {
      setIsSaving(true);
      
      // Use actualRowId (the real database ID) for the API call
      const idToUpdate = actualRowId || rowId;
      await tablesApi.updateRow(Number(tableId), idToUpdate, dataToSubmit);
      
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['related-row', tableId, rowId] });
      queryClient.invalidateQueries({ queryKey: ['relation-cell-data'] });
      queryClient.invalidateQueries({ queryKey: ['relation-editor-data'] });
      queryClient.invalidateQueries({ queryKey: ['rows'] });
      
      onClose();
    } catch (error) {
      logger.error('Failed to save related row:', error);
      alert(error instanceof Error ? error.message : 'Ошибка сохранения');
    } finally {
      setIsSaving(false);
    }
  };

  const isLoading = isLoadingTable || isLoadingRow;

  // Filter columns to show (exclude system columns)
  const editableColumns = useMemo(() => columns.filter(col => {
    const name = (col.name || '').toLowerCase();
    return col.isVisible !== false && !READONLY_COLUMNS.includes(name) && !isPasswordColumn(col);
  }), [columns]);
  
  // Separate checkbox columns from other columns  
  const checkboxColumns = useMemo(() => editableColumns.filter(col => col.type === 'checkbox'), [editableColumns]);
  const otherColumns = useMemo(() => editableColumns.filter(col => col.type !== 'checkbox'), [editableColumns]);

  // Handle form config save
  const handleSaveFormConfig = (config: FormConfig, formTypes: FormTypeValue[]) => {
    if (tableId) {
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
        onOpenChange={(open) => { if (!open) onClose(); }}
        title={`Редактировать: ${tableName}`}
        size={getModalSize()}
      >
        <div className="flex flex-col" style={{ height: 'calc(70vh - 80px)', maxHeight: '600px' }}>
          {isLoading ? (
            <div className="flex items-center justify-center py-8 flex-1">
              <Loader2 className="w-6 h-6 animate-spin text-[var(--color-primary-500)]" />
              <span className="ml-2 text-[var(--text-secondary)]">Загрузка...</span>
            </div>
          ) : (
            <>
              <p className="text-sm text-[var(--text-secondary)] mb-4 flex-shrink-0">
                Измените данные строки и нажмите «Сохранить».
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
                    {/* Regular fields */}
                    <div className="space-y-4">
                      {otherColumns.map(col => (
                        <div key={col.id}>
                          <label className="mb-1.5 block text-sm font-medium text-[var(--text-primary)]">
                            {col.displayName || col.name}
                            {col.isRequired && <span className="ml-1 text-red-500">*</span>}
                          </label>
                          <FieldRenderer
                            column={col}
                            value={formData[col.id]}
                            onChange={(value) => handleChange(col.id, value)}
                            showLabel={false}
                          />
                        </div>
                      ))}
                      
                      {/* Password field if exists */}
                      {passwordColumn && (
                        <div>
                          <label className="mb-1.5 block text-sm font-medium text-[var(--text-primary)]">
                            {passwordColumn.displayName || passwordColumn.name} (новый)
                          </label>
                          <Input
                            type="password"
                            value={newPassword}
                            onChange={(e) => handlePasswordChange(e.target.value)}
                            placeholder="Оставьте пустым, чтобы не менять"
                          />
                        </div>
                      )}
                    </div>

                    {/* Checkboxes section */}
                    {checkboxColumns.length > 0 && (
                      <div className="flex flex-wrap gap-4 pt-2">
                        {checkboxColumns.map(col => (
                          <FieldRenderer
                            key={col.id}
                            column={col}
                            value={formData[col.id]}
                            onChange={(val) => handleChange(col.id, val)}
                          />
                        ))}
                      </div>
                    )}
                  </>
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
                    Отмена
                  </Button>
                  <Button 
                    variant="primary" 
                    onClick={handleSubmit} 
                    disabled={!hasChanges || isSaving}
                  >
                    {isSaving ? 'Сохранение...' : 'Сохранить'}
                  </Button>
                </div>
              </div>
            </>
          )}
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
          tableId={typeof tableId === 'string' ? parseInt(tableId) : Number(tableId)}
          sampleData={rowData || {}}
        />
      )}
    </>
  );
};
