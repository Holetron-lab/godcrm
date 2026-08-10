/**
 * Edit Document Modal - Edit existing document properties
 */

import { useState, useEffect } from 'react';
import { FileText, X } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { logger } from '@/shared/utils/logger';
import { apiClient } from '@/shared/utils/apiClient';
import { useDocumentsContext } from '../DocumentsContext';
import { getStatusChipClass, getStatusDotClass } from '../../../../types/documents.types';

export function EditDocumentModal() {
  const ctx = useDocumentsContext();
  const targetId = ctx.editingDocumentId ?? ctx.selectedDocumentId;
  const doc = ctx.documents.find(d => d.id === targetId);

  const [name, setName] = useState(doc?.name || '');
  const [description, setDescription] = useState(doc?.description || '');
  const [category, setCategory] = useState(doc?.category || '');
  const [icon, setIcon] = useState(doc?.icon || '📄');
  const [statusId, setStatusId] = useState<number | null>(doc?.status_id ?? null);
  const [statusPickerOpen, setStatusPickerOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Reset form when the target document changes.
  // Intentionally NOT depending on `ctx` — the provider rebuilds its value on
  // every render, which would reset every keystroke mid-edit.
  useEffect(() => {
    if (!doc) return;
    setName(doc.name || '');
    setDescription(doc.description || '');
    setCategory(doc.category || '');
    setIcon(doc.icon || '📄');
  }, [doc?.id]);

  // Once statusOptions load, resolve initial status from status_id or legacy slug.
  useEffect(() => {
    if (!doc) return;
    if (doc.status_id != null) {
      setStatusId(doc.status_id);
      return;
    }
    if (doc.status && ctx.statusOptions.length > 0) {
      const bySlug = ctx.statusOptions.find(o => o.slug === doc.status);
      setStatusId(bySlug?.id ?? null);
    } else {
      setStatusId(null);
    }
  }, [doc?.id, doc?.status_id, doc?.status, ctx.statusOptions]);

  const closeModal = () => {
    ctx.setShowEditDocumentModal(false);
    ctx.setEditingDocumentId(null);
    setStatusPickerOpen(false);
  };

  const handleSave = async () => {
    if (!name.trim() || !ctx.registryTableId || !doc) return;

    setIsSaving(true);
    setSaveError(null);
    try {
      const opt = statusId != null ? ctx.statusOptions.find(o => o.id === statusId) : undefined;
      // `category` is a select column on the registry. Sending an empty string
      // is a no-op (the resolver skips it), but sending an option not in the
      // configured list returns 400. Only include the field if it's one of the
      // valid options (or intentionally cleared).
      const trimmedCategory = category.trim();
      const validCategory =
        trimmedCategory === '' ||
        ctx.categoryOptions.length === 0 ||
        ctx.categoryOptions.includes(trimmedCategory);
      if (!validCategory) {
        setSaveError(`Invalid category. Pick one of: ${ctx.categoryOptions.join(', ')}`);
        setIsSaving(false);
        return;
      }

      await apiClient.request(
        `/tables/${ctx.registryTableId}/rows/${doc.id}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            data: {
              name: name.trim(),
              description: description.trim(),
              category: trimmedCategory,
              icon,
              status_id: opt?.id ?? null,
              status: opt?.slug ?? null,
            }
          }),
        }
      );

      ctx.refresh();
      closeModal();
    } catch (error) {
      logger.error('Failed to update document:', error);
      setSaveError(error instanceof Error ? error.message : 'Failed to save document');
    } finally {
      setIsSaving(false);
    }
  };

  if (!doc) return null;

  const currentStatus = statusId != null ? ctx.statusOptions.find(o => o.id === statusId) : undefined;
  const currentChip = getStatusChipClass(currentStatus);
  const currentDot = getStatusDotClass(currentStatus);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={closeModal}>
      <div
        className="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-primary)] shadow-2xl w-full max-w-md"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-primary)]">
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-blue-400" />
            <h2 className="text-lg font-semibold">Edit Document</h2>
          </div>
          <button onClick={closeModal} className="p-2 hover:bg-[var(--bg-tertiary)] rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {/* Icon picker */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Icon</label>
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
            <label className="block text-sm font-medium mb-1.5">Name *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Document name"
              className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-sm"
              autoFocus
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Brief document description"
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-sm resize-none"
            />
          </div>

          {/* Category — dropdown when the registry's `category` column is a select */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Category</label>
            {ctx.categoryOptions.length > 0 ? (
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-sm"
              >
                <option value="">— none —</option>
                {ctx.categoryOptions.map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={category}
                onChange={e => setCategory(e.target.value)}
                placeholder="e.g. ADR, Spec, Guide"
                className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-sm"
              />
            )}
          </div>

          {/* Status */}
          <div>
            <label className="block text-sm font-medium mb-1.5">Status</label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setStatusPickerOpen(v => !v)}
                className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-sm flex items-center justify-between gap-2 hover:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                disabled={ctx.isLoadingStatusOptions}
              >
                {currentStatus ? (
                  <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs', currentChip.className)} style={currentChip.style}>
                    <span className={cn('w-1.5 h-1.5 rounded-full', currentDot.className)} style={currentDot.style} />
                    {currentStatus.icon ? `${currentStatus.icon} ` : ''}{currentStatus.label}
                  </span>
                ) : (
                  <span className="text-[var(--text-tertiary)]">— none —</span>
                )}
                <svg className="w-4 h-4 opacity-60" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd"/></svg>
              </button>
              {statusPickerOpen && (
                <div
                  className="absolute left-0 right-0 mt-1 z-10 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl p-1 max-h-64 overflow-auto"
                >
                  <button
                    type="button"
                    onClick={() => { setStatusId(null); setStatusPickerOpen(false); }}
                    className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]"
                  >
                    — none —
                  </button>
                  {ctx.statusOptions.map((option) => {
                    const optChip = getStatusChipClass(option);
                    const optDot = getStatusDotClass(option);
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => { setStatusId(option.id); setStatusPickerOpen(false); }}
                        className={cn(
                          'w-full text-left px-2 py-1.5 text-sm rounded hover:bg-[var(--bg-tertiary)] flex items-center gap-2',
                          statusId === option.id && 'bg-[var(--bg-tertiary)]'
                        )}
                      >
                        <span className={cn('w-2 h-2 rounded-full flex-shrink-0', optDot.className)} style={optDot.style} />
                        <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs', optChip.className)} style={optChip.style}>
                          {option.icon ? `${option.icon} ` : ''}{option.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)]">
          <div className="text-xs text-red-500 flex-1 min-w-0 truncate" title={saveError ?? undefined}>
            {saveError}
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <button
              onClick={closeModal}
              className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!name.trim() || isSaving}
              className="px-4 py-2 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
