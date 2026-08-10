import { useMemo, useState } from 'react';
import { Button, Input, Modal, Select } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { getColumnTypeOptions } from '@/shared/types';

interface CreateColumnModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: { name: string; displayName: string; type: string; config?: Record<string, any> }) => void;
  loading?: boolean;
  tableId?: string | number;
  projectId?: string | number;
}

export const CreateColumnModal = ({ open, onOpenChange, onSubmit, loading, tableId, projectId }: CreateColumnModalProps) => {
  const { language } = useLanguage();
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [type, setType] = useState('text');

  // Generate column types from shared types
  const columnTypes = useMemo(() => getColumnTypeOptions(language as 'ru' | 'en'), [language]);

  const handleSubmit = () => {
    if (!name.trim()) return;
    
    // Build config for file/image columns with default upload path
    let config: Record<string, any> | undefined;
    if (type === 'file' || type === 'image') {
      const uploadPath = `https://crm.hltrn.cc/uploads/project_${projectId || 0}/table_${tableId || 0}/${name.trim()}/`;
      config = {
        file: {
          prefix: uploadPath,
          saveFormat: 'filename'
        }
      };
    }
    
    onSubmit({
      name: name.trim(),
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
            disabled={!name.trim() || loading}
          >
            {loading ? 'Создание...' : 'Создать'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
