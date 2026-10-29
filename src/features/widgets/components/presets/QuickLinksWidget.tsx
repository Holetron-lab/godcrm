import { ExternalLink, Table2 } from 'lucide-react';
import type { PresetWidgetProps } from '../../types/widget.types';

/**
 * Quick Links Widget - displays quick links to tables
 */
export function QuickLinksWidget({ widget, data }: PresetWidgetProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400">
        <ExternalLink className="w-12 h-12 mb-2" />
        <p className="text-sm">No links configured</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2">
      {data.map((item, idx) => {
        const url = item.data?.url;
        const href = typeof url === 'string' && url ? url : undefined;
        const Element = href ? 'a' : 'div';
        const title = item.data?.name || item.data?.title;
        const description = item.data?.description;
        return (
          <Element
            key={item.id || idx}
            href={href}
            className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 hover:bg-primary-50 hover:border-primary-200 border border-gray-200 transition-colors group"
          >
            <div className="p-2 rounded bg-white group-hover:bg-primary-100">
              <Table2 className="w-4 h-4 text-gray-600 group-hover:text-primary-600" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-gray-900 group-hover:text-primary-700">
                {typeof title === 'string' && title ? title : 'Untitled'}
              </p>
              {typeof description === 'string' && description && (
                <p className="text-xs text-gray-500">
                  {description}
                </p>
              )}
            </div>
            <ExternalLink className="w-4 h-4 text-gray-400 group-hover:text-primary-600" />
          </Element>
        );
      })}
    </div>
  );
}
