/**
 * Create Document Modal - Create a new empty document with optional project link
 */

import { useState, useEffect, useId } from 'react';
import { Modal } from '@/shared/components/ui/Modal';
import { cn } from '@/shared/utils/cn';
import { logger } from '@/shared/utils/logger';
import { apiClient } from '@/shared/utils/apiClient';
import { useDocumentsContext } from '../DocumentsContext';

export function CreateDocumentModal() {
  const ctx = useDocumentsContext();
  const fieldId = useId();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [icon, setIcon] = useState('📄');
  const [projectId, setProjectId] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Fetch projects from ADR Projects table (1699)
  const [projects, setProjects] = useState<Array<{ id: number; data: { title?: string; name?: string } }>>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);

  // Load projects when modal opens
  useEffect(() => {
    if (ctx.showCreateDocumentModal) {
      setLoadingProjects(true);
      apiClient.get<{ success: boolean; data: { rows: Array<{ id: number; data: { title?: string; name?: string } }> } }>('/tables/1699/rows?limit=100')
        .then(result => {
          setProjects(result.data?.rows || []);
        })
        .catch(err => {
          logger.error('Failed to load projects:', err);
          setProjects([]);
        })
        .finally(() => setLoadingProjects(false));
    }
  }, [ctx.showCreateDocumentModal]);

  // Reset form when modal opens
  useEffect(() => {
    if (ctx.showCreateDocumentModal) {
      setName('');
      setDescription('');
      setCategory('');
      setIcon('📄');
      setProjectId(null);
    }
  }, [ctx.showCreateDocumentModal]);

  const handleCreate = async () => {
    if (!name.trim()) return;

    setIsSaving(true);
    try {
      const result = await ctx.createDocument({
        name: name.trim(),
        description: description.trim(),
        category: category.trim(),
        icon,
        project_id: projectId || undefined,
      });

      if (result.success) {
        ctx.setShowCreateDocumentModal(false);
        ctx.setSelectedDocumentId(result.data.document_id);
        ctx.refresh();
      }
    } catch (error) {
      logger.error('Failed to create document:', error);
    } finally {
      setIsSaving(false);
    }
  };

  if (!ctx.showCreateDocumentModal) return null;

  return (
    <Modal
      open={ctx.showCreateDocumentModal}
      onOpenChange={ctx.setShowCreateDocumentModal}
      title="Новый документ"
      size="md"
      footer={
        <div className="flex items-center justify-end gap-3 w-full">
          <button
            onClick={() => ctx.setShowCreateDocumentModal(false)}
            className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            Отмена
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || isSaving}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {isSaving ? 'Создание...' : 'Создать'}
          </button>
        </div>
      }
    >
      {/* Body */}
      <div className="space-y-4">
        {/* Icon picker (simple) */}
        <fieldset>
          <legend className="block text-sm font-medium mb-1.5">Иконка</legend>
          <div className="flex flex-wrap gap-2">
            {['📄', '📋', '📝', '📑', '📊', '📈', '🔧', '⚙️', '🎯', '💡'].map(emoji => (
              <button
                key={emoji}
                aria-pressed={icon === emoji}
                onClick={() => setIcon(emoji)}
                className={cn(
                  "w-10 h-10 rounded-lg text-xl flex items-center justify-center transition-colors",
                  icon === emoji ? "bg-blue-500/20 ring-2 ring-blue-500" : "bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)]"
                )}
              >
                {emoji}
              </button>
            ))}
          </div>
        </fieldset>

        {/* Name */}
        <div>
          <label htmlFor={`${fieldId}-name`} className="block text-sm font-medium mb-1.5">Название *</label>
          <input
            type="text"
            id={`${fieldId}-name`}
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Название документа"
            className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-sm"
          />
        </div>

        {/* Description */}
        <div>
          <label htmlFor={`${fieldId}-description`} className="block text-sm font-medium mb-1.5">Описание</label>
          <textarea
            id={`${fieldId}-description`}
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Краткое описание документа"
            rows={3}
            className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-sm resize-none"
          />
        </div>

        {/* Category */}
        <div>
          <label htmlFor={`${fieldId}-category`} className="block text-sm font-medium mb-1.5">Категория</label>
          <input
            type="text"
            id={`${fieldId}-category`}
            value={category}
            onChange={e => setCategory(e.target.value)}
            placeholder="Например: ADR, Spec, Guide"
            className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-sm"
          />
        </div>

        {/* Project selector */}
        <div>
          <label htmlFor={`${fieldId}-project`} className="block text-sm font-medium mb-1.5">Проект (опционально)</label>
          <select
            id={`${fieldId}-project`}
            value={projectId || ''}
            onChange={e => setProjectId(e.target.value ? Number(e.target.value) : null)}
            disabled={loadingProjects}
            className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-sm"
          >
            <option value="">Без проекта</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>
                {p.data.title || p.data.name || `Project #${p.id}`}
              </option>
            ))}
          </select>
          {loadingProjects && (
            <p className="text-xs text-[var(--text-tertiary)] mt-1">Загрузка проектов...</p>
          )}
        </div>
      </div>

    </Modal>
  );
}
