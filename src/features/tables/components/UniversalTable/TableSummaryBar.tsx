import { useMemo } from 'react';
import type { RowModel, ColumnModel, LinkedVariableRef, ColumnOption } from '../../types/table.types';
import type { Table as ReactTable } from '@tanstack/react-table';
import { Hash, Calendar, CheckSquare, List, Type, AlertCircle, Calculator, Variable } from 'lucide-react';

interface TableSummaryBarProps {
  rows: RowModel[];
  columns: ColumnModel[];
  table: ReactTable<RowModel>;
  hasActions?: boolean;
  /** Variables map for formula evaluation (variableName -> value) */
  variables?: Record<string, string | number | null>;
}

interface ColumnSummary {
  column: ColumnModel;
  type: string;
  summary: React.ReactNode;
  emptyCount: number;
}

/**
 * ADR-026: VariableBadge component
 * Displays a linked variable with its name and value
 */
function VariableBadge({ 
  name, 
  value, 
  fallbackValue 
}: { 
  name: string; 
  value: string | number | null | undefined;
  fallbackValue: number;
}) {
  const displayValue = value !== null && value !== undefined 
    ? Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 2 })
    : fallbackValue.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--accent-primary)]/10 border border-[var(--accent-primary)]/30">
      <Variable className="w-3 h-3 text-[var(--accent-primary)]" />
      <span className="text-[10px] font-mono text-[var(--accent-primary)]">{name}</span>
      <span className="text-gray-400">=</span>
      <span className="font-medium text-white">{displayValue}</span>
    </span>
  );
}

/**
 * Get configured summary types from column config
 */
function getConfiguredSummary(column: ColumnModel): {
  sum?: boolean;
  avg?: boolean;
  min?: boolean;
  max?: boolean;
  count?: boolean;
  countUnique?: boolean;
  countEmpty?: boolean;
  countFilled?: boolean;
  checked?: boolean;
  unchecked?: boolean;
  percentChecked?: boolean;
  earliest?: boolean;
  latest?: boolean;
  dateRange?: boolean;
  percentFilled?: boolean;
} {
  const config = column.config?.summary || {};
  return config;
}

/**
 * Check if column has any summary configured
 */
function hasSummaryConfig(column: ColumnModel): boolean {
  const config = column.config?.summary;
  if (!config) return false;
  return Object.values(config).some(v => v === true);
}

