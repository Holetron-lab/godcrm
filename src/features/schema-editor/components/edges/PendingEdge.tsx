import { memo, useMemo } from 'react';
import { getSmoothStepPath, getBezierPath, getStraightPath, Position, type EdgeProps } from '@xyflow/react';
import { useSchemaEditorStore } from '../../store/schemaEditorStore';
import type { EdgeShapeType, EndpointMarkerType } from '../../types/schema-editor.types';

/**
 * Pending edge - uses same shape/style system as GlowEdge but with blue color
 * Synced with GlowEdge for consistent appearance
 */
export const PendingEdge = memo(({
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
  const pendingConnections = useSchemaEditorStore((s) => s.pendingConnections);
  
  // Calculate label offset for pending edges
  const { sourceLabelIndex, targetLabelIndex } = useMemo(() => {
    const pendingForSource = pendingConnections.filter(pc => 
      `table-${pc.sourceTableId}` === source
    );
    const srcIdx = pendingForSource.findIndex(pc => 
      `pending-${pc.sourceTableId}-${pc.sourceColumn}-${pc.targetTableId}` === id
    );
    
    const pendingForTarget = pendingConnections.filter(pc => 
      `table-${pc.targetTableId}` === target
    );
    const tgtIdx = pendingForTarget.findIndex(pc => 
      `pending-${pc.sourceTableId}-${pc.sourceColumn}-${pc.targetTableId}` === id
    );
    
    return {
      sourceLabelIndex: srcIdx >= 0 ? srcIdx : 0,
      targetLabelIndex: tgtIdx >= 0 ? tgtIdx : 0,
    };
  }, [pendingConnections, source, target, id]);
  
  const LABEL_LINE_HEIGHT = 24;
  
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
  
  const sourceOffset = getOffset(sourcePosition, 10);
  const targetOffset = getOffset(targetPosition, 10);
  
  // Offset dot positions by 10px away from card
  const dotSourceX = sourceX + sourceOffset.x;
  const dotSourceY = sourceY + sourceOffset.y;
  const dotTargetX = targetX + targetOffset.x;
  const dotTargetY = targetY + targetOffset.y;
  
  // Generate paths based on shape
  const [smoothPath] = getSmoothStepPath({
    sourceX: dotSourceX,
    sourceY: dotSourceY,
    targetX: dotTargetX,
    targetY: dotTargetY,
    sourcePosition,
    targetPosition,
    borderRadius: 16,
  });
  
  const [bezierPath] = getBezierPath({
    sourceX: dotSourceX,
    sourceY: dotSourceY,
    targetX: dotTargetX,
    targetY: dotTargetY,
    sourcePosition,
    targetPosition,
    curvature: 0.25,
  });
  
  const [straightPath] = getStraightPath({
    sourceX: dotSourceX,
    sourceY: dotSourceY,
    targetX: dotTargetX,
    targetY: dotTargetY,
  });
  
  const [sharpPath] = getSmoothStepPath({
    sourceX: dotSourceX,
    sourceY: dotSourceY,
    targetX: dotTargetX,
    targetY: dotTargetY,
    sourcePosition,
    targetPosition,
    borderRadius: 0,
  });
  
  // Select path based on shape (same as GlowEdge)
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

  // Blue color theme for pending edges
  const strokeColor = '#3b82f6';
  const lightColor = '#60a5fa';
  
  // Extract info from data
  const edgeData = data as any;
  const sourceColumn = edgeData?.sourceColumn || '';
  const targetColumn = edgeData?.targetColumn || '';
  const sourceTableName = edgeData?.sourceTableName || '';
  const targetTableName = edgeData?.targetTableName || '';
  const sourceTableIdData = edgeData?.sourceTableId || '';
  const targetTableIdData = edgeData?.targetTableId || '';
  
  // Parse table IDs from node IDs
  const sourceTableId = source?.replace('table-', '') || '';
  const targetTableId = target?.replace('table-', '') || '';
  
  // Labels
  const sourceLabel1 = targetTableName ? `${targetTableName} (#${targetTableIdData || targetTableId})` : '';
  const sourceLabel2 = targetColumn || '';
  const targetLabel1 = sourceTableName ? `${sourceTableName} (#${sourceTableIdData || sourceTableId})` : '';
  const targetLabel2 = sourceColumn || '';

  // Endpoint marker renderer (same types as GlowEdge)
  const renderMarker = (
    type: EndpointMarkerType,
    x: number,
    y: number,
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
            fill={strokeColor}
            stroke={lightColor}
            strokeWidth={1}
          />
        );
        
      case 'diamond':
        return (
          <polygon
            points={`${x},${y - size * 1.2} ${x + size * 1.2},${y} ${x},${y + size * 1.2} ${x - size * 1.2},${y}`}
            fill={strokeColor}
            stroke={lightColor}
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
            fill={strokeColor}
            stroke={lightColor}
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
            fill={strokeColor}
            stroke={lightColor}
            strokeWidth={1}
          />
        );
    }
  };

  // Render labels with offset
  const renderLabels = () => {
    const sourceYOffset = sourceLabelIndex * LABEL_LINE_HEIGHT;
    const targetYOffset = targetLabelIndex * LABEL_LINE_HEIGHT;
    
    return (
      <>
        {(sourceLabel1 || sourceLabel2) && (
          <g>
            <text x={dotSourceX + 8} y={dotSourceY + 10 + sourceYOffset} fill={lightColor} fontSize={8} fontFamily="monospace">
              {sourceLabel1}
            </text>
            <text x={dotSourceX + 8} y={dotSourceY + 20 + sourceYOffset} fill={lightColor} fontSize={9} fontFamily="monospace">
              {sourceLabel2}
            </text>
          </g>
        )}
        {(targetLabel1 || targetLabel2) && (
          <g>
            <text x={dotTargetX - 8} y={dotTargetY + 10 + targetYOffset} fill={lightColor} fontSize={8} fontFamily="monospace" textAnchor="end">
              {targetLabel1}
            </text>
            <text x={dotTargetX - 8} y={dotTargetY + 20 + targetYOffset} fill={lightColor} fontSize={9} fontFamily="monospace" textAnchor="end">
              {targetLabel2}
            </text>
          </g>
        )}
      </>
    );
  };

  // Render endpoints based on config (same as GlowEdge)
  const renderEndpoints = () => {
    const sourceType = edgeStyleConfig?.sourceMarker || 'dot';
    const targetType = edgeStyleConfig?.targetMarker || 'dot';
    
    return (
      <>
        <g>{renderMarker(sourceType, dotSourceX, dotSourceY, false)}</g>
        <g>{renderMarker(targetType, dotTargetX, dotTargetY, true)}</g>
        {renderLabels()}
      </>
    );
  };

  // Render only source endpoint (for styles with arrows)
  const renderSourceEndpoint = () => {
    return (
      <>
        <circle cx={dotSourceX} cy={dotSourceY} r={3} fill={strokeColor} stroke={lightColor} strokeWidth={1} />
        {renderLabels()}
      </>
    );
  };

  // Arrow markers (blue theme)
  const renderFilledArrowMarker = () => (
    <defs>
      <marker
        id={`arrow-pending-filled-${id}`}
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
  
  const renderDraftArrowMarker = () => (
    <defs>
      <marker
        id={`arrow-pending-draft-${id}`}
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
  
  const arrowMarkerId = edgeShape === 'straight' ? `arrow-pending-draft-${id}` : `arrow-pending-filled-${id}`;
  const renderArrowDefs = () => edgeShape === 'straight' ? renderDraftArrowMarker() : renderFilledArrowMarker();

  // Directional gradient (source = 30%, target = 100% opacity - shows direction to target)
  const renderGradientDefs = () => {
    const gradientId = `gradient-pending-${id}`;
    const glowGradientId = `gradient-pending-glow-${id}`;
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

  // Main render based on lineStyle (same structure as GlowEdge)
  const gradientId = `gradient-pending-${id}`;
  const glowGradientId = `gradient-pending-glow-${id}`;
  
  switch (lineStyle) {
    // SOLID
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
    
    // DASHED
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
    
    // THIN
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
    
    // ANIMATED
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
    
    // GRADIENT - directional (source 100% -> target 30%)
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
    
    // PULSE
    case 'pulse':
      return (
        <>
          <path d={edgePath} fill="none" stroke={strokeColor} strokeWidth={12} strokeOpacity={0.15} filter="blur(8px)" />
          <path d={edgePath} fill="none" stroke={lightColor} strokeWidth={8} strokeOpacity={0.2} filter="blur(4px)" />
          <path d={edgePath} fill="none" stroke={strokeColor} strokeWidth={2} strokeOpacity={0.6} />
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
    
    // DEFAULT (same as solid)
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
          {renderSourceEndpoint()}
        </>
      );
  }
});

PendingEdge.displayName = 'PendingEdge';
