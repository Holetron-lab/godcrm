import '../../styles/index.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { InstallPlanTree } from '@/features/module-install/InstallPlanTree';
import { blueprint, dashboards, plan, targetColumns, tree } from '@/features/module-install/__tests__/fixtures';
import type { InstallBindings, InstallPlan } from '@/features/module-install/types';

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get('theme') || 'light';
document.documentElement.lang = params.get('lang') || 'en';
localStorage.setItem('god-crm-language', document.documentElement.lang);

// Stands in for the dry-run: `priority` (number) auto-matches the select column `prio` and stays a
// blocking conflict until the user maps it to a new column or skips it.
const dryRun = (bindings: InstallBindings): InstallPlan => {
  const tickets = bindings.tables?.tickets;
  const priority = tickets?.action === 'connect' ? tickets.columns?.find(column => column.module_column === 'priority') : undefined;
  const base = plan();
  if (priority && (priority.target === '__new' || priority.target === null)) return base;
  return {
    ...base,
    tables: base.tables.map(table => table.key !== 'tickets' ? table : {
      ...table,
      columns: table.columns?.map(column => column.module_column !== 'priority' ? column
        : { ...column, target_type: 'select', compat: 'conflict' as const, reason: 'select ← number' }),
    }),
    conflicts: [{
      kind: 'column_type', table: 'tickets', column: 'priority', target: 'prio', existing_type: 'select', declared_type: 'number',
      reason: 'select ← number', referenced_by: ['apps.board.config.sort'], blocking: true,
    }],
  };
};

function Fixture() {
  const [bindings, setBindings] = useState<InstallBindings>({});
  const [installed, setInstalled] = useState(false);
  return <main className="flex h-screen flex-col bg-[var(--bg-primary)]">
    <h1 className="p-3 text-lg text-[var(--text-primary)]">Module install plan</h1>
    <div className="min-h-0 flex-1">
      <InstallPlanTree blueprint={blueprint} tree={tree} plan={dryRun(bindings)} bindings={bindings} onBindingsChange={setBindings}
        targetColumns={targetColumns} dashboards={dashboards} onInstall={() => setInstalled(true)} />
    </div>
    <output aria-label="Bindings" className="sr-only">{JSON.stringify(bindings)}</output>
    <output aria-label="Installed" className="sr-only">{String(installed)}</output>
  </main>;
}
createRoot(document.getElementById('root')!).render(<LanguageProvider><Fixture /></LanguageProvider>);
