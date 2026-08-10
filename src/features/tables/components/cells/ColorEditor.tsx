/**
 * ADR-028: Color Editor Component
 * Inline editor for selecting colors in table cells
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import { CellPortal } from '@/shared/components/ui/CellPortal';
import {
  DEFAULT_20_COLORS,
  DEFAULT_EMOJI_PALETTE,
  RAL_CLASSIC_COLORS,
  PANTONE_SOLID_COATED,
  isValidHex,
  isValidEmoji,
  getDisplayValue,
  cmykToHex,
  type ColorListItem,
  type PantoneColor,
  type CMYK,
} from '../../utils/color-utils';
import type { ColorColumnConfig, ColorValue, ColorValueObject, ColorMode } from '../../types/table.types';

interface ColorEditorProps {
  value: string;
  config?: ColorColumnConfig;
  onChange: (value: string) => void;
  onCommit: (valueOverride?: string) => void;
  onCancel: () => void;
}

type TabMode = 'list' | 'palette' | 'cmyk' | 'ral' | 'pantone' | 'emoji';

const TAB_LABELS: Record<TabMode, string> = {
  list: 'Список',
  palette: 'Палитра',
  cmyk: 'CMYK',
  ral: 'RAL',
  pantone: 'Pantone',
  emoji: 'Emoji',
};

export const ColorEditor = ({
  value,
  config,
  onChange,
  onCommit,
  onCancel,
}: ColorEditorProps) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Determine which tabs to show based on config mode
  const getAvailableTabs = (): TabMode[] => {
    const mode = config?.mode || 'palette';
    if (mode === 'all') {
      return ['list', 'palette', 'cmyk', 'ral', 'pantone', 'emoji'];
    }
    return [mode as TabMode];
  };

  const availableTabs = getAvailableTabs();
  const [activeTab, setActiveTab] = useState<TabMode>(availableTabs[0]);
  const [search, setSearch] = useState('');

  // CMYK state
  const [cmykValues, setCmykValues] = useState<CMYK>({ c: 0, m: 0, y: 0, k: 0 });

  // Custom HEX input
  const [customHex, setCustomHex] = useState('');
  
  // Focus trap and keyboard handling
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onCommit();
      }
    };
    
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onCommit, onCancel]);
  
  // Select color
  const handleSelectColor = useCallback((colorValue: string) => {
    onChange(colorValue);
    onCommit(colorValue);
  }, [onChange, onCommit]);
  
  // Select emoji
  const handleSelectEmoji = useCallback((emoji: string) => {
    onChange(emoji);
    onCommit(emoji);
  }, [onChange, onCommit]);
  
  // Select CMYK (convert to hex for storage)
  const handleSelectCmyk = useCallback(() => {
    const hex = cmykToHex(cmykValues.c, cmykValues.m, cmykValues.y, cmykValues.k);
    // Store as ColorValueObject JSON
    const colorValue: ColorValueObject = {
      type: 'cmyk',
      value: hex,
      original: { cmyk: cmykValues },
    };
    const jsonValue = JSON.stringify(colorValue);
    onChange(jsonValue);
    onCommit(jsonValue);
  }, [cmykValues, onChange, onCommit]);
  
  // Clear selection
  const handleClear = useCallback(() => {
    onChange('');
    onCommit('');
  }, [onChange, onCommit]);
  
  // Filter colors by search
  const filterColors = (colors: ColorListItem[], searchTerm: string) => {
    if (!searchTerm) return colors;
    const term = searchTerm.toLowerCase();
    return colors.filter(c => 
      c.name.toLowerCase().includes(term) ||
      c.nameEn?.toLowerCase().includes(term) ||
      c.hex.toLowerCase().includes(term) ||
      c.ral?.toLowerCase().includes(term)
    );
  };
  
  const filterPantone = (colors: PantoneColor[], searchTerm: string) => {
    if (!searchTerm) return colors;
    const term = searchTerm.toLowerCase();
    return colors.filter(c => 
      c.name.toLowerCase().includes(term) ||
      c.code.toLowerCase().includes(term) ||
      c.hex.toLowerCase().includes(term)
    );
  };
  
  // Render tab content
  const renderTabContent = () => {
    switch (activeTab) {
      case 'list':
        return renderListMode();
      case 'palette':
        return renderPaletteMode();
      case 'cmyk':
        return renderCmykMode();
      case 'ral':
        return renderRalMode();
      case 'pantone':
        return renderPantoneMode();
      case 'emoji':
        return renderEmojiMode();
      default:
        return renderPaletteMode();
    }
  };
  
  // List mode (20 colors)
  const renderListMode = () => {
    const colors = filterColors(config?.colorList || DEFAULT_20_COLORS, search);
    return (
      <div className="p-2">
        <div className="grid grid-cols-4 gap-1.5">
          {colors.map((color) => (
            <button
              key={color.id}
              type="button"
              onClick={() => handleSelectColor(color.hex)}
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded hover:bg-[var(--bg-secondary)] transition-colors text-left ${
                value === color.hex ? 'ring-2 ring-[var(--color-primary-500)]' : ''
              }`}
              title={`${color.name} (${color.hex})`}
            >
              <span
                className="w-4 h-4 rounded-sm shadow-sm border border-black/10 flex-shrink-0"
                style={{ backgroundColor: color.hex }}
              />
              <span className="text-xs truncate">{color.name}</span>
            </button>
          ))}
        </div>
      </div>
    );
  };
  
  // Palette mode (color grid + custom input)
  const renderPaletteMode = () => {
    const presetColors = config?.presetColors || DEFAULT_20_COLORS.map(c => c.hex);
    return (
      <div className="p-2 space-y-3">
        {/* Color grid */}
        <div className="grid grid-cols-10 gap-1">
          {presetColors.map((hex, index) => (
            <button
              key={`${hex}-${index}`}
              type="button"
              onClick={() => handleSelectColor(hex)}
              className={`w-6 h-6 rounded shadow-sm border border-black/10 hover:scale-110 transition-transform ${
                value === hex ? 'ring-2 ring-[var(--color-primary-500)] ring-offset-1' : ''
              }`}
              style={{ backgroundColor: hex }}
              title={hex}
            />
          ))}
        </div>
        
        {/* Custom HEX input */}
        {config?.allowCustomColor !== false && (
          <div className="flex gap-2 items-center">
            <input
              type="text"
              placeholder="#ff0000"
              value={customHex}
              onChange={(e) => setCustomHex(e.target.value)}
              className="flex-1 px-2 py-1 text-sm font-mono rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
            />
            <button
              type="button"
              onClick={() => {
                if (isValidHex(customHex)) {
                  handleSelectColor(customHex.toLowerCase());
                }
              }}
              disabled={!isValidHex(customHex)}
              className="px-3 py-1 text-sm rounded bg-[var(--color-primary-500)] text-white disabled:opacity-50"
            >
              OK
            </button>
          </div>
        )}
      </div>
    );
  };
  
  // CMYK mode
  const renderCmykMode = () => {
    const previewHex = cmykToHex(cmykValues.c, cmykValues.m, cmykValues.y, cmykValues.k);
    return (
      <div className="p-3 space-y-3">
        {/* Sliders */}
        {(['c', 'm', 'y', 'k'] as const).map((channel) => (
          <div key={channel} className="flex items-center gap-2">
            <span className="w-4 text-xs font-bold text-[var(--text-secondary)] uppercase">{channel}</span>
            <input
              type="range"
              min="0"
              max="100"
              value={cmykValues[channel]}
              onChange={(e) => setCmykValues(prev => ({ ...prev, [channel]: Number(e.target.value) }))}
              className="flex-1"
            />
            <input
              type="number"
              min="0"
              max="100"
              value={cmykValues[channel]}
              onChange={(e) => setCmykValues(prev => ({ ...prev, [channel]: Math.min(100, Math.max(0, Number(e.target.value))) }))}
              className="w-12 px-1 py-0.5 text-xs text-center rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)]"
            />
          </div>
        ))}
        
        {/* Preview */}
        <div className="flex items-center gap-3 pt-2 border-t border-[var(--border-secondary)]">
          <span
            className="w-10 h-10 rounded shadow border border-black/10"
            style={{ backgroundColor: previewHex }}
          />
          <div className="flex-1">
            <div className="text-xs text-[var(--text-tertiary)]">HEX (preview)</div>
            <div className="font-mono text-sm">{previewHex}</div>
          </div>
          <button
            type="button"
            onClick={handleSelectCmyk}
            className="px-3 py-1.5 text-sm rounded bg-[var(--color-primary-500)] text-white"
          >
            Применить
          </button>
        </div>
      </div>
    );
  };
  
  // RAL mode
  const renderRalMode = () => {
    const colors = filterColors(RAL_CLASSIC_COLORS, search);
    return (
      <div className="overflow-y-auto" style={{ maxHeight: '250px' }}>
        {colors.map((color) => (
          <button
            key={color.id}
            type="button"
            onClick={() => {
              const colorValue: ColorValueObject = {
                type: 'ral',
                value: color.hex,
                original: { ral: color.ral },
                name: color.name,
              };
              const jsonValue = JSON.stringify(colorValue);
              onChange(jsonValue);
              onCommit(jsonValue);
            }}
            className={`w-full flex items-center gap-2 px-3 py-2 hover:bg-[var(--bg-secondary)] transition-colors text-left ${
              value.includes(color.hex) ? 'bg-[var(--color-primary-500)]/10' : ''
            }`}
          >
            <span
              className="w-6 h-6 rounded shadow-sm border border-black/10 flex-shrink-0"
              style={{ backgroundColor: color.hex }}
            />
            <span className="flex-1">
              <div className="text-sm font-medium">{color.ral}</div>
              <div className="text-xs text-[var(--text-tertiary)]">{color.name}</div>
            </span>
          </button>
        ))}
      </div>
    );
  };
  
  // Pantone mode
  const renderPantoneMode = () => {
    const colors = filterPantone(PANTONE_SOLID_COATED, search);
    return (
      <div className="overflow-y-auto" style={{ maxHeight: '250px' }}>
        {colors.map((color) => (
          <button
            key={color.id}
            type="button"
            onClick={() => {
              const colorValue: ColorValueObject = {
                type: 'pantone',
                value: color.hex,
                original: { pantone: color.code },
                name: color.name,
              };
              const jsonValue = JSON.stringify(colorValue);
              onChange(jsonValue);
              onCommit(jsonValue);
            }}
            className={`w-full flex items-center gap-2 px-3 py-2 hover:bg-[var(--bg-secondary)] transition-colors text-left ${
              value.includes(color.hex) ? 'bg-[var(--color-primary-500)]/10' : ''
            }`}
          >
            <span
              className="w-6 h-6 rounded shadow-sm border border-black/10 flex-shrink-0"
              style={{ backgroundColor: color.hex }}
            />
            <span className="flex-1">
              <div className="text-sm font-medium">{color.code}</div>
              <div className="text-xs text-[var(--text-tertiary)]">{color.name}</div>
            </span>
          </button>
        ))}
      </div>
    );
  };
  
  // Emoji mode
  const renderEmojiMode = () => {
    const emojis = config?.presetEmojis || DEFAULT_EMOJI_PALETTE;
    return (
      <div className="p-2">
        <div className="grid grid-cols-8 gap-1">
          {emojis.map((emoji, index) => (
            <button
              key={`${emoji}-${index}`}
              type="button"
              onClick={() => handleSelectEmoji(emoji)}
              className={`w-8 h-8 text-xl flex items-center justify-center rounded hover:bg-[var(--bg-secondary)] transition-colors ${
                value === emoji ? 'ring-2 ring-[var(--color-primary-500)]' : ''
              }`}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
    );
  };
  
  return (
    <>
      {/* CellPortal dropdown - viewport-aware positioning */}
      <CellPortal
        ref={containerRef}
        width={320}
        maxHeight={400}
        className="bg-[var(--bg-primary)] rounded-lg shadow-xl border border-[var(--border-primary)] overflow-hidden"
      >
        {/* Tabs (if multiple modes) */}
        {availableTabs.length > 1 && (
          <div className="flex border-b border-[var(--border-secondary)] overflow-x-auto">
            {availableTabs.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
                  activeTab === tab
                    ? 'text-[var(--color-primary-500)] border-b-2 border-[var(--color-primary-500)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
          </div>
        )}

        {/* Search (for list/ral/pantone modes) */}
        {['list', 'ral', 'pantone'].includes(activeTab) && (
          <div className="p-2 border-b border-[var(--border-secondary)]">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск..."
              className="w-full px-3 py-1.5 text-sm rounded-md bg-[var(--bg-secondary)] border border-[var(--border-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
            />
          </div>
        )}

        {/* Tab content */}
        {renderTabContent()}

        {/* Footer with clear button */}
        <div className="flex justify-between items-center px-3 py-2 border-t border-[var(--border-secondary)] bg-[var(--bg-secondary)]">
          <button
            type="button"
            onClick={handleClear}
            className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
          >
            Очистить
          </button>

          {/* Current value preview */}
          {value && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-[var(--text-tertiary)]">Выбрано:</span>
              {isValidEmoji(value) ? (
                <span className="text-base">{value}</span>
              ) : isValidHex(value) ? (
                <span
                  className="w-4 h-4 rounded border border-black/10"
                  style={{ backgroundColor: value }}
                />
              ) : (
                <span className="font-mono">{value.slice(0, 10)}...</span>
              )}
            </div>
          )}
        </div>
      </CellPortal>
    </>
  );
};
