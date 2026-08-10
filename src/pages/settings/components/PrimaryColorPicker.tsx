import { useState, useRef, useEffect } from 'react';
import { useTheme, PrimaryColor, COLOR_PRESETS, PrimaryColorPreset } from '@/shared/hooks/useTheme';
import { ChevronDown } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext';

// Quick preset colors
const COLOR_OPTIONS: Array<{ key: PrimaryColorPreset; label: string; labelEn: string; color: string }> = [
  { key: 'blue', label: 'Синий', labelEn: 'Blue', color: COLOR_PRESETS.blue['500'] },
  { key: 'purple', label: 'Фиолетовый', labelEn: 'Purple', color: COLOR_PRESETS.purple['500'] },
  { key: 'green', label: 'Зелёный', labelEn: 'Green', color: COLOR_PRESETS.green['500'] },
  { key: 'orange', label: 'Оранжевый', labelEn: 'Orange', color: COLOR_PRESETS.orange['500'] },
  { key: 'red', label: 'Красный', labelEn: 'Red', color: COLOR_PRESETS.red['500'] },
  { key: 'pink', label: 'Розовый', labelEn: 'Pink', color: COLOR_PRESETS.pink['500'] },
  { key: 'teal', label: 'Бирюзовый', labelEn: 'Teal', color: COLOR_PRESETS.teal['500'] },
  { key: 'indigo', label: 'Индиго', labelEn: 'Indigo', color: COLOR_PRESETS.indigo['500'] },
];

// Helper to get display color from PrimaryColor
const getDisplayColor = (color: PrimaryColor): string => {
  if (color.startsWith('#')) return color;
  const preset = COLOR_OPTIONS.find(o => o.key === color);
  return preset?.color || COLOR_PRESETS.blue['500'];
};

export const PrimaryColorPicker = () => {
  const { language } = useLanguage();
  const t = (ru: string, en: string) => (language === 'ru' ? ru : en);
  const { primaryColor, setPrimaryColor } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const [hexInput, setHexInput] = useState(() => {
    if (primaryColor.startsWith('#')) return primaryColor.toUpperCase();
    const preset = COLOR_OPTIONS.find(o => o.key === primaryColor);
    return preset?.color.toUpperCase() || '#3B82F6';
  });
  
  const containerRef = useRef<HTMLDivElement>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);

  // Sync hexInput when primaryColor changes externally
  useEffect(() => {
    const displayColor = getDisplayColor(primaryColor);
    setHexInput(displayColor.toUpperCase());
  }, [primaryColor]);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const handlePresetSelect = (key: PrimaryColorPreset) => {
    setPrimaryColor(key);
    setIsOpen(false);
  };

  const handleHexInputChange = (value: string) => {
    // Allow typing with or without #
    let hex = value.toUpperCase();
    if (!hex.startsWith('#') && hex.length > 0) {
      hex = '#' + hex;
    }
    setHexInput(hex);
    
    // Validate and apply
    if (/^#[0-9A-F]{6}$/i.test(hex)) {
      setPrimaryColor(hex as PrimaryColor);
    }
  };

  const handleNativeColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const hex = e.target.value.toUpperCase();
    setHexInput(hex);
    setPrimaryColor(hex as PrimaryColor);
  };

  const handleColorSquareClick = () => {
    colorInputRef.current?.click();
  };

  const displayColor = getDisplayColor(primaryColor);

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-[var(--text-secondary)]">{t('Акцентный цвет', 'Accent color')}</p>
      
      <div ref={containerRef} className="relative">
        <div className="flex">
          {/* Left: Color square (native color picker trigger) */}
          <button
            type="button"
            onClick={handleColorSquareClick}
            className="h-10 w-12 rounded-l-lg border border-r-0 border-[var(--border-primary)] flex items-center justify-center cursor-pointer hover:brightness-110 transition-all"
            style={{ backgroundColor: displayColor }}
            title={t('Выбрать цвет', 'Pick a color')}
          />
          
          {/* Hidden native color input */}
          <input
            ref={colorInputRef}
            type="color"
            value={displayColor}
            onChange={handleNativeColorChange}
            className="sr-only"
          />
          
          {/* Center: HEX input */}
          <input
            type="text"
            value={hexInput}
            onChange={(e) => handleHexInputChange(e.target.value)}
            placeholder="#3B82F6"
            maxLength={7}
            className="w-24 h-10 px-2 text-sm font-mono text-center border-y border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-inset focus:ring-[var(--color-primary-500)] uppercase"
          />
          
          {/* Right: Dropdown button for presets */}
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="h-10 w-8 rounded-r-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors flex items-center justify-center"
          >
            <ChevronDown className={`w-4 h-4 text-[var(--text-tertiary)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {/* Dropdown with presets */}
        {isOpen && (
          <div className="absolute top-full left-0 mt-1 z-50 bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg shadow-lg p-2 w-[200px]">
            <p className="text-xs font-medium text-[var(--text-tertiary)] mb-2 px-1">{t('Пресеты', 'Presets')}</p>
            <div className="grid grid-cols-4 gap-1.5">
              {COLOR_OPTIONS.map(({ key, label, labelEn, color }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => handlePresetSelect(key)}
                  className={`h-9 w-full rounded-md transition-all ${
                    primaryColor === key 
                      ? 'ring-2 ring-[var(--text-primary)] ring-offset-1 ring-offset-[var(--bg-secondary)] scale-105' 
                      : 'hover:scale-105 hover:brightness-110'
                  }`}
                  style={{ backgroundColor: color }}
                  title={t(label, labelEn)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
      
      <p className="text-xs text-[var(--text-tertiary)]">
        {t('Выбранный цвет применяется к кнопкам, ссылкам и акцентным элементам', 'The selected color applies to buttons, links and accent elements')}
      </p>
    </div>
  );
};
