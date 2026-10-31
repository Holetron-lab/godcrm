import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';
import { TableViewWidget } from '@/features/widgets/components/presets/TableViewWidget';
import { WidgetColumnVisibility } from '@/features/widgets/components/presets/WidgetColumnVisibility';
import { WidgetTableLink } from '@/features/widgets/components/presets/WidgetTableLink';
import { TableFilters } from '@/features/tables/components/TableFilters/TableFilters';
import type { ColumnModel } from '@/features/tables/types/table.types';
import type { Widget } from '@/features/widgets/types/widget.types';
import '@/styles/index.css';

const darkTheme = window.matchMedia('(prefers-color-scheme: dark)').matches;
const columns: ColumnModel[] = [
  { name: 'name', displayName: 'Название', type: 'text' },
  { name: 'status', displayName: 'Статус', type: 'select', config: { options: [{ value:'new',label:'Новая',color:darkTheme ? '#93c5fd' : '#1e40af' },{ value:'done',label:'Готово',color:darkTheme ? '#86efac' : '#166534' }] } },
  { name: 'content', displayName: 'Контент', type: 'image', config: { image: { rowHeight: 140, fit: 'contain' } } },
  { name: 'summary', displayName: 'Сводка', type: 'rollup', config: { rollup: { fields: [
    { id:'name',label:'Название',formula:'{{name}}' },
    { id:'status',label:'Статус',formula:'{{status}}' },
  ] } } },
  { name: 'internal_note', displayName: 'Служебная заметка', type: 'text', isVisible: false },
].map((c, i) => ({ id: String(i), tableId:'123', config:{}, isRequired:false, isReadonly:false, orderIndex:i, width:180, isVisible: true, ...c } as ColumnModel));
const initialWidget = { id:1, preset_name:'table_view', config:{table_id:123} } as Widget;
function App() {
  const [isEditMode, setIsEditMode] = useState(false);
  const [widget, setWidget] = useState(initialWidget);
  const [rows,setRows] = useState([{id:1,name:'Бета',status:'new',content:'/src/tests/widget-table-fixture/image.svg'},{id:2,name:'Альфа',status:'done',content:''}]);
  return <main className="p-4 h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
    <h1 className="mb-4 text-lg">Таблица виджета</h1>
    <button type="button" aria-pressed={isEditMode} onClick={() => setIsEditMode(!isEditMode)}>Редактировать виджет</button>
    <TableFilters columns={columns} searchQuery="" onSearchChange={()=>{}} searchColumns={[]} onSearchColumnsChange={()=>{}} selectFilters={{}} onSelectFiltersChange={()=>{}} dateFilters={{}} onDateFiltersChange={()=>{}} activeFilterColumns={[]} onActiveFilterColumnsChange={()=>{}} onAddRow={()=>{}} compact
      afterAddRow={<WidgetTableLink tableId={123} />} columnVisibilityControl={<WidgetColumnVisibility columns={columns} config={widget.config!} onChange={patch => setWidget({...widget,config:{...widget.config,...patch}})} />} />
    <div className="h-[65vh]"><TableViewWidget isEditMode={isEditMode} widget={widget} data={rows} columnsInfo={columns} tableColumns={columns}
      onConfigChange={patch => setWidget({...widget,config:{...widget.config,...patch}})}
      onCellUpdate={async (id,field,value) => { setRows(current => current.map(row=>String(row.id)===id?{...row,[field]:value}:row)); }} /></div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<BrowserRouter><QueryClientProvider client={new QueryClient()}><LanguageProvider><App /></LanguageProvider></QueryClientProvider></BrowserRouter>);
