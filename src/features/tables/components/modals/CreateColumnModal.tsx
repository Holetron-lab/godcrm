import { useMemo, useState } from 'react';
import { Button, Input, Modal, Select } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { getColumnTypeOptions } from '@/shared/types';
import { toSlug } from '@/shared/utils/i18n-utils';

interface CreateColumnModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: { name: string; displayName: string; type: string; config?: Record<string, any> }) => void;
  loading?: boolean;
  tableId?: string | number;
  projectId?: string | number;
}

export const CreateColumnModal = ({ open, onOpenChange, onSubmit, loading }: CreateColumnModalProps) => {
  const { language } = useLanguage();
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [type, setType] = useState('text');

  // Generate column types from shared types
  const columnTypes = useMemo(() => getColumnTypeOptions(language as 'ru' | 'en'), [language]);
  // Row data is keyed by this value, so it must stay [a-z0-9_]; a Cyrillic
  // title becomes a transliterated key and the title itself stays the display name.
  const key = toSlug(name.trim());

  const handleSubmit = () => {
    if (!key) return;
    
    // Space uploads already return a complete /uploads/spaces/<id>/ URL, so image
    // columns need no prefix. FileCell still requires a prefix to enable upload;
    // point it at this ring's own origin, never at a foreign host.
    let config: Record<string, any> | undefined;
    if (type === 'file') {
      config = { file: { prefix: window.location.origin, saveFormat: 'url' } };
    }
    
    onSubmit({
      name: key,
      displayName: displayName.trim() || name.trim(),
      type,
      config
    });
    
    // Reset form
    setName('');
    setDisplayName('');
    setType('text');
  };

  const handleClose = () => {
    setName('');
    setDisplayName('');
    setType('text');
    onOpenChange(false);
  };

  return (
    <Modal
      open={open}
      onOpenChange={handleClose}
      title="Добавить колонку"
      description="Создайте новую колонку для таблицы"
    >
      <div className="space-y-4">
        <div>
          <Input
            label="Название поля (для API)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="email"
            required
          />
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">
            Используется в API и базе данных. Только латиница, цифры и подчеркивания.
            {key && key !== name.trim() && <> Будет сохранено как <code className="font-mono text-[var(--text-secondary)]">{key}</code></>}
          </p>
        </div>

        <div>
          <Input
            label="Отображаемое название"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Email адрес"
          />
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">
            Название которое видят пользователи. Если не указано, используется название поля.
          </p>
        </div>

        <div>
          <Select
            label="Тип колонки"
            value={type}
            onChange={setType}
            options={columnTypes}
          />
        </div>

        <div className="flex justify-end gap-3 pt-4">
          <Button variant="secondary" onClick={handleClose} disabled={loading}>
            Отмена
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={!key || loading}
          >
            {loading ? 'Создание...' : 'Создать'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
