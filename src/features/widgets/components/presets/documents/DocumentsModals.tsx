/**
 * Documents Modals - File upload, Atom configuration, and Structure editor modals
 * Refactored: individual modals extracted to ./modals/ directory (ADR-046)
 */

import { useRef } from 'react';
import { logger } from '@/shared/utils/logger';
import {
  X,
  Upload,
  FileUp,
  Atom,
  Save,
  Link2,
} from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { useDocumentsContext } from './DocumentsContext';
import { parseMarkdownToDocumentV4, buildSectionTreeV4 } from '../../../utils/parseMarkdownToAtoms';

// Extracted modals
import { CreateDocumentModal } from './modals/CreateDocumentModal';
import { EditDocumentModal } from './modals/EditDocumentModal';
import { StructureEditorModal } from './modals/StructureEditorModal';
import { ConvertToAtomModal } from './modals/ConvertToAtomModal';
import { ConvertToTicketModal } from './modals/ConvertToTicketModal';
import { AgentsModal } from './modals/AgentsModal';
import { TranslationMissingModal } from './modals/TranslationMissingModal';

export function DocumentsModals() {
  const ctx = useDocumentsContext();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // === LANGUAGE DETECTION ===

  // Detect if text is primarily Russian (>10% Cyrillic words = likely Russian)
  const detectLanguage = (text: string): 'en' | 'ru' => {
    // Extract words (at least 3 chars)
    const words = text.match(/[a-zA-Zа-яА-ЯёЁ]{3,}/g) || [];
    if (words.length === 0) return 'en';

    // Count Cyrillic words
    const cyrillicWords = words.filter(w => /[а-яА-ЯёЁ]/.test(w)).length;
    const ratio = cyrillicWords / words.length;

    // 10% threshold - if even 10% words are Cyrillic, it's likely Russian
    return ratio > 0.1 ? 'ru' : 'en';
  };

  // === FILE UPLOAD HANDLERS ===

  const handleImportFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    const parsed = parseMarkdownToDocumentV4(text, { sourceFile: file.name });
    const tree = buildSectionTreeV4(parsed.sections);

    // Auto-detect language if set to 'auto'
    if (ctx.importLanguage === 'auto') {
      const detected = detectLanguage(text);
      ctx.setImportLanguage(detected);
    }

    ctx.setNewDocName(parsed.title);
    ctx.setNewDocDescription(parsed.description || '');
    ctx.setImportTree(tree);
    ctx.setIsCreatingMode(true);
    ctx.setPreviewMode('none');
    ctx.setShowFileUploadModal(false);

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleUrlImport = async () => {
    if (!ctx.urlInput.trim()) return;

    try {
      const response = await fetch(ctx.urlInput);
      if (!response.ok) throw new Error('Failed to fetch');

      const text = await response.text();

      // Extract filename from URL
      const urlParts = ctx.urlInput.split('/');
      const fileName = urlParts[urlParts.length - 1] || 'document.md';

      const parsed = parseMarkdownToDocumentV4(text, { sourceFile: fileName });
      const tree = buildSectionTreeV4(parsed.sections);

      // Auto-detect language if set to 'auto'
      if (ctx.importLanguage === 'auto') {
        const detected = detectLanguage(text);
        ctx.setImportLanguage(detected);
      }

      ctx.setNewDocName(parsed.title);
      ctx.setNewDocDescription(parsed.description || '');
      ctx.setImportTree(tree);
      ctx.setIsCreatingMode(true);
      ctx.setPreviewMode('none');
      ctx.setShowFileUploadModal(false);
      ctx.setUrlInput('');
    } catch (error) {
      logger.error('Failed to import from URL:', error);
      alert('Не удалось загрузить файл по ссылке');
    }
  };

  // === RENDER ===

  return (
    <>
      {/* File Upload Modal — hidden in read-only (ADR-0060 P6/P) */}
      {ctx.showFileUploadModal && !ctx.isReadOnly && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-primary)]">
              <div className="flex items-center gap-3">
                <Upload className="w-5 h-5 text-blue-500" />
                <span className="font-medium">Загрузить Markdown</span>
              </div>
              <button
                onClick={() => { ctx.setShowFileUploadModal(false); ctx.setUrlInput(''); }}
                className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Drag & Drop area */}
              <div
                className="flex flex-col items-center justify-center py-10 border-2 border-dashed border-[var(--border-primary)] rounded-xl hover:border-[var(--color-primary-500)] transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.add('border-[var(--color-primary-500)]');
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.remove('border-[var(--color-primary-500)]');
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.remove('border-[var(--color-primary-500)]');
                  const file = e.dataTransfer.files[0];
                  if (file) {
                    const input = fileInputRef.current;
                    if (input) {
                      const dt = new DataTransfer();
                      dt.items.add(file);
                      input.files = dt.files;
                      input.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                  }
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".md,.markdown,.txt"
                  onChange={handleImportFileSelect}
                  className="hidden"
                />
                <FileUp className="w-10 h-10 text-[var(--text-tertiary)] mb-3" />
                <p className="text-[var(--text-secondary)] text-sm mb-2">Перетащите MD файл сюда</p>
                <button
                  onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                  className="px-4 py-2 rounded-lg bg-[var(--color-primary-500)] text-white text-sm font-medium"
                >
                  Выбрать файл
                </button>
              </div>

              {/* Language selector */}
              <div className="flex items-center gap-3">
                <span className="text-sm text-[var(--text-secondary)]">Язык документа:</span>
                <div className="flex gap-1">
                  {(['auto', 'en', 'ru'] as const).map(lang => (
                    <button
                      key={lang}
                      onClick={() => ctx.setImportLanguage(lang)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                        ctx.importLanguage === lang
                          ? "bg-[var(--color-primary-500)] text-white"
                          : "bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                      )}
                    >
                      {lang === 'auto' ? '🔍 Авто' : lang === 'en' ? '🇺🇸 EN' : '🇷🇺 RU'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Divider */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-[var(--border-primary)]" />
                <span className="text-xs text-[var(--text-tertiary)]">или</span>
                <div className="flex-1 h-px bg-[var(--border-primary)]" />
              </div>

              {/* URL input */}
              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">Загрузить по ссылке</label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={ctx.urlInput}
                    onChange={(e) => ctx.setUrlInput(e.target.value)}
                    placeholder="https://example.com/document.md"
                    className="flex-1 px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-sm focus:border-[var(--color-primary-500)] outline-none"
                  />
                  <button
                    onClick={handleUrlImport}
                    disabled={!ctx.urlInput.trim()}
                    className="px-4 py-2 rounded-lg bg-[var(--color-primary-500)] text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Загрузить
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Atom Modal — hidden in read-only (ADR-0060 P6/P) */}
      {ctx.showAtomModal && ctx.selectedItemForAtom && !ctx.isReadOnly && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-primary)]">
              <div className="flex items-center gap-3">
                <Atom className="w-5 h-5 text-purple-500" />
                <span className="font-medium">Настройка атома</span>
              </div>
              <button
                onClick={() => { ctx.setShowAtomModal(false); ctx.setSelectedItemForAtom(null); }}
                className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-sm text-[var(--text-secondary)]">
                Настройте привязку этого элемента к атому в системе. Атом можно будет использовать
                для ссылок, поиска и навигации.
              </p>

              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">base_id (ключ атома)</label>
                <input
                  type="text"
                  value={ctx.selectedItemForAtom.atom_key || ''}
                  onChange={(e) => ctx.setSelectedItemForAtom({
                    ...ctx.selectedItemForAtom!,
                    atom_key: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-')
                  })}
                  placeholder="heading-name-123"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] font-mono text-sm focus:border-purple-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">Заголовок атома</label>
                <input
                  type="text"
                  value={ctx.selectedItemForAtom.atom_title || ''}
                  onChange={(e) => ctx.setSelectedItemForAtom({
                    ...ctx.selectedItemForAtom!,
                    atom_title: e.target.value
                  })}
                  placeholder="Описательный заголовок"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-sm focus:border-purple-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">Комментарий</label>
                <textarea
                  value={ctx.selectedItemForAtom.comment || ''}
                  onChange={(e) => ctx.setSelectedItemForAtom({
                    ...ctx.selectedItemForAtom!,
                    comment: e.target.value
                  })}
                  placeholder="Заметки, TODO, контекст... (не отображается в документе)"
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-sm focus:border-purple-500 outline-none resize-y"
                />
              </div>

              <div className="flex items-center gap-3 pt-4 border-t border-[var(--border-primary)]">
                <button
                  onClick={async () => {
                    if (!ctx.selectedItemForAtom || !ctx.selectedDocumentId || !ctx.selectedDocument?.content_table_id) return;

                    await ctx.updateItem({
                      documentId: ctx.selectedDocumentId,
                      itemId: ctx.selectedItemForAtom.id,
                      tableId: ctx.selectedDocument.content_table_id,
                      data: {
                        atom_key: ctx.selectedItemForAtom.atom_key,
                        atom_title: ctx.selectedItemForAtom.atom_title,
                        comment: ctx.selectedItemForAtom.comment,
                      },
                    });

                    ctx.setShowAtomModal(false);
                    ctx.setSelectedItemForAtom(null);
                  }}
                  className="flex-1 px-4 py-2 rounded-lg bg-purple-500 text-white text-sm font-medium flex items-center justify-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  Сохранить
                </button>
                <button
                  onClick={() => { ctx.setShowAtomModal(false); ctx.setSelectedItemForAtom(null); }}
                  className="px-4 py-2 rounded-lg bg-[var(--bg-tertiary)] text-sm"
                >
                  Отмена
                </button>
              </div>

              {ctx.selectedItemForAtom.atom_key && (
                <div className="mt-4 p-3 rounded-lg bg-[var(--bg-tertiary)] text-xs">
                  <div className="flex items-center gap-2 text-[var(--text-tertiary)]">
                    <Link2 className="w-3 h-3" />
                    <span>Ссылка на атом:</span>
                  </div>
                  <code className="block mt-1 text-purple-400 font-mono">
                    atom://{ctx.selectedItemForAtom.atom_key}
                  </code>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ADR-0060 P6/P — All mutation-only modals are blocked in read-only mode.
          Defense-in-depth: the openers are also gated, but if any external
          state-setter slips through, the modal still refuses to render. */}

      {/* Structure Editor Modal */}
      {ctx.showStructureModal && ctx.selectedDocument && !ctx.isReadOnly && (
        <StructureEditorModal />
      )}

      {/* Convert to Atom Modal */}
      {ctx.showConvertToAtomModal && ctx.convertToAtomItem && !ctx.isReadOnly && (
        <ConvertToAtomModal />
      )}

      {/* Convert to Ticket Modal */}
      {ctx.showConvertToTicketModal && ctx.convertToTicketItem && !ctx.isReadOnly && (
        <ConvertToTicketModal />
      )}

      {/* Agents Modal */}
      {ctx.showAgentsModal && !ctx.isReadOnly && (
        <AgentsModal />
      )}

      {/* Translation Missing Modal — pops when language switch finds no
          translated content; lets the user dispatch the configured
          translation agent in a row-bound chat. */}
      {ctx.showTranslationMissingModal && !ctx.isReadOnly && (
        <TranslationMissingModal />
      )}

      {/* Create Document Modal */}
      {ctx.showCreateDocumentModal && !ctx.isReadOnly && (
        <CreateDocumentModal />
      )}

      {/* Edit Document Modal */}
      {ctx.showEditDocumentModal && (ctx.editingDocumentId || ctx.selectedDocumentId) && !ctx.isReadOnly && (
        <EditDocumentModal />
      )}
    </>
  );
}
