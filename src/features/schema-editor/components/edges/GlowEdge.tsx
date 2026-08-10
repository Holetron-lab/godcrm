import { memo, useMemo } from 'react';
import { BaseEdge, getSmoothStepPath, getBezierPath, getStraightPath, Position, type EdgeProps } from '@xyflow/react';
import { useSchemaEditorStore } from '../../store/schemaEditorStore';
import type { EdgeShapeType, LineStyleType, EndpointMarkerType } from '../../types/schema-editor.types';

/**
 * Custom edge with separate SHAPE and STYLE controls:
 * 
 * SHAPES (path/curve direction - RIGHT menu):
 * 1. rounded  - Smooth step with rounded corners (default)
 * 2. bezier   - Smooth bezier curves
 * 3. straight - Direct straight lines
 * 4. angular  - Sharp 90° angles (PCB style)
 * 
 * LINE STYLES (visual appearance - LEFT menu):
 * 1. solid    - Сплошная линия
 * 2. dashed   - Пунктир
 * 3. thin     - Тонкая линия
 * 4. arrows   - Со стрелкой на конце (без точек)
 * 5. animated - Анимированная (движущийся пунктир)
 * 6. gradient - Градиент (100% края, 20% центр)
 * 7. pulse    - Пульсация (светящийся поток)
 */
