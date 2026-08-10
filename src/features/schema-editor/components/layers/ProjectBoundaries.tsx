import { useMemo } from 'react';
import { useViewport, type Node } from '@xyflow/react';
import { useSchemaEditorStore } from '../../store/schemaEditorStore';

interface ProjectBoundariesProps {
  nodes: Node[];
  projectColors: Record<number, string>;
  showConnectionLines?: boolean;
}

interface TableBoundary {
  id: string;
  tableId: number;
  projectId: number;
  projectName: string;
  projectIcon: string;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  cardWidth: number;
  cardHeight: number;
}

// Padding from card edges
const PADDING = 36;
// Card dimensions - actual width from TableNode.tsx min-w-[320px] max-w-[400px]
const CARD_WIDTH = 360;
const BORDER_RADIUS = 16;
const CHAMFER_SIZE = 12;

type PathStyle = 'rounded' | 'bezier' | 'straight' | 'angular' | 'smoothstep' | 'step';

// Generate path for a single boundary based on style
const generateBoundaryPath = (b: TableBoundary, style: PathStyle): string => {
  const { x, y, width, height } = b;
  const r = BORDER_RADIUS;
  const c = CHAMFER_SIZE;
  
  if (style === 'angular' || style === 'step') {
    // Sharp corners
    return `M ${x} ${y} L ${x + width} ${y} L ${x + width} ${y + height} L ${x} ${y + height} Z`;
  }
  
  if (style === 'straight') {
    // 45° chamfer corners
    return `M ${x + c} ${y} L ${x + width - c} ${y} L ${x + width} ${y + c} L ${x + width} ${y + height - c} L ${x + width - c} ${y + height} L ${x + c} ${y + height} L ${x} ${y + height - c} L ${x} ${y + c} Z`;
  }
  
  // Rounded corners (bezier, rounded, smoothstep)
  return `M ${x + r} ${y} L ${x + width - r} ${y} Q ${x + width} ${y} ${x + width} ${y + r} L ${x + width} ${y + height - r} Q ${x + width} ${y + height} ${x + width - r} ${y + height} L ${x + r} ${y + height} Q ${x} ${y + height} ${x} ${y + height - r} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} Z`;
};

