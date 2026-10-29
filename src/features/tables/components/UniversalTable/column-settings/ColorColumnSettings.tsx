/**
 * ADR-028: Color Column Settings Component
 * Settings panel for color column type in ColumnSettingsDrawer
 * 
 * Режимы:
 * - colorType: hex | cmyk | ral | pantone | emoji
 * - displayMode: swatch-code | full-cell | swatch-only
 */

import React, { useId } from 'react';
import { Select, Switch } from '@/shared/components/ui';
import type { ColumnSettingsProps } from './types';
import type { RowColorMode } from '../../../utils/color-utils';

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

type ColorType = 'hex' | 'cmyk' | 'ral' | 'pantone' | 'emoji';
type DisplayMode = 'swatch-code' | 'full-cell' | 'swatch-only';
type CodeFormat = 'auto' | 'hex' | 'rgb' | 'cmyk' | 'name';

// ═══════════════════════════════════════════════════════════
// Options for Selects
// ═══════════════════════════════════════════════════════════

const COLOR_TYPE_OPTIONS = [
  { value: 'hex', label: 'HEX', description: 'Свободный выбор цвета (#ef4444)' },
  { value: 'cmyk', label: 'CMYK', description: 'Для печати (C/M/Y/K)' },
  { value: 'ral', label: 'RAL', description: 'Индустриальные цвета' },
  { value: 'pantone', label: 'Pantone', description: 'Полиграфические цвета' },
  { value: 'emoji', label: 'Emoji', description: 'Цветные эмодзи 🔴🟢🔵' },
];

const DISPLAY_MODE_OPTIONS = [
  { value: 'swatch-code', label: '[■] + код', description: 'Квадрат слева, код справа' },
  { value: 'full-cell', label: 'На всю ячейку', description: 'Цвет заполняет ячейку' },
  { value: 'swatch-only', label: 'Только [■]', description: 'Только цветной квадрат' },
];

const CODE_FORMAT_OPTIONS = [
  { value: 'auto', label: 'Авто' },
  { value: 'hex', label: 'HEX (#ef4444)' },
  { value: 'rgb', label: 'RGB (239, 68, 68)' },
  { value: 'cmyk', label: 'CMYK (0/82/70/6)' },
  { value: 'name', label: 'Название (Красный)' },
];

const ROW_COLOR_MODE_OPTIONS: Array<{ value: RowColorMode; label: string }> = [
  { value: 'background', label: 'Фон' },
  { value: 'border-left', label: 'Полоса слева' },
  { value: 'gradient', label: 'Градиент' },
];

// ═══════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════

