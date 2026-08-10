import { useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { Widget } from '../../types/widget.types';
import { getWidgetDisplayName } from '../../utils/getWidgetDisplayName';

interface NumberWidgetProps {
  widget: Widget;
  data: Record<string, unknown>[];
}

export function NumberWidget({ widget, data }: NumberWidgetProps) {
  const config = widget.config || {};
  const aggregation = config.aggregation || 'count';
  const column = config.column;
  const filter = config.filter;
  const prefix = config.prefix || '';
  const suffix = config.suffix || '';
  const compareWith = config.compareWith; // 'yesterday', 'last_week', etc.
  
  const value = useMemo(() => {
    let filteredData = data;
    
    // Apply filter if exists
    if (filter) {
      filteredData = data.filter(row => {
        const rowData = row.data || row;
        if (filter.column && filter.value !== undefined) {
          return rowData[filter.column] === filter.value;
        }
        if (filter.column && filter.values) {
          return filter.values.includes(rowData[filter.column]);
        }
        return true;
      });
    }
    
    switch (aggregation) {
      case 'count':
        return filteredData.length;
      case 'sum':
        return filteredData.reduce((acc, row) => {
          const val = Number((row.data || row)[column]) || 0;
          return acc + val;
        }, 0);
      case 'avg':
        if (filteredData.length === 0) return 0;
        const sum = filteredData.reduce((acc, row) => {
          const val = Number((row.data || row)[column]) || 0;
          return acc + val;
        }, 0);
        return Math.round((sum / filteredData.length) * 10) / 10;
      case 'min':
        return Math.min(...filteredData.map(row => Number((row.data || row)[column]) || 0));
      case 'max':
        return Math.max(...filteredData.map(row => Number((row.data || row)[column]) || 0));
      default:
        return filteredData.length;
    }
  }, [data, aggregation, column, filter]);

  // Format number with commas
  const formatNumber = (num: number) => {
    return num.toLocaleString('ru-RU');
  };

  // Calculate trend (mock for now)
  const trend = useMemo(() => {
    if (!compareWith) return null;
    // In real implementation, this would compare with historical data
    const mockChange = Math.random() * 20 - 10; // Random -10 to +10
    return {
      value: Math.round(mockChange * 10) / 10,
      direction: mockChange > 0 ? 'up' : mockChange < 0 ? 'down' : 'neutral'
    };
  }, [compareWith]);

  return (
    <div className="h-full flex items-center justify-center bg-[var(--bg-secondary)] p-6">
      <div className="text-center">
        {/* Main Value */}
        <div className="text-5xl font-bold text-[var(--text-primary)] mb-2">
          {prefix}{formatNumber(value)}{suffix}
        </div>
        
        {/* Widget Title */}
        <div className="text-sm text-[var(--text-tertiary)]">
          {getWidgetDisplayName(widget)}
        </div>
        
        {/* Trend Indicator */}
        {trend && (
          <div className={`flex items-center justify-center gap-1 mt-3 text-sm ${
            trend.direction === 'up' ? 'text-green-500' : 
            trend.direction === 'down' ? 'text-red-500' : 'text-[var(--text-tertiary)]'
          }`}>
            {trend.direction === 'up' && <TrendingUp className="w-4 h-4" />}
            {trend.direction === 'down' && <TrendingDown className="w-4 h-4" />}
            {trend.direction === 'neutral' && <Minus className="w-4 h-4" />}
            <span>{trend.value > 0 ? '+' : ''}{trend.value}%</span>
          </div>
        )}
      </div>
    </div>
  );
}
