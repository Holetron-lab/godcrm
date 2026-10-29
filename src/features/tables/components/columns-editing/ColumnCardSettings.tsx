/**
 * ColumnCardSettings - Expanded settings accordions for a column card
 */
import { useId, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Switch } from '@/shared/components/ui';
import { ColorPicker } from './ColorPicker';
import { RelationAccordions } from './RelationAccordions';
import { ALIGN_OPTIONS, TEXT_WRAP_OPTIONS } from './constants';
import type { ColumnSettingsProps } from './types';

type SettingsSection = 'layout' | 'behavior' | 'type' | 'display' | 'relation' | 'backlink' | null;

export const ColumnCardSettings = ({
  config,
  onUpdate,
  projects,
  sampleValues,
  currentSampleIndex,
  onSampleNavigate,
}: ColumnSettingsProps) => {
  const id = useId();
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('layout');

  // Column config values
  const order = (config.order as number) ?? 0;
  const align = (config.align as string) || 'left';
  const width = (config.width as number) ?? 150;
  const bgColor = (config.bgColor as string) || null;
  const textWrap = (config.textWrap as string) || 'nowrap';
  const required = (config.required as boolean) || false;
  const readonly = (config.readonly as boolean) || false;

  // Type config
  const defaultValue = (config.defaultValue as string) || '';
  const formula = (config.formula as string) || '';

  // Display config
  const renderMode = (config.renderMode as string) || 'text';
  const fontFamily = (config.fontFamily as string) || 'inherit';
  const fontSize = (config.fontSize as number) || 14;
  const textColor = (config.textColor as string) || null;

  return (
    <div className="px-3 pb-3 pt-1 border-t border-[var(--border-secondary)] space-y-3">
      {/* Sample values with navigation */}
      {sampleValues.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-secondary)]">
              Значения колонки ({sampleValues.length} строк)
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Предыдущее значение"
                onClick={() => onSampleNavigate(-1)}
                disabled={currentSampleIndex === 0}
                className="px-2 py-0.5 text-xs rounded bg-[var(--bg-primary)] border border-[var(--border-primary)] disabled:opacity-30 hover:bg-[var(--bg-secondary)]"
              >
                {'\u2190'}
              </button>
              <span className="text-xs text-[var(--text-secondary)] min-w-[60px] text-center">
                {currentSampleIndex + 1} / {sampleValues.length}
              </span>
              <button
                type="button"
                aria-label="Следующее значение"
                onClick={() => onSampleNavigate(1)}
                disabled={currentSampleIndex >= sampleValues.length - 1}
                className="px-2 py-0.5 text-xs rounded bg-[var(--bg-primary)] border border-[var(--border-primary)] disabled:opacity-30 hover:bg-[var(--bg-secondary)]"
              >
                {'\u2192'}
              </button>
            </div>
          </div>
          <div className="p-2 rounded-lg text-xs break-all max-h-20 overflow-y-auto bg-[var(--bg-primary)] border border-[var(--border-primary)] text-[var(--text-primary)]">
            {sampleValues[currentSampleIndex] || <span className="text-[var(--text-tertiary)]">пусто</span>}
          </div>
        </div>
      )}

      {/* Settings accordions */}
      <div className="space-y-2">
        {/* Layout accordion */}
        <div className="rounded-lg border border-[var(--border-secondary)]">
          <button
            type="button"
            aria-expanded={settingsSection === 'layout'}
            onClick={() => setSettingsSection(settingsSection === 'layout' ? null : 'layout')}
            className="w-full flex items-center gap-2 p-2 hover:bg-[var(--bg-tertiary)] rounded-t-lg"
          >
            <ChevronRight className={`w-3 h-3 transition-transform ${settingsSection === 'layout' ? 'rotate-90' : ''}`} />
            <span className="text-xs font-medium text-[var(--text-secondary)] uppercase">Размеры и положение</span>
          </button>
          {settingsSection === 'layout' && (
            <div className="px-3 pb-3 grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div>
                <label htmlFor={`${id}-order`} className="block text-xs text-[var(--text-tertiary)] mb-1">Порядок</label>
                <input
                  id={`${id}-order`}
                  type="number"
                  value={order}
                  onChange={(e) => onUpdate('config.order', Number(e.target.value))}
                  className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)]"
                />
              </div>
              <div>
                <label htmlFor={`${id}-align`} className="block text-xs text-[var(--text-tertiary)] mb-1">Выравнивание</label>
                <select
                  id={`${id}-align`}
                  value={align}
                  onChange={(e) => onUpdate('config.align', e.target.value)}
                  className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)]"
                >
                  {ALIGN_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor={`${id}-width`} className="block text-xs text-[var(--text-tertiary)] mb-1">Ширина</label>
                <input
                  id={`${id}-width`}
                  type="number"
                  value={width}
                  onChange={(e) => onUpdate('config.width', Number(e.target.value))}
                  className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)]"
                />
              </div>
              <fieldset className="min-w-0">
                <legend className="block text-xs text-[var(--text-tertiary)] mb-1">Фон колонки</legend>
                <ColorPicker value={bgColor} onChange={(c) => onUpdate('config.bgColor', c)} compact />
              </fieldset>
              <div>
                <label htmlFor={`${id}-textWrap`} className="block text-xs text-[var(--text-tertiary)] mb-1">Перенос текста</label>
                <select
                  id={`${id}-textWrap`}
                  value={textWrap}
                  onChange={(e) => onUpdate('config.textWrap', e.target.value)}
                  className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)]"
                >
                  {TEXT_WRAP_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Behavior accordion */}
        <div className="rounded-lg border border-[var(--border-secondary)]">
          <button
            type="button"
            aria-expanded={settingsSection === 'behavior'}
            onClick={() => setSettingsSection(settingsSection === 'behavior' ? null : 'behavior')}
            className="w-full flex items-center gap-2 p-2 hover:bg-[var(--bg-tertiary)] rounded-t-lg"
          >
            <ChevronRight className={`w-3 h-3 transition-transform ${settingsSection === 'behavior' ? 'rotate-90' : ''}`} />
            <span className="text-xs font-medium text-[var(--text-secondary)] uppercase">Поведение</span>
          </button>
          {settingsSection === 'behavior' && (
            <div className="px-3 pb-3 flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Switch
                  id={`${id}-required`}
                  aria-label="Обязательное поле"
                  checked={required}
                  onCheckedChange={(v) => onUpdate('config.required', v)}
                />
                <label htmlFor={`${id}-required`} className="text-sm text-[var(--text-primary)] cursor-pointer">Обязательное поле</label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id={`${id}-readonly`}
                  aria-label="Только чтение"
                  checked={readonly}
                  onCheckedChange={(v) => onUpdate('config.readonly', v)}
                />
                <label htmlFor={`${id}-readonly`} className="text-sm text-[var(--text-primary)] cursor-pointer">Только чтение</label>
              </div>
            </div>
          )}
        </div>

        {/* Type accordion */}
        <div className="rounded-lg border border-[var(--border-secondary)]">
          <button
            type="button"
            aria-expanded={settingsSection === 'type'}
            onClick={() => setSettingsSection(settingsSection === 'type' ? null : 'type')}
            className="w-full flex items-center gap-2 p-2 hover:bg-[var(--bg-tertiary)] rounded-t-lg"
          >
            <ChevronRight className={`w-3 h-3 transition-transform ${settingsSection === 'type' ? 'rotate-90' : ''}`} />
            <span className="text-xs font-medium text-[var(--text-secondary)] uppercase">Тип</span>
          </button>
          {settingsSection === 'type' && (
            <div className="px-3 pb-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor={`${id}-defaultValue`} className="block text-xs text-[var(--text-tertiary)] mb-1">Значение по умолчанию</label>
                  <select
                    id={`${id}-defaultValue`}
                    value={defaultValue ? 'custom' : ''}
                    onChange={(e) => onUpdate('config.defaultValue', e.target.value === 'custom' ? '' : e.target.value)}
                    className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)]"
                  >
                    <option value="">{'\u2014'} Не выбрано {'\u2014'}</option>
                    <option value="{{now}}">Текущая дата</option>
                    <option value="{{user}}">Текущий пользователь</option>
                    <option value="{{uuid}}">UUID</option>
                    <option value="custom">Своё значение...</option>
                  </select>
                  {defaultValue === 'custom' || (defaultValue && !['{{now}}', '{{user}}', '{{uuid}}'].includes(defaultValue)) ? (
                    <input
                      type="text"
                      value={defaultValue}
                      onChange={(e) => onUpdate('config.defaultValue', e.target.value)}
                      aria-label="Своё значение по умолчанию"
                      placeholder="Введите значение"
                      className="w-full mt-2 px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)]"
                    />
                  ) : null}
                </div>
                <div>
                  <label htmlFor={`${id}-formula`} className="block text-xs text-[var(--text-tertiary)] mb-1">Формула (RAW)</label>
                  <input
                    id={`${id}-formula`}
                    type="text"
                    value={formula}
                    onChange={(e) => onUpdate('config.formula', e.target.value)}
                    placeholder="{{category}}"
                    className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border-primary)] text-sm font-mono text-[var(--text-primary)]"
                  />
                  <p className="text-xs text-[var(--text-tertiary)] mt-1">
                    Используйте {'{{column_name}}'} для подстановки
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Display mode accordion */}
        <div className="rounded-lg border border-[var(--border-secondary)]">
          <button
            type="button"
            aria-expanded={settingsSection === 'display'}
            onClick={() => setSettingsSection(settingsSection === 'display' ? null : 'display')}
            className="w-full flex items-center gap-2 p-2 hover:bg-[var(--bg-tertiary)] rounded-t-lg"
          >
            <ChevronRight className={`w-3 h-3 transition-transform ${settingsSection === 'display' ? 'rotate-90' : ''}`} />
            <span className="text-xs font-medium text-[var(--text-secondary)] uppercase">Режим отображения</span>
          </button>
          {settingsSection === 'display' && (
            <div className="px-3 pb-3 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="col-span-2">
                  <label htmlFor={`${id}-renderMode`} className="block text-xs text-[var(--text-tertiary)] mb-1">Режим</label>
                  <select
                    id={`${id}-renderMode`}
                    value={renderMode}
                    onChange={(e) => onUpdate('config.renderMode', e.target.value)}
                    className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)]"
                  >
                    <option value="text">Текст</option>
                    <option value="markdown">Markdown</option>
                    <option value="html">HTML</option>
                    <option value="formula">Формула</option>
                    <option value="javascript">JavaScript</option>
                  </select>
                </div>
                <div>
                  <label htmlFor={`${id}-fontSize`} className="block text-xs text-[var(--text-tertiary)] mb-1">Размер</label>
                  <input
                    id={`${id}-fontSize`}
                    type="number"
                    value={fontSize}
                    onChange={(e) => onUpdate('config.fontSize', Number(e.target.value) || 14)}
                    min={8}
                    max={72}
                    className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)]"
                  />
                </div>
                <fieldset className="min-w-0">
                  <legend className="block text-xs text-[var(--text-tertiary)] mb-1">Цвет текста</legend>
                  <ColorPicker value={textColor} onChange={(c) => onUpdate('config.textColor', c)} compact />
                </fieldset>
              </div>
              <div>
                <label htmlFor={`${id}-fontFamily`} className="block text-xs text-[var(--text-tertiary)] mb-1">Шрифт</label>
                <select
                  id={`${id}-fontFamily`}
                  value={fontFamily}
                  onChange={(e) => onUpdate('config.fontFamily', e.target.value)}
                  className="w-full px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border-primary)] text-sm text-[var(--text-primary)]"
                >
                  <option value="inherit">По умолчанию</option>
                  <option value="'Inter', sans-serif">Inter</option>
                  <option value="'Roboto', sans-serif">Roboto</option>
                  <option value="monospace">Monospace</option>
                  <option value="'Georgia', serif">Georgia (Serif)</option>
                  <option value="'Arial', sans-serif">Arial</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Relation & BackLink accordions */}
        <RelationAccordions
          config={config}
          onUpdate={onUpdate}
          projects={projects}
          settingsSection={settingsSection}
          onSetSection={setSettingsSection}
        />
      </div>
    </div>
  );
};
