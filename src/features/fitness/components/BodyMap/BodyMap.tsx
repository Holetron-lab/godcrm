/**
 * ADR-025: Body Map Component
 * Interactive SVG body diagram with muscle group coloring based on volume
 * Adapted from LiftShift
 */

import React, { useRef, useCallback, useMemo, useEffect } from 'react';
import { cn } from '@/shared/utils/cn';
import { 
  INTERACTIVE_MUSCLE_IDS, 
  getVolumeColor, 
  getRelatedMuscleIds,
  SVG_MUSCLE_GROUPS,
  SVG_MUSCLE_NAMES 
} from './muscleMapping';
import MaleFrontBodyMapMuscle from './MaleFrontBodyMapMuscle';
import MaleBackBodyMapMuscle from './MaleBackBodyMapMuscle';

export interface BodyMapProps {
  /** Muscle volume data: { 'Chest': 5000, 'Back': 3000, ... } */
  muscleVolumes: Map<string, number>;
  /** Maximum volume for intensity scaling (auto-calculated if not provided) */
  maxVolume?: number;
  /** Currently selected muscle group */
  selectedPart?: string | null;
  /** Callback when muscle is clicked */
  onPartClick?: (muscleGroup: string) => void;
  /** Callback when muscle is hovered */
  onPartHover?: (muscleGroup: string | null) => void;
  /** Compact mode for smaller displays */
  compact?: boolean;
  /** Additional CSS classes */
  className?: string;
}

// Default color for muscles without data
const DEFAULT_MUSCLE_COLOR = 'rgb(55, 65, 81)'; // gray-700

// Hover highlight color
const HOVER_HIGHLIGHT = 'rgba(96, 165, 250, 0.6)'; // blue-400 with opacity

// Selection highlight color
const SELECTION_HIGHLIGHT = 'rgba(34, 211, 238, 0.7)'; // cyan-400 with opacity

/**
 * Interactive body map showing muscle activation based on workout volume
 */
export function BodyMap({
  muscleVolumes,
  maxVolume,
  selectedPart = null,
  onPartClick,
  onPartHover,
  compact = false,
  className,
}: BodyMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hoveredMuscleRef = useRef<string | null>(null);

  // Calculate max volume if not provided
  const calculatedMaxVolume = useMemo(() => {
    if (maxVolume && maxVolume > 0) return maxVolume;
    const values = Array.from(muscleVolumes.values());
    return values.length > 0 ? Math.max(...values) : 1;
  }, [muscleVolumes, maxVolume]);

  // Get selected muscle IDs
  const selectedMuscleIds = useMemo(() => {
    return getRelatedMuscleIds(selectedPart);
  }, [selectedPart]);

  // Apply colors to SVG elements
  const applyColors = useCallback((hoveredId: string | null = null) => {
    if (!containerRef.current) return;

    INTERACTIVE_MUSCLE_IDS.forEach(muscleId => {
      const elements = containerRef.current?.querySelectorAll(`#${muscleId}`);
      elements?.forEach(el => {
        const volume = muscleVolumes.get(muscleId) || 0;
        const color = getVolumeColor(volume, calculatedMaxVolume);
        const isSelected = selectedMuscleIds.includes(muscleId);
        const isHovered = hoveredId === muscleId || 
          (hoveredId && getRelatedMuscleIds(hoveredId).includes(muscleId));

        el.querySelectorAll('path').forEach(path => {
          path.style.transition = 'all 0.15s ease';
          path.style.stroke = '#000000';
          path.style.strokeWidth = compact ? '0.6' : '1';
          path.style.strokeOpacity = compact ? '0.55' : '0.7';

          if (isSelected) {
            path.style.fill = SELECTION_HIGHLIGHT;
            path.style.filter = 'brightness(1.2)';
          } else if (isHovered) {
            path.style.fill = HOVER_HIGHLIGHT;
            path.style.filter = 'brightness(1.1)';
          } else if (volume > 0) {
            path.style.fill = color;
            path.style.filter = '';
          } else {
            path.style.fill = DEFAULT_MUSCLE_COLOR;
            path.style.filter = '';
          }
        });
      });
    });
  }, [muscleVolumes, calculatedMaxVolume, selectedMuscleIds, compact]);

  // Handle mouse events
  const handleMouseOver = useCallback((e: React.SyntheticEvent) => {
    const target = e.target as SVGElement;
    const muscleId = target.closest('[id]')?.id;
    
    if (muscleId && INTERACTIVE_MUSCLE_IDS.some(id => id === muscleId)) {
      hoveredMuscleRef.current = muscleId;
      applyColors(muscleId);
      onPartHover?.(SVG_MUSCLE_GROUPS[muscleId] || muscleId);
    }
  }, [applyColors, onPartHover]);

  const handleMouseOut = useCallback(() => {
    hoveredMuscleRef.current = null;
    applyColors(null);
    onPartHover?.(null);
  }, [applyColors, onPartHover]);

  const handleClick = useCallback((e: React.SyntheticEvent) => {
    const target = e.target as SVGElement;
    const muscleId = target.closest('[id]')?.id;
    
    if (muscleId && INTERACTIVE_MUSCLE_IDS.some(id => id === muscleId)) {
      const groupName = SVG_MUSCLE_GROUPS[muscleId] || muscleId;
      onPartClick?.(groupName);
    }
  }, [onPartClick]);

  useEffect(() => {
    const muscles = containerRef.current?.querySelectorAll<SVGGElement>('g[id]');
    muscles?.forEach(muscle => {
      if (!INTERACTIVE_MUSCLE_IDS.some(id => id === muscle.id)) return;
      muscle.setAttribute('role', onPartClick ? 'button' : 'img');
      muscle.setAttribute('tabindex', onPartClick ? '0' : '-1');
      muscle.setAttribute('aria-label', SVG_MUSCLE_NAMES[muscle.id] || muscle.id);
      if (onPartClick) muscle.setAttribute('aria-pressed', String(selectedMuscleIds.includes(muscle.id)));
      else muscle.removeAttribute('aria-pressed');
    });
  }, [onPartClick, selectedMuscleIds]);

  // Apply colors on mount and when data changes
  useEffect(() => {
    applyColors(hoveredMuscleRef.current);
  }, [applyColors]);

  return (
    <div role="presentation"
      ref={containerRef}
      className={cn(
        'flex items-center justify-center gap-2',
        compact ? 'h-48' : 'h-80',
        className
      )}
      onFocus={handleMouseOver}
      onBlur={handleMouseOut}
      onKeyDown={(e) => {
        if (onPartClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          handleClick(e);
        }
      }}
      onMouseOver={handleMouseOver}
      onMouseOut={handleMouseOut}
      onClick={handleClick}
    >
      <div className="flex-shrink-0">
        <MaleFrontBodyMapMuscle 
          className={cn(
            compact ? 'h-48 w-auto' : 'h-80 w-auto',
            'cursor-pointer'
          )} 
        />
      </div>
      <div className="flex-shrink-0">
        <MaleBackBodyMapMuscle 
          className={cn(
            compact ? 'h-48 w-auto' : 'h-80 w-auto',
            'cursor-pointer'
          )} 
        />
      </div>
    </div>
  );
}

export default BodyMap;
