import { Atom, ArrowRight } from 'lucide-react';
import { useDocumentsContext } from '../../DocumentsContext';
import { useDocumentUpdate } from '../hooks/useDocumentUpdate';
import { transliterate } from '../utils';
import type { DocumentItem } from '../../../../../types/documents.types';

interface AtomPreviewSectionProps {
  item: DocumentItem;
  tableId: number | undefined;
  onOpenAtomPicker: (itemId: number) => void;
}

export function AtomPreviewSection({ item, tableId, onOpenAtomPicker }: AtomPreviewSectionProps) {
  const ctx = useDocumentsContext();
  const updateItem = useDocumentUpdate(item.id, tableId);

  if (item.level === 'text') {
    const getParentHeading = (): string => {
      const itemIndex = ctx.items.findIndex(i => i.id === item.id);
      for (let i = itemIndex - 1; i >= 0; i--) {
        if (ctx.items[i].level === 'h3' || ctx.items[i].level === 'h2' || ctx.items[i].level === 'h1') {
          return ctx.items[i].content || '';
        }
      }
      return '';
    };

    return (
      <>
        <div className="border-t border-[var(--border-secondary)]" />

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Atom className="w-4 h-4 text-purple-400" />
            <span className="text-sm font-medium">Атом</span>
            {item.atom_ref && (
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-500/20 text-purple-400">
                активен
              </span>
            )}
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-[10px] uppercase text-[var(--text-tertiary)] mb-1">base_id</label>
              <input
                type="text"
                value={item.atom_ref || ''}
                placeholder={transliterate(getParentHeading() || 'atom') + '-' + item.id}
                onChange={async (e) => {
                  const newValue = e.target.value ? transliterate(e.target.value) : null;
                  await updateItem({ atom_ref: newValue });
                }}
                className="w-full px-2 py-1.5 rounded text-xs bg-[var(--bg-tertiary)] border border-[var(--border-primary)] font-mono"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase text-[var(--text-tertiary)] mb-1">Название атома</label>
              <input
                type="text"
                value={item.atom_title || ''}
                placeholder={getParentHeading() || 'Заголовок атома...'}
                onChange={async (e) => {
                  await updateItem({ atom_title: e.target.value || null });
                }}
                className="w-full px-2 py-1.5 rounded text-xs bg-[var(--bg-tertiary)] border border-[var(--border-primary)]"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase text-[var(--text-tertiary)] mb-1">Комментарий атома</label>
              <textarea
                value={item.atom_comment || ''}
                placeholder="Описание или пометка..."
                rows={2}
                onChange={async (e) => {
                  await updateItem({ atom_comment: e.target.value || null });
                }}
                className="w-full px-2 py-1.5 rounded text-xs bg-[var(--bg-tertiary)] border border-[var(--border-primary)] resize-none"
              />
            </div>

            {!ctx.isReadOnly && (
              <button
                onClick={() => {
                  ctx.setConvertToAtomItem(item);
                  ctx.setShowConvertToAtomModal(true);
                }}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-purple-400 hover:bg-purple-500/10 border border-purple-500/30 text-xs"
              >
                <Atom className="w-3.5 h-3.5" /> {item.atom_ref ? 'Редактировать атом' : 'Создать новый атом'}
              </button>
            )}

            {!ctx.isReadOnly && !item.atom_ref && (
              <button
                onClick={() => onOpenAtomPicker(item.id)}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-blue-400 hover:bg-blue-500/10 border border-blue-500/30 text-xs"
              >
                <ArrowRight className="w-3.5 h-3.5" /> Привязать существующий
              </button>
            )}
          </div>
        </div>
      </>
    );
  }

  if (item.level === 'atom') {
    return (
      <div className="space-y-4">
        <div className="p-3 rounded-lg border border-purple-500/30 bg-purple-500/5">
          <div className="flex items-center gap-2 mb-3">
            <Atom className="w-4 h-4 text-purple-400" />
            <span className="text-sm font-medium">Настройки атома</span>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-[10px] uppercase text-purple-400 mb-1">base_id</label>
              <input
                type="text"
                value={item.atom_ref || ''}
                placeholder="unique-atom-key"
                onChange={async (e) => {
                  await updateItem({ atom_ref: transliterate(e.target.value) });
                }}
                className="w-full px-2 py-1.5 rounded text-xs bg-[var(--bg-primary)] border border-purple-500/30 font-mono"
              />
            </div>

            <div>
              <label className="block text-[10px] uppercase text-purple-400 mb-1">Название</label>
              <input
                type="text"
                value={item.atom_title || ''}
                placeholder="Название атома"
                onChange={async (e) => {
                  await updateItem({ atom_title: e.target.value || null });
                }}
                className="w-full px-2 py-1.5 rounded text-xs bg-[var(--bg-primary)] border border-purple-500/30"
              />
            </div>

            <div>
              <label className="block text-[10px] uppercase text-purple-400 mb-1">Содержимое ({ctx.currentLanguage.toUpperCase()})</label>
              <textarea
                value={item.content || ''}
                placeholder="Содержимое атома (Markdown)..."
                rows={6}
                onChange={async (e) => {
                  await updateItem({ [`content_${ctx.currentLanguage}`]: e.target.value || null });
                }}
                className="w-full px-2 py-1.5 rounded text-xs bg-[var(--bg-primary)] border border-purple-500/30 resize-none font-mono"
              />
            </div>
          </div>
        </div>

        {/* Translations */}
        <div className="p-3 rounded-lg border border-blue-500/30 bg-blue-500/5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-blue-400">Переводы</span>
            <button
              onClick={() => {
                ctx.setConvertToAtomItem(item);
                ctx.setShowConvertToAtomModal(true);
              }}
              className="px-2 py-1 rounded text-[10px] bg-blue-500/20 hover:bg-blue-500/30 text-blue-400"
            >
              AI Перевод
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-[10px] uppercase text-blue-400 mb-1">English</label>
              <textarea
                value={item.content_en || ''}
                placeholder="English content..."
                rows={3}
                onChange={async (e) => {
                  await updateItem({ content_en: e.target.value || null });
                }}
                className="w-full px-2 py-1.5 rounded text-xs bg-[var(--bg-primary)] border border-blue-500/30 resize-none"
              />
            </div>

            <div>
              <label className="block text-[10px] uppercase text-blue-400 mb-1">Русский</label>
              <textarea
                value={item.content_ru || ''}
                placeholder="Русский контент..."
                rows={3}
                onChange={async (e) => {
                  await updateItem({ content_ru: e.target.value || null });
                }}
                className="w-full px-2 py-1.5 rounded text-xs bg-[var(--bg-primary)] border border-blue-500/30 resize-none"
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
