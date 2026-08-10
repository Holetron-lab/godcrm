/**
 * Convert to Atom Modal - Create a full atom from text element with translations
 */

import { useState } from 'react';
import {
  X,
  Atom,
  Save,
  Link2,
  RefreshCw,
} from 'lucide-react';
import { logger } from '@/shared/utils/logger';
import { useDocumentsContext } from '../DocumentsContext';

export function ConvertToAtomModal() {
  const ctx = useDocumentsContext();
  const item = ctx.convertToAtomItem;

  // Get parent heading (h2 or h3) for default title
  const getParentHeading = (): string => {
    if (!item) return '';
    const itemIndex = ctx.items.findIndex(i => i.id === item.id);
    for (let i = itemIndex - 1; i >= 0; i--) {
      if (ctx.items[i].level === 'h3' || ctx.items[i].level === 'h2' || ctx.items[i].level === 'h1') {
        return ctx.items[i].content || '';
      }
    }
    return '';
  };

  // Transliterate for base_id
  const transliterate = (text: string): string => {
    const map: Record<string, string> = {
      'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh',
      'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
      'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'ts',
      'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
    };
    return text
      .toLowerCase()
      .split('')
      .map(char => map[char] || char)
      .join('')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  };

  const parentHeading = getParentHeading();

  const [atomKey, setAtomKey] = useState(() => item?.atom_ref || transliterate(parentHeading || 'atom') + '-' + (item?.id || ''));
  const [atomTitle, setAtomTitle] = useState(() => item?.atom_title || parentHeading);
  const [content, setContent] = useState(() => item?.content || '');
  const [contentEn, setContentEn] = useState(() => item?.content_en || '');
  const [contentRu, setContentRu] = useState(() => item?.content_ru || '');
  const [isTranslating, setIsTranslating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // AI Translate handler
  const handleAITranslate = async () => {
    if (!content.trim()) return;

    setIsTranslating(true);
    try {
      // Call AI agent for translation
      const response = await fetch('/api/v3/ai/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          space_id: ctx.projectId,
          prompt: `Translate the following text to both English and Russian. Respond in JSON format with keys "en" and "ru":

Text to translate:
${content}`,
          context: { type: 'translation' }
        }),
      });

      if (response.ok) {
        const result = await response.json();
        // Try to parse AI response as JSON
        const aiText = result.data?.response || result.data?.text || '';
        try {
          // Try to extract JSON from the response
          const jsonMatch = aiText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const translations = JSON.parse(jsonMatch[0]);
            if (translations.en) setContentEn(translations.en);
            if (translations.ru) setContentRu(translations.ru);
          }
        } catch {
          // If JSON parsing fails, show the raw response
          logger.debug('AI response:', aiText);
        }
      }
    } catch (error) {
      logger.error('Translation failed:', error);
    } finally {
      setIsTranslating(false);
    }
  };

  // Save handler - converts text to atom and creates atom in atoms table
  const handleSave = async () => {
    if (!item || !ctx.selectedDocumentId || !ctx.selectedDocument?.content_table_id) return;

    logger.debug('=== SAVING ATOM ===');
    logger.debug('atomsTableId:', ctx.atomsTableId);
    logger.debug('atomKey:', atomKey);
    logger.debug('atomTitle:', atomTitle);

    if (!ctx.atomsTableId) {
      alert('Ошибка: atoms_table_id не настроен в конфиге виджета');
      return;
    }

    setIsSaving(true);
    try {
      // 1. Create atom record in atoms table using context method
      logger.debug('Creating atom in table:', ctx.atomsTableId);
      const atomResult = await ctx.createAtom({
        key: atomKey,
        title: atomTitle,
        content: content,
        content_en: contentEn || null,
        content_ru: contentRu || null,
        type: 'content',
        document_ids: [ctx.selectedDocumentId],
      });
      logger.debug('Atom created result:', atomResult);

      // Check for success and get the atom ID
      if (!atomResult?.id) {
        alert('Ошибка создания атома: не получен ID');
        logger.error('Atom creation failed:', atomResult);
        setIsSaving(false);
        return;
      }

      const atomId = atomResult.id;
      logger.debug('Atom created with ID:', atomId);

      // 2. Update the document item - change level to 'atom', store atom ID as integer reference
      await ctx.updateItem({
        documentId: ctx.selectedDocumentId,
        itemId: item.id,
        tableId: ctx.selectedDocument.content_table_id,
        data: {
          level: 'atom',
          atom_ref: atomId, // Use atom row ID as integer
          atom_title: atomTitle || null,
          content_en: null,
          content_ru: null,
        },
      });

      ctx.setShowConvertToAtomModal(false);
      ctx.setConvertToAtomItem(null);
    } catch (error) {
      logger.error('Failed to convert to atom:', error);
    } finally {
      setIsSaving(false);
    }
  };

  if (!item) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--bg-primary)] rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-primary)]">
          <div className="flex items-center gap-3">
            <Atom className="w-5 h-5 text-purple-500" />
            <span className="font-medium">Создать атом</span>
          </div>
          <button
            onClick={() => { ctx.setShowConvertToAtomModal(false); ctx.setConvertToAtomItem(null); }}
            className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <p className="text-sm text-[var(--text-secondary)]">
            Преобразование текстового элемента в полноценный атом с поддержкой переводов.
          </p>

          {/* base_id */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
              base_id (ключ атома)
            </label>
            <input
              type="text"
              value={atomKey}
              onChange={(e) => setAtomKey(transliterate(e.target.value))}
              placeholder="unique-atom-key"
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-purple-500/30 font-mono text-sm focus:border-purple-500 outline-none"
            />
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
              Название атома
            </label>
            <input
              type="text"
              value={atomTitle}
              onChange={(e) => setAtomTitle(e.target.value)}
              placeholder="Описательный заголовок"
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-sm focus:border-purple-500 outline-none"
            />
          </div>

          {/* Content */}
          <div>
            <label className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
              Содержимое (Markdown)
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Основной контент атома..."
              rows={5}
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)] text-sm focus:border-purple-500 outline-none resize-y font-mono"
            />
          </div>

          {/* Translations Section */}
          <div className="border-t border-[var(--border-primary)] pt-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-blue-400">Переводы</span>
              <button
                onClick={handleAITranslate}
                disabled={isTranslating || !content.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 disabled:opacity-50"
              >
                {isTranslating ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <span>✨</span>
                )}
                AI Перевод
              </button>
            </div>

            {/* Translations in single column */}
            <div className="space-y-3">
              <div>
                <label className="block text-xs uppercase text-blue-400 mb-1">English</label>
                <textarea
                  value={contentEn}
                  onChange={(e) => setContentEn(e.target.value)}
                  placeholder="English translation..."
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-blue-500/30 text-sm focus:border-blue-500 outline-none resize-y"
                />
              </div>

              <div>
                <label className="block text-xs uppercase text-blue-400 mb-1">Русский</label>
                <textarea
                  value={contentRu}
                  onChange={(e) => setContentRu(e.target.value)}
                  placeholder="Русский перевод..."
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-blue-500/30 text-sm focus:border-blue-500 outline-none resize-y"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-6 py-4 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)]">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex-1 px-4 py-2 rounded-lg bg-purple-500 hover:bg-purple-600 text-white text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Создать атом
          </button>
          <button
            onClick={() => { ctx.setShowConvertToAtomModal(false); ctx.setConvertToAtomItem(null); }}
            className="px-4 py-2 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-primary)] text-sm"
          >
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}