export const TableSummaryBar = ({ rows, columns, table, hasActions = true, variables = {} }: TableSummaryBarProps) => {
  const summaries = useMemo(() => {
    if (!rows.length || !columns.length) return [];

    return columns.map((column): ColumnSummary => {
      const values = rows.map(row => row.data[column.name] ?? row.data[column.id]);
      const nonEmptyValues = values.filter(v => v !== null && v !== undefined && v !== '');
      const emptyCount = values.length - nonEmptyValues.length;
      const colType = column.type as string;
      const summaryConfig = getConfiguredSummary(column);
      const hasConfig = hasSummaryConfig(column);
      
      // ADR-026: Get linked variables from config
      const linkedVariables = column.config?.summary?.linkedVariables || {};

      // Number columns - sum, avg, min, max (respects config + linkedVariables)
      if (colType === 'number' || colType === 'integer' || colType === 'float' || colType === 'decimal') {
        const numbers = nonEmptyValues.map(v => parseFloat(String(v))).filter(n => !isNaN(n));
        if (numbers.length === 0) {
          return { column, type: 'number', summary: <span className="text-gray-400">—</span>, emptyCount };
        }
        
        const sum = numbers.reduce((a, b) => a + b, 0);
        const avg = sum / numbers.length;
        const min = Math.min(...numbers);
        const max = Math.max(...numbers);
        
        // Build summary based on config (default: sum + avg if no config)
        const parts: React.ReactNode[] = [];
        
        // ADR-026: Check for linked variables first
        const sumLinked = linkedVariables.sum;
        const avgLinked = linkedVariables.avg;
        const minLinked = linkedVariables.min;
        const maxLinked = linkedVariables.max;
        
        if (!hasConfig || summaryConfig.sum !== false) {
          if (sumLinked) {
            // Show Variable badge with value from variables map or fallback to local calc
            const varValue = variables[sumLinked.variableName];
            parts.push(
              <VariableBadge 
                key="sum-var" 
                name={sumLinked.variableName} 
                value={varValue} 
                fallbackValue={sum} 
              />
            );
          } else {
            parts.push(
              <span key="sum" className="inline-flex items-center gap-1">
                <span className="text-primary-300">Σ</span>
                <span className="font-medium text-white">{sum.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}</span>
              </span>
            );
          }
        }
        if (!hasConfig || summaryConfig.avg !== false) {
          if (parts.length > 0) parts.push(<span key="sep1" className="text-gray-500 mx-1">|</span>);
          if (avgLinked) {
            const varValue = variables[avgLinked.variableName];
            parts.push(
              <VariableBadge 
                key="avg-var" 
                name={avgLinked.variableName} 
                value={varValue} 
                fallbackValue={avg} 
              />
            );
          } else {
            parts.push(
              <span key="avg" className="inline-flex items-center gap-1">
                <span className="text-gray-400">avg:</span>
                <span className="text-gray-300">{avg.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}</span>
              </span>
            );
          }
        }
        if (summaryConfig.min) {
          if (parts.length > 0) parts.push(<span key="sep2" className="text-gray-500 mx-1">|</span>);
          if (minLinked) {
            const varValue = variables[minLinked.variableName];
            parts.push(
              <VariableBadge 
                key="min-var" 
                name={minLinked.variableName} 
                value={varValue} 
                fallbackValue={min} 
              />
            );
          } else {
            parts.push(<span key="min" className="text-cyan-300">min: {min.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}</span>);
          }
        }
        if (summaryConfig.max) {
          if (parts.length > 0) parts.push(<span key="sep3" className="text-gray-500 mx-1">|</span>);
          if (maxLinked) {
            const varValue = variables[maxLinked.variableName];
            parts.push(
              <VariableBadge 
                key="max-var" 
                name={maxLinked.variableName} 
                value={varValue} 
                fallbackValue={max} 
              />
            );
          } else {
            parts.push(<span key="max" className="text-orange-300">max: {max.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}</span>);
          }
        }
        
        return {
          column,
          type: 'number',
          summary: (
            <div className="flex items-center gap-1 flex-wrap">
              <Hash className="h-3 w-3 text-primary-400" />
              {parts}
            </div>
          ),
          emptyCount
        };
      }

      // Select columns - count per option
      if (column.type === 'select') {
        const counts: Record<string, number> = {};
        nonEmptyValues.forEach(v => {
          const key = String(v);
          counts[key] = (counts[key] || 0) + 1;
        });
        
        const options = column.config?.options || [];
        const entries = Object.entries(counts).slice(0, 4); // Show max 4 options
        
        return {
          column,
          type: 'select',
          summary: entries.length > 0 ? (
            <div className="flex items-center gap-2 flex-wrap">
              <List className="h-3 w-3 text-purple-400" />
              {entries.map(([value, count]) => {
                const option = options.find((o: ColumnOption) => o.value === value);
                const color = option?.color || '#6b7280';
                return (
                  <span 
                    key={value} 
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs"
                    style={{ backgroundColor: `${color}30`, color }}
                  >
                    {option?.label || value}: {count}
                  </span>
                );
              })}
              {Object.keys(counts).length > 4 && (
                <span className="text-gray-500 text-xs">+{Object.keys(counts).length - 4}</span>
              )}
            </div>
          ) : <span className="text-gray-400">—</span>,
          emptyCount
        };
      }

      // Multi-select columns
      if (column.type === 'multi-select') {
        const counts: Record<string, number> = {};
        nonEmptyValues.forEach(v => {
          let arr: string[] = [];
          if (Array.isArray(v)) arr = v;
          else if (typeof v === 'string') {
            try { arr = JSON.parse(v); } catch { arr = v.split(',').map(s => s.trim()); }
          }
          arr.forEach(item => {
            counts[item] = (counts[item] || 0) + 1;
          });
        });
        
        const options = column.config?.options || [];
        const entries = Object.entries(counts).slice(0, 3);
        
        return {
          column,
          type: 'multi-select',
          summary: entries.length > 0 ? (
            <div className="flex items-center gap-1 flex-wrap">
              <List className="h-3 w-3 text-indigo-400" />
              {entries.map(([value, count]) => {
                const option = options.find((o: ColumnOption) => o.value === value);
                const color = option?.color || '#6b7280';
                return (
                  <span 
                    key={value} 
                    className="inline-flex items-center gap-1 px-1 py-0.5 rounded text-xs"
                    style={{ backgroundColor: `${color}25`, color }}
                  >
                    {option?.label || value}: {count}
                  </span>
                );
              })}
            </div>
          ) : <span className="text-gray-400">—</span>,
          emptyCount
        };
      }

      // Date/datetime columns - earliest, latest, range (respects config)
      if (column.type === 'date' || column.type === 'datetime') {
        const dates = nonEmptyValues
          .map(v => new Date(String(v)))
          .filter(d => !isNaN(d.getTime()))
          .sort((a, b) => a.getTime() - b.getTime());
        
        if (dates.length === 0) {
          return { column, type: 'date', summary: <span className="text-gray-400">—</span>, emptyCount };
        }
        
        const min = dates[0];
        const max = dates[dates.length - 1];
        const formatDate = (d: Date) => d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: '2-digit' });
        
        // Build summary based on config (default: date range if no config)
        const parts: React.ReactNode[] = [];
        const showRange = !hasConfig || summaryConfig.dateRange !== false;
        const showEarliest = summaryConfig.earliest;
        const showLatest = summaryConfig.latest;
        
        if (showRange) {
          parts.push(
            <span key="range" className="inline-flex items-center gap-1">
              <span className="text-green-300">{formatDate(min)}</span>
              <span className="text-gray-500">→</span>
              <span className="text-green-300">{formatDate(max)}</span>
            </span>
          );
        } else {
          if (showEarliest) {
            parts.push(<span key="earliest" className="text-green-300">от: {formatDate(min)}</span>);
          }
          if (showLatest) {
            if (parts.length > 0) parts.push(<span key="sep" className="text-gray-500 mx-1">|</span>);
            parts.push(<span key="latest" className="text-green-300">до: {formatDate(max)}</span>);
          }
        }
        
        if (parts.length === 0) {
          parts.push(<span key="count" className="text-gray-400">{dates.length} дат</span>);
        }
        
        return {
          column,
          type: 'date',
          summary: (
            <div className="flex items-center gap-1 text-xs">
              <Calendar className="h-3 w-3 text-green-400" />
              {parts}
            </div>
          ),
          emptyCount
        };
      }

      // Checkbox columns - count checked/unchecked (respects config)
      if (colType === 'checkbox' || colType === 'boolean') {
        const checked = nonEmptyValues.filter(v => v === true || v === 1 || v === '1' || v === 'true').length;
        const unchecked = nonEmptyValues.length - checked;
        const percentChecked = nonEmptyValues.length > 0 ? Math.round((checked / nonEmptyValues.length) * 100) : 0;
        
        // Build summary based on config (default: checked + unchecked if no config)
        const parts: React.ReactNode[] = [];
        const showChecked = !hasConfig || summaryConfig.checked !== false;
        const showUnchecked = !hasConfig || summaryConfig.unchecked !== false;
        const showPercent = summaryConfig.percentChecked;
        
        if (showChecked) {
          parts.push(<span key="checked" className="text-cyan-300">✓ {checked}</span>);
        }
        if (showUnchecked) {
          if (parts.length > 0) parts.push(<span key="sep1" className="text-gray-500 mx-1">|</span>);
          parts.push(<span key="unchecked" className="text-gray-400">✗ {unchecked}</span>);
        }
        if (showPercent) {
          if (parts.length > 0) parts.push(<span key="sep2" className="text-gray-500 mx-1">|</span>);
          parts.push(<span key="percent" className="text-cyan-400">{percentChecked}%</span>);
        }
        
        if (parts.length === 0) {
          parts.push(<span key="count" className="text-gray-400">{nonEmptyValues.length}</span>);
        }
        
        return {
          column,
          type: 'checkbox',
          summary: (
            <div className="flex items-center gap-2 text-xs">
              <CheckSquare className="h-3 w-3 text-cyan-400" />
              {parts}
            </div>
          ),
          emptyCount
        };
      }

      // Text columns - unique count, filled, empty (respects config)
      if (column.type === 'text' || column.type === 'email' || column.type === 'url' || column.type === 'phone') {
        const unique = new Set(nonEmptyValues.map(v => String(v))).size;
        const filled = nonEmptyValues.length;
        const total = values.length;
        const percentFilled = total > 0 ? Math.round((filled / total) * 100) : 0;
        
        // Build summary based on config (default: unique count if no config)
        const parts: React.ReactNode[] = [];
        const showUnique = !hasConfig || summaryConfig.countUnique !== false;
        const showFilled = summaryConfig.countFilled;
        const showEmpty = summaryConfig.countEmpty;
        const showPercentFilled = summaryConfig.percentFilled;
        
        if (showUnique) {
          parts.push(<span key="unique" className="text-gray-300">{unique} уник.</span>);
        }
        if (showFilled) {
          if (parts.length > 0) parts.push(<span key="sep1" className="text-gray-500 mx-1">|</span>);
          parts.push(<span key="filled" className="text-green-300">{filled} заполн.</span>);
        }
        if (showEmpty) {
          if (parts.length > 0) parts.push(<span key="sep2" className="text-gray-500 mx-1">|</span>);
          parts.push(<span key="empty" className="text-gray-400">{emptyCount} пуст.</span>);
        }
        if (showPercentFilled) {
          if (parts.length > 0) parts.push(<span key="sep3" className="text-gray-500 mx-1">|</span>);
          parts.push(<span key="percent" className="text-green-400">{percentFilled}%</span>);
        }
        
        if (parts.length === 0) {
          parts.push(<span key="count" className="text-gray-400">{filled} знач.</span>);
        }
        
        return {
          column,
          type: 'text',
          summary: (
            <div className="flex items-center gap-1 text-xs">
              <Type className="h-3 w-3 text-gray-400" />
              {parts}
            </div>
          ),
          emptyCount
        };
      }

      // Default - just count
      return {
        column,
        type: 'default',
        summary: (
          <div className="flex items-center gap-1 text-xs text-gray-400">
            <span>{nonEmptyValues.length} знач.</span>
          </div>
        ),
        emptyCount
      };
    });
  }, [rows, columns]);

  // Build a map for quick lookup
  const summaryMap = useMemo(() => {
    const map = new Map<string, ColumnSummary>();
    summaries.forEach(s => map.set(s.column.id, s));
    return map;
  }, [summaries]);

  if (!rows.length) return null;

  // Get headers from table to match widths exactly
  const headerGroup = table.getHeaderGroups()[0];
  if (!headerGroup) return null;

  return (
    <div className="w-max border-t-2 border-b border-r border-[var(--border-primary)] bg-[var(--bg-secondary)]">
      <table className="min-w-max border-collapse text-xs">
        <tfoot>
          <tr>
            {headerGroup.headers.map((header, index) => {
              const summary = summaryMap.get(header.id);
              if (!summary) return null;
              
              return (
                <td 
                  key={header.id}
                  className={`px-4 py-2 border-r border-[var(--border-primary)] ${
                    index === 0 ? 'rounded-bl-2xl' : ''
                  }`}
                  style={{ 
                    width: header.getSize(),
                    minWidth: header.getSize()
                  }}
                >
                  <div className="flex flex-col gap-0.5">
                    {summary.summary}
                    {summary.emptyCount > 0 && (
                      <div className="flex items-center gap-1 text-amber-500/70 text-[10px]">
                        <AlertCircle className="h-2.5 w-2.5" />
                        <span>{summary.emptyCount} пустых</span>
                      </div>
                    )}
                  </div>
                </td>
              );
            })}
            {/* Actions column spacer */}
            {hasActions && (
              <td 
                className="w-[50px] rounded-br-2xl"
                style={{ boxShadow: 'inset 2px 0 0 0 var(--border-primary)' }}
              />
            )}
          </tr>
        </tfoot>
      </table>
    </div>
  );
};
