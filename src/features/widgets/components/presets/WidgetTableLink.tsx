import { ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';

export function WidgetTableLink({ tableId }: { tableId: number }) {
  return <Link to={`/tables/${tableId}?mode=raw`} title="Перейти на страницу таблицы" aria-label="Перейти на страницу таблицы" className="p-1.5 rounded-md hover:bg-[var(--bg-tertiary)]"><ArrowUpRight className="w-4 h-4" /></Link>;
}
