import { useState, useCallback } from 'react';
import { logger } from '@/shared/utils/logger';
import { useQuery } from '@tanstack/react-query';
import { EyeOff, RefreshCw, Copy, Check, Eye } from 'lucide-react';
import { Input } from '@/shared/components/ui';
import { apiClient } from '@/shared/utils/apiClient';
import type { ColumnModel, ColumnOption } from '../../types/table.types';
import { FileUploaderField } from './FileUploaderField';

// Helper to format ISO date to YYYY-MM-DD for input[type="date"]
const formatDateForInput = (value: unknown): string => {
  if (!value) return '';
  const str = String(value);
  // Already in correct format
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  // ISO format with time
  if (str.includes('T')) return str.split('T')[0];
  // Try to parse as date
  const date = new Date(str);
  if (!isNaN(date.getTime())) {
    return date.toISOString().split('T')[0];
  }
  return '';
};

// Helper to format ISO datetime to YYYY-MM-DDTHH:mm for input[type="datetime-local"]
const formatDateTimeForInput = (value: unknown): string => {
  if (!value) return '';
  const str = String(value);
  // Already in correct format
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(str)) return str;
  // ISO format - take first 16 chars
  if (str.includes('T')) return str.slice(0, 16);
  // Try to parse as date
  const date = new Date(str);
  if (!isNaN(date.getTime())) {
    return date.toISOString().slice(0, 16);
  }
  return '';
};

// Password Input with show/hide, copy, and generate functionality
function PasswordInput({ 
  value, 
  onChange, 
  disabled, 
  highlighted 
}: { 
  value: string; 
  onChange: (v: unknown) => void; 
  disabled?: boolean; 
  highlighted?: boolean;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);

  const generatePassword = useCallback(() => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
    let password = '';
    for (let i = 0; i < 16; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    onChange(password);
  }, [onChange]);

  const copyToClipboard = useCallback(async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      logger.error('Copy failed:', err);
    }
  }, [value]);

  // Password strength calculation
  const getStrength = (pwd: string) => {
    if (!pwd) return { label: '', color: '', width: '0%' };
    let score = 0;
    if (pwd.length >= 8) score++;
    if (pwd.length >= 12) score++;
    if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) score++;
    if (/[0-9]/.test(pwd)) score++;
    if (/[^a-zA-Z0-9]/.test(pwd)) score++;
    
    if (score <= 2) return { label: 'Weak', color: 'bg-red-500', width: '33%' };
    if (score <= 3) return { label: 'Medium', color: 'bg-yellow-500', width: '66%' };
    return { label: 'Strong', color: 'bg-green-500', width: '100%' };
  };

  const strength = getStrength(value);

  return (
    <div className="space-y-1.5">
      <div className="relative flex items-center gap-1">
        <Input
          type={showPassword ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder="••••••••"
          className={`pr-24 font-mono ${highlighted ? 'border-[var(--color-primary-500)] ring-2 ring-[var(--color-primary-500)]' : ''}`}
        />
        <div className="absolute right-1 flex items-center gap-0.5">
          {/* Show/Hide */}
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            disabled={disabled}
            className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] transition-colors disabled:opacity-50"
            title={showPassword ? 'Hide' : 'Show'}
          >
            {showPassword ? (
              <EyeOff className="w-4 h-4 text-[var(--text-tertiary)]" />
            ) : (
              <Eye className="w-4 h-4 text-[var(--text-tertiary)]" />
            )}
          </button>
          
          {/* Copy */}
          <button
            type="button"
            onClick={copyToClipboard}
            disabled={disabled || !value}
            className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] transition-colors disabled:opacity-50"
            title={copied ? 'Copied!' : 'Copy'}
          >
            {copied ? (
              <Check className="w-4 h-4 text-green-500" />
            ) : (
              <Copy className="w-4 h-4 text-[var(--text-tertiary)]" />
            )}
          </button>
          
          {/* Generate */}
          <button
            type="button"
            onClick={generatePassword}
            disabled={disabled}
            className="p-1.5 rounded hover:bg-[var(--bg-tertiary)] transition-colors disabled:opacity-50"
            title="Generate secure password"
          >
            <RefreshCw className="w-4 h-4 text-[var(--text-tertiary)]" />
          </button>
        </div>
      </div>
      
      {/* Strength indicator */}
      {value && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
            <div 
              className={`h-full ${strength.color} transition-all duration-300`}
              style={{ width: strength.width }}
            />
          </div>
          <span className={`text-xs ${
            strength.label === 'Weak' ? 'text-red-500' : 
            strength.label === 'Medium' ? 'text-yellow-500' : 'text-green-500'
          }`}>
            {strength.label}
          </span>
        </div>
      )}
    </div>
  );
}

