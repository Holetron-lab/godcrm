import '../../styles/index.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RelationCell } from '@/features/tables/components/cells/RelationCell';
import type { ColumnRelationConfig } from '@/features/tables/types/table.types';

document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') || 'light';
const client = new QueryClient();
const relation: ColumnRelationConfig = { enabled: true, tableId: '42', valueColumn: 'id', labelColumn: 'name' };
const item = { label: 'Related record', description: 'A linked row', color: '#eab308' };
for (const reverse of [false, true]) {
  client.setQueryData(['relation-cell-data', '42', reverse ? 'parent_id' : 'id', 'name', undefined, reverse, reverse ? '9' : undefined], {
    map: new Map([['7', item]]), reverseItems: [{ ...item, value: '7' }],
  });
}
function Fixture() {
  const [calls, setCalls] = useState(0);
  const [destination, setDestination] = useState('');
  const [submits, setSubmits] = useState(0);
  const navigate = (tableId: string, rowId: string, column?: string) => {
    setCalls(value => value + 1);
    setDestination([tableId, rowId, column].filter(Boolean).join('/'));
  };
  return <main className="p-6 text-[var(--text-primary)]">
    <h1>Relation cell keyboard navigation</h1>
    <form onSubmit={event => { event.preventDefault(); setSubmits(value => value + 1); }}>
      {(['badges', 'tags', 'cards'] as const).map(displayMode => <section key={displayMode} aria-label={displayMode} className="my-6">
        <RelationCell value="7" relation={{ ...relation, displayMode }} onNavigateToRow={navigate} />
      </section>)}
      <section aria-label="Reverse" className="my-6">
        <RelationCell value="" rowId="9" relation={{ ...relation, lookupMode: 'reverse', valueColumn: 'parent_id' }} onNavigateToRow={navigate} />
      </section>
      <section aria-label="Disabled" className="my-6"><RelationCell value="7" relation={relation} /></section>
      <section aria-label="Nested" className="my-6">
        <RelationCell value="7" relation={{ ...relation, type: 'nested', nested: { filterColumn: 'parent_id', buttonLabel: 'Open records' } }} onOpenNestedTable={navigate} />
      </section>
      <button type="button">Outside</button>
    </form>
    <p role="status">Opened {calls}: {destination}</p>
    <p>Submits: {submits}</p>
    <div aria-hidden="true" className="h-[1200px]" />
  </main>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><Fixture /></QueryClientProvider>);
