import React, { useId } from 'react';
import { Input, Select } from '@/shared/components/ui';
import { ColumnSettingsProps } from './types';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { ImageCell, type ImageDisplayConfig } from '../../cells/ImageCell';
import { parseImageUrls, resolveAttachmentFormula } from '../../cells/attachmentValue';

const displayModes = [
  { value: 'stack', icon: '🎴' }, { value: 'carousel', icon: '◀️▶️' },
  { value: 'grid', icon: '🔲' }, { value: 'single', icon: '🖼️' },
] as const;
const fitOptions = ['cover', 'contain', 'fill', 'none'] as const;
const shapeOptions = [
  { value: 'square', icon: '⬜' }, { value: 'rounded', icon: '🔳' }, { value: 'circle', icon: '⚪' },
] as const;
const sampleImages = [0, 1, 2].map(index => ({
  url: 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90" viewBox="0 0 160 90"><rect width="160" height="90" fill="${['#164e63', '#14532d', '#713f12'][index]}"/><circle cx="120" cy="24" r="14" fill="#fef08a"/><path d="M0 90L48 24L96 90ZM60 90L120 40L160 90Z" fill="#e2e8f0"/></svg>`),
}));

/**
 * Компонент настроек для колонок типа image
 */
export const ImageColumnSettings: React.FC<ColumnSettingsProps> = ({
  draft,
  setDraft,
  firstRow,
}) => {
  const { t } = useLanguage();
  const fieldId = useId();
  const imageConfig: ImageDisplayConfig = draft.config?.image || {};
  const rawValue = draft.config?.file?.formula
    ? resolveAttachmentFormula(draft.config.file.formula, firstRow || undefined)
    : firstRow?.[draft.name] ?? firstRow?.[draft.id];
  const hasImages = parseImageUrls(rawValue).length > 0;

  const updateConfig = (updates: Partial<typeof imageConfig>) => {
    setDraft(prev => ({
      ...prev,
      config: {
        ...prev.config,
        image: { ...prev.config?.image, ...updates }
      }
    }));
  };

  const rowHeight = imageConfig.rowHeight || 48;
  const maxImages = imageConfig.maxImages || 5;

  return (
    <div className="space-y-4">
      <h4 className="font-medium text-[var(--text-primary)] flex items-center gap-2">
        🖼️ {t('columnSettings.image.title')}
      </h4>

      {/* Режим отображения галереи */}
      <fieldset className="min-w-0">
        <legend className="block text-sm font-medium text-[var(--text-primary)] mb-2">
          {t('columnSettings.image.galleryMode')}
        </legend>
        <div className="grid grid-cols-2 gap-2">
          {displayModes.map(mode => (
            <button aria-pressed={(imageConfig.displayMode || 'stack') === mode.value}
              key={mode.value}
              type="button"
              onClick={() => updateConfig({ displayMode: mode.value })}
              className={`p-3 rounded-lg border text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 ${
                (imageConfig.displayMode || 'stack') === mode.value
                  ? 'border-primary-500 bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                  : 'border-[var(--border-primary)] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span aria-hidden="true">{mode.icon}</span>
                <span className="font-medium text-sm">{t(`columnSettings.image.${mode.value}`)}</span>
              </div>
              <div className="text-xs text-[var(--text-secondary)]">{t(`columnSettings.image.${mode.value}Description`)}</div>
            </button>
          ))}
        </div>
      </fieldset>

      {/* Высота строки */}
      <div>
        <label htmlFor={`${fieldId}-rowHeight`} className="block text-sm font-medium text-[var(--text-primary)] mb-2">
          {t('columnSettings.image.height', { height: rowHeight })}
        </label>
        <input id={`${fieldId}-rowHeight`}
          type="range"
          min={32}
          max={200}
          step={8}
          value={rowHeight}
          onChange={(e) => updateConfig({ rowHeight: parseInt(e.target.value) })}
          className="w-full h-2 bg-[var(--bg-tertiary)] rounded-lg appearance-none cursor-pointer accent-primary-500"
        />
        <div className="flex justify-between text-xs text-[var(--text-secondary)] mt-1">
          <span>{t('columnSettings.image.compact')}</span>
          <span>{t('columnSettings.image.large')}</span>
        </div>
      </div>

      {/* Форма изображения */}
      <fieldset className="min-w-0">
        <legend className="block text-sm font-medium text-[var(--text-primary)] mb-2">
          {t('columnSettings.image.shape')}
        </legend>
        <div className="grid grid-cols-3 gap-2">
          {shapeOptions.map(shape => (
            <button aria-pressed={(imageConfig.shape || 'rounded') === shape.value}
              key={shape.value}
              type="button"
              onClick={() => updateConfig({ shape: shape.value })}
              className={`p-2 rounded-lg border text-center transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500 ${
                (imageConfig.shape || 'rounded') === shape.value
                  ? 'border-primary-500 bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                  : 'border-[var(--border-primary)] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
              }`}
            >
              <span aria-hidden="true" className="text-lg">{shape.icon}</span>
              <div className="text-xs mt-1">{t(`columnSettings.image.${shape.value}`)}</div>
            </button>
          ))}
        </div>
      </fieldset>

      {/* Заполнение */}
      <Select
        label={t('columnSettings.image.fit')}
        value={imageConfig.fit || 'cover'}
        onChange={(value) => updateConfig({ fit: value as ImageDisplayConfig['fit'] })}
        options={fitOptions.map(opt => ({
          value: opt,
          label: t(`columnSettings.image.${opt}`)
        }))}
      />

      {/* Настройки стека */}
      {(imageConfig.displayMode === 'stack' || !imageConfig.displayMode) && (
        <fieldset className="min-w-0 p-3 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-secondary)] space-y-3">
          <legend className="block text-sm font-medium text-[var(--text-primary)]">
            {t('columnSettings.image.stackSettings')}
          </legend>
          
          <div className="grid grid-cols-2 gap-3">
            <Input id={`${fieldId}-input-1`}
              label={t('columnSettings.image.maxImages')}
              type="number"
              min={1}
              max={10}
              value={maxImages}
              onChange={(e) => updateConfig({ maxImages: Math.max(1, Math.min(10, parseInt(e.target.value) || 5)) })}
            />
            <Input id={`${fieldId}-input-2`}
              label={t('columnSettings.image.stackOffset')}
              type="number"
              min={4}
              max={32}
              value={imageConfig.stackOffset || 12}
              onChange={(e) => updateConfig({ stackOffset: Math.max(4, Math.min(32, parseInt(e.target.value) || 12)) })}
            />
          </div>
        </fieldset>
      )}

      {/* Настройки сетки */}
      {imageConfig.displayMode === 'grid' && (
        <fieldset className="min-w-0 p-3 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-secondary)] space-y-3">
          <legend className="block text-sm font-medium text-[var(--text-primary)]">
            {t('columnSettings.image.gridSettings')}
          </legend>
          
          <Input id={`${fieldId}-input-3`}
            label={t('columnSettings.image.thumbnailSize')}
            type="number"
            min={16}
            max={64}
            value={imageConfig.thumbnailSize || 32}
            onChange={(e) => updateConfig({ thumbnailSize: Math.max(16, Math.min(64, parseInt(e.target.value) || 32)) })}
          />
        </fieldset>
      )}

      {/* Опции отображения */}
      <fieldset className="min-w-0 space-y-2">
        <legend className="block text-sm font-medium text-[var(--text-primary)]">
          {t('columnSettings.image.options')}
        </legend>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={imageConfig.showCount !== false}
            onChange={(e) => updateConfig({ showCount: e.target.checked })}
            className="rounded border-[var(--border-primary)]"
          />
          <span className="text-sm text-[var(--text-secondary)]">{t('columnSettings.image.showCount')}</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={imageConfig.showOnHover === true}
            onChange={(e) => updateConfig({ showOnHover: e.target.checked })}
            className="rounded border-[var(--border-primary)]"
          />
          <span className="text-sm text-[var(--text-secondary)]">{t('columnSettings.image.showOnHover')}</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={imageConfig.lightbox !== false}
            onChange={(e) => updateConfig({ lightbox: e.target.checked })}
            className="rounded border-[var(--border-primary)]"
          />
          <span className="text-sm text-[var(--text-secondary)]">{t('columnSettings.image.lightbox')}</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={imageConfig.showFilename === true}
            onChange={(e) => updateConfig({ showFilename: e.target.checked })}
            className="rounded border-[var(--border-primary)]"
          />
          <span className="text-sm text-[var(--text-secondary)]">{t('columnSettings.image.showFilename')}</span>
        </label>
      </fieldset>

      <div className="p-3 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-primary)] overflow-x-auto">
        <p className="text-xs text-[var(--text-secondary)] mb-2">{t('columnSettings.image.preview')}</p>
        <ImageCell value={hasImages ? rawValue : sampleImages} readOnly
          config={hasImages ? draft.config : { image: imageConfig }} rowData={firstRow || undefined} />
        {!hasImages && <p className="text-xs text-[var(--text-secondary)] mt-2">{t('columnSettings.image.sampleHint')}</p>}
      </div>
    </div>
  );
};