interface FieldRendererProps {
  column: ColumnModel;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  highlighted?: boolean;
  showLabel?: boolean; // Show label above input
  inline?: boolean; // For checkbox - render inline without wrapper
}

/**
 * Renders appropriate input control based on column type
 */
export function FieldRenderer({ 
  column, 
  value, 
  onChange, 
  disabled = false,
  highlighted = false,
  showLabel = true,
  inline = false
}: FieldRendererProps) {
  const baseInputClass = `w-full px-3 py-2 rounded-lg border bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)] ${
    disabled ? 'opacity-50 cursor-not-allowed' : ''
  } ${highlighted ? 'border-[var(--color-primary-500)] ring-2 ring-[var(--color-primary-500)]' : 'border-[var(--border-primary)]'}`;

  // Skip system columns that shouldn't be edited
  const isSystemColumn = ['created_at', 'updated_at'].includes(column.name);
  
  const label = column.displayName || column.name;

  // Wrapper for label + input
  const withLabel = (input: React.ReactNode, isInline = false) => {
    if (!showLabel) return input;
    if (isInline) {
      return (
        <label className="flex items-center gap-2 cursor-pointer">
          {input}
          <span className="text-sm font-medium text-[var(--text-primary)]">{label}</span>
        </label>
      );
    }
    return (
      <div className="space-y-1">
        <label className="block text-sm font-medium text-[var(--text-primary)]">
          {label}
        </label>
        {input}
      </div>
    );
  };
  
  switch (column.type) {
    case 'select': {
      const relation = column.config?.relation;
      const staticOptions = column.config?.options || [];
      
      // Load options from related table if relation is enabled
      const { data: relationOptions = [] } = useQuery({
        queryKey: ['field-renderer-relation', relation?.tableId, relation?.valueColumn, relation?.labelColumn],
        queryFn: async () => {
          if (!relation?.enabled || !relation.tableId || !relation.valueColumn || !relation.labelColumn) {
            return [];
          }
          
          const response = await apiClient.request<{ 
            data: { rows: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
          }>(`/tables/${relation.tableId}/rows?limit=5000`);
          
          const rows = Array.isArray(response.data) ? response.data : response.data.rows || [];
          
          return rows.map((row) => {
            const rowData = row.data && typeof row.data === 'object' ? row.data as Record<string, unknown> : row;
            const rowId = (row as { id?: string | number }).id;
            const originalId = (row as { originalId?: string | number }).originalId;
            
            let val: string;
            if (relation.valueColumn === 'id') {
              val = String(originalId ?? rowData['id'] ?? rowId ?? '');
            } else {
              val = String(rowData[relation.valueColumn] ?? '');
            }
              
            return {
              value: val,
              label: String(rowData[relation.labelColumn] ?? ''),
              color: relation.colorColumn ? String(rowData[relation.colorColumn] ?? '') || undefined : undefined
            } as ColumnOption;
          });
        },
        enabled: Boolean(relation?.enabled && relation?.tableId && relation?.valueColumn && relation?.labelColumn),
        staleTime: 60000,
      });
      
      // Use relation options if available, otherwise static options
      const options = relation?.enabled && relationOptions.length > 0 ? relationOptions : staticOptions;
      
      // Find current option color for styling
      const currentOption = options.find((opt: ColumnOption) => String(opt.value) === String(value || ''));
      const selectColor = currentOption?.color || undefined;

      return withLabel(
        <select
          value={String(value || '')}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled || isSystemColumn}
          className={`${baseInputClass} cursor-pointer`}
          style={selectColor ? {
            borderColor: selectColor,
            backgroundColor: `${selectColor}15`,
            color: selectColor,
          } : undefined}
        >
          <option value="">Выберите...</option>
          {options.map((opt: ColumnOption) => (
            <option key={opt.value} value={opt.value}>
              {opt.label || opt.value}
            </option>
          ))}
        </select>
      );
    }

    case 'multi-select': {
      const relation = column.config?.relation;
      const staticOptions = column.config?.options || [];
      
      // Load options from related table if relation is enabled
      const { data: relationOptions = [] } = useQuery({
        queryKey: ['field-renderer-relation', relation?.tableId, relation?.valueColumn, relation?.labelColumn],
        queryFn: async () => {
          if (!relation?.enabled || !relation.tableId || !relation.valueColumn || !relation.labelColumn) {
            return [];
          }
          
          const response = await apiClient.request<{ 
            data: { rows: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
          }>(`/tables/${relation.tableId}/rows?limit=5000`);
          
          const rows = Array.isArray(response.data) ? response.data : response.data.rows || [];
          
          return rows.map((row) => {
            const rowData = row.data && typeof row.data === 'object' ? row.data as Record<string, unknown> : row;
            const rowId = (row as { id?: string | number }).id;
            const originalId = (row as { originalId?: string | number }).originalId;
            
            let val: string;
            if (relation.valueColumn === 'id') {
              val = String(originalId ?? rowData['id'] ?? rowId ?? '');
            } else {
              val = String(rowData[relation.valueColumn] ?? '');
            }
              
            return {
              value: val,
              label: String(rowData[relation.labelColumn] ?? ''),
              color: relation.colorColumn ? String(rowData[relation.colorColumn] ?? '') || undefined : undefined
            } as ColumnOption;
          });
        },
        enabled: Boolean(relation?.enabled && relation?.tableId && relation?.valueColumn && relation?.labelColumn),
        staleTime: 60000,
      });
      
      // Use relation options if available, otherwise static options
      const options = relation?.enabled && relationOptions.length > 0 ? relationOptions : staticOptions;
      const selected = Array.isArray(value) ? value : (value ? [value] : []);
      
      return withLabel(
        <div className="flex flex-wrap gap-2 p-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] min-h-[42px]">
          {options.map((opt: ColumnOption) => {
            const isSelected = selected.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                disabled={disabled || isSystemColumn}
                onClick={() => {
                  const newValue = isSelected 
                    ? selected.filter((v: string) => v !== opt.value)
                    : [...selected, opt.value];
                  onChange(newValue);
                }}
                className={`px-2 py-1 rounded text-xs font-medium transition ${
                  isSelected 
                    ? 'bg-[var(--color-primary-500)] text-white' 
                    : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]'
                } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                style={opt.color && !isSelected ? { backgroundColor: `${opt.color}20`, color: opt.color } : {}}
              >
                {opt.label || opt.value}
              </button>
            );
          })}
          {options.length === 0 && (
            <span className="text-sm text-[var(--text-tertiary)]">Нет доступных опций</span>
          )}
        </div>
      );
    }

    case 'checkbox':
      // Checkbox always has inline label
      return withLabel(
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled || isSystemColumn}
          className="w-5 h-5 rounded border-[var(--border-primary)] text-[var(--color-primary-500)] focus:ring-[var(--color-primary-500)]"
        />,
        true // inline
      );

    case 'date':
      return withLabel(
        <Input
          type="date"
          value={formatDateForInput(value)}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled || isSystemColumn}
          className={highlighted ? 'border-[var(--color-primary-500)] ring-2 ring-[var(--color-primary-500)]' : ''}
        />
      );

    case 'datetime':
      return withLabel(
        <Input
          type="datetime-local"
          value={formatDateTimeForInput(value)}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled || isSystemColumn}
          className={highlighted ? 'border-[var(--color-primary-500)] ring-2 ring-[var(--color-primary-500)]' : ''}
        />
      );

    case 'number':
      return withLabel(
        <Input
          type="number"
          value={value !== null && value !== undefined ? String(value) : ''}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
          disabled={disabled || isSystemColumn}
          placeholder={label}
          className={highlighted ? 'border-[var(--color-primary-500)] ring-2 ring-[var(--color-primary-500)]' : ''}
        />
      );

    case 'email':
      return withLabel(
        <Input
          type="email"
          value={String(value || '')}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled || isSystemColumn}
          placeholder={label}
          className={highlighted ? 'border-[var(--color-primary-500)] ring-2 ring-[var(--color-primary-500)]' : ''}
        />
      );

    case 'url':
      return withLabel(
        <Input
          type="url"
          value={String(value || '')}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled || isSystemColumn}
          placeholder="https://..."
          className={highlighted ? 'border-[var(--color-primary-500)] ring-2 ring-[var(--color-primary-500)]' : ''}
        />
      );

    case 'password':
      return withLabel(
        <PasswordInput
          value={String(value || '')}
          onChange={onChange}
          disabled={disabled || isSystemColumn}
          highlighted={highlighted}
        />
      );

    case 'phone':
      return withLabel(
        <Input
          type="tel"
          value={String(value || '')}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled || isSystemColumn}
          placeholder="+7 (999) 123-45-67"
          className={highlighted ? 'border-[var(--color-primary-500)] ring-2 ring-[var(--color-primary-500)]' : ''}
        />
      );

    case 'textarea':
      return withLabel(
        <textarea
          value={String(value || '')}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled || isSystemColumn}
          rows={3}
          placeholder={label}
          className={`${baseInputClass} resize-none`}
        />
      );

    case 'file':
      return withLabel(
        <FileUploaderField
          value={value}
          onChange={onChange}
          disabled={disabled || isSystemColumn}
          tableId={column.tableId}
          columnId={column.id}
        />
      );

    case 'image':
      return withLabel(
        <FileUploaderField
          value={value}
          onChange={onChange}
          disabled={disabled || isSystemColumn}
          tableId={column.tableId}
          columnId={column.id}
          accept="image/*"
          isImageType={true}
        />
      );

    // Ticket #81436: Support relation column type in EditRowModal
    case 'relation': {
      const relation = column.config?.relation;

      // Load options from related table
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const { data: relationOptions = [] } = useQuery({
        queryKey: ['field-renderer-relation-type', relation?.tableId, relation?.valueColumn, relation?.labelColumn],
        queryFn: async () => {
          if (!relation?.tableId) return [];
          const valueCol = relation.valueColumn || 'id';
          const labelCol = relation.labelColumn || 'name';

          const response = await apiClient.request<{
            data: { rows: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
          }>(`/tables/${relation.tableId}/rows?limit=5000`);

          const rows = Array.isArray(response.data) ? response.data : (response.data as { rows?: Array<Record<string, unknown>> }).rows || [];

          return rows.map((row) => {
            const rowData = row.data && typeof row.data === 'object' ? row.data as Record<string, unknown> : row;
            const rowId = (row as { id?: string | number }).id;
            const originalId = (row as { originalId?: string | number }).originalId;

            let val: string;
            if (valueCol === 'id') {
              val = String(originalId ?? rowData['id'] ?? rowId ?? '');
            } else {
              val = String(rowData[valueCol] ?? '');
            }

            return {
              value: val,
              label: String(rowData[labelCol] ?? rowData['title'] ?? rowData['name'] ?? val),
              color: relation.colorColumn ? String(rowData[relation.colorColumn] ?? '') || undefined : undefined
            } as ColumnOption;
          });
        },
        enabled: Boolean(relation?.tableId),
        staleTime: 60000,
      });

      if (relation?.tableId && relationOptions.length > 0) {
        const currentRelOption = relationOptions.find((opt: ColumnOption) => String(opt.value) === String(value || ''));
        const relColor = currentRelOption?.color || undefined;

        return withLabel(
          <select
            value={String(value || '')}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled || isSystemColumn}
            className={`w-full px-3 py-2 rounded-lg border bg-[var(--bg-primary)] text-[var(--text-primary)] cursor-pointer focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)] ${highlighted ? 'border-[var(--color-primary-500)] ring-2 ring-[var(--color-primary-500)]' : 'border-[var(--border-primary)]'}`}
            style={relColor ? {
              borderColor: relColor,
              backgroundColor: `${relColor}15`,
              color: relColor,
            } : undefined}
          >
            <option value="">Выберите...</option>
            {relationOptions.map((opt: ColumnOption) => (
              <option key={opt.value} value={opt.value}>
                {opt.label || opt.value}
              </option>
            ))}
          </select>
        );
      }

      // Fallback: show as text if no relation config
      return withLabel(
        <Input
          type="text"
          value={String(value || '')}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled || isSystemColumn}
          placeholder={label}
          className={highlighted ? 'border-[var(--color-primary-500)] ring-2 ring-[var(--color-primary-500)]' : ''}
        />
      );
    }

    case 'text':
    default:
      return withLabel(
        <Input
          type="text"
          value={String(value || '')}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled || isSystemColumn}
          placeholder={label}
          className={highlighted ? 'border-[var(--color-primary-500)] ring-2 ring-[var(--color-primary-500)]' : ''}
        />
      );
  }
}
