import { useState } from 'react';
import { X } from 'lucide-react';
import { Button, Input } from '@/shared/components/ui';

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
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      />
      
      {/* Modal */}
      <div className="relative bg-[var(--bg-secondary)] rounded-xl shadow-2xl border border-[var(--border-primary)] w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-primary)]">
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">
              Добавить колонку (статус)
            </h2>
            <p className="text-sm text-[var(--text-tertiary)]">
              Для поля: {columnName}
            </p>
          </div>
          <button
            onClick={handleClose}
            className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Label Input */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
              Название опции
            </label>
            <Input
              type="text"
              value={label}
              onChange={(e) => {
                setLabel(e.target.value);
                setError('');
              }}
              placeholder="Например: В работе, Готово, На проверке..."
              autoFocus
            />
          </div>

          {/* Key Input */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
              Ключ <span className="text-[var(--text-tertiary)] font-normal">(латиница/цифры/_, авто из названия)</span>
            </label>
            <Input
              type="text"
              value={valueTouched ? valueKey : slugify(label)}
              onChange={(e) => {
                setValueTouched(true);
                setValueKey(e.target.value);
                setError('');
              }}
              placeholder="in_progress"
            />
            {error && (
              <p className="mt-1 text-sm text-red-500">{error}</p>
            )}
          </div>

          {/* Color Picker */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
              Цвет
            </label>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map((presetColor) => (
                <button
                  key={presetColor}
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
          </div>

          {/* Preview */}
          {label && (
            <div>
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                Предпросмотр
              </label>
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
              <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
                Существующие опции ({existingOptions.length})
              </label>
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
      </div>
    </div>
  );
}
