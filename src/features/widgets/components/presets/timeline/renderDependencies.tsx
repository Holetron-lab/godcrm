import type { TimelineItem, ViewMode } from './types';

interface RenderDependenciesParams {
  viewMode: ViewMode;
  displayItems: TimelineItem[];
  getPositionForDate: (date: Date) => number;
  groupedItemsWithLanes: Record<string, { items: TimelineItem[]; maxLane: number }>;
  collapsedGroups: Set<string>;
  groupByColumn: string | undefined;
  hoveredDependency: string | null;
  setHoveredDependency: (dep: string | null) => void;
  handleRemoveDependency: (itemId: string, tagToRemove: string) => void;
}

export function renderDependencies({
  viewMode,
  displayItems,
  getPositionForDate,
  groupedItemsWithLanes,
  collapsedGroups,
  groupByColumn,
  hoveredDependency,
  setHoveredDependency,
  handleRemoveDependency,
}: RenderDependenciesParams): JSX.Element | null {
  if (viewMode !== 'gantt') return null;

  // Build a map of item positions based on lanes and groups
  const itemLaneMap = new Map<string, { lane: number; groupIndex: number }>();
  let currentGroupOffset = 0;

  Object.entries(groupedItemsWithLanes).forEach(([groupName, { items: groupItems, maxLane }], groupIdx) => {
    const isGroupCollapsed = collapsedGroups.has(groupName);
    if (isGroupCollapsed) {
      currentGroupOffset += 40;
      return;
    }

    if (groupByColumn && groupName) {
      currentGroupOffset += 37;
    }

    groupItems.forEach(item => {
      itemLaneMap.set(item.id, {
        lane: item.lane || 0,
        groupIndex: currentGroupOffset
      });
    });

    currentGroupOffset += maxLane * 33 + 9;
  });

  // Group items by their dependency tags
  const tagGroups = new Map<string, TimelineItem[]>();
  displayItems.forEach(item => {
    if (!item.dependencies || item.dependencies.length === 0) return;

    item.dependencies.forEach(tag => {
      if (!tagGroups.has(tag)) {
        tagGroups.set(tag, []);
      }
      tagGroups.get(tag)!.push(item);
    });
  });

  const lines: JSX.Element[] = [];
  const LANE_HEIGHT = 33;
  const SVG_WIDTH = 1000;
  const CORNER_RADIUS = 6;
  const HORIZONTAL_OFFSET = 25;

  // For each tag group, sort by startDate and connect sequentially
  tagGroups.forEach((tagItems, tag) => {
    if (tagItems.length < 2) return;

    const sorted = [...tagItems].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

    for (let i = 0; i < sorted.length - 1; i++) {
      const fromItem = sorted[i];
      const toItem = sorted[i + 1];

      const fromLaneInfo = itemLaneMap.get(fromItem.id);
      const toLaneInfo = itemLaneMap.get(toItem.id);

      if (!fromLaneInfo || !toLaneInfo) continue;

      const fromEndPos = getPositionForDate(fromItem.endDate);
      const toStartPos = getPositionForDate(toItem.startDate);

      if (fromEndPos < 0 && toStartPos < 0) continue;
      if (fromEndPos > 100 && toStartPos > 100) continue;

      const fromX = Math.min(SVG_WIDTH, Math.max(0, fromEndPos * SVG_WIDTH / 100));
      const toX = Math.min(SVG_WIDTH, Math.max(0, toStartPos * SVG_WIDTH / 100));

      const fromY = fromLaneInfo.groupIndex + (fromLaneInfo.lane * LANE_HEIGHT) + LANE_HEIGHT / 2;
      const toY = toLaneInfo.groupIndex + (toLaneInfo.lane * LANE_HEIGHT) + LANE_HEIGHT / 2;

      let pathD: string;
      const r = CORNER_RADIUS;

      if (Math.abs(toY - fromY) < 5) {
        pathD = `M ${fromX} ${fromY} L ${toX} ${toY}`;
      } else {
        const goingDown = toY > fromY;
        const midY = (fromY + toY) / 2;

        const x1 = fromX + HORIZONTAL_OFFSET;
        const x2 = toX - HORIZONTAL_OFFSET;

        if (goingDown) {
          pathD = `
            M ${fromX} ${fromY}
            L ${x1 - r} ${fromY}
            Q ${x1} ${fromY} ${x1} ${fromY + r}
            L ${x1} ${midY - r}
            Q ${x1} ${midY} ${x1 + r} ${midY}
            L ${x2 - r} ${midY}
            Q ${x2} ${midY} ${x2} ${midY + r}
            L ${x2} ${toY - r}
            Q ${x2} ${toY} ${x2 + r} ${toY}
            L ${toX} ${toY}
          `;
        } else {
          pathD = `
            M ${fromX} ${fromY}
            L ${x1 - r} ${fromY}
            Q ${x1} ${fromY} ${x1} ${fromY - r}
            L ${x1} ${midY + r}
            Q ${x1} ${midY} ${x1 + r} ${midY}
            L ${x2 - r} ${midY}
            Q ${x2} ${midY} ${x2} ${midY - r}
            L ${x2} ${toY + r}
            Q ${x2} ${toY} ${x2 + r} ${toY}
            L ${toX} ${toY}
          `;
        }
      }

      const lineColor = fromItem.color;
      const depKey = `dep-${tag}-${fromItem.id}-${toItem.id}`;
      const isHovered = hoveredDependency === depKey;

      const midX = (fromX + toX) / 2;
      const midY_label = (fromY + toY) / 2;

      lines.push(
        <g key={depKey}>
          {/* Invisible wider path for easier hover */}
          <path
            d={pathD}
            fill="none"
            stroke="transparent"
            strokeWidth="12"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
            onMouseEnter={() => setHoveredDependency(depKey)}
            onMouseLeave={() => setHoveredDependency(null)}
          />
          {/* Visible line */}
          <path
            d={pathD}
            fill="none"
            stroke={lineColor}
            strokeWidth={isHovered ? "2.5" : "1.5"}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={isHovered ? "0.8" : "0.4"}
            vectorEffect="non-scaling-stroke"
            style={{ pointerEvents: 'none' }}
          />
          {/* Tag label in center - only show on hover */}
          {isHovered && (
            <g
              style={{ cursor: 'pointer', pointerEvents: 'all' }}
              onClick={(e) => {
                e.stopPropagation();
                if (window.confirm(`Удалить связь "${tag}" у элемента "${toItem.title}"?`)) {
                  handleRemoveDependency(toItem.id, tag);
                }
              }}
            >
              <rect
                x={midX - 30}
                y={midY_label - 10}
                width={60}
                height={20}
                rx={4}
                fill={lineColor}
                opacity="0.9"
              />
              <text
                x={midX}
                y={midY_label + 4}
                textAnchor="middle"
                fontSize="10"
                fill="white"
                fontWeight="500"
                style={{ pointerEvents: 'none' }}
              >
                {tag.length > 8 ? tag.slice(0, 6) + '..' : tag}
              </text>
              {/* X button */}
              <circle
                cx={midX + 22}
                cy={midY_label}
                r={7}
                fill="rgba(255,255,255,0.3)"
              />
              <text
                x={midX + 22}
                y={midY_label + 3}
                textAnchor="middle"
                fontSize="10"
                fill="white"
                fontWeight="bold"
                style={{ pointerEvents: 'none' }}
              >
                ×
              </text>
            </g>
          )}
        </g>
      );
    }
  });

  if (lines.length === 0) return null;

  const totalHeight = currentGroupOffset + 50;

  return (
    <svg
      className="absolute"
      style={{
        zIndex: 5,
        left: '192px',
        top: 0,
        width: 'calc(100% - 192px)',
        height: totalHeight,
        overflow: 'visible',
        pointerEvents: 'none'
      }}
      viewBox={`0 0 ${SVG_WIDTH} ${totalHeight}`}
      preserveAspectRatio="none"
    >
      <g style={{ pointerEvents: 'auto' }}>
        {lines}
      </g>
    </svg>
  );
}
