import '../../styles/index.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { Modal } from '@/shared/components/ui';
import type { ColumnModel } from '@/features/tables/types/table.types';
import { ImageColumnSettings } from '@/features/tables/components/UniversalTable/column-settings/ImageColumnSettings';
import { ImageCell } from '@/features/tables/components/cells/ImageCell';

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get('theme') || 'light';
document.documentElement.lang = params.get('language') || 'en';
localStorage.setItem('god-crm-language', document.documentElement.lang);
const images = ['/src/tests/image-settings-fixture/wide.svg', '/src/tests/image-settings-fixture/portrait.svg', '/src/tests/image-settings-fixture/wide.svg'];
const initialColumn: ColumnModel = {
  id: 'images', tableId: '1', name: 'images', displayName: 'Images', type: 'image',
  config: { image: { displayMode: 'single', rowHeight: 96 }, file: { saveFormat: 'url' } },
  isRequired: false, isReadonly: false, orderIndex: 0, width: 200, isVisible: true,
};

function Fixture() {
  const [draft, setDraft] = useState(initialColumn);
  const [saved, setSaved] = useState(initialColumn);
  const [open, setOpen] = useState(true);
  return <main className="p-4 text-[var(--text-primary)]">
    <h1>Image display regression</h1>
    <button type="button" onClick={() => { setDraft(saved); setOpen(true); }}>Settings</button>
    <section aria-label="Saved cell"><ImageCell value={images} readOnly config={saved.config} /></section>
    <Modal open={open} onOpenChange={setOpen} title="Images" size="lg"
      primaryAction={{ label: 'Save', onClick: () => { setSaved(draft); setOpen(false); } }}>
      <ImageColumnSettings draft={draft} setDraft={setDraft} firstRow={{ images }} />
    </Modal>
  </main>;
}
createRoot(document.getElementById('root')!).render(<LanguageProvider><Fixture /></LanguageProvider>);
