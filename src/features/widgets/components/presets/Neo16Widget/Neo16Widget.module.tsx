/**
 * Neo16 module registrar (doc 239900 W1 / MODULE-CONTRACT v1).
 *
 * Side-effect file: the core preset registry eager-imports every
 * `*.module.tsx` via `import.meta.glob`, which runs this registration. This is
 * the ONLY seam that plugs Neo16 into core — no static import, no `switch` case
 * in any core file. Delete this directory and core stops knowing `16neo`.
 *
 * The preset key stays `16neo` so widget rows created before the move keep
 * rendering and their `/widgets/:id` URLs keep resolving.
 *
 * `registerWidgetPreset` comes from the dependency-free leaf
 * `presetRegistryStore`, never from `modulePresetRegistry` (which runs the glob).
 */
import { Gamepad2 } from 'lucide-react';
import { registerWidgetPreset } from '../../../registry/presetRegistryStore';
import { Neo16ModuleWidget } from './town/TownWidget';

registerWidgetPreset('16neo', { component: Neo16ModuleWidget, icon: Gamepad2 });
