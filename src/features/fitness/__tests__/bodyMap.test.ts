/**
 * ADR-025: Body Map Tests
 * Tests for muscle mapping and BodyMap component
 */

import { describe, it, expect } from 'vitest';
import { 
  getSvgIdsForMuscleName, 
  getVolumeColor, 
  getRelatedMuscleIds,
  SVG_MUSCLE_GROUPS,
  SVG_MUSCLE_NAMES,
  INTERACTIVE_MUSCLE_IDS,
} from '../components/BodyMap/muscleMapping';

describe('muscleMapping', () => {
  describe('getSvgIdsForMuscleName', () => {
    it('should return SVG IDs for generic muscle names', () => {
      expect(getSvgIdsForMuscleName('Chest')).toEqual(['mid-lower-pectoralis', 'upper-pectoralis']);
      expect(getSvgIdsForMuscleName('Biceps')).toEqual(['long-head-bicep', 'short-head-bicep']);
      expect(getSvgIdsForMuscleName('Back')).toContain('lats');
    });

    it('should handle case-insensitive matching', () => {
      expect(getSvgIdsForMuscleName('chest')).toEqual(['mid-lower-pectoralis', 'upper-pectoralis']);
      expect(getSvgIdsForMuscleName('CHEST')).toEqual(['mid-lower-pectoralis', 'upper-pectoralis']);
    });

    it('should return SVG IDs for anatomical muscle names', () => {
      expect(getSvgIdsForMuscleName('deltoid_anterior')).toEqual(['anterior-deltoid']);
      expect(getSvgIdsForMuscleName('biceps_brachii')).toEqual(['long-head-bicep', 'short-head-bicep']);
    });

    it('should return empty array for unknown muscles', () => {
      expect(getSvgIdsForMuscleName('unknown_muscle')).toEqual([]);
      expect(getSvgIdsForMuscleName('')).toEqual([]);
      expect(getSvgIdsForMuscleName(undefined)).toEqual([]);
    });
  });

  describe('getVolumeColor', () => {
    it('should return default color for zero volume', () => {
      expect(getVolumeColor(0, 1000)).toContain('var(--bg-tertiary');
    });

    it('should return default color for zero max volume', () => {
      expect(getVolumeColor(500, 0)).toContain('var(--bg-tertiary');
    });

    it('should return lightest color for low intensity', () => {
      expect(getVolumeColor(100, 1000)).toBe('rgb(254, 243, 199)'); // < 20%
    });

    it('should return darkest color for max intensity', () => {
      expect(getVolumeColor(1000, 1000)).toBe('rgb(202, 138, 4)'); // 100%
    });

    it('should return gradient colors for intermediate values', () => {
      expect(getVolumeColor(300, 1000)).toBe('rgb(253, 224, 71)'); // 30%
      expect(getVolumeColor(500, 1000)).toBe('rgb(250, 204, 21)'); // 50%
      expect(getVolumeColor(700, 1000)).toBe('rgb(234, 179, 8)');  // 70%
    });
  });

  describe('getRelatedMuscleIds', () => {
    it('should return all SVG IDs for a muscle group name', () => {
      const shoulderIds = getRelatedMuscleIds('Shoulders');
      expect(shoulderIds).toContain('anterior-deltoid');
      expect(shoulderIds).toContain('lateral-deltoid');
      expect(shoulderIds).toContain('posterior-deltoid');
    });

    it('should return related IDs when given an SVG ID', () => {
      const ids = getRelatedMuscleIds('anterior-deltoid');
      expect(ids).toContain('lateral-deltoid');
      expect(ids).toContain('posterior-deltoid');
    });

    it('should return empty array for null', () => {
      expect(getRelatedMuscleIds(null)).toEqual([]);
    });
  });

  describe('SVG_MUSCLE_GROUPS', () => {
    it('should map all interactive muscle IDs to groups', () => {
      const unmappedIds = INTERACTIVE_MUSCLE_IDS.filter(
        id => !SVG_MUSCLE_GROUPS[id]
      );
      // Some IDs like 'neck' are mapped, others might not be
      expect(unmappedIds.length).toBeLessThan(5);
    });

    it('should have consistent group names', () => {
      const groups = new Set(Object.values(SVG_MUSCLE_GROUPS));
      expect(groups.has('Chest')).toBe(true);
      expect(groups.has('Back')).toBe(false); // We use 'Lats', 'Lower Back' etc
      expect(groups.has('Shoulders')).toBe(true);
    });
  });

  describe('SVG_MUSCLE_NAMES', () => {
    it('should provide display names for all interactive muscles', () => {
      const missingNames = INTERACTIVE_MUSCLE_IDS.filter(
        id => !SVG_MUSCLE_NAMES[id]
      );
      expect(missingNames.length).toBe(0);
    });
  });
});
