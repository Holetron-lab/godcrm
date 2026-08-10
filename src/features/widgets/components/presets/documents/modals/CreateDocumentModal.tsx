/**
 * Create Document Modal - Create a new empty document with optional project link
 */

import { useState, useEffect } from 'react';
import { FileText, X } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { logger } from '@/shared/utils/logger';
import { apiClient } from '@/shared/utils/apiClient';
import { useDocumentsContext } from '../DocumentsContext';

export function CreateDocumentModal() {
  const ctx = useDocumentsContext();
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
        ctx.setSelectedDocumentId(result.data.id);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => ctx.setShowCreateDocumentModal(false)}>
      <div
        className="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-primary)] shadow-2xl w-full max-w-md"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-primary)]">
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-blue-400" />
            <h2 className="text-lg font-semibold">Новый документ</h2>
          </div>
          <button onClick={() => ctx.setShowCreateDocumentModal(false)} className="p-2 hover:bg-[var(--bg-tertiary)] rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {/* Icon picker (simple) */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Иконка</label>
            <div className="flex gap-2">
              {['📄', '📋', '📝', '📑', '📊', '📈', '🔧', '⚙️', '🎯', '💡'].map(emoji => (
                <button
                  key={emoji}
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
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Название *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Название документа"
              className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-sm"
              autoFocus
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Описание</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Краткое описание документа"
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-sm resize-none"
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Категория</label>
            <input
              type="text"
              value={category}
              onChange={e => setCategory(e.target.value)}
              placeholder="Например: ADR, Spec, Guide"
              className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-sm"
            />
          </div>

          {/* Project selector */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Проект (опционально)</label>
            <select
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

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)]">
          <button
            onClick={() => ctx.setShowCreateDocumentModal(false)}
            className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            Отмена
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || isSaving}
            className="px-4 py-2 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 disabled:opacity-50"
          >
            {isSaving ? 'Создание...' : 'Создать'}
          </button>
        </div>
      </div>
    </div>
  );
}