export const ColorColumnSettings: React.FC<ColumnSettingsProps> = ({ draft, setDraft }) => {
  const fieldId = useId();
  const colorConfig = draft.config?.color;
  
  // Map legacy mode to colorType
  const getColorType = (): ColorType => {
    if (colorConfig?.colorType) return colorConfig.colorType;
    // Map legacy mode values
    const legacyMode = colorConfig?.mode;
    if (legacyMode === 'cmyk') return 'cmyk';
    if (legacyMode === 'ral') return 'ral';
    if (legacyMode === 'pantone') return 'pantone';
    if (legacyMode === 'emoji') return 'emoji';
    return 'hex'; // default (palette, list, all → hex)
  };
  
  // Current settings
  const colorType: ColorType = getColorType();
  const displayMode: DisplayMode = colorConfig?.displayMode || 'swatch-code';
  const showCode = colorConfig?.showCode !== false;
  const codeFormat: CodeFormat = colorConfig?.codeFormat || 'auto';
  const allowCustomHex = colorConfig?.allowCustomColor !== false;
  
  // Row coloring
  const applyToRow = colorConfig?.applyToRow || false;
  const rowColorMode: RowColorMode = colorConfig?.rowColorMode || 'background';
  const rowColorOpacity = colorConfig?.rowColorOpacity ?? 0.15;
  
  // Update config helper
  const updateColorConfig = (updates: Record<string, unknown>) => {
    setDraft(prev => ({
      ...prev,
      config: {
        ...prev.config,
        color: {
          colorType: 'hex',
          displayMode: 'swatch-code',
          showCode: true,
          applyToRow: false,
          ...prev.config?.color,
          ...updates,
        },
      },
    }));
  };
  
  return (
    <div className="space-y-5 p-4 border border-[var(--border-primary)] rounded-lg bg-[var(--bg-secondary)]">
      <h4 className="font-medium text-[var(--text-primary)] flex items-center gap-2">
        🎨 Настройки цвета
      </h4>
      
      {/* ═══════════════════════════════════════════════════════════ */}
      {/* Color Type Select */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div className="space-y-2">
        <Select
          label="Тип цвета"
          value={colorType}
          onChange={(value) => updateColorConfig({ colorType: value, mode: value })}
          options={COLOR_TYPE_OPTIONS}
        />
        <p className="text-xs text-[var(--text-tertiary)]">
          {COLOR_TYPE_OPTIONS.find(o => o.value === colorType)?.description}
        </p>
      </div>
      
      {/* ═══════════════════════════════════════════════════════════ */}
      {/* Display Mode Settings */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div className="pt-3 border-t border-[var(--border-secondary)] space-y-3">
        <h5 className="text-sm font-medium text-[var(--text-secondary)]">Отображение в ячейке</h5>
        
        {/* Display Mode */}
        <Select
          label="Режим отображения"
          value={displayMode}
          onChange={(value) => updateColorConfig({ displayMode: value })}
          options={DISPLAY_MODE_OPTIONS}
        />
        
        {/* Cell Preview */}
        <div className="space-y-1">
          <p className="text-xs font-medium text-[var(--text-tertiary)]">Превью:</p>
          <div className="flex gap-2 p-2 bg-[var(--bg-primary)] rounded border border-[var(--border-primary)]">
            {displayMode === 'swatch-code' && (
              <span className="inline-flex items-center gap-1.5">
                <span className="w-5 h-5 rounded shadow-sm border border-black/10" style={{ backgroundColor: '#22c55e' }} />
                {showCode && <span className="text-xs font-mono text-[var(--text-secondary)]">#22c55e</span>}
              </span>
            )}
            {displayMode === 'full-cell' && (
              <span 
                className="flex-1 h-6 rounded shadow-sm" 
                style={{ backgroundColor: '#22c55e' }} 
              />
            )}
            {displayMode === 'swatch-only' && (
              <span className="w-5 h-5 rounded shadow-sm border border-black/10" style={{ backgroundColor: '#22c55e' }} />
            )}
          </div>
        </div>
        
        {/* Show Code Toggle (only for swatch-code) */}
        {displayMode === 'swatch-code' && (
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm">Показывать код</div>
              <div className="text-xs text-[var(--text-tertiary)]">Отображать значение цвета рядом</div>
            </div>
            <Switch aria-label="Показывать код"
              checked={showCode}
              onCheckedChange={(checked) => updateColorConfig({ showCode: checked })}
            />
          </div>
        )}
        
        {/* Code Format (only if showCode) */}
        {displayMode === 'swatch-code' && showCode && (
          <Select
            label="Формат кода"
            value={codeFormat}
            onChange={(value) => updateColorConfig({ codeFormat: value })}
            options={CODE_FORMAT_OPTIONS}
          />
        )}
      </div>
      
      {/* ═══════════════════════════════════════════════════════════ */}
      {/* Type-specific Settings */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div className="pt-3 border-t border-[var(--border-secondary)] space-y-3">
        <h5 className="text-sm font-medium text-[var(--text-secondary)]">
          Настройки {colorType.toUpperCase()}
        </h5>
        
        {/* HEX Settings */}
        {colorType === 'hex' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm">Разрешить ввод HEX</div>
                <div className="text-xs text-[var(--text-tertiary)]">Ручной ввод кода цвета</div>
              </div>
              <Switch aria-label="Разрешить ввод HEX"
                checked={allowCustomHex}
                onCheckedChange={(checked) => updateColorConfig({ allowCustomColor: checked })}
              />
            </div>
            <div className="p-2 bg-[var(--bg-tertiary)] rounded text-xs text-[var(--text-tertiary)]">
              💡 20 preset цветов + цветовой круг{allowCustomHex ? ' + поле ввода HEX' : ''}
            </div>
          </div>
        )}
        
        {/* CMYK Settings */}
        {colorType === 'cmyk' && (
          <div className="p-2 bg-[var(--bg-tertiary)] rounded text-xs text-[var(--text-tertiary)]">
            💡 Слайдеры C/M/Y/K (0-100%). Значение сохраняется как CMYK + ближайший HEX для отображения.
          </div>
        )}
        
        {/* RAL Settings */}
        {colorType === 'ral' && (
          <div className="p-2 bg-[var(--bg-tertiary)] rounded text-xs text-[var(--text-tertiary)]">
            💡 Каталог RAL Classic (~200 цветов). Поиск по коду (RAL 3020) или названию.
          </div>
        )}
        
        {/* Pantone Settings */}
        {colorType === 'pantone' && (
          <div className="p-2 bg-[var(--bg-tertiary)] rounded text-xs text-[var(--text-tertiary)]">
            💡 Каталог Pantone Solid Coated. Поиск по коду (485 C) или названию.
          </div>
        )}
        
        {/* Emoji Settings */}
        {colorType === 'emoji' && (
          <div className="p-2 bg-[var(--bg-tertiary)] rounded text-xs text-[var(--text-tertiary)]">
            💡 Быстрые emoji: 🔴🟠🟡🟢🔵🟣⚫⚪ + расширенный picker
          </div>
        )}
      </div>
      
      {/* ═══════════════════════════════════════════════════════════ */}
      {/* Row Coloring */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div className="pt-3 border-t border-[var(--border-secondary)] space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Раскрасить строку</div>
            <div className="text-xs text-[var(--text-tertiary)]">Применить цвет ко всей строке таблицы</div>
          </div>
          <Switch aria-label="Раскрасить строку"
            checked={applyToRow}
            onCheckedChange={(checked) => updateColorConfig({ applyToRow: checked })}
          />
        </div>
        
        {applyToRow && (
          <>
            {/* Row color mode */}
            <fieldset className="min-w-0 space-y-2">
              <legend className="block text-xs font-medium text-[var(--text-secondary)]">
                Режим раскраски
              </legend>
              <div className="flex gap-2 flex-wrap">
                {ROW_COLOR_MODE_OPTIONS.map((option) => (
                  <button aria-pressed={rowColorMode === option.value}
                    key={option.value}
                    type="button"
                    onClick={() => updateColorConfig({ rowColorMode: option.value })}
                    className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                      rowColorMode === option.value
                        ? 'border-[var(--color-primary-500)] bg-primary-50 text-[var(--color-primary-500)]'
                        : 'border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)]'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>
            
            {/* Opacity slider (for background mode) */}
            {rowColorMode === 'background' && (
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label htmlFor={`${fieldId}-opacity`} className="text-xs font-medium text-[var(--text-secondary)]">
                    Прозрачность фона
                  </label>
                  <span className="text-xs text-[var(--text-tertiary)]">
                    {Math.round(rowColorOpacity * 100)}%
                  </span>
                </div>
                <input id={`${fieldId}-opacity`}
                  type="range"
                  min="0.05"
                  max="0.5"
                  step="0.05"
                  value={rowColorOpacity}
                  onChange={(e) => updateColorConfig({ rowColorOpacity: parseFloat(e.target.value) })}
                  className="w-full accent-[var(--color-primary-500)]"
                />
              </div>
            )}
            
            {/* Preview */}
            <div className="space-y-1">
              <p className="text-xs font-medium text-[var(--text-tertiary)]">Превью строки:</p>
              <div 
                className="flex items-center gap-3 px-3 py-2 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)]"
                style={getRowPreviewStyle(rowColorMode, rowColorOpacity)}
              >
                <span
                  className="w-5 h-5 rounded shadow-sm border border-black/10"
                  style={{ backgroundColor: '#22c55e' }}
                />
                <span className="text-sm">Название задачи</span>
                <span className="text-xs text-[var(--text-tertiary)]">В работе</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

/**
 * Get preview style for row coloring
 */
function getRowPreviewStyle(mode: RowColorMode, opacity: number): React.CSSProperties {
  const color = '#22c55e'; // Green for preview
  
  switch (mode) {
    case 'background':
      return {
        backgroundColor: `${color}${Math.round(opacity * 255).toString(16).padStart(2, '0')}`,
      };
    case 'border-left':
      return {
        borderLeft: `4px solid ${color}`,
        paddingLeft: '12px',
      };
    case 'gradient':
      return {
        background: `linear-gradient(90deg, ${color}33 0%, transparent 100%)`,
      };
    default:
      return {};
  }
}
