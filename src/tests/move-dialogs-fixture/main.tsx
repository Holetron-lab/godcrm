import '../../styles/index.css';
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { apiClient } from '@/shared/utils/apiClient';
import { MoveTablesModal } from '@/features/schema-editor/components/modals/MoveTablesModal';
import { MoveItemsModal } from '@/features/space-manager/components/modals/MoveItemsModal';
import { useSpaceManagerStore } from '@/features/space-manager/store/spaceManagerStore';
import { spaceManagerApi } from '@/features/space-manager/api/spaceManagerApi';
import type { TreeNode } from '@/features/space-manager/types/space-manager.types';

const node = (id: string, name: string, type: TreeNode['type'], children: TreeNode[] = []): TreeNode =>
  ({ id, name, type, children, icon: '', data: {}, parentId: null, orderIndex: 0, depth: 0 });
const tree = [node('project:7', 'Target project', 'project', [
  node('folder:8', 'Target folder', 'folder', [node('folder:9', 'Nested folder', 'folder')]),
  node('virtual:tables', 'Virtual group', 'folder'),
])];
const moves: unknown[] = [];
apiClient.request = (async (url: string, options?: RequestInit) => {
  if (url === '/spaces') return { data: [{ id: 11, name: 'Test space', icon: '' }] };
  if (url === '/spaces/11/tree') return { data: tree };
  if (url === '/spaces/11/batch' && options?.method === 'POST') {
    moves.push(JSON.parse(String(options.body)));
    return { data: { success: [{ id: 42 }], failed: [] } };
  }
  throw new Error(`Unexpected fixture API: ${url}`);
}) as typeof apiClient.request;
spaceManagerApi.batch = async (_spaceId, request) => {
  moves.push(request);
  return { success: [{ type: 'table', id: 42, action: 'move' }], failed: [] };
};
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function Fixture() {
  const [tablesOpen, setTablesOpen] = useState(false);
  const [result, setResult] = useState('[]');
  return <main>
    <button type="button" onClick={() => setTablesOpen(true)}>Open tables</button>
    <button type="button" onClick={() => useSpaceManagerStore.setState({ moveModalOpen: true, moveModalItems: ['table:42'] })}>Open items</button>
    <output aria-label="Moves">{result}</output>
    <MoveTablesModal open={tablesOpen} onClose={() => setTablesOpen(false)} tableIds={[42]} currentSpaceId={11}
      onSuccess={() => setResult(JSON.stringify(moves))} />
    <MoveItemsModal spaceId={11} tree={tree} onSuccess={() => setResult(JSON.stringify(moves))} />
  </main>;
}
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}><LanguageProvider><Fixture /></LanguageProvider></QueryClientProvider>
);
