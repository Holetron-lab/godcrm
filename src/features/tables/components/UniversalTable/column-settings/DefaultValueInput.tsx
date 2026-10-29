/**
 * DefaultValueInput — input component for column default values
 * Supports formulas {{column_key}} for all types
 * Extracted from ColumnSettingsDrawer for modularity
 */
import React, { useState, useRef, useEffect, useId } from 'react';
import { Input, Checkbox } from '@/shared/components/ui';
import type { ColumnModel } from '@/features/tables/types/table.types';
import type { ColumnType } from '@/shared/types';
import { ChevronDown, Check } from 'lucide-react';
import { getDefaultColor } from './shared';
import type { TFunction } from './shared';

// FancySelect component for modal
interface FancySelectProps {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  options: Array<{ label: string; value: string; color?: string }>;
  placeholder?: string;
  searchPlaceholder?: string;
  notFoundText?: string;
  disabled?: boolean;
}

export const FancySelect = ({ label, value, onChange, options, placeholder = '— Not selected —', searchPlaceholder = 'Search...', notFoundText = 'Nothing found', disabled }: FancySelectProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const fieldId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const filteredOptions = options.filter(opt =>
    opt?.label?.toLowerCase().includes(search.toLowerCase())
  );

  const selectedOption = options.find(opt => opt.value === value);

  useEffect(() => {
    if (!isOpen) return;
    if (disabled) {
      setIsOpen(false);
      setSearch('');
      return;
    }
    searchRef.current?.focus();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !containerRef.current?.contains(event.target as Node)) return;
      event.preventDefault();
      event.stopPropagation();
      setIsOpen(false);
      setSearch('');
      triggerRef.current?.focus();
    };
    document.addEventListener('keydown', handleEscape, true);
    return () => document.removeEventListener('keydown', handleEscape, true);
  }, [isOpen, disabled]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (optValue: string | null) => {
    onChange(optValue);
    setIsOpen(false);
    setSearch('');
    triggerRef.current?.focus();
  };

  return (
    <div className="space-y-1" ref={containerRef} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) {
        setIsOpen(false);
        setSearch('');
      }
    }}>
      <label htmlFor={fieldId} className="block text-sm font-medium text-[var(--text-secondary)]">{label}</label>
      <div className="relative">
        <button
          type="button"
          id={fieldId}
          ref={triggerRef}
          disabled={disabled}
          aria-expanded={isOpen}
          aria-describedby={`${fieldId}-value`}
          aria-controls={isOpen ? `${fieldId}-options` : undefined}
          onClick={() => { setIsOpen(!isOpen); setSearch(''); }}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] hover:bg-[var(--bg-secondary)] transition text-left focus-visible:ring-2 focus-visible:ring-[var(--color-primary-500)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {selectedOption ? (
            <span
              id={`${fieldId}-value`}
              className="text-[var(--text-primary)] inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
              style={{
                backgroundColor: `${selectedOption.color || getDefaultColor(options.indexOf(selectedOption))}20`,
                border: `1px solid ${selectedOption.color || getDefaultColor(options.indexOf(selectedOption))}40`
              }}
            >
              {selectedOption.label}
            </span>
          ) : (
            <span id={`${fieldId}-value`} className="text-sm text-[var(--text-secondary)]">{placeholder}</span>
          )}
          <ChevronDown className={`w-4 h-4 text-[var(--text-secondary)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {isOpen && (
          <div id={`${fieldId}-options`} className="absolute z-50 top-full left-0 right-0 mt-1 bg-[var(--bg-primary)] rounded-lg shadow-xl border border-[var(--border-primary)] overflow-hidden">
            <div className="p-2 border-b border-[var(--border-secondary)]">
              <input
                ref={searchRef}
                aria-label={`${label}: ${searchPlaceholder}`}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full px-3 py-1.5 text-sm rounded-md bg-[var(--bg-secondary)] border border-[var(--border-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
              />
            </div>
            <div className="max-h-[200px] overflow-y-auto py-1">
              {/* Опция "Не выбрано" */}
              <button
                type="button"
                aria-pressed={value == null}
                onClick={() => handleSelect(null)}
                className={`w-full text-left flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[var(--bg-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-primary-500)] ${value == null ? 'bg-[var(--bg-secondary)]' : ''}`}
              >
                <span className="w-4 shrink-0">{value == null && <Check className="w-4 h-4 text-[var(--color-primary-500)]" />}</span>
                <span className="text-sm text-[var(--text-secondary)]">{placeholder}</span>
              </button>

              {filteredOptions.map((opt, index) => {
                const isSelected = opt.value === value;
                const color = opt.color || getDefaultColor(index);
                return (
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    key={opt.value}
                    onClick={() => handleSelect(opt.value)}
                    className={`w-full text-left flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[var(--bg-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-primary-500)] ${isSelected ? 'bg-[var(--bg-secondary)]' : ''}`}
                  >
                    <span className="w-4 shrink-0">{isSelected && <Check className="w-4 h-4 text-[var(--color-primary-500)]" />}</span>
                    <span
                      className="text-[var(--text-primary)] inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
                      style={{
                        backgroundColor: `${color}20`,
                        border: `1px solid ${color}40`
                      }}
                    >
                      {opt.label}
                    </span>
                  </button>
                );
              })}

              {filteredOptions.length === 0 && search && (
                <div className="px-3 py-4 text-center text-sm text-[var(--text-secondary)]">
                  {notFoundText}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Подсветка формул в тексте
const FormulaHighlight: React.FC<{ text: string; columns: Set<string> }> = ({ text, columns }) => {
  if (!text) return null;

  const parts = text.split(/(\{\{[^}]+\}\})/g);
  return (
    <div className="mt-1 p-2 bg-[var(--bg-tertiary)] rounded text-xs font-mono break-all">
      {parts.map((part, i) => {
        const match = part.match(/^\{\{([^}]+)\}\}$/);
        if (match) {
          const colName = match[1];
          const isValid = columns.has(colName);
          return (
            <span
              key={i}
              className={`px-1 rounded ${isValid ? 'bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200' : 'bg-red-200 dark:bg-red-800 text-red-800 dark:text-red-200'}`}
            >
              {part}
            </span>
          );
        }
        return <span key={i} className="text-[var(--text-secondary)]">{part}</span>;
      })}
    </div>
  );
};

// Props for DefaultValueInput
interface DefaultValueInputProps {
  type: ColumnType;
  value: unknown;
  onChange: (value: unknown) => void;
  options?: Array<{ label: string; value: string; color?: string }>;
  allColumns?: ColumnModel[];
  t: TFunction;
}

export const DefaultValueInput = ({ type, value, onChange, options = [], allColumns = [], t }: DefaultValueInputProps) => {
  const availableColumns = React.useMemo(() => new Set(allColumns.map(c => c.name)), [allColumns]);
  const strValue = String(value ?? '');
  const hasFormula = strValue.includes('{{');

  switch (type as string) {
    case 'checkbox':
      return (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-[var(--text-secondary)]">
            {t('columnSettings.defaultValue.label')}
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-2 h-10">
              <Checkbox
                checked={value === true || value === 'true' || value === 1}
                onCheckedChange={(checked) => onChange(checked === true)}
                disabled={hasFormula}
              />
              <span className="text-sm text-[var(--text-secondary)]">
                {value === true || value === 'true' || value === 1 ? t('columnSettings.defaultValue.checkboxEnabled') : t('columnSettings.defaultValue.checkboxDisabled')}
              </span>
            </div>
            <Input
              placeholder="{{status}}"
              value={hasFormula ? strValue : ''}
              onChange={(e) => onChange(e.target.value || null)}
            />
          </div>
          {hasFormula && <FormulaHighlight text={strValue} columns={availableColumns} />}
        </div>
      );

    case 'select':
      return (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <FancySelect
              label={t('columnSettings.defaultValue.label')}
              value={hasFormula ? null : (value as string | null)}
              onChange={onChange}
              options={options}
              disabled={hasFormula}
              searchPlaceholder={t('columnSettings.search')}
              notFoundText={t('columnSettings.nothingFound')}
            />
            <Input
              label={t('columnSettings.defaultValue.formulaPlaceholder')}
              placeholder="{{category}}"
              value={hasFormula ? strValue : ''}
              onChange={(e) => onChange(e.target.value || null)}
            />
          </div>
          {hasFormula && <FormulaHighlight text={strValue} columns={availableColumns} />}
        </div>
      );

    case 'multi-select': {
      // Для multi-select показываем чекбоксы
      const selectedValues = Array.isArray(value) ? value : (value ? [value] : []);
      return (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-[var(--text-secondary)]">
            {t('columnSettings.defaultValue.label')}
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-wrap gap-2 p-2 border border-[var(--border-primary)] rounded-lg min-h-[42px]">
              {options.map((opt, index) => {
                const color = opt.color || getDefaultColor(index);
                return (
                  <label
                    key={opt.value}
                    className="cursor-pointer transition-transform hover:scale-105"
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={selectedValues.includes(opt.value)}
                      disabled={hasFormula}
                      onChange={(e) => {
                        if (e.target.checked) {
                          onChange([...selectedValues, opt.value]);
                        } else {
                          onChange(selectedValues.filter((v: string) => v !== opt.value));
                        }
                      }}
                    />
                    <span
                      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
                      style={{
                        backgroundColor: selectedValues.includes(opt.value) ? `${color}40` : `${color}20`,
                        color: color,
                        border: `1px solid ${selectedValues.includes(opt.value) ? color : `${color}40`}`
                      }}
                    >
                      {selectedValues.includes(opt.value) && <Check className="w-3 h-3 mr-1" />}
                      {opt.label}
                    </span>
                  </label>
                );
              })}
              {options.length === 0 && (
                <span className="text-xs text-[var(--text-tertiary)]">{t('columnSettings.defaultValue.addOptions')}</span>
              )}
            </div>
            <Input
              placeholder="{{tags}}"
              value={hasFormula ? strValue : ''}
              onChange={(e) => onChange(e.target.value || null)}
            />
          </div>
          {hasFormula && <FormulaHighlight text={strValue} columns={availableColumns} />}
        </div>
      );
    }

    case 'date':
    case 'datetime': {
      // Format date properly for input[type="date"]
      const formatDate = (val: unknown): string => {
        if (!val || String(val).includes('{{') || String(val).toUpperCase().includes('NOW')) return '';
        const str = String(val);
        if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
        if (str.includes('T')) return str.split('T')[0];
        const d = new Date(str);
        return !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : '';
      };
      const formatDateTime = (val: unknown): string => {
        if (!val || String(val).includes('{{') || String(val).toUpperCase().includes('NOW')) return '';
        return String(val).slice(0, 16);
      };
      const isFormulaValue = strValue.includes('{{') || strValue.toUpperCase().includes('NOW');
      return (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-[var(--text-secondary)]">
            {t('columnSettings.defaultValue.label')}
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Input
              type={type === 'datetime' ? 'datetime-local' : 'date'}
              value={type === 'datetime' ? formatDateTime(value) : formatDate(value)}
              onChange={(e) => onChange(e.target.value || null)}
              disabled={isFormulaValue}
            />
            <Input
              placeholder="{{created_at}} / NOW()"
              value={isFormulaValue ? strValue : ''}
              onChange={(e) => {
                const val = e.target.value;
                if (val.includes('{{') || val.toUpperCase().includes('NOW') || val === '') {
                  onChange(val || null);
                } else {
                  onChange(val || null);
                }
              }}
            />
          </div>
          {isFormulaValue && <FormulaHighlight text={strValue} columns={availableColumns} />}
          <p className="text-xs text-[var(--text-tertiary)]">
            💡 {t('columnSettings.defaultValue.useNowHint')}
          </p>
        </div>
      );
    }

    case 'number':
      return (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-[var(--text-secondary)]">
            {t('columnSettings.defaultValue.label')}
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Input
              type="number"
              value={!hasFormula && value !== null && value !== undefined ? String(value) : ''}
              onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
              disabled={hasFormula}
            />
            <Input
              placeholder="{{price}} * 1.2"
              value={hasFormula ? strValue : ''}
              onChange={(e) => onChange(e.target.value || null)}
            />
          </div>
          {hasFormula && <FormulaHighlight text={strValue} columns={availableColumns} />}
        </div>
      );

    case 'email':
    case 'url':
    case 'phone':
    case 'password': {
      const placeholders: Record<string, string> = {
        email: 'email@example.com',
        url: 'https://...',
        phone: '+7 (999) 123-45-67',
        password: '••••••••'
      };
      const inputTypes: Record<string, string> = {
        email: 'email',
        url: 'url',
        phone: 'tel',
        password: 'password'
      };
      return (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-[var(--text-secondary)]">
            {t('columnSettings.defaultValue.label')}
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Input
              type={inputTypes[type]}
              placeholder={placeholders[type]}
              value={!hasFormula ? strValue : ''}
              onChange={(e) => onChange(e.target.value || null)}
              disabled={hasFormula}
            />
            <Input
              placeholder={`{{${type}}}`}
              value={hasFormula ? strValue : ''}
              onChange={(e) => onChange(e.target.value || null)}
            />
          </div>
          {hasFormula && <FormulaHighlight text={strValue} columns={availableColumns} />}
        </div>
      );
    }

    case 'button':
    case 'formula':
    case 'rollup':
    case 'relation':
    case 'table':
      return (
        <div className="p-3 bg-[var(--bg-tertiary)] rounded-lg text-sm text-[var(--text-tertiary)]">
          {t('columnSettings.defaultValue.unsupportedType')}
        </div>
      );

    default:
      // text, image, file и прочие
      return (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-[var(--text-secondary)]">
            {t('columnSettings.defaultValue.label')}
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Input
              placeholder={t('columnSettings.defaultValue.staticValue')}
              value={!hasFormula ? strValue : ''}
              onChange={(e) => onChange(e.target.value || null)}
              disabled={hasFormula}
            />
            <Input
              placeholder={t('columnSettings.defaultValue.formulaPlaceholder')}
              value={hasFormula ? strValue : ''}
              onChange={(e) => onChange(e.target.value || null)}
            />
          </div>
          {hasFormula && <FormulaHighlight text={strValue} columns={availableColumns} />}
          <p className="text-xs text-[var(--text-tertiary)]">
            💡 {t('columnSettings.defaultValue.useTemplateHint')}
          </p>
        </div>
      );
  }
};
