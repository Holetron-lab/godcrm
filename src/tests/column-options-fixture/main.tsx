import '../../styles/index.css';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { tablesApi } from '@/features/tables/api/tablesApi';
import type { ColumnModel } from '@/features/tables/types/table.types';
import { SelectOptionsEditor } from '@/features/tables/components/UniversalTable/column-settings/SelectOptionsEditor';
import { ValidationRulesSettings } from '@/features/tables/components/UniversalTable/column-settings/ValidationRulesSettings';
import { MappingSection } from '@/features/tables/components/UniversalTable/column-settings/MappingSection';
import { LanguageProvider, useLanguage } from '@/shared/i18n/LanguageContext';

const params = new URLSearchParams(location.search);
const language = params.get('language') === 'en' ? 'en' : 'ru';
localStorage.setItem('god-crm-language', language);
document.documentElement.lang = language;
document.documentElement.dataset.theme = params.get('theme') || 'light';
const column: ColumnModel = { id: '8', tableId: '123', name: 'type', displayName: 'Тип', type: 'select',
  config: { options: [{ label: 'Petal Heart', value: 'Petal Heart', color: '#6366f1',
    children: [{ label: 'Вложенный вариант', value: 'child', color: '#14b8a6' }] }] },
  isRequired: false, isReadonly: false, orderIndex: 0, width: 160, isVisible: true };
let requests = 0;
tablesApi.getRows = async (tableId, page = 1, limit = 500) => {
  requests += 1;
  await new Promise(resolve => setTimeout(resolve, 150));
  const values = page === 1 ? Array<string>(500).fill('Petal Heart') : ['За пределами 500'];
  return { rows: values.map((value, index) => ({ id: String((page - 1) * limit + index), tableId,
    data: { type: value }, createdAt: '', updatedAt: '', createdBy: '' })),
    pagination: { page, limit, total: 501, pages: 2 } };
};
const noop = () => {};
function Fixture() {
  const { t } = useLanguage();
  const [draft, setDraft] = useState<ColumnModel | null>(column);
  if (!draft) return null;
  return <main className="mx-auto max-w-4xl space-y-4 p-4 text-[var(--text-primary)]">
    <h1>{t('columnSettings.title', { name: column.displayName })}</h1>
    <SelectOptionsEditor column={column} draft={draft} setDraft={setDraft} t={t}
      options={draft.config.options || []} relationConfig={undefined} availableTables={[]} importTableColumns={[]}
      handleExportOptionsCsv={noop} handleImportOptionsCsv={noop} handleImportFromTable={noop}
      importFromTableOpen={false} setImportFromTableOpen={noop} importTableId="" setImportTableId={noop}
      importValueColumn="" setImportValueColumn={noop} importLabelColumn="" setImportLabelColumn={noop}
      optionsSubTab="options" setOptionsSubTab={noop} setActiveTab={noop} />
    <ValidationRulesSettings draft={draft} setDraft={updater => setDraft(current => current && (typeof updater === 'function' ? updater(current) : updater))} />
    <MappingSection draft={draft} t={t} allColumns={[column]} currentMappingRow={{ id: '51', type: 'Petal Heart' }}
      mappingRowIndex={0} mappingRows={[{ id: '51', data: {} }]} goToPrevMappingRow={noop} goToNextMappingRow={noop} />
    <output data-testid="requests">{requests}</output>
  </main>;
}
createRoot(document.getElementById('root')!).render(<LanguageProvider><Fixture /></LanguageProvider>);
