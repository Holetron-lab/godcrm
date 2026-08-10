import React from 'react';
import { Input, Select } from '@/shared/components/ui';
import { ColumnSettingsProps } from './types';

type GalleryDisplayMode = 'stack' | 'carousel' | 'grid' | 'single';

const displayModes: Array<{ value: GalleryDisplayMode; label: string; description: string; icon: string }> = [
  { value: 'stack', label: 'Стек', description: 'Накладываются друг на друга', icon: '🎴' },
  { value: 'carousel', label: 'Карусель', description: 'Перелистывание стрелками', icon: '◀️▶️' },
  { value: 'grid', label: 'Сетка', description: 'Миниатюры в ряд', icon: '🔲' },
  { value: 'single', label: 'Одно фото', description: 'Только первое изображение', icon: '🖼️' },
];

type ImageFit = 'cover' | 'contain' | 'fill' | 'none';

const fitOptions: Array<{ value: ImageFit; label: string; description: string }> = [
  { value: 'cover', label: 'Заполнить', description: 'Обрезает края' },
  { value: 'contain', label: 'Вписать', description: 'Целиком с полями' },
  { value: 'fill', label: 'Растянуть', description: 'Без сохранения пропорций' },
  { value: 'none', label: 'Оригинал', description: 'Без изменений' },
];

type ImageShape = 'square' | 'rounded' | 'circle';

const shapeOptions: Array<{ value: ImageShape; label: string; icon: string }> = [
  { value: 'square', label: 'Квадрат', icon: '⬜' },
  { value: 'rounded', label: 'Скруглённый', icon: '🔳' },
  { value: 'circle', label: 'Круг', icon: '⚪' },
];

/**
 * Компонент настроек для колонок типа image
 */
