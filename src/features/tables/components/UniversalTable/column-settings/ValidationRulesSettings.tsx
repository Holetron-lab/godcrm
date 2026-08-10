import React from 'react';
import { Input, Select, Button, Switch, Checkbox } from '@/shared/components/ui';
import { ColumnSettingsProps } from './types';

/**
 * Тип правила валидации
 */
export interface ValidationRule {
  id: string;
  name: string;
  enabled: boolean;
  type: 'regex' | 'length' | 'range' | 'dateRange' | 'custom';
  config: {
    pattern?: string;
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    minDate?: string;
    maxDate?: string;
    allowPast?: boolean;
    allowFuture?: boolean;
    allowWeekends?: boolean;
    customJs?: string;
  };
  errorMessage: string;
}

/**
 * Компонент настроек правил валидации
 */
export const ValidationRulesSettings: React.FC<ColumnSettingsProps> = ({
  draft,
  setDraft,
}) => {
  const rules = (draft.config?.validation?.rules || []) as ValidationRule[];

  const addRule = () => {
    setDraft(prev => ({
      ...prev,
      config: {
        ...prev.config,
        validation: {
          ...prev.config?.validation,
          rules: [...(prev.config?.validation?.rules || []), {
            id: `rule_${Date.now()}`,
            name: 'New rule',
            enabled: true,
            type: 'regex',
            config: {},
            errorMessage: 'Value does not match the rule'
          }]
        }
      }
    }));
  };

  const updateRule = (ruleIndex: number, updates: Partial<ValidationRule>) => {
    setDraft(prev => {
      const rules = [...(prev.config?.validation?.rules || [])] as ValidationRule[];
      rules[ruleIndex] = { ...rules[ruleIndex], ...updates };
      return {
        ...prev,
        config: { ...prev.config, validation: { ...prev.config?.validation, rules } }
      };
    });
  };

  const updateRuleConfig = (ruleIndex: number, configUpdates: Partial<ValidationRule['config']>) => {
    setDraft(prev => {
      const rules = [...(prev.config?.validation?.rules || [])] as ValidationRule[];
      rules[ruleIndex] = { 
        ...rules[ruleIndex], 
        config: { ...rules[ruleIndex].config, ...configUpdates } 
      };
      return {
        ...prev,
        config: { ...prev.config, validation: { ...prev.config?.validation, rules } }
      };
    });
  };

  const deleteRule = (ruleIndex: number) => {
    setDraft(prev => {
      const rules = (prev.config?.validation?.rules || []).filter((_: ValidationRule, i: number) => i !== ruleIndex);
      return {
        ...prev,
        config: { ...prev.config, validation: { ...prev.config?.validation, rules } }
      };
    });
  };

  return (
    <div className="space-y-3 pt-4 border-t border-[var(--border-primary)]">
      <div className="flex items-center justify-between">
        <h4 className="font-medium text-[var(--text-primary)] flex items-center gap-2">
          🛡️ Правила валидации
        </h4>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={addRule}
        >
          + Добавить правило
        </Button>
      </div>
      
      <p className="text-xs text-[var(--text-tertiary)]">
        Правила проверяются при вводе значения в ячейку. Поддерживаются regex, ограничения длины и JavaScript валидаторы.
      </p>
      
      {rules.map((rule, ruleIndex) => (
        <div key={rule.id} className="border border-[var(--border-primary)] rounded-lg p-3 space-y-3 bg-[var(--bg-secondary)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Switch
                checked={rule.enabled}
                onCheckedChange={(checked) => updateRule(ruleIndex, { enabled: checked === true })}
              />
              <Input
                value={rule.name}
                onChange={(e) => updateRule(ruleIndex, { name: e.target.value })}
                className="w-40"
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-red-500 hover:text-red-700"
              onClick={() => deleteRule(ruleIndex)}
            >
              🗑️
            </Button>
          </div>
          
          <Select
            label="Тип правила"
            value={rule.type}
            onChange={(value) => updateRule(ruleIndex, { type: value as ValidationRule['type'], config: {} })}
            options={[
              { label: '🔤 Регулярное выражение', value: 'regex' },
              { label: '📏 Длина текста', value: 'length' },
              { label: '🔢 Диапазон чисел', value: 'range' },
              { label: '📅 Диапазон дат', value: 'dateRange' },
              { label: '⚙️ JavaScript (кастом)', value: 'custom' }
            ]}
          />
          
          {rule.type === 'regex' && (
            <Input
              label="Regex паттерн"
              placeholder="^[a-zA-Z0-9]+$"
              value={rule.config.pattern || ''}
              onChange={(e) => updateRuleConfig(ruleIndex, { pattern: e.target.value })}
            />
          )}
          
          {rule.type === 'length' && (
            <div className="grid grid-cols-2 gap-2">
              <Input
                label="Мин. длина"
                type="number"
                min={0}
                value={String(rule.config.minLength ?? '')}
                onChange={(e) => updateRuleConfig(ruleIndex, { minLength: parseInt(e.target.value) || undefined })}
              />
              <Input
                label="Макс. длина"
                type="number"
                min={0}
                value={String(rule.config.maxLength ?? '')}
                onChange={(e) => updateRuleConfig(ruleIndex, { maxLength: parseInt(e.target.value) || undefined })}
              />
            </div>
          )}
          
          {rule.type === 'range' && (
            <div className="grid grid-cols-2 gap-2">
              <Input
                label="Минимум"
                type="number"
                value={String(rule.config.min ?? '')}
                onChange={(e) => updateRuleConfig(ruleIndex, { min: parseFloat(e.target.value) || undefined })}
              />
              <Input
                label="Максимум"
                type="number"
                value={String(rule.config.max ?? '')}
                onChange={(e) => updateRuleConfig(ruleIndex, { max: parseFloat(e.target.value) || undefined })}
              />
            </div>
          )}
          
          {rule.type === 'dateRange' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Input
                  label="Минимальная дата"
                  placeholder="2025-01-01 или today-30d"
                  value={rule.config.minDate || ''}
                  onChange={(e) => updateRuleConfig(ruleIndex, { minDate: e.target.value || undefined })}
                />
                <Input
                  label="Максимальная дата"
                  placeholder="2025-12-31 или today+30d"
                  value={rule.config.maxDate || ''}
                  onChange={(e) => updateRuleConfig(ruleIndex, { maxDate: e.target.value || undefined })}
                />
              </div>
              <p className="text-xs text-[var(--text-tertiary)]">
                💡 Форматы: <code className="bg-[var(--bg-tertiary)] px-1 rounded">today</code>, <code className="bg-[var(--bg-tertiary)] px-1 rounded">today+7d</code>, <code className="bg-[var(--bg-tertiary)] px-1 rounded">today-1m</code>, <code className="bg-[var(--bg-tertiary)] px-1 rounded">today+1y</code>, или конкретная дата <code className="bg-[var(--bg-tertiary)] px-1 rounded">2025-12-31</code>
              </p>
              <div className="grid grid-cols-3 gap-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={rule.config.allowPast !== false}
                    onCheckedChange={(checked) => updateRuleConfig(ruleIndex, { allowPast: checked === true })}
                  />
                  <span className="text-sm text-[var(--text-secondary)]">Прошлые</span>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={rule.config.allowFuture !== false}
                    onCheckedChange={(checked) => updateRuleConfig(ruleIndex, { allowFuture: checked === true })}
                  />
                  <span className="text-sm text-[var(--text-secondary)]">Будущие</span>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={rule.config.allowWeekends !== false}
                    onCheckedChange={(checked) => updateRuleConfig(ruleIndex, { allowWeekends: checked === true })}
                  />
                  <span className="text-sm text-[var(--text-secondary)]">Выходные</span>
                </div>
              </div>
            </div>
          )}
          
          {rule.type === 'custom' && (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-[var(--text-secondary)]">
                JavaScript код (return true/false)
              </label>
              <textarea
                className="w-full h-24 px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] text-sm font-mono"
                placeholder="// value - текущее значение&#10;// row - данные строки&#10;return value.length > 0 && value.startsWith('ID-');"
                value={rule.config.customJs || ''}
                onChange={(e) => updateRuleConfig(ruleIndex, { customJs: e.target.value })}
              />
              <p className="text-xs text-[var(--text-tertiary)]">
                Доступны: <code className="bg-[var(--bg-tertiary)] px-1 rounded">value</code> (значение ячейки), <code className="bg-[var(--bg-tertiary)] px-1 rounded">row</code> (данные строки)
              </p>
            </div>
          )}
          
          <Input
            label="Сообщение об ошибке"
            value={rule.errorMessage}
            onChange={(e) => updateRule(ruleIndex, { errorMessage: e.target.value })}
          />
        </div>
      ))}
      
      {rules.length === 0 && (
        <div className="p-4 text-center text-[var(--text-tertiary)] border border-dashed border-[var(--border-secondary)] rounded-lg">
          Правил валидации пока нет. Нажмите "+ Добавить правило" для создания.
        </div>
      )}
    </div>
  );
};
