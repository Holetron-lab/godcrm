import '../../styles/index.css';
import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { loader } from '@monaco-editor/react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { JsonEditor } from '@/features/tables/components/cells/JsonEditor';
import { FilePreviewModal } from '@/features/files/components/FilePreviewModal';
import { FilePreviewModal as AttachmentPreview } from '@/features/widgets/components/modals/FilePreviewModal';
import { MarkdownPreviewModal } from '@/shared/components/MarkdownPreviewModal';
import { NestedTableModal } from '@/features/tables/components/cells/NestedTableModal';

loader.config({ paths: { vs: '/node_modules/monaco-editor/min/vs' } });
const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get('theme') || 'light';
const kind = params.get('kind') || 'file';
const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
client.setQueryData(['nested-table-info', 'fixture'], { name: 'fixture', displayName: 'Связанные записи', columns: [] });
client.setQueryData(['nested-table-rows', 'fixture', 'parent', 'fixture', 1], { rows: [], total: 0 });
const fileUrl = '/src/tests/preview-dialogs-fixture/sample.md';
function Fixture() {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(kind === 'json' ? '' : 'Исходное содержимое');
  const [draft, setDraft] = useState('');
  const [events, setEvents] = useState<string[]>([]);
  const close = () => { setOpen(false); setEvents(prev => [...prev, 'close']); };
  return <main className="p-4 text-[var(--text-primary)]">
    <h1>Окна предпросмотра</h1>
    <button type="button" onClick={() => setOpen(true)}>Открыть</button>
    <button type="button">Фоновое действие</button>
    <output className="block" aria-label="Сохранено">{saved}</output>
    <output className="block" aria-label="Черновик">{draft}</output>
    <output className="block" aria-label="События">{events.join(',')}</output>
    {kind === 'file' && <FilePreviewModal isOpen={open} onClose={close} fileName="Заметка.txt" fileType="text" inlineContent={saved} canEdit onSave={async content => { setSaved(content); setEvents(prev => [...prev, 'save']); }} />}
    {kind === 'attachment' && <AttachmentPreview file={open ? { id: 'fixture', name: 'Заметка.md', type: 'text/markdown', size: 100, uploadedAt: new Date(0), url: fileUrl } : null} onClose={close} />}
    {kind === 'markdown' && <MarkdownPreviewModal isOpen={open} onClose={close} fileUrl={fileUrl} fileName="Заметка.md" />}
    {kind === 'nested' && <NestedTableModal isOpen={open} onClose={close} tableId="fixture" filterColumn="parent" filterValue="fixture" />}
    {kind === 'json' && open && <JsonEditor value={saved} config={{ defaultMode: 'form' }} onChange={setDraft} onCancel={close} onCommit={value => { setSaved(value ?? saved); setEvents(prev => [...prev, 'save']); setOpen(false); }} />}
  </main>;
}
function StackedFixture() {
  const [open, setOpen] = useState(true);
  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
      <Dialog.Content aria-describedby={undefined} className="fixed inset-4 z-40 bg-[var(--bg-primary)] p-4">
        <Dialog.Title>Родительское окно</Dialog.Title>
        <Fixture />
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
createRoot(document.getElementById('root')!).render(<LanguageProvider><QueryClientProvider client={client}>{params.has('stack') ? <StackedFixture /> : <Fixture />}</QueryClientProvider></LanguageProvider>);
