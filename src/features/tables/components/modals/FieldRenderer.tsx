import { cloneElement, isValidElement, useId, useState, useCallback, type ReactElement } from 'react';
import { logger } from '@/shared/utils/logger';
import { EyeOff, RefreshCw, Copy, Check, Eye, ExternalLink as ExternalLinkIcon } from 'lucide-react';
import { Input } from '@/shared/components/ui';
import type { ColumnModel, ColumnOption, ColumnRelationConfig } from '../../types/table.types';
import { useRelationOptions } from '../../hooks/useRelationOptions';
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
  multiline?: boolean; // Text column as a resizable textarea (form builder "Расширяемое")
  rows?: number; // Visible rows for the multiline textarea
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
  inline = false,
  multiline = false,
  rows,
}: FieldRendererProps) {
  const fieldId = useId();
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
    const labelable = isValidElement(input) && (input.type === Input || ['input', 'select', 'textarea'].includes(String(input.type)));
    const labelledInput = labelable
      ? cloneElement(input as ReactElement<{ id?: string; 'aria-required'?: boolean }>, { id: fieldId, 'aria-required': column.isRequired || undefined })
      : input;
    return (
      <div className="space-y-1">
        <label htmlFor={labelable ? fieldId : undefined} className="block text-sm font-medium text-[var(--text-primary)]">
          {label}{column.isRequired && <span aria-hidden="true" className="ml-1 text-red-500">*</span>}
        </label>
        {labelledInput}
      </div>
    );
  };

  const relation = column.config?.relation;
  const staticOptions = column.config?.options || [];
  const isRelationColumn = column.type === 'relation';
  const valueColumn = relation?.valueColumn || (isRelationColumn ? 'id' : undefined);
  const labelColumn = relation?.labelColumn || (isRelationColumn ? 'name' : undefined);

  // Options from the related table (ADR-205 D4: shared lookup). Relation-type columns
  // default to id/name even without an explicit relation config.
  const wantsRelationOptions = Boolean(
    relation?.tableId && valueColumn && labelColumn &&
    (isRelationColumn || ((column.type === 'select' || column.type === 'multi-select') && relation?.enabled)),
  );
  const lensRelation: ColumnRelationConfig | undefined = wantsRelationOptions && relation
    ? { ...relation, enabled: true, valueColumn, labelColumn }
    : undefined;
  const { options: lookupOptions } = useRelationOptions(lensRelation);
  // A relation row without a label still needs something to pick: fall back to its key.
  const relationOptions = isRelationColumn ? lookupOptions.map((opt) => (opt.label ? opt : { ...opt, label: opt.value })) : lookupOptions;

  // Persisted schemas can still contain legacy names such as textarea.
  const displayType: string = column.type;
  switch (displayType) {
    case 'select': {
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

    case 'url': {
      const urlValue = String(value || '').trim();
      const href = urlValue && !/^https?:\/\//i.test(urlValue) ? `https://${urlValue}` : urlValue;
      return withLabel(
        <div className="relative">
          <Input
            type="url"
            value={String(value || '')}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled || isSystemColumn}
            placeholder="https://..."
            className={`${highlighted ? 'border-[var(--color-primary-500)] ring-2 ring-[var(--color-primary-500)]' : ''} ${href ? 'pr-9' : ''}`}
          />
          {href && (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              title="Open link"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--color-primary-500)] transition-colors"
            >
              <ExternalLinkIcon className="w-4 h-4" />
            </a>
          )}
        </div>
      );
    }

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
      if (multiline) {
        return withLabel(
          <textarea
            value={String(value || '')}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled || isSystemColumn}
            rows={rows && rows > 0 ? rows : 3}
            placeholder={label}
            className={`${baseInputClass} resize-y`}
          />
        );
      }
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
