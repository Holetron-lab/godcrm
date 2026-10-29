import '../../styles/index.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InlineCreateFolder, InlineEditFolder } from '@/shared/components/layout/project-content/FolderForms';
import { AdderRow } from '@/features/tables/components/cells/JsonEditor.parts';
import { PasswordPrompt } from '@/features/public/PasswordPrompt';
import { DetailsPanel } from '@/features/space-manager/components/panels/DetailsPanel';
import { useSpaceManagerStore } from '@/features/space-manager/store/spaceManagerStore';

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get('theme') || 'light';
const kind = params.get('kind');
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
useSpaceManagerStore.setState({ focusedItem: 'project:1', selectedItems: new Set() });

function Fixture() {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState('');
  const close = () => setOpen(false);
  return <main className="p-4 text-[var(--text-primary)] bg-[var(--bg-primary)] min-h-screen">
    <h1>Form focus</h1>
    <button type="button" onClick={() => setOpen(true)}>Open form</button>
    <output aria-label="Result">{result}</output>
    <section aria-label="Form under test">
      {kind === 'create' && <InlineCreateFolder isOpen={open} onClose={close} onCreate={(name) => setResult(name)} />}
      {kind === 'edit' && open && <InlineEditFolder folder={{ id: '1', name: 'Reports', items: [], isExpanded: true }}
        onClose={close} onSave={(_id, name) => setResult(name)} onDelete={() => setResult('deleted')} />}
      {kind === 'json' && open && <AdderRow isArray={params.has('array')} existingKeys={[]} indent={0}
        onCancel={close} onAdd={(type, key) => setResult(`${type}:${key || ''}`)} />}
      {kind === 'password' && <PasswordPrompt slug="fixture" onSuccess={() => setResult('unlocked')} />}
      {kind === 'details' && <DetailsPanel spaceId={11} onRefresh={() => setResult('refreshed')} tree={[{
        id: 'project:1', type: 'project', name: 'Reports', icon: '📁', data: {},
        children: [], parentId: null, orderIndex: 0, depth: 0,
      }]} />}
    </section>
  </main>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><Fixture /></QueryClientProvider>);
