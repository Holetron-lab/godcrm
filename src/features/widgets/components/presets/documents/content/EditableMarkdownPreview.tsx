import { useState, useRef, useEffect } from 'react';
import { MarkdownPreview } from '@/shared/components/MarkdownPreview';
import { useAuthStore } from '@/features/auth/store/authStore';

/**
 * EditableMarkdownPreview - Renders markdown with inline editing for tables
 * Click on table cells to edit them directly
 */
export interface EditableMarkdownPreviewProps {
  content: string;
  onContentChange?: (newContent: string) => Promise<void>;
  onEditRaw?: () => void;
  /** @deprecated Use variables prop instead */
  widgetId?: number;
  /** Variables to substitute in content. Use buildSystemVariables() or useSystemVariables() hook. */
  variables?: Record<string, string | number>;
}

export function EditableMarkdownPreview({ content, onContentChange, onEditRaw, widgetId, variables }: EditableMarkdownPreviewProps) {
  const authUser = useAuthStore((s) => s.user);
  const checkboxUser = authUser ? { name: authUser.name, id: Number(authUser.id) } : undefined;
  const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null);
  const [cellValue, setCellValue] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  // Click outside to save
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (editingCell && containerRef.current && !containerRef.current.contains(e.target as Node)) {
        // Save on click outside
        saveCellEdit();
      }
    };

    if (editingCell) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [editingCell, cellValue]);

  // Parse markdown tables
  const parseTable = (markdown: string): { headers: string[]; rows: string[][]; startLine: number; endLine: number } | null => {
    const lines = markdown.split('\n');
    let tableStart = -1;
    let tableEnd = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('|') && line.endsWith('|')) {
        if (tableStart === -1) tableStart = i;
        tableEnd = i;
      } else if (tableStart !== -1 && tableEnd !== -1) {
        break; // End of table
      }
    }

    if (tableStart === -1) return null;

    const tableLines = lines.slice(tableStart, tableEnd + 1);
    if (tableLines.length < 2) return null;

    // Parse headers
    const headerLine = tableLines[0];
    const headers = headerLine.split('|').slice(1, -1).map(h => h.trim());

    // Skip separator line (index 1)
    // Parse data rows
    const rows = tableLines.slice(2).map(line =>
      line.split('|').slice(1, -1).map(cell => cell.trim())
    );

    return { headers, rows, startLine: tableStart, endLine: tableEnd };
  };

  // Rebuild table markdown
  const rebuildTable = (headers: string[], rows: string[][], newValue: string, rowIdx: number, colIdx: number): string => {
    const updatedRows = rows.map((row, ri) =>
      row.map((cell, ci) => (ri === rowIdx && ci === colIdx) ? newValue : cell)
    );

    // Calculate column widths
    const colWidths = headers.map((h, i) => {
      const cellWidths = [h.length, ...updatedRows.map(r => (r[i] || '').length)];
      return Math.max(...cellWidths);
    });

    // Build table
    const headerRow = '| ' + headers.map((h, i) => h.padEnd(colWidths[i])).join(' | ') + ' |';
    const separator = '|' + colWidths.map(w => '-'.repeat(w + 2)).join('|') + '|';
    const dataRows = updatedRows.map(row =>
      '| ' + row.map((cell, i) => (cell || '').padEnd(colWidths[i])).join(' | ') + ' |'
    );

    return [headerRow, separator, ...dataRows].join('\n');
  };

  // Save cell edit
  const saveCellEdit = async () => {
    if (!editingCell) return;

    const table = parseTable(content);
    if (!table) return;

    const { headers, rows, startLine, endLine } = table;
    const newTableMarkdown = rebuildTable(headers, rows, cellValue, editingCell.row, editingCell.col);

    // Replace table in content
    const lines = content.split('\n');
    const before = lines.slice(0, startLine).join('\n');
    const after = lines.slice(endLine + 1).join('\n');

    const newContent = [before, newTableMarkdown, after].filter(Boolean).join('\n');
    await onContentChange?.(newContent);

    setEditingCell(null);
    setCellValue('');
  };

  // Check if content has a table
  const table = parseTable(content);

  if (table) {
    // Render editable table
    const { headers, rows } = table;

    // Get content before and after table
    const lines = content.split('\n');
    const beforeTable = lines.slice(0, table.startLine).join('\n').trim();
    const afterTable = lines.slice(table.endLine + 1).join('\n').trim();

    return (
      <div ref={containerRef} style={{ fontSize: 'inherit' }}>
        {/* Content before table */}
        {beforeTable && (
          <div
            className="mb-3 cursor-text hover:bg-[var(--bg-secondary)] rounded p-1 -m-1"
            onClick={onEditRaw}
          >
            <MarkdownPreview content={beforeTable} variables={variables} widgetId={widgetId} onContentChange={onContentChange} currentUser={checkboxUser} />
          </div>
        )}

        {/* Editable table */}
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse" style={{ fontSize: '0.85em' }}>
            <thead>
              <tr className="border-b border-[var(--border-primary)]">
                {headers.map((header, i) => (
                  <th key={i} className="text-left px-3 py-2 font-semibold text-[var(--text-primary)]">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIdx) => (
                <tr key={rowIdx} className="border-b border-[var(--border-secondary)]">
                  {row.map((cell, colIdx) => (
                    <td key={colIdx} className="px-3 py-2">
                      {editingCell?.row === rowIdx && editingCell?.col === colIdx ? (
                        <input
                          type="text"
                          value={cellValue}
                          onChange={(e) => setCellValue(e.target.value)}
                          className="py-0 bg-transparent border border-blue-500 rounded outline-none"
                          style={{ fontSize: 'inherit', lineHeight: 'inherit', width: '80%' }}
                          autoFocus
                          onBlur={saveCellEdit}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveCellEdit();
                            if (e.key === 'Escape') { setEditingCell(null); setCellValue(''); }
                            if (e.key === 'Tab') {
                              e.preventDefault();
                              saveCellEdit();
                              // Move to next cell
                              const nextCol = colIdx + 1;
                              if (nextCol < row.length) {
                                setTimeout(() => {
                                  setEditingCell({ row: rowIdx, col: nextCol });
                                  setCellValue(row[nextCol] || '');
                                }, 50);
                              }
                            }
                          }}
                        />
                      ) : (
                        <span
                          className="cursor-text hover:bg-blue-500/10 px-1 -mx-1 rounded inline-block min-w-[20px]"
                          onClick={() => {
                            setEditingCell({ row: rowIdx, col: colIdx });
                            setCellValue(cell);
                          }}
                        >
                          {/* Render cell content with inline formatting */}
                          {cell.startsWith('`') && cell.endsWith('`') ? (
                            <code className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 text-xs font-mono">
                              {cell.slice(1, -1)}
                            </code>
                          ) : cell || <span className="text-[var(--text-tertiary)]">—</span>}
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Content after table */}
        {afterTable && (
          <div
            className="mt-3 cursor-text hover:bg-[var(--bg-secondary)] rounded p-1 -m-1"
            onClick={onEditRaw}
          >
            <MarkdownPreview content={afterTable} variables={variables} widgetId={widgetId} onContentChange={onContentChange} currentUser={checkboxUser} />
          </div>
        )}
      </div>
    );
  }

  // No table - regular preview with click to edit
  return (
    <div
      className="text-[var(--text-secondary)] cursor-text hover:bg-[var(--bg-secondary)] rounded p-2 -m-2"
      style={{ fontSize: 'inherit' }}
      onClick={onEditRaw}
    >
      <MarkdownPreview content={content || 'Нажмите чтобы редактировать...'} variables={variables} widgetId={widgetId} onContentChange={onContentChange} currentUser={checkboxUser} />
    </div>
  );
}
