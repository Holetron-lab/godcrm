/**
 * ColumnCard - Single column card with header and expandable settings
 */
import { renderTypeCellPreview } from '../UniversalTable/column-settings';
import { ColumnCardHeader } from './ColumnCardHeader';
import { CellPreview } from './CellPreview';
import { ColumnCardSettings } from './ColumnCardSettings';
import type { ColumnCardProps } from './types';

export const ColumnCard = ({
  column,
  isExpanded,
  isHidden,
  onToggleExpand,
  onToggleHidden,
  onUpdate,
  onDelete,
  onRequestKeyEdit,
  onOpenSettings,
  keyEditable,
  columnTypes,
  sampleValues = [],
  currentSampleIndex,
  onSampleNavigate,
  projects,
  currentRow
}: ColumnCardProps) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const config = (column.config || {}) as any;
  const width = config.width ?? 150;
  const fontFamily = config.fontFamily || 'inherit';
  const fontSize = config.fontSize || 14;
  const textColor = config.textColor || null;
  const align = config.align || 'left';

  // Get raw value for preview
  const rawValue = currentRow ? (currentRow[column.name] ?? currentRow[column.id] ?? null) : null;

  return (
    <div className={`rounded-lg border transition-all ${
      isHidden
        ? 'border-orange-500/30 bg-orange-500/5'
        : 'border-[var(--border-primary)] bg-[var(--bg-secondary)]'
    }`}>
      <ColumnCardHeader
        column={column}
        isExpanded={isExpanded}
        isHidden={isHidden}
        onToggleExpand={onToggleExpand}
        onToggleHidden={onToggleHidden}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onRequestKeyEdit={onRequestKeyEdit}
        onOpenSettings={onOpenSettings}
        keyEditable={keyEditable}
        columnTypes={columnTypes}
      />

      {isExpanded && (
        <>
          {/* Cell Preview Block - inside the settings area */}
          <div className="px-3 pt-1 border-t border-[var(--border-secondary)]">
            <CellPreview
              column={column}
              width={width}
              fontFamily={fontFamily}
              fontSize={fontSize}
              textColor={textColor}
              align={align}
              rawValue={rawValue}
              currentRow={currentRow}
            />
          </div>

          <ColumnCardSettings
            column={column}
            config={config}
            onUpdate={onUpdate}
            projects={projects}
            sampleValues={sampleValues}
            currentSampleIndex={currentSampleIndex}
            onSampleNavigate={onSampleNavigate}
            currentRow={currentRow}
          />
        </>
      )}
    </div>
  );
};
