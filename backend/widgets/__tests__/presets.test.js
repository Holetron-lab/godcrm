/**
 * Widget Presets Tests
 * Testing preset registry functions
 */

import { describe, test, expect } from 'vitest';
import {
  WIDGET_PRESETS,
  getPreset,
  getAllPresets,
  getPresetsByCategory,
  isValidPreset,
  getCategories
} from '../presets.js';

describe('Widget Presets', () => {
  describe('WIDGET_PRESETS', () => {
    test('should have required presets', () => {
      expect(WIDGET_PRESETS).toHaveProperty('table_view');
      expect(WIDGET_PRESETS).toHaveProperty('project_stats');
      expect(WIDGET_PRESETS).toHaveProperty('quick_links');
      expect(WIDGET_PRESETS).toHaveProperty('chart_widget');
      expect(WIDGET_PRESETS).toHaveProperty('kanban_board');
    });

    test('each preset should have required fields', () => {
      Object.entries(WIDGET_PRESETS).forEach(([id, preset]) => {
        expect(preset).toHaveProperty('name');
        expect(preset).toHaveProperty('description');
        expect(preset).toHaveProperty('icon');
        expect(preset).toHaveProperty('category');
        expect(preset).toHaveProperty('default_config');
        expect(preset).toHaveProperty('component');
      });
    });

    test('table_view preset should have correct structure', () => {
      const preset = WIDGET_PRESETS.table_view;
      
      expect(preset.name).toBe('Table View');
      expect(preset.icon).toBe('📊');
      expect(preset.category).toBe('display');
      expect(preset.default_config).toHaveProperty('table_id');
      expect(preset.default_config).toHaveProperty('filters');
    });
  });

  describe('getPreset', () => {
    test('should return preset by name', () => {
      const preset = getPreset('table_view');
      
      expect(preset).toBeDefined();
      expect(preset.name).toBe('Table View');
    });

    test('should return null for non-existent preset', () => {
      const preset = getPreset('non_existent');
      
      expect(preset).toBeNull();
    });
  });

  describe('getAllPresets', () => {
    test('should return array of all presets', () => {
      const presets = getAllPresets();
      
      expect(Array.isArray(presets)).toBe(true);
      expect(presets.length).toBeGreaterThan(0);
    });

    test('each preset should have id field', () => {
      const presets = getAllPresets();
      
      presets.forEach(preset => {
        expect(preset).toHaveProperty('id');
        expect(preset).toHaveProperty('name');
      });
    });

    test('should include all required presets', () => {
      const presets = getAllPresets();
      const ids = presets.map(p => p.id);
      
      expect(ids).toContain('table_view');
      expect(ids).toContain('project_stats');
      expect(ids).toContain('quick_links');
      expect(ids).toContain('chart_widget');
      expect(ids).toContain('kanban_board');
    });
  });

  describe('getPresetsByCategory', () => {
    test('should return presets for valid category', () => {
      const displayPresets = getPresetsByCategory('display');
      
      expect(Array.isArray(displayPresets)).toBe(true);
      expect(displayPresets.length).toBeGreaterThan(0);
      expect(displayPresets[0].category).toBe('display');
    });

    test('should return empty array for non-existent category', () => {
      const presets = getPresetsByCategory('non_existent');
      
      expect(presets).toEqual([]);
    });

    test('should return analytics presets', () => {
      const analyticsPresets = getPresetsByCategory('analytics');
      
      expect(analyticsPresets.length).toBeGreaterThan(0);
      analyticsPresets.forEach(preset => {
        expect(preset.category).toBe('analytics');
      });
    });
  });

  describe('isValidPreset', () => {
    test('should return true for valid preset', () => {
      expect(isValidPreset('table_view')).toBe(true);
      expect(isValidPreset('project_stats')).toBe(true);
      expect(isValidPreset('chart_widget')).toBe(true);
    });

    test('should return false for invalid preset', () => {
      expect(isValidPreset('non_existent')).toBe(false);
      expect(isValidPreset('')).toBe(false);
      expect(isValidPreset(null)).toBe(false);
    });
  });

  describe('getCategories', () => {
    test('should return array of unique categories', () => {
      const categories = getCategories();
      
      expect(Array.isArray(categories)).toBe(true);
      expect(categories.length).toBeGreaterThan(0);
    });

    test('should include expected categories', () => {
      const categories = getCategories();
      
      // Actual categories from shared/widget-presets.json
      expect(categories).toContain('analytics');
      expect(categories).toContain('display');
      expect(categories).toContain('documents');
    });

    test('categories should be unique', () => {
      const categories = getCategories();
      const uniqueCategories = [...new Set(categories)];
      
      expect(categories.length).toBe(uniqueCategories.length);
    });

    test('categories should be sorted', () => {
      const categories = getCategories();
      const sorted = [...categories].sort();
      
      expect(categories).toEqual(sorted);
    });
  });
});
