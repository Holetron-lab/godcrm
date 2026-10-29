import '../../styles/index.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { DocumentsContext, type DocumentsContextValue } from '@/features/widgets/components/presets/documents/DocumentsContext';
import { DocumentItemRenderer } from '@/features/widgets/components/presets/documents/content/DocumentItemRenderer';
import type { DocumentItem } from '@/features/widgets/types/documents.types';

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get('theme') || 'light';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const initialContent = params.get('kind') === 'short' ? 'Короткий текст.' :
  'Всё можно сделать в других программах. Это правда.\n\n- Первый пункт с длинным текстом, который переносится на небольшом экране.\n- Второй пункт.\n\nВывод: спорить с аргументом нельзя, надо признать его первой фразой.';
const noop = () => {};
function Fixture() {
  const [item, setItem] = useState<DocumentItem>({ id: 1, level: 'text', content: initialContent, order: 0 });
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editingData, setEditingData] = useState<Partial<DocumentItem>>({});
  const [events, setEvents] = useState<string[]>([]);
  const cancel = () => { setEditingItemId(null); setEditingData({}); };
  const save = () => { setItem(previous => ({ ...previous, ...editingData })); setEvents(previous => [...previous, 'save']); cancel(); };
  const context: Partial<DocumentsContextValue> = {
    isReadOnly: params.get('readonly') === 'true', editingItemId, editingData, setEditingData, selectedItemId: null,
    setSelectedItemId: noop, setRightPanelOpen: noop, setRightPanelMode: noop,
  };
  return <QueryClientProvider client={client}><DocumentsContext.Provider value={context as DocumentsContextValue}>
    <main className="p-4 pr-16 max-w-3xl mx-auto bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <h1>Редактор текста документа</h1>
      <div style={{ fontSize: `${Number(params.get('size') || 12)}px`, lineHeight: 1.5 }}>
        <DocumentItemRenderer item={item} index={0} itemsCount={1} openMenu={null} openMenuAt={noop} closeMenu={noop}
          onStartEditing={value => { if (context.isReadOnly) return; setEditingData(value); setEditingItemId(value.id); }}
          onCancelEditing={cancel} onSaveEditing={save} onAddBefore={noop} onAddAfter={noop}
          onDelete={noop} onCopy={noop} onMoveUp={noop} onMoveDown={noop} />
      </div>
      <button type="button">После блока</button>
      <output aria-label="Сохранения">{events.join(',')}</output>
      <pre aria-label="Сохранённый текст" className="whitespace-pre-wrap break-all">{item.content}</pre>
    </main>
  </DocumentsContext.Provider></QueryClientProvider>;
}
createRoot(document.getElementById('root')!).render(<LanguageProvider><Fixture /></LanguageProvider>);
