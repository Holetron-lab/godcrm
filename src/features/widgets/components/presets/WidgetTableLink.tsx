import { Table2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/shared/i18n/LanguageContext';

export function WidgetTableLink({ tableId }: { tableId: number }) {
  const { t } = useLanguage();
  const label = t('widgets.tableControls.openTable');
  return <Link to={`/tables/${tableId}`} title={label} aria-label={label} className="p-1.5 rounded-md hover:bg-[var(--bg-tertiary)]"><Table2 className="w-4 h-4" /></Link>;
}
