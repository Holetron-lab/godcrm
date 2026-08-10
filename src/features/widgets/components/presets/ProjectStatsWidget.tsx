import { BarChart3, Database, Layers } from 'lucide-react';
import type { PresetWidgetProps } from '../../types/widget.types';

/**
 * Project Stats Widget - displays project statistics
 */
export function ProjectStatsWidget({ widget, data }: PresetWidgetProps) {
  // Calculate stats from data
  const totalRecords = data.length;

  // Count unique tables (if data has table_id)
  const uniqueTables = new Set(
    data.map((row) => row.table_id).filter(Boolean)
  ).size;

  const stats = [
    {
      label: 'Total Records',
      value: totalRecords,
      icon: Database,
      color: 'text-primary-600',
      bg: 'bg-primary-50',
    },
    {
      label: 'Tables',
      value: uniqueTables || '-',
      icon: Layers,
      color: 'text-green-600',
      bg: 'bg-green-50',
    },
    {
      label: 'Activity',
      value: '100%',
      icon: BarChart3,
      color: 'text-purple-600',
      bg: 'bg-purple-50',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <div
            key={stat.label}
            className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
          >
            <div className={`p-2 rounded-lg ${stat.bg}`}>
              <Icon className={`w-5 h-5 ${stat.color}`} />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
              <p className="text-sm text-gray-600">{stat.label}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
