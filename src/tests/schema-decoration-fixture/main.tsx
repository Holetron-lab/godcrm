import '../../styles/index.css';
import { createRoot } from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import { LanguageProvider, useLanguage } from '@/shared/i18n/LanguageContext';
import { ProjectBoundaries } from '@/features/schema-editor/components/layers/ProjectBoundaries';
import { TableWidgetStrips } from '@/features/schema-editor/components/nodes/TableWidgetStrips';
import { NavTreeItem } from '@/features/schema-editor/components/panels/NavTreeItem';
import { useSchemaEditorStore } from '@/features/schema-editor/store/schemaEditorStore';
import type { TableNode, NavTreeNode } from '@/features/schema-editor/types/schema-editor.types';

const widgets = [
  { widgetId: 1, name: 'Deliveries and payments', icon: '', presetName: 'table_view', widgetConfig: { procurement: { supplier_table_id: 6 } } },
  { widgetId: 2, name: 'Orders', icon: '', presetName: 'table_view' },
];
const node: TableNode = { id: 'table-7', type: 'tableNode', position: { x: 80, y: 180 }, measured: { width: 360, height: 120 },
  data: { tableId: 7, name: 'orders', displayName: 'Orders', key: 'orders', icon: '', projectId: 1, projectName: 'Procurement', isExternal: false, columns: [{ id: '1', name: 'title', displayName: 'Title', type: 'text', isPrimaryKey: false, isForeignKey: false, isRequired: false }], widgets } };
const table: NavTreeNode = { id: 'table:7', type: 'table', numericId: 7, name: 'orders', displayName: 'Orders', icon: '📋', children: [], parentId: null };
const project: NavTreeNode = { ...table, id: 'project:1', type: 'project', numericId: 1, name: 'Procurement', displayName: 'Procurement', children: [table] };
useSchemaEditorStore.setState({ nodes: [node] });
document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') || 'light';
function Fixture() {
  const { t } = useLanguage();
  const showWidgets = useSchemaEditorStore(state => state.showWidgets);
  return <main className="p-4">
    <h1>Schema decorations</h1>
    <button type="button" onClick={() => useSchemaEditorStore.getState().toggleWidgets()}>Toggle modules</button>
    <section aria-label="Canvas" className="relative h-[360px] isolate">
      <ProjectBoundaries nodes={[node]} projectColors={{ 1: '#2563eb' }} />
      <div style={{ position: 'absolute', left: 80, top: 180, width: 360, height: 120 }}>
        {showWidgets && <TableWidgetStrips widgets={widgets} openLabel="Open module" />}
        <div className="relative z-10 h-full border bg-[var(--bg-primary)] p-4">Orders table</div>
      </div>
    </section>
    <section aria-label="Navigation" className="max-w-lg">
      {[project, table, { ...table, id: 'widget:1', type: 'widget' as const, numericId: 1, name: widgets[0].name, displayName: widgets[0].name, presetName: 'table_view', widgetConfig: widgets[0].widgetConfig }].map(item =>
        <NavTreeItem key={item.id} node={item} depth={0} t={t} selectedTables={new Set()} selectedProjects={new Map()} onToggleSelect={() => {}} onToggleProjectSelect={() => {}} />)}
    </section>
  </main>;
}
createRoot(document.getElementById('root')!).render(<LanguageProvider><ReactFlowProvider><Fixture /></ReactFlowProvider></LanguageProvider>);
