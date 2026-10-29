// Neo16 W1 slice 2 — backend half of the preset seam (MODULE-CONTRACT v1, seam #3).
// The `16neo` preset must come from this module's manifest + fragment, so the
// blueprint installer's isValidPreset check passes without a core JSON entry.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { modulePresetFragments, readModuleManifests, REPO_ROOT } from '../../loader.js';
import { isValidPreset, getPreset } from '../../../widgets/presets.js';
import { NEO16_BLUEPRINT } from '../blueprint.js';

const MODULE_DIR = path.resolve(REPO_ROOT, 'backend/modules/neo16');

describe('neo16 module manifest', () => {
  const manifest = yaml.load(readFileSync(path.join(MODULE_DIR, 'module.manifest.yaml'), 'utf8'));

  it('is discovered by the loader; contributes the authenticated /api/v3/neo16 router and no migrations', async () => {
    const found = readModuleManifests().find((m) => m.id === 'neo16');
    expect(found).toBeDefined();
    expect(manifest.backend.routes).toEqual([
      { mount: '/api/v3/neo16', router: 'backend/modules/neo16/routes.js', auth: true },
    ]);
    expect(manifest.backend?.migrations).toBeUndefined();
    const mod = await import(path.resolve(REPO_ROOT, manifest.backend.routes[0].router));
    expect(typeof mod.default).toBe('function'); // what mountModuleRoutes requires
  });

  it('names the preset the blueprint widget uses and every owned path exists', () => {
    expect(manifest.frontend.preset_key).toBe(NEO16_BLUEPRINT.widgets[0].preset_name);
    for (const rel of [manifest.frontend.preset_entry, manifest.frontend.preset_fragment, ...manifest.owns_dirs]) {
      expect(existsSync(path.resolve(REPO_ROOT, rel)), rel).toBe(true);
    }
  });

  it('supplies 16neo through the fragment, not shared/widget-presets.json', () => {
    const core = JSON.parse(readFileSync(path.resolve(REPO_ROOT, 'shared/widget-presets.json'), 'utf8'));
    expect(core).not.toHaveProperty('16neo');
    expect(modulePresetFragments()['16neo']).toMatchObject({ id: '16neo' });
    expect(isValidPreset('16neo')).toBe(true);
    expect(getPreset('16neo').icon).toBe('🎮');
  });
});
