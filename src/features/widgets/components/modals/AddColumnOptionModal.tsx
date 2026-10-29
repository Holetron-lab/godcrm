import { useState, useId } from 'react';
import { Button, Input, Modal } from '@/shared/components/ui';

interface AddColumnOptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (option: { value: string; label: string; color: string }) => void;
  columnName: string;
  existingOptions: Array<{ value: string; label?: string; color?: string }>;
}

const PRESET_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#f59e0b', // amber
  '#eab308', // yellow
  '#84cc16', // lime
  '#22c55e', // green
  '#10b981', // emerald
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#0ea5e9', // sky
  '#3b82f6', // blue
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#a855f7', // purple
  '#d946ef', // fuchsia
  '#ec4899', // pink
];

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

export function AddColumnOptionModal({
  isOpen,
  onClose,
  onConfirm,
  columnName,
  existingOptions
}: AddColumnOptionModalProps) {
  const fieldId = useId();
  const [label, setLabel] = useState('');
  const [valueKey, setValueKey] = useState('');
  const [valueTouched, setValueTouched] = useState(false);
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const effectiveValue = (valueTouched ? valueKey : slugify(label)).trim();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedLabel = label.trim();
    const trimmedValue = effectiveValue;

    if (!trimmedLabel) {
      setError('Введите название опции');
      return;
    }
    if (!trimmedValue) {
      setError('Введите ключ опции (латиница, цифры, _)');
      return;
    }
    if (!/^[a-z0-9_-]+$/i.test(trimmedValue)) {
      setError('Ключ может содержать только латиницу, цифры, _ и -');
      return;
    }
    if (existingOptions.some(opt => opt.value.toLowerCase() === trimmedValue.toLowerCase())) {
      setError('Опция с таким ключом уже существует');
      return;
    }

    onConfirm({ value: trimmedValue, label: trimmedLabel, color });
    setLabel('');
    setValueKey('');
    setValueTouched(false);
    setColor(PRESET_COLORS[0]);
    setError('');
    onClose();
  };

  const handleClose = () => {
    setLabel('');
    setValueKey('');
    setValueTouched(false);
    setColor(PRESET_COLORS[0]);
    setError('');
    onClose();
  };

  return (
    <Modal
      open={isOpen}
      onOpenChange={(open) => { if (!open) handleClose(); }}
      title="Добавить колонку (статус)"
      description={`Для поля: ${columnName}`}
    >
      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Label Input */}
        <Input
          type="text"
          id={`${fieldId}-label`}
          label="Название опции"
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
            setError('');
          }}
          placeholder="Например: В работе, Готово, На проверке..."
        />

        {/* Key Input */}
        <Input
          type="text"
          id={`${fieldId}-key`}
          label="Ключ"
          hint="Латиница/цифры/_, авто из названия"
          error={error || undefined}
          value={valueTouched ? valueKey : slugify(label)}
          onChange={(e) => {
            setValueTouched(true);
            setValueKey(e.target.value);
            setError('');
          }}
          placeholder="in_progress"
        />

        {/* Color Picker */}
        <fieldset>
          <legend className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
            Цвет
          </legend>
          <div className="flex flex-wrap gap-2">
            {PRESET_COLORS.map((presetColor) => (
              <button
                key={presetColor}
                aria-label={`Цвет ${presetColor}`}
                aria-pressed={color === presetColor}
                type="button"
                onClick={() => setColor(presetColor)}
                className={`w-8 h-8 rounded-lg transition-transform ${
                  color === presetColor
                    ? 'ring-2 ring-[var(--text-primary)] ring-offset-2 ring-offset-[var(--bg-secondary)] scale-110'
                    : 'hover:scale-110'
                }`}
                style={{ backgroundColor: presetColor }}
              />
            ))}
          </div>
        </fieldset>

        {/* Preview */}
        {label && (
          <div>
            <p className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
              Предпросмотр
            </p>
            <div
              className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm font-medium"
              style={{
                backgroundColor: `${color}20`,
                color: color
              }}
            >
              {label}
              {effectiveValue && effectiveValue !== label && (
                <span className="ml-2 text-[10px] font-mono opacity-60">{effectiveValue}</span>
              )}
            </div>
          </div>
        )}

        {/* Existing Options */}
        {existingOptions.length > 0 && (
          <div>
            <p className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
              Существующие опции ({existingOptions.length})
            </p>
            <div className="flex flex-wrap gap-2">
              {existingOptions.map((opt) => (
                <span
                  key={opt.value}
                  className="px-2 py-1 rounded-md text-xs"
                  style={{
                    backgroundColor: opt.color ? `${opt.color}20` : 'var(--bg-tertiary)',
                    color: opt.color || 'var(--text-secondary)'
                  }}
                >
                  {opt.label || opt.value}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4">
          <Button type="button" variant="secondary" onClick={handleClose}>
            Отмена
          </Button>
          <Button type="submit" variant="primary">
            Добавить
          </Button>
        </div>
      </form>
    </Modal>
  );
}