export const GlowEdge = memo(({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  data,
  source,
  target,
  sourceHandleId,
  targetHandleId,
}: EdgeProps) => {
  const edgeShape = useSchemaEditorStore((s) => s.edgeShape);
  const lineStyle = useSchemaEditorStore((s) => s.lineStyle);
  const edgeStyleConfig = useSchemaEditorStore((s) => s.edgeStyleConfig);
  const allEdges = useSchemaEditorStore((s) => s.edges);
  
  // Calculate label offset index for edges sharing the same source/target column
  const { sourceLabelIndex, targetLabelIndex } = useMemo(() => {
    // Find edges sharing same source handle (same column on source table)
    const sourceHandleEdges = allEdges.filter(e => 
      e.source === source && e.sourceHandle === sourceHandleId
    );
    const srcIdx = sourceHandleEdges.findIndex(e => e.id === id);
    
    // Find edges sharing same target handle (same column on target table)
    const targetHandleEdges = allEdges.filter(e => 
      e.target === target && e.targetHandle === targetHandleId
    );
    const tgtIdx = targetHandleEdges.findIndex(e => e.id === id);
    
    return {
      sourceLabelIndex: srcIdx >= 0 ? srcIdx : 0,
      targetLabelIndex: tgtIdx >= 0 ? tgtIdx : 0,
    };
  }, [allEdges, source, target, sourceHandleId, targetHandleId, id]);
  
  // Label offset constants
  const LABEL_LINE_HEIGHT = 24; // Height per label group (2 lines)
  
  // Calculate offset direction based on position
  const getOffset = (pos: Position, offset: number) => {
    switch (pos) {
      case 'top': return { x: 0, y: -offset };
      case 'bottom': return { x: 0, y: offset };
      case 'left': return { x: -offset, y: 0 };
      case 'right': return { x: offset, y: 0 };
      default: return { x: 0, y: 0 };
    }
  };
  
  // Extra clearance from node before first bend (requested larger margins)
  const bendOffset = edgeShape === 'straight' ? 120 : 100;
  const dotOffset = edgeShape === 'straight' ? 18 : 14;

  const sourceOffset = getOffset(sourcePosition, dotOffset);
  const targetOffset = getOffset(targetPosition, dotOffset);
  
  // Offset dot positions by 10px away from card
  const dotSourceX = sourceX + sourceOffset.x;
  const dotSourceY = sourceY + sourceOffset.y;
  const dotTargetX = targetX + targetOffset.x;
  const dotTargetY = targetY + targetOffset.y;
  
  // Generate path based on edge style
  const [smoothPath] = getSmoothStepPath({
    sourceX: dotSourceX,
    sourceY: dotSourceY,
    targetX: dotTargetX,
    targetY: dotTargetY,
    sourcePosition,
    targetPosition,
    borderRadius: 16,
    offset: bendOffset,
  });
  
  const [bezierPath] = getBezierPath({
    sourceX: dotSourceX,
    sourceY: dotSourceY,
    targetX: dotTargetX,
    targetY: dotTargetY,
    sourcePosition,
    targetPosition,
    curvature: 0.5, // deeper curve for clearer offset from nodes
  });
  
  const [straightPath] = getStraightPath({
    sourceX: dotSourceX,
    sourceY: dotSourceY,
    targetX: dotTargetX,
    targetY: dotTargetY,
  });
  
  // Sharp step path (90° angles, no rounding)
  const [sharpPath] = getSmoothStepPath({
    sourceX: dotSourceX,
    sourceY: dotSourceY,
    targetX: dotTargetX,
    targetY: dotTargetY,
    sourcePosition,
    targetPosition,
    borderRadius: 0,
    offset: bendOffset,
  });
  
  // Select path based on shape (only path direction, no visual effects)
  const getPathForShape = (shapeType: EdgeShapeType): string => {
    switch (shapeType) {
      case 'bezier': return bezierPath;
      case 'straight': return straightPath;
      case 'angular': return sharpPath;
      case 'rounded':
      default: return smoothPath;
    }
  };
  
  const edgePath = getPathForShape(edgeShape);

  // Get color from style or default to purple
  const strokeColor = (style?.stroke as string) || '#a855f7';
  const getLightColor = (color: string) => {
    if (color === '#f97316') return '#fb923c'; // orange
    if (color === '#22c55e') return '#4ade80'; // green
    return '#c084fc'; // default light purple
  };
  const lightColor = getLightColor(strokeColor);
  
  // Extract info from data
  const edgeData = data as any;
  const sourceColumn = edgeData?.sourceColumn || '';
  const targetColumn = edgeData?.targetColumn || '';
  const sourceTableName = edgeData?.sourceTableName || '';
  const targetTableName = edgeData?.targetTableName || '';
  const sourceTableIdData = edgeData?.sourceTableId || '';
  const targetTableIdData = edgeData?.targetTableId || '';
  
  // Parse table IDs from node IDs (table-123 -> 123) - fallback
  const sourceTableId = source?.replace('table-', '') || '';
  const targetTableId = target?.replace('table-', '') || '';
  
  // Labels
  const sourceLabel1 = targetTableName ? `${targetTableName} (#${targetTableIdData || targetTableId})` : '';
  const sourceLabel2 = targetColumn || '';
  const targetLabel1 = sourceTableName ? `${sourceTableName} (#${sourceTableIdData || sourceTableId})` : '';
  const targetLabel2 = sourceColumn || '';

  // Endpoint marker renderer
  const renderMarker = (
    type: EndpointMarkerType,
    x: number,
    y: number,
    color: string,
    lightCol: string,
    isTarget: boolean = false
  ) => {
    const size = 4;
    
    switch (type) {
      case 'none':
        return null;
        
      case 'square':
        return (
          <rect
            x={x - size}
            y={y - size}
            width={size * 2}
            height={size * 2}
            fill={color}
            stroke={lightCol}
            strokeWidth={1}
          />
        );
        
      case 'diamond':
        return (
          <polygon
            points={`${x},${y - size * 1.2} ${x + size * 1.2},${y} ${x},${y + size * 1.2} ${x - size * 1.2},${y}`}
            fill={color}
            stroke={lightCol}
            strokeWidth={1}
          />
        );
        
      case 'arrow':
      case 'arrowReverse':
        return (
          <circle
            cx={x}
            cy={y}
            r={size * 0.7}
            fill={color}
            stroke={lightCol}
            strokeWidth={1}
          />
        );
        
      case 'dot':
      default:
        return (
          <circle
            cx={x}
            cy={y}
            r={size}
            fill={color}
            stroke={lightCol}
            strokeWidth={1}
          />
        );
    }
  };

  // Render endpoint labels with offset based on index
  const renderLabels = () => {
    const sourceYOffset = sourceLabelIndex * LABEL_LINE_HEIGHT;
    const targetYOffset = targetLabelIndex * LABEL_LINE_HEIGHT;
    
    return (
      <>
        {(sourceLabel1 || sourceLabel2) && (
          <g>
            <text x={dotSourceX + 8} y={dotSourceY + 10 + sourceYOffset} fill="#9ca3af" fontSize={8} fontFamily="monospace">
              {sourceLabel1}
            </text>
            <text x={dotSourceX + 8} y={dotSourceY + 20 + sourceYOffset} fill="#9ca3af" fontSize={9} fontFamily="monospace">
              {sourceLabel2}
            </text>
          </g>
        )}
        {(targetLabel1 || targetLabel2) && (
          <g>
            <text x={dotTargetX - 8} y={dotTargetY + 10 + targetYOffset} fill="#9ca3af" fontSize={8} fontFamily="monospace" textAnchor="end">
              {targetLabel1}
            </text>
            <text x={dotTargetX - 8} y={dotTargetY + 20 + targetYOffset} fill="#9ca3af" fontSize={9} fontFamily="monospace" textAnchor="end">
              {targetLabel2}
            </text>
          </g>
        )}
      </>
    );
  };

  // Render endpoints based on config
  const renderEndpoints = () => {
    const sourceType = edgeStyleConfig?.sourceMarker || 'dot';
    const targetType = edgeStyleConfig?.targetMarker || 'dot';
    
    return (
      <>
        <g>{renderMarker(sourceType, dotSourceX, dotSourceY, strokeColor, lightColor, false)}</g>
        <g>{renderMarker(targetType, dotTargetX, dotTargetY, strokeColor, lightColor, true)}</g>
        {renderLabels()}
      </>
    );
  };

  // Render only source endpoint (for styles with arrows - no dot at target)
  const renderSourceEndpoint = () => {
    return (
      <>
        <circle cx={dotSourceX} cy={dotSourceY} r={3} fill={strokeColor} stroke={lightColor} strokeWidth={1} />
        {renderLabels()}
      </>
    );
  };

  // ====== LINE STYLE RENDERING ======
  
  // Filled arrow marker (for most styles)
  const renderFilledArrowMarker = () => (
    <defs>
      <marker
        id={`arrow-filled-${id}`}
        viewBox="0 0 10 10"
        refX="9"
        refY="5"
        markerWidth="6"
        markerHeight="6"
        orient="auto"
      >
        <path d="M 0 0 L 10 5 L 0 10 L 3 5 z" fill={strokeColor} />
      </marker>
    </defs>
  );
  
  // Draft-style arrow marker (two lines like in technical drawings - for straight/minimal shape)
  const renderDraftArrowMarker = () => (
    <defs>
      <marker
        id={`arrow-draft-${id}`}
        viewBox="0 0 12 12"
        refX="11"
        refY="6"
        markerWidth="8"
        markerHeight="8"
        orient="auto"
      >
        <path d="M 0 0 L 12 6 M 0 12 L 12 6" stroke={strokeColor} strokeWidth="1.5" fill="none" strokeLinecap="round" />
      </marker>
    </defs>
  );
  
  // Choose arrow type based on shape
  const arrowMarkerId = edgeShape === 'straight' ? `arrow-draft-${id}` : `arrow-filled-${id}`;
  const renderArrowDefs = () => edgeShape === 'straight' ? renderDraftArrowMarker() : renderFilledArrowMarker();

  // Gradient definitions for 'gradient' lineStyle - directional (source 30% -> target 100%)
  const renderGradientDefs = () => {
    const gradientId = `gradient-${id}`;
    const glowGradientId = `gradient-glow-${id}`;
    return (
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={strokeColor} stopOpacity="0.3" />
          <stop offset="100%" stopColor={strokeColor} stopOpacity="1" />
        </linearGradient>
        <linearGradient id={glowGradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={strokeColor} stopOpacity="0.1" />
          <stop offset="100%" stopColor={strokeColor} stopOpacity="0.4" />
        </linearGradient>
      </defs>
    );
  };

  // Main render based on lineStyle
  const renderEdge = () => {
    const gradientId = `gradient-${id}`;
    const glowGradientId = `gradient-glow-${id}`;
    
    switch (lineStyle) {
      // SOLID - сплошная линия (СО СТРЕЛКОЙ)
      case 'solid':
        return (
          <>
            {renderArrowDefs()}
            <path d={edgePath} fill="none" stroke={strokeColor} strokeWidth={6} strokeOpacity={0.1} />
            <path 
              d={edgePath} 
              fill="none" 
              stroke={strokeColor} 
              strokeWidth={2} 
              strokeLinecap="round"
              markerEnd={`url(#${arrowMarkerId})`}
            />
            {renderSourceEndpoint()}
          </>
        );
      
      // DASHED - пунктир (СО СТРЕЛКОЙ)
      case 'dashed':
        return (
          <>
            {renderArrowDefs()}
            <path d={edgePath} fill="none" stroke={strokeColor} strokeWidth={6} strokeOpacity={0.1} />
            <path 
              d={edgePath} 
              fill="none" 
              stroke={strokeColor} 
              strokeWidth={2} 
              strokeDasharray="8 6" 
              strokeLinecap="round"
              markerEnd={`url(#${arrowMarkerId})`}
            />
            {renderSourceEndpoint()}
          </>
        );
      
      // THIN - тонкая линия (СО СТРЕЛКОЙ)
      case 'thin':
        return (
          <>
            {renderArrowDefs()}
            <path 
              d={edgePath} 
              fill="none" 
              stroke={strokeColor} 
              strokeWidth={1} 
              strokeOpacity={0.7} 
              strokeLinecap="round"
              markerEnd={`url(#${arrowMarkerId})`}
            />
            {renderSourceEndpoint()}
          </>
        );
      
      // ANIMATED - живая (БЕЗ стрелки)
      case 'animated':
        return (
          <>
            <path d={edgePath} fill="none" stroke={strokeColor} strokeWidth={6} strokeOpacity={0.1} />
            <path d={edgePath} fill="none" stroke={strokeColor} strokeWidth={2} strokeLinecap="round" />
            <path 
              d={edgePath} 
              fill="none" 
              stroke={lightColor} 
              strokeWidth={2} 
              strokeDasharray="8 12" 
              strokeLinecap="round"
              className="animate-dash-flow"
            />
            {renderEndpoints()}
          </>
        );
      
      // GRADIENT - градиент (СО СТРЕЛКОЙ)
      case 'gradient':
        return (
          <>
            {renderGradientDefs()}
            {renderArrowDefs()}
            <path d={edgePath} fill="none" stroke={`url(#${glowGradientId})`} strokeWidth={10} filter="blur(4px)" />
            <path 
              d={edgePath} 
              fill="none" 
              stroke={`url(#${gradientId})`} 
              strokeWidth={3} 
              strokeLinecap="round"
              markerEnd={`url(#${arrowMarkerId})`}
            />
            {renderSourceEndpoint()}
          </>
        );
      
      // PULSE - пульсация (БЕЗ стрелки)
      case 'pulse':
        return (
          <>
            {/* Основное свечение - размытый слой */}
            <path d={edgePath} fill="none" stroke={strokeColor} strokeWidth={12} strokeOpacity={0.15} filter="blur(8px)" />
            <path d={edgePath} fill="none" stroke={lightColor} strokeWidth={8} strokeOpacity={0.2} filter="blur(4px)" />
            {/* Базовая линия */}
            <path d={edgePath} fill="none" stroke={strokeColor} strokeWidth={2} strokeOpacity={0.6} />
            {/* Светящийся пульсирующий поток - длинные тире */}
            <path 
              d={edgePath} 
              fill="none" 
              stroke={lightColor} 
              strokeWidth={4} 
              strokeDasharray="20 30" 
              strokeLinecap="round"
              strokeOpacity={0.8}
              filter="blur(2px)"
              className="animate-pulse-flow"
            />
            {/* Яркий центральный поток */}
            <path 
              d={edgePath} 
              fill="none" 
              stroke="white" 
              strokeWidth={1} 
              strokeDasharray="20 30" 
              strokeLinecap="round"
              strokeOpacity={0.6}
              className="animate-pulse-flow"
            />
            {renderEndpoints()}
          </>
        );
      
      default:
        return (
          <>
            {renderArrowDefs()}
            <path d={edgePath} fill="none" stroke={strokeColor} strokeWidth={6} strokeOpacity={0.1} />
            <path 
              d={edgePath} 
              fill="none" 
              stroke={strokeColor} 
              strokeWidth={2} 
              strokeLinecap="round"
              markerEnd={`url(#${arrowMarkerId})`}
            />
            {renderEndpoints()}
          </>
        );
    }
  };

  return renderEdge();
});

GlowEdge.displayName = 'GlowEdge';
