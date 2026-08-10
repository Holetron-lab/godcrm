import { useMemo } from 'react';
import type { Widget } from '../../types/widget.types';

/** Row data item with id and data fields */
interface GalleryRowItem {
  id?: string | number;
  base_id?: string | number;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

interface GalleryWidgetProps {
  widget: Widget;
  data: GalleryRowItem[];
  onCardClick?: (card: GalleryRowItem) => void;
}

export function GalleryWidget({ widget, data, onCardClick }: GalleryWidgetProps) {
  const config = widget.config || {};
  const titleColumn = config.titleColumn || config.title_column || 'name';
  const descriptionColumn = config.descriptionColumn || config.description_column || 'description';
  const coverColumn = config.coverColumn || config.cover_column;
  const cardsPerRow = config.cardsPerRow || config.cards_per_row || 3;
  const progressColumn = config.progressColumn || config.progress_column;

  const cards = useMemo(() => {
    return data.map((row) => {
      const rowData = row.data || row;
      return {
        id: row.id || row.base_id,
        title: rowData[titleColumn] || 'Untitled',
        description: rowData[descriptionColumn] || '',
        cover: coverColumn ? rowData[coverColumn] : null,
        progress: progressColumn ? Number(rowData[progressColumn]) || 0 : null,
        raw: row
      };
    });
  }, [data, titleColumn, descriptionColumn, coverColumn, progressColumn]);

  if (cards.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--text-tertiary)]">
        <div className="text-center">
          <div className="text-4xl mb-2">📭</div>
          <div>No items to display</div>
        </div>
      </div>
    );
  }

  // Grid columns based on cardsPerRow
  const gridCols = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 sm:grid-cols-2',
    3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
  }[cardsPerRow] || 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';

  return (
    <div className="h-full overflow-auto p-4 bg-[var(--bg-secondary)]">
      <div className={`grid ${gridCols} gap-4`}>
        {cards.map((card) => (
          <div
            key={card.id}
            onClick={() => onCardClick?.(card.raw)}
            className="group bg-[var(--bg-primary)] rounded-xl border border-[var(--border-primary)] overflow-hidden hover:shadow-lg hover:border-[var(--color-primary-500)] transition-all cursor-pointer"
          >
            {/* Cover Image */}
            {card.cover && (
              <div className="aspect-video bg-[var(--bg-tertiary)] overflow-hidden">
                <img 
                  src={card.cover} 
                  alt={card.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
              </div>
            )}
            
            {/* Content */}
            <div className="p-4">
              <h3 className="font-semibold text-[var(--text-primary)] mb-1 line-clamp-2">
                {card.title}
              </h3>
              
              {card.description && (
                <p className="text-sm text-[var(--text-secondary)] line-clamp-3 mb-2">
                  {card.description}
                </p>
              )}
              
              {/* Progress Bar */}
              {card.progress !== null && (
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs text-[var(--text-tertiary)] mb-1">
                    <span>Progress</span>
                    <span>{card.progress}%</span>
                  </div>
                  <div className="h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-[var(--color-primary-500)] rounded-full transition-all"
                      style={{ width: `${Math.min(100, Math.max(0, card.progress))}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
