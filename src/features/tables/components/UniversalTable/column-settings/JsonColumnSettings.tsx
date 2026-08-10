import React, { useEffect, useMemo, useState } from 'react';
import { ColumnSettingsProps } from './types';

type JsonMode = 'code' | 'tree' | 'form';

const DEFAULT_TEMPLATE = '{}';
const DEFAULT_MODE: JsonMode = 'code';
const DEFAULT_PRETTY = true;
const DEFAULT_PREVIEW_LINES = 3;

const MODES: Array<{ value: JsonMode; label: string; hint: string }> = [
  { value: 'code', label: 'Код', hint: 'Текстовый JSON-редактор' },
  { value: 'tree', label: 'Дерево', hint: 'Иерархический просмотр' },
  { value: 'form', label: 'Форма', hint: 'По шаблону (если задан)' },
];

/**
 * ADR-0017 Phase 2 — настройки колонки типа `json`.
 * Хранит конфиг под `draft.config.json`. Невалидный JSON в `template`
 * показывает inline-ошибку; родительский drawer прерывает Save.
 */
export const JsonColumnSettings: React.FC<ColumnSettingsProps> = ({ draft, setDraft }) => {
  const json = draft.config?.json ?? {};
  const template = json.template ?? DEFAULT_TEMPLATE;
  const defaultMode: JsonMode = (json.defaultMode as JsonMode) ?? DEFAULT_MODE;
  const prettyInCell = json.prettyInCell ?? DEFAULT_PRETTY;
  const previewLines = json.previewLines ?? DEFAULT_PREVIEW_LINES;

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

  return (
    <div className="space-y-4">
      <h4 className="font-medium text-[var(--text-primary)] flex items-center gap-2">
        🧬 Настройки JSON
      </h4>

      {/* Шаблон */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-[var(--text-secondary)]">
            Шаблон (JSON)
          </label>
          <button
            type="button"
            onClick={handlePrettify}
            disabled={Boolean(templateError) || !localTemplate.trim()}
            className="text-xs px-2 py-1 rounded border border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50 disabled:cursor-not-allowed"
            title="Pretty-print"
          >
            Форматировать
          </button>
        </div>
        <textarea
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
            ⚠️ Невалидный JSON: {templateError}
          </p>
        ) : (
          <p className="text-xs text-[var(--text-tertiary)]">
            Опционально. Используется как заготовка при создании новой записи (Phase 3).
          </p>
        )}
      </div>

      {/* Default mode */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-[var(--text-secondary)]">
          Режим редактора по умолчанию
        </label>
        <div className="flex flex-wrap gap-2">
          {MODES.map(mode => (
            <label
              key={mode.value}
              className={`flex items-center gap-2 px-3 py-2 rounded border cursor-pointer text-sm ${
                defaultMode === mode.value
                  ? 'border-[var(--color-primary-500)] bg-[var(--color-primary-50)] dark:bg-primary-100'
                  : 'border-[var(--border-primary)] hover:bg-[var(--bg-tertiary)]'
              }`}
              title={mode.hint}
            >
              <input
                type="radio"
                name="json-default-mode"
                value={mode.value}
                checked={defaultMode === mode.value}
                onChange={() => updateJson({ defaultMode: mode.value })}
                className="accent-[var(--color-primary-500)]"
              />
              <span>{mode.label}</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-[var(--text-tertiary)]">
          Какой режим открывается при клике в ячейку (Phase 3).
        </p>
      </div>

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
            Форматировать JSON в превью ячейки
          </span>
        </label>
      </div>

      {/* Preview lines */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-[var(--text-secondary)]">
          Строк в превью ячейки
        </label>
        <input
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
          Сколько строк JSON показывать в ячейке (1–10). Остальное — «…».
        </p>
      </div>
    </div>
  );
};
