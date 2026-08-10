/**
 * Widget Presets Registry - v0.003.002
 * Core presets come from shared widget-presets.json; autonomous modules
 * (MODULE-CONTRACT v1, ADR-165-P) contribute their own presets via
 * `frontend.preset_fragment` in their manifest, merged in at load time — the
 * backend half of seam #3, mirroring the frontend's fragment glob-merge.
 *
 * To add a core widget:
 * 1. Edit /shared/widget-presets.json
 * 2. Both frontend and backend will use the new preset automatically
 *
 * A module widget lives ONLY in its module's presets.fragment.json — remove the
 * module dirs and the preset disappears from both trees, no core edit.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import { modulePresetFragments } from '../modules/loader.js';

// Load presets from shared JSON file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const presetsPath = join(__dirname, '../../shared/widget-presets.json');

let WIDGET_PRESETS = {};

try {
  const presetsJson = readFileSync(presetsPath, 'utf-8');
  // Core presets from shared JSON, then module-owned preset fragments layered on
  // top (present modules only). Fragments share the shared-JSON entry shape, so the
  // transform loop below handles them identically.
  const presetConfigs = { ...JSON.parse(presetsJson), ...modulePresetFragments() };

  // Transform to backend format (add default_config, icon → emoji mapping)
  for (const [id, config] of Object.entries(presetConfigs)) {
    WIDGET_PRESETS[id] = {
      name: config.name,
      description: config.description,
      icon: config.emoji,
      category: config.category,
      default_config: {
        table_id: null,
        filters: [],
        ...(config.requiredColumns?.length > 0 ? { column_mapping: {} } : {})
      },
      component: config.id.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('') + 'Widget'
    };
  }
} catch (error) {
  logger.error({ err: error }, 'Failed to load widget presets from JSON');
  // Fallback to minimal presets
  WIDGET_PRESETS = {
    table_view: {
      name: 'Table View',
      description: 'Display filtered table data',
      icon: '📊',
      category: 'data',
      default_config: { table_id: null },
      component: 'TableViewWidget'
    }
  };
}

export { WIDGET_PRESETS };

/**
 * Get preset by name
 * @param {string} presetName - Preset name (e.g., 'table_view')
 * @returns {object|null} Preset configuration or null
 */
export function getPreset(presetName) {
  return WIDGET_PRESETS[presetName] || null;
}

/**
 * Get all presets as array
 * @returns {array} Array of presets with id
 */
export function getAllPresets() {
  return Object.entries(WIDGET_PRESETS).map(([id, preset]) => ({
    id,
    ...preset
  }));
}

/**
 * Get presets by category
 * @param {string} category - Category name
 * @returns {array} Array of presets in category
 */
export function getPresetsByCategory(category) {
  return Object.entries(WIDGET_PRESETS)
    .filter(([_, preset]) => preset.category === category)
    .map(([id, preset]) => ({ id, ...preset }));
}

/**
 * Validate preset name
 * @param {string} presetName - Preset name
 * @returns {boolean} True if preset exists
 */
export function isValidPreset(presetName) {
  return presetName in WIDGET_PRESETS;
}

/**
 * Get preset categories
 * @returns {array} Array of unique categories
 */
export function getCategories() {
  const categories = new Set();
  Object.values(WIDGET_PRESETS).forEach(preset => {
    categories.add(preset.category);
  });
  return Array.from(categories).sort();
}

export default WIDGET_PRESETS;
