import { describe, test, expect } from 'vitest';
import { 
  calculateNewValue, 
  escapeRegex, 
  sortRowsWithSelection,
  getTargetRowIds,
  generateReplacePreview,
  prepareBatchUpdatePayload
} from '../bulkReplaceUtils';
import type { BulkReplaceConfig } from '../../types/selection.types';
import type { ColumnModel, RowModel } from '../../types/table.types';

describe('bulkReplaceUtils', () => {
  describe('escapeRegex', () => {
    test('escapes special regex characters', () => {
      expect(escapeRegex('hello.*world')).toBe('hello\\.\\*world');
      expect(escapeRegex('[test]')).toBe('\\[test\\]');
      expect(escapeRegex('a+b?c')).toBe('a\\+b\\?c');
      expect(escapeRegex('$100')).toBe('\\$100');
    });
    
    test('returns plain string unchanged', () => {
      expect(escapeRegex('hello world')).toBe('hello world');
      expect(escapeRegex('abc123')).toBe('abc123');
    });
  });
  
  describe('calculateNewValue', () => {
    describe('replace operation', () => {
      test('replaces exact match', () => {
        const config: BulkReplaceConfig = {
          targetScope: 'selected',
          columnId: 'col1',
          operationType: 'replace',
          findValue: 'Draft',
          replaceValue: 'Active',
          caseSensitive: false
        };
        
        expect(calculateNewValue('Draft', config)).toBe('Active');
      });
      
      test('is case insensitive by default', () => {
        const config: BulkReplaceConfig = {
          targetScope: 'selected',
          columnId: 'col1',
          operationType: 'replace',
          findValue: 'draft',
          replaceValue: 'Active',
          caseSensitive: false
        };
        
        expect(calculateNewValue('DRAFT', config)).toBe('Active');
        expect(calculateNewValue('Draft', config)).toBe('Active');
        expect(calculateNewValue('draft', config)).toBe('Active');
      });
      
      test('respects case sensitivity when enabled', () => {
        const config: BulkReplaceConfig = {
          targetScope: 'selected',
          columnId: 'col1',
          operationType: 'replace',
          findValue: 'draft',
          replaceValue: 'Active',
          caseSensitive: true
        };
        
        expect(calculateNewValue('DRAFT', config)).toBe('DRAFT'); // No change
        expect(calculateNewValue('draft', config)).toBe('Active');
      });
      
      test('replaces all occurrences', () => {
        const config: BulkReplaceConfig = {
          targetScope: 'selected',
          columnId: 'col1',
          operationType: 'replace',
          findValue: 'test',
          replaceValue: 'TEST',
          caseSensitive: false
        };
        
        expect(calculateNewValue('test test test', config)).toBe('TEST TEST TEST');
      });
      
      test('supports regex when enabled', () => {
        const config: BulkReplaceConfig = {
          targetScope: 'selected',
          columnId: 'col1',
          operationType: 'replace',
          findValue: '\\d+',
          replaceValue: 'X',
          useRegex: true,
          caseSensitive: false
        };
        
        expect(calculateNewValue('Item 123 and 456', config)).toBe('Item X and X');
      });
      
      test('handles invalid regex gracefully', () => {
        const config: BulkReplaceConfig = {
          targetScope: 'selected',
          columnId: 'col1',
          operationType: 'replace',
          findValue: '[invalid',
          replaceValue: 'X',
          useRegex: true,
          caseSensitive: false
        };
        
        // Should return original value on invalid regex
        expect(calculateNewValue('test', config)).toBe('test');
      });
      
      test('replaces with empty string', () => {
        const config: BulkReplaceConfig = {
          targetScope: 'selected',
          columnId: 'col1',
          operationType: 'replace',
          findValue: 'remove',
          replaceValue: '',
          caseSensitive: false
        };
        
        expect(calculateNewValue('please remove this', config)).toBe('please  this');
      });
    });
    
    describe('addText operation - append', () => {
      test('adds value to end', () => {
        const config: BulkReplaceConfig = {
          targetScope: 'selected',
          columnId: 'col1',
          operationType: 'addText',
          appendValue: ' World'
        };
        
        expect(calculateNewValue('Hello', config)).toBe('Hello World');
      });
      
      test('handles empty append value', () => {
        const config: BulkReplaceConfig = {
          targetScope: 'selected',
          columnId: 'col1',
          operationType: 'addText',
          appendValue: ''
        };
        
        expect(calculateNewValue('Hello', config)).toBe('Hello');
      });
      
      test('handles null/undefined input', () => {
        const config: BulkReplaceConfig = {
          targetScope: 'selected',
          columnId: 'col1',
          operationType: 'addText',
          appendValue: '-suffix'
        };
        
        expect(calculateNewValue(null, config)).toBe('-suffix');
        expect(calculateNewValue(undefined, config)).toBe('-suffix');
      });
    });
    
    describe('addText operation - prepend', () => {
      test('adds value to beginning', () => {
        const config: BulkReplaceConfig = {
          targetScope: 'selected',
          columnId: 'col1',
          operationType: 'addText',
          prependValue: 'Hello '
        };
        
        expect(calculateNewValue('World', config)).toBe('Hello World');
      });
    });
    
    describe('clear operation', () => {
      test('returns empty string', () => {
        const config: BulkReplaceConfig = {
          targetScope: 'selected',
          columnId: 'col1',
          operationType: 'clear'
        };
        
        expect(calculateNewValue('Some value', config)).toBe('');
        expect(calculateNewValue('Another value', config)).toBe('');
      });
    });
  });
  
  describe('sortRowsWithSelection', () => {
    const rows = [
      { id: '1', data: {} },
      { id: '2', data: {} },
      { id: '3', data: {} },
      { id: '4', data: {} },
    ] as RowModel[];
    
    test('returns rows unchanged with default sort', () => {
      const selected = new Set(['2', '4']);
      const sorted = sortRowsWithSelection(rows, 'default', selected);
      
      expect(sorted.map(r => r.id)).toEqual(['1', '2', '3', '4']);
    });
    
    test('puts selected rows at top with selected-first', () => {
      const selected = new Set(['2', '4']);
      const sorted = sortRowsWithSelection(rows, 'selected-first', selected);
      
      expect(sorted.map(r => r.id)).toEqual(['2', '4', '1', '3']);
    });
    
    test('puts selected rows at bottom with selected-last', () => {
      const selected = new Set(['2', '4']);
      const sorted = sortRowsWithSelection(rows, 'selected-last', selected);
      
      expect(sorted.map(r => r.id)).toEqual(['1', '3', '2', '4']);
    });
    
    test('handles empty selection', () => {
      const selected = new Set<string>();
      
      expect(sortRowsWithSelection(rows, 'selected-first', selected).map(r => r.id))
        .toEqual(['1', '2', '3', '4']);
      expect(sortRowsWithSelection(rows, 'selected-last', selected).map(r => r.id))
        .toEqual(['1', '2', '3', '4']);
    });
    
    test('handles all selected', () => {
      const selected = new Set(['1', '2', '3', '4']);
      
      expect(sortRowsWithSelection(rows, 'selected-first', selected).map(r => r.id))
        .toEqual(['1', '2', '3', '4']);
      expect(sortRowsWithSelection(rows, 'selected-last', selected).map(r => r.id))
        .toEqual(['1', '2', '3', '4']);
    });
  });
  
  describe('getTargetRowIds', () => {
    const ids = {
      selected: new Set(['1', '2']),
      filtered: ['1', '2', '3', '4', '5'],
      all: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']
    };
    
    test('returns selected IDs for selected scope', () => {
      const result = getTargetRowIds('selected', ids);
      expect(result.size).toBe(2);
      expect(result.has('1')).toBe(true);
      expect(result.has('2')).toBe(true);
    });
    
    test('returns filtered IDs for filtered scope', () => {
      const result = getTargetRowIds('filtered', ids);
      expect(result.size).toBe(5);
    });
    
    test('returns all IDs for all scope', () => {
      const result = getTargetRowIds('all', ids);
      expect(result.size).toBe(10);
    });
  });
  
  describe('generateReplacePreview', () => {
    const columns: ColumnModel[] = [
      { id: 'col1', name: 'status', displayName: 'Status', type: 'text' } as ColumnModel
    ];
    
    const rows: RowModel[] = [
      { id: '1', data: { col1: 'Draft' } },
      { id: '2', data: { col1: 'Active' } },
      { id: '3', data: { col1: 'Draft' } },
      { id: '4', data: { col1: 'Archived' } },
    ] as RowModel[];
    
    test('generates preview for matching rows', () => {
      const config: BulkReplaceConfig = {
        targetScope: 'all',
        columnId: 'col1',
        operationType: 'replace',
        findValue: 'Draft',
        replaceValue: 'Published',
        caseSensitive: false
      };
      
      const targetIds = new Set(['1', '2', '3', '4']);
      const { preview, totalChanges } = generateReplacePreview(config, rows, columns, targetIds, 10);
      
      expect(totalChanges).toBe(2);
      expect(preview.length).toBe(2);
      expect(preview[0].currentValue).toBe('Draft');
      expect(preview[0].newValue).toBe('Published');
    });
    
    test('respects limit', () => {
      const config: BulkReplaceConfig = {
        targetScope: 'all',
        columnId: 'col1',
        operationType: 'replace',
        findValue: 'Draft',
        replaceValue: 'Published',
        caseSensitive: false
      };
      
      const targetIds = new Set(['1', '2', '3', '4']);
      const { preview, totalChanges } = generateReplacePreview(config, rows, columns, targetIds, 1);
      
      expect(totalChanges).toBe(2);
      expect(preview.length).toBe(1);
    });
    
    test('only includes rows in target set', () => {
      const config: BulkReplaceConfig = {
        targetScope: 'selected',
        columnId: 'col1',
        operationType: 'replace',
        findValue: 'Draft',
        replaceValue: 'Published',
        caseSensitive: false
      };
      
      const targetIds = new Set(['1']); // Only first row
      const { preview, totalChanges } = generateReplacePreview(config, rows, columns, targetIds, 10);
      
      expect(totalChanges).toBe(1);
      expect(preview.length).toBe(1);
      expect(preview[0].rowId).toBe('1');
    });
    
    test('returns empty for non-existent column', () => {
      const config: BulkReplaceConfig = {
        targetScope: 'all',
        columnId: 'nonexistent',
        operationType: 'replace',
        findValue: 'Draft',
        replaceValue: 'Published',
        caseSensitive: false
      };
      
      const targetIds = new Set(['1', '2', '3', '4']);
      const { preview, totalChanges } = generateReplacePreview(config, rows, columns, targetIds, 10);
      
      expect(totalChanges).toBe(0);
      expect(preview.length).toBe(0);
    });
  });
  
  describe('prepareBatchUpdatePayload', () => {
    const columns: ColumnModel[] = [
      { id: 'col1', name: 'status', displayName: 'Status', type: 'text' } as ColumnModel
    ];
    
    const rows: RowModel[] = [
      { id: '1', data: { col1: 'Draft' } },
      { id: '2', data: { col1: 'Active' } },
      { id: '3', data: { col1: 'Draft' } },
    ] as RowModel[];
    
    test('prepares updates only for changed rows', () => {
      const config: BulkReplaceConfig = {
        targetScope: 'all',
        columnId: 'col1',
        operationType: 'replace',
        findValue: 'Draft',
        replaceValue: 'Published',
        caseSensitive: false
      };
      
      const targetIds = new Set(['1', '2', '3']);
      const updates = prepareBatchUpdatePayload(config, rows, columns, targetIds);
      
      expect(updates.length).toBe(2);
      expect(updates[0].rowId).toBe('1');
      expect(updates[0].data).toEqual({ col1: 'Published' });
      expect(updates[1].rowId).toBe('3');
      expect(updates[1].data).toEqual({ col1: 'Published' });
    });
    
    test('returns empty array for no changes', () => {
      const config: BulkReplaceConfig = {
        targetScope: 'all',
        columnId: 'col1',
        operationType: 'replace',
        findValue: 'NonExistent',
        replaceValue: 'Published',
        caseSensitive: false
      };
      
      const targetIds = new Set(['1', '2', '3']);
      const updates = prepareBatchUpdatePayload(config, rows, columns, targetIds);
      
      expect(updates.length).toBe(0);
    });
  });
});