export const ProjectBoundaries = ({ nodes, projectColors, showConnectionLines = false }: ProjectBoundariesProps) => {
  const { x, y, zoom } = useViewport();
  const edgeShape = useSchemaEditorStore(state => state.edgeShape);
  const toggleProjectExpanded = useSchemaEditorStore(state => state.toggleProjectExpanded);
  
  const pathStyle = (edgeShape || 'rounded') as PathStyle;
  
  // Handle click on project badge
  const handleBadgeClick = (projectId: number) => {
    toggleProjectExpanded(projectId);
  };
  
  // Calculate individual boundaries for each table
  const tableBoundaries = useMemo(() => {
    const boundaries: TableBoundary[] = [];
    
    const tableNodes = nodes.filter(n => n.type === 'tableNode');
    
    tableNodes.forEach(node => {
      const projectId = node.data?.projectId;
      if (!projectId) return;
      
      const color = projectColors[projectId] || '#6366f1';
      const nodeX = node.position.x;
      const nodeY = node.position.y;
      
      // Use measured width from React Flow, or fallback to default
      const cardWidth = node.measured?.width || node.width || CARD_WIDTH;
      
      // Calculate height based on columns (37px per row + header 56px + footer 44px)
      const columns = node.data?.columns || [];
      const cardHeight = node.measured?.height || node.height || (56 + (columns.length * 37) + 44);
      
      // Simple calculation: boundary = card position - padding
      const boundaryX = nodeX - PADDING;
      const boundaryY = nodeY - PADDING;
      const boundaryWidth = cardWidth + PADDING * 2;
      const boundaryHeight = cardHeight + PADDING * 2;
      
      const centerX = nodeX + cardWidth / 2;
      const centerY = nodeY + cardHeight / 2;
      
      boundaries.push({
        id: node.id,
        tableId: node.data?.tableId,
        projectId,
        projectName: node.data?.projectName || `Project ${projectId}`,
        projectIcon: node.data?.projectIcon || '📊',
        color,
        x: boundaryX,
        y: boundaryY,
        width: boundaryWidth,
        height: boundaryHeight,
        centerX,
        centerY,
        cardWidth,
        cardHeight,
      });
    });
    
    return boundaries;
  }, [nodes, projectColors]);

  // Group boundaries by project
  const projectGroups = useMemo(() => {
    const groups: Map<number, { 
      color: string; 
      name: string;
      icon: string;
      boundaries: TableBoundary[];
    }> = new Map();
    
    tableBoundaries.forEach(b => {
      if (!groups.has(b.projectId)) {
        groups.set(b.projectId, { 
          color: b.color, 
          name: b.projectName,
          icon: b.projectIcon,
          boundaries: [] 
        });
      }
      groups.get(b.projectId)!.boundaries.push(b);
    });
    
    return groups;
  }, [tableBoundaries]);

  // Generate connection lines between tables of same project
  const generateConnectionLines = (boundaries: TableBoundary[], color: string) => {
    if (!showConnectionLines || boundaries.length < 2) return null;
    
    const lines: JSX.Element[] = [];
    
    for (let i = 0; i < boundaries.length; i++) {
      for (let j = i + 1; j < boundaries.length; j++) {
        const t1 = boundaries[i];
        const t2 = boundaries[j];
        
        lines.push(
          <line
            key={`line-${t1.id}-${t2.id}`}
            x1={t1.centerX}
            y1={t1.centerY}
            x2={t2.centerX}
            y2={t2.centerY}
            stroke={color}
            strokeWidth={1.5}
            strokeOpacity={0.15}
            strokeDasharray="6 4"
          />
        );
      }
    }
    
    return lines;
  };

  // Opacity based on zoom
  const opacity = useMemo(() => {
    return Math.min(0.6, Math.max(0.2, 0.35 / zoom));
  }, [zoom]);

  if (tableBoundaries.length === 0) return null;

  return (
    <>
      {/* Background layer - behind nodes */}
      <svg
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          overflow: 'visible',
          zIndex: -1,
        }}
      >
        <g transform={`translate(${x}, ${y}) scale(${zoom})`}>
          {Array.from(projectGroups.entries()).map(([projectId, group]) => {
            const maskId = `project-mask-${projectId}`;
            const clipId = `project-clip-${projectId}`;
            
            return (
              <g key={`project-${projectId}`}>
              {/* Connection lines */}
              {generateConnectionLines(group.boundaries, group.color)}
              
              <defs>
                {/* Clip path for unified fill */}
                <clipPath id={clipId}>
                  {group.boundaries.map(b => (
                    <path key={`clip-${b.id}`} d={generateBoundaryPath(b, pathStyle)} />
                  ))}
                </clipPath>
                
                {/* Mask for stroke - shows only outer edges */}
                <mask id={maskId}>
                  <rect x="-100000" y="-100000" width="200000" height="200000" fill="white" />
                  {group.boundaries.map(b => {
                    const inset = 1.5;
                    const insetB = { ...b, x: b.x + inset, y: b.y + inset, width: b.width - inset * 2, height: b.height - inset * 2 };
                    return <path key={`mask-${b.id}`} d={generateBoundaryPath(insetB, pathStyle)} fill="black" />;
                  })}
                </mask>
              </defs>
              
              {/* Unified fill */}
              <rect
                x={-100000}
                y={-100000}
                width={200000}
                height={200000}
                fill={group.color}
                fillOpacity={opacity * 0.25}
                clipPath={`url(#${clipId})`}
              />
              
              {/* Unified stroke */}
              <g mask={`url(#${maskId})`}>
                {group.boundaries.map(b => (
                  <path
                    key={`stroke-${b.id}`}
                    d={generateBoundaryPath(b, pathStyle)}
                    fill="none"
                    stroke={group.color}
                    strokeWidth={2}
                    strokeOpacity={opacity}
                  />
                ))}
              </g>
            </g>
          );
        })}
        </g>
      </svg>
      
      {/* Labels layer - above nodes for clickability */}
      <svg
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          overflow: 'visible',
          zIndex: 10,
        }}
      >
        <g transform={`translate(${x}, ${y}) scale(${zoom})`}>
          {Array.from(projectGroups.entries()).map(([projectId, group]) => (
            <g key={`labels-${projectId}`}>
              {group.boundaries.map(b => {
                const labelText = `${group.icon} ${group.name} • #${projectId}`;
                const labelWidth = labelText.length * 6 + 16;
                return (
                  <g 
                    key={`label-${b.id}`}
                    style={{ cursor: 'pointer', pointerEvents: 'all' }}
                    onClick={() => handleBadgeClick(projectId)}
                  >
                    <rect
                      x={b.centerX - labelWidth / 2}
                      y={b.y + 3}
                      width={labelWidth}
                      height={16}
                      rx={4}
                      fill={group.color}
                      fillOpacity={0.15}
                    />
                    <text
                      x={b.centerX}
                      y={b.y + 14}
                      textAnchor="middle"
                      fill={group.color}
                      fontSize={11}
                      fontFamily="system-ui, -apple-system, sans-serif"
                      fontWeight={500}
                      opacity={0.85}
                    >
                      {labelText}
                    </text>
                  </g>
                );
              })}
            </g>
          ))}
        </g>
      </svg>
    </>
  );
};
