import '../../styles/index.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImportModal } from '@/features/tables/components/modals/ImportModal';
import { ImportJSONModal } from '@/features/tables/components/modals/ImportJSONModal';

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get('theme') || 'light';
const client = new QueryClient();
function Fixture() {
  const [open, setOpen] = useState(false);
  const Component = params.get('kind') === 'json' ? ImportJSONModal : ImportModal;
  return <main>
    <button type="button" onClick={() => setOpen(true)}>Open import</button>
    <Component isOpen={open} onClose={() => setOpen(false)} tableId="42" tableName="Fixture table" />
  </main>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><Fixture /></QueryClientProvider>);
