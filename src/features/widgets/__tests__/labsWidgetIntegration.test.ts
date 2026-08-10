/**
 * @file labsWidgetIntegration.test.ts
 * @description Integration tests for Labs widget (v4 - Documents pattern)
 * @see ADR-043: Laboratories Feature
 * 
 * Labs v4 Architecture:
 * - 1 registry table for lab list (user maps during widget creation)
 * - 1 nodes table per lab (auto-created when lab is created)
 * - Node types defined in code, not database
 * - Edges stored as JSON array in nodes table
 */
import { describe, it, expect } from 'vitest';
import { 
  presetRequiresTable, 
  getPresetTables, 
  hasAutoInit, 
  getAutoInitEndpoint,
  WIDGET_PRESETS 
} from '../config/widget-presets.config';

describe('Labs Widget v4 Integration', () => {
  describe('Table Requirements', () => {
    it('should require tables for Labs widget', () => {
      expect(presetRequiresTable('labs')).toBe(true);
    });

    it('should have single registry table (Documents pattern)', () => {
      const labsTables = getPresetTables('labs');
      
      // Labs v4: Only 1 table - the registry (like Documents)
      // Individual lab nodes tables are created dynamically
      expect(labsTables).toHaveLength(1);
      
      const tableKeys = labsTables.map(t => t.key);
      expect(tableKeys).toEqual(['labs']);
    });

    it('should have registry table properly configured', () => {
      const labsTables = getPresetTables('labs');
      const registryTable = labsTables[0];
      
      expect(registryTable.key).toBe('labs');
      expect(registryTable.name).toBe('Labs Registry');
      expect(registryTable.required).toBe(true);
      expect(registryTable.canCreate).toBe(true);
    });

    it('should allow table creation', () => {
      const labsTables = getPresetTables('labs');
      expect(labsTables[0].canCreate).toBe(true);
    });

    it('should have proper default table name', () => {
      const labsTables = getPresetTables('labs');
      expect(labsTables[0].defaultTableName).toBe('Labs');
    });
  });

  describe('Column Requirements', () => {
    it('should have required columns for labs registry table', () => {
      const labsTables = getPresetTables('labs');
      const labsTable = labsTables.find(t => t.key === 'labs');
      
      expect(labsTable?.requiredColumns).toHaveLength(2);
      
      const columnKeys = labsTable?.requiredColumns.map(c => c.key);
      expect(columnKeys).toContain('nameColumn');
      expect(columnKeys).toContain('tableIdColumn');
    });

    it('should have default columns for table creation', () => {
      const labsTables = getPresetTables('labs');
      const labsTable = labsTables[0];
      
      expect(labsTable.defaultColumns).toBeDefined();
      expect(labsTable.defaultColumns!.length).toBeGreaterThan(0);
      
      // Verify key columns exist
      const columnNames = labsTable.defaultColumns?.map(c => c.name);
      expect(columnNames).toContain('name');
      expect(columnNames).toContain('slug');
      expect(columnNames).toContain('table_id');
    });
  });

  describe('Auto-initialization', () => {
    it('should NOT have auto-init (tables are user-managed)', () => {
      // Labs v4: User maps/creates registry table during widget setup
      // No auto-init because we follow Documents pattern
      expect(hasAutoInit('labs')).toBe(false);
    });

    it('should NOT have init endpoint', () => {
      expect(getAutoInitEndpoint('labs')).toBeUndefined();
    });
  });

  describe('Widget Creation Flow', () => {
    it('should trigger table mapping step during widget creation', () => {
      // Labs v4 flow:
      // 1. Select preset (labs)
      // 2. Table mapping (map/create registry table)
      // 3. Configuration
      
      expect(presetRequiresTable('labs')).toBe(true);
      
      const labsTables = getPresetTables('labs');
      const requiredTables = labsTables.filter(t => t.required);
      
      expect(requiredTables.length).toBe(1);
    });

    it('should support both table creation and mapping', () => {
      const labsTables = getPresetTables('labs');
      
      // Registry table should support creation
      expect(labsTables[0].canCreate).toBe(true);
      
      // Should have column mappings for existing tables
      expect(labsTables[0].requiredColumns.length).toBeGreaterThan(0);
    });
  });

  describe('Core Widget Properties', () => {
    it('should have correct widget metadata', () => {
      const labsPreset = WIDGET_PRESETS.labs;
      
      expect(labsPreset.id).toBe('labs');
      expect(labsPreset.name).toBe('Labs');
      expect(labsPreset.emoji).toBe('🧪');
      expect(labsPreset.color).toBe('#8b5cf6');
      expect(labsPreset.category).toBe('productivity');
    });

    it('should have proper default size', () => {
      const labsPreset = WIDGET_PRESETS.labs;
      
      expect(labsPreset.defaultSize.w).toBe(12);
      expect(labsPreset.defaultSize.h).toBe(8);
    });

    it('should not be deprecated', () => {
      const labsPreset = WIDGET_PRESETS.labs;
      expect(labsPreset.deprecated).toBeFalsy();
    });
  });

  describe('Documents Pattern Compliance', () => {
    it('should follow Documents pattern (1 registry table)', () => {
      const labsTables = getPresetTables('labs');
      const documentsTables = getPresetTables('documents');
      
      // Both should have registry-style table structure
      expect(labsTables.length).toBe(1); // Labs: 1 registry
      expect(documentsTables.length).toBe(2); // Documents: registry + atoms
      
      // Labs registry should have table_id for linking to nodes tables
      const labsRegistry = labsTables[0];
      const hasTableIdColumn = labsRegistry.defaultColumns?.some(c => c.name === 'table_id');
      expect(hasTableIdColumn).toBe(true);
    });
  });
});