export const ImageColumnSettings: React.FC<ColumnSettingsProps> = ({
  draft,
  setDraft,
  allColumns = [],
  firstRow,
}) => {
  const imageConfig = draft.config?.image || {};

  const updateConfig = (updates: Partial<typeof imageConfig>) => {
    setDraft(prev => ({
      ...prev,
      config: {
        ...prev.config,
        image: { ...imageConfig, ...updates }
      }
    }));
  };

  const rowHeight = imageConfig.rowHeight || 48;
  const maxImages = imageConfig.maxImages || 5;

  return (
    <div className="space-y-4">
      <h4 className="font-medium text-[var(--text-primary)] flex items-center gap-2">
        🖼️ Настройки изображений
      </h4>

      {/* Режим отображения галереи */}
      <div>
        <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
          Режим галереи
        </label>
        <div className="grid grid-cols-2 gap-2">
          {displayModes.map(mode => (
            <button
              key={mode.value}
              type="button"
              onClick={() => updateConfig({ displayMode: mode.value })}
              className={`p-3 rounded-lg border text-left transition-all ${
                (imageConfig.displayMode || 'stack') === mode.value
                  ? 'border-primary-500 bg-primary-50 text-primary-600 dark:text-primary-400'
                  : 'border-[var(--border-secondary)] hover:border-[var(--border-primary)]'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span>{mode.icon}</span>
                <span className="font-medium text-sm">{mode.label}</span>
              </div>
              <div className="text-xs text-[var(--text-tertiary)]">{mode.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Высота строки */}
      <div>
        <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
          Высота изображений: {rowHeight}px
        </label>
        <input
          type="range"
          min={32}
          max={200}
          step={8}
          value={rowHeight}
          onChange={(e) => updateConfig({ rowHeight: parseInt(e.target.value) })}
          className="w-full h-2 bg-[var(--bg-tertiary)] rounded-lg appearance-none cursor-pointer accent-primary-500"
        />
        <div className="flex justify-between text-xs text-[var(--text-tertiary)] mt-1">
          <span>32px (компактно)</span>
          <span>200px (большие)</span>
        </div>
      </div>

      {/* Форма изображения */}
      <div>
        <label className="block text-sm font-medium text-[var(--text-primary)] mb-2">
          Форма
        </label>
        <div className="grid grid-cols-3 gap-2">
          {shapeOptions.map(shape => (
            <button
              key={shape.value}
              type="button"
              onClick={() => updateConfig({ shape: shape.value })}
              className={`p-2 rounded-lg border text-center transition-all ${
                (imageConfig.shape || 'rounded') === shape.value
                  ? 'border-green-500 bg-green-500/10 text-green-600 dark:text-green-400'
                  : 'border-[var(--border-secondary)] hover:border-[var(--border-primary)]'
              }`}
            >
              <span className="text-lg">{shape.icon}</span>
              <div className="text-xs mt-1">{shape.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Заполнение */}
      <Select
        label="Заполнение"
        value={imageConfig.fit || 'cover'}
        onChange={(value) => updateConfig({ fit: value as ImageFit })}
        options={fitOptions.map(opt => ({
          value: opt.value,
          label: `${opt.label} — ${opt.description}`
        }))}
      />

      {/* Настройки стека */}
      {(imageConfig.displayMode === 'stack' || !imageConfig.displayMode) && (
        <div className="p-3 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-secondary)] space-y-3">
          <label className="block text-sm font-medium text-[var(--text-primary)]">
            Настройки стека
          </label>
          
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Макс. изображений"
              type="number"
              min={1}
              max={10}
              value={maxImages}
              onChange={(e) => updateConfig({ maxImages: parseInt(e.target.value) || 5 })}
            />
            <Input
              label="Смещение (px)"
              type="number"
              min={4}
              max={32}
              value={imageConfig.stackOffset || 12}
              onChange={(e) => updateConfig({ stackOffset: parseInt(e.target.value) || 12 })}
            />
          </div>
        </div>
      )}

      {/* Настройки сетки */}
      {imageConfig.displayMode === 'grid' && (
        <div className="p-3 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-secondary)] space-y-3">
          <label className="block text-sm font-medium text-[var(--text-primary)]">
            Настройки сетки
          </label>
          
          <Input
            label="Размер миниатюры (px)"
            type="number"
            min={16}
            max={64}
            value={imageConfig.thumbnailSize || 32}
            onChange={(e) => updateConfig({ thumbnailSize: parseInt(e.target.value) || 32 })}
          />
        </div>
      )}

      {/* Опции отображения */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-[var(--text-primary)]">
          Опции
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={imageConfig.showCount !== false}
            onChange={(e) => updateConfig({ showCount: e.target.checked })}
            className="rounded border-[var(--border-primary)]"
          />
          <span className="text-sm text-[var(--text-secondary)]">Показывать количество изображений</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={imageConfig.showOnHover === true}
            onChange={(e) => updateConfig({ showOnHover: e.target.checked })}
            className="rounded border-[var(--border-primary)]"
          />
          <span className="text-sm text-[var(--text-secondary)]">Увеличивать при наведении</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={imageConfig.lightbox !== false}
            onChange={(e) => updateConfig({ lightbox: e.target.checked })}
            className="rounded border-[var(--border-primary)]"
          />
          <span className="text-sm text-[var(--text-secondary)]">Открывать в лайтбоксе по клику</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={imageConfig.showFilename === true}
            onChange={(e) => updateConfig({ showFilename: e.target.checked })}
            className="rounded border-[var(--border-primary)]"
          />
          <span className="text-sm text-[var(--text-secondary)]">Показывать имя файла</span>
        </label>
      </div>

      {/* Превью */}
      <div className="p-3 bg-[var(--bg-tertiary)] rounded-lg border border-[var(--border-secondary)]">
        <p className="text-xs text-[var(--text-tertiary)] mb-2">Превью:</p>
        <div className="flex items-center gap-2">
          {/* Стек/Карусель */}
          {(imageConfig.displayMode === 'stack' || !imageConfig.displayMode) && (
            <div className="relative" style={{ width: rowHeight * 1.5, height: rowHeight }}>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className={`absolute bg-gradient-to-br from-primary-400 to-purple-500 border-2 border-white dark:border-gray-800 ${
                    imageConfig.shape === 'circle' ? 'rounded-full' : 
                    imageConfig.shape === 'square' ? 'rounded-none' : 'rounded-lg'
                  }`}
                  style={{
                    width: rowHeight,
                    height: rowHeight,
                    left: i * (imageConfig.stackOffset || 12),
                    zIndex: 3 - i,
                  }}
                />
              ))}
            </div>
          )}
          
          {imageConfig.displayMode === 'carousel' && (
            <div className="flex items-center gap-1">
              <button className="p-1 rounded bg-[var(--bg-secondary)] text-[var(--text-tertiary)]">◀</button>
              <div
                className={`bg-gradient-to-br from-green-400 to-primary-500 ${
                  imageConfig.shape === 'circle' ? 'rounded-full' : 
                  imageConfig.shape === 'square' ? 'rounded-none' : 'rounded-lg'
                }`}
                style={{ width: rowHeight, height: rowHeight }}
              />
              <button className="p-1 rounded bg-[var(--bg-secondary)] text-[var(--text-tertiary)]">▶</button>
            </div>
          )}
          
          {imageConfig.displayMode === 'grid' && (
            <div className="flex gap-1">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`bg-gradient-to-br ${
                    i % 2 === 0 ? 'from-pink-400 to-red-500' : 'from-yellow-400 to-orange-500'
                  } ${
                    imageConfig.shape === 'circle' ? 'rounded-full' : 
                    imageConfig.shape === 'square' ? 'rounded-none' : 'rounded'
                  }`}
                  style={{ 
                    width: imageConfig.thumbnailSize || 32, 
                    height: imageConfig.thumbnailSize || 32 
                  }}
                />
              ))}
            </div>
          )}
          
          {imageConfig.displayMode === 'single' && (
            <div
              className={`bg-gradient-to-br from-cyan-400 to-teal-500 ${
                imageConfig.shape === 'circle' ? 'rounded-full' : 
                imageConfig.shape === 'square' ? 'rounded-none' : 'rounded-lg'
              }`}
              style={{ width: rowHeight, height: rowHeight }}
            />
          )}
          
          {/* Счётчик */}
          {imageConfig.showCount !== false && (
            <span className="text-xs text-[var(--text-tertiary)] ml-2">
              +3 фото
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
