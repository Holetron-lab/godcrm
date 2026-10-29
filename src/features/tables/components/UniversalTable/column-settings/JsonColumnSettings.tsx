import React, { useId, useEffect, useMemo, useState } from 'react';
import { ColumnSettingsProps } from './types';
import type { JsonColumnConfig } from '../../../types/table.types';
import { useLanguage } from '@/shared/i18n/LanguageContext';

type JsonMode = 'code' | 'tree' | 'form';

const DEFAULT_TEMPLATE = '{}';
const DEFAULT_MODE: JsonMode = 'code';
const DEFAULT_PRETTY = true;
const DEFAULT_PREVIEW_LINES = 3;

const MODES: JsonMode[] = ['code', 'tree', 'form'];

type JsonCellView = NonNullable<JsonColumnConfig['cellView']>;
const DEFAULT_CELL_VIEW: JsonCellView = 'preview';
const CELL_VIEWS: JsonCellView[] = ['preview', 'table'];

/**
 * ADR-0017 Phase 2 — настройки колонки типа `json`.
 * Хранит конфиг под `draft.config.json`. Невалидный JSON в `template`
 * показывает inline-ошибку; родительский drawer прерывает Save.
 */
export const JsonColumnSettings: React.FC<ColumnSettingsProps> = ({ draft, setDraft }) => {
  const { t } = useLanguage();
  const fieldId = useId();
  const json = draft.config?.json ?? {};
  const template = json.template ?? DEFAULT_TEMPLATE;
  const defaultMode: JsonMode = (json.defaultMode as JsonMode) ?? DEFAULT_MODE;
  const prettyInCell = json.prettyInCell ?? DEFAULT_PRETTY;
  const previewLines = json.previewLines ?? DEFAULT_PREVIEW_LINES;
  const cellView: JsonCellView = json.cellView ?? DEFAULT_CELL_VIEW;

  const [localTemplate, setLocalTemplate] = useState<string>(template);

  useEffect(() => {
    setLocalTemplate(template);
  }, [template]);

  const templateError = useMemo(() => {
    if (!localTemplate || !localTemplate.trim()) return null;
    try {
      JSON.parse(localTemplate);
      return null;
    } catch (err) {
      return (err as Error).message;
    }
  }, [localTemplate]);

  const updateJson = (patch: Partial<NonNullable<typeof draft.config>['json']>) => {
    setDraft(prev => ({
      ...prev,
      config: {
        ...prev.config,
        json: {
          template: prev.config?.json?.template ?? DEFAULT_TEMPLATE,
          defaultMode: prev.config?.json?.defaultMode ?? DEFAULT_MODE,
          prettyInCell: prev.config?.json?.prettyInCell ?? DEFAULT_PRETTY,
          previewLines: prev.config?.json?.previewLines ?? DEFAULT_PREVIEW_LINES,
          cellView: prev.config?.json?.cellView ?? DEFAULT_CELL_VIEW,
          ...patch,
        },
      },
    }));
  };

  const handleTemplateChange = (value: string | undefined) => {
    const next = value ?? '';
    setLocalTemplate(next);
    updateJson({ template: next });
  };

  const handlePrettify = () => {
    if (templateError) return;
    try {
      const obj = JSON.parse(localTemplate || DEFAULT_TEMPLATE);
      const pretty = JSON.stringify(obj, null, 2);
      setLocalTemplate(pretty);
      updateJson({ template: pretty });
    } catch {
      // ignore — UI already shows error
    }
  };

  const radioClass = (checked: boolean) =>
    `flex items-center gap-2 px-3 py-2 rounded border cursor-pointer text-sm ${
      checked
        ? 'border-[var(--color-primary-500)] bg-[var(--color-primary-50)] dark:bg-primary-900'
        : 'border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)]'
    }`;

  return (
    <div className="space-y-4">
      <h4 className="font-medium text-[var(--text-primary)] flex items-center gap-2">
        🧬 {t('columnSettings.json.title')}
      </h4>

      {/* Шаблон */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label htmlFor={`${fieldId}-template`} className="text-sm font-medium text-[var(--text-secondary)]">
            {t('columnSettings.json.template')}
          </label>
          <button
            type="button"
            onClick={handlePrettify}
            disabled={Boolean(templateError) || !localTemplate.trim()}
            className="text-xs px-2 py-1 rounded border border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50 disabled:cursor-not-allowed"
            title={t('columnSettings.json.formatHint')}
          >
            {t('columnSettings.json.format')}
          </button>
        </div>
        <textarea id={`${fieldId}-template`}
          value={localTemplate}
          onChange={(e) => handleTemplateChange(e.target.value)}
          spellCheck={false}
          placeholder="{}"
          className={`w-full font-mono text-xs px-3 py-2 rounded border bg-[var(--bg-primary)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary-500)] resize-y ${
            templateError ? 'border-red-500' : 'border-[var(--border-primary)]'
          }`}
          style={{ minHeight: 180 }}
        />
        {templateError ? (
          <p className="text-xs text-red-500" data-testid="json-template-error">
            ⚠️ {t('columnSettings.json.invalid', { error: templateError })}
          </p>
        ) : (
          <p className="text-xs text-[var(--text-tertiary)]">
            {t('columnSettings.json.templateHint')}
          </p>
        )}
      </div>

      {/* Default mode */}
      <fieldset className="min-w-0 space-y-2">
        <legend className="text-sm font-medium text-[var(--text-secondary)]">
          {t('columnSettings.json.defaultMode')}
        </legend>
        <div className="flex flex-wrap gap-2">
          {MODES.map(mode => (
            <label
              key={mode}
              className={radioClass(defaultMode === mode)}
              title={t(`columnSettings.json.modes.${mode}Hint`)}
            >
              <input
                type="radio"
                name={`${fieldId}-default-mode`}
                value={mode}
                checked={defaultMode === mode}
                onChange={() => updateJson({ defaultMode: mode })}
                className="accent-[var(--color-primary-500)]"
              />
              <span>{t(`columnSettings.json.modes.${mode}`)}</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-[var(--text-tertiary)]">
          {t('columnSettings.json.defaultModeHint')}
        </p>
      </fieldset>

      {/* Cell view */}
      <fieldset className="min-w-0 space-y-2">
        <legend className="text-sm font-medium text-[var(--text-secondary)]">
          {t('columnSettings.json.cellView')}
        </legend>
        <div className="flex flex-wrap gap-2">
          {CELL_VIEWS.map(view => (
            <label
              key={view}
              className={radioClass(cellView === view)}
              title={t(`columnSettings.json.views.${view}Hint`)}
            >
              <input
                type="radio"
                name={`${fieldId}-cell-view`}
                value={view}
                checked={cellView === view}
                onChange={() => updateJson({ cellView: view })}
                className="accent-[var(--color-primary-500)]"
              />
              <span>{t(`columnSettings.json.views.${view}`)}</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-[var(--text-tertiary)]">
          {t('columnSettings.json.cellViewHint')}
        </p>
      </fieldset>

      {/* Pretty in cell */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={prettyInCell}
            onChange={(e) => updateJson({ prettyInCell: e.target.checked })}
            className="accent-[var(--color-primary-500)]"
          />
          <span className="text-sm text-[var(--text-primary)]">
            {t('columnSettings.json.prettyInCell')}
          </span>
        </label>
      </div>

      {/* Preview lines */}
      <div className="space-y-2">
        <label htmlFor={`${fieldId}-previewLines`} className="text-sm font-medium text-[var(--text-secondary)]">
          {t('columnSettings.json.previewLines')}
        </label>
        <input id={`${fieldId}-previewLines`}
          type="number"
          min={1}
          max={10}
          value={previewLines}
          onChange={(e) => {
            const raw = Number(e.target.value);
            const clamped = Number.isFinite(raw)
              ? Math.max(1, Math.min(10, Math.round(raw)))
              : DEFAULT_PREVIEW_LINES;
            updateJson({ previewLines: clamped });
          }}
          className="w-24 px-2 py-1.5 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-primary)]"
        />
        <p className="text-xs text-[var(--text-tertiary)]">
          {t('columnSettings.json.previewLinesHint')}
        </p>
      </div>
    </div>
  );
};
