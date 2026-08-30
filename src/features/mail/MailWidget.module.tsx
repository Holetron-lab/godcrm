/**
 * Mail module registrar (ADR-195 / MODULE-CONTRACT v1).
 *
 * Side-effect file: the core preset registry eager-imports every
 * `*.module.tsx` via `import.meta.glob`, which runs this registration. This is
 * the ONLY seam that plugs Mail into core — no static import, no `switch` case
 * in any core file. Delete `src/features/mail/` and core stops knowing `mail`.
 *
 * `registerWidgetPreset` comes from the dependency-free leaf
 * `presetRegistryStore`, never from `modulePresetRegistry` (which runs the
 * glob) — see the TDZ/circular-import regression documented in that leaf.
 */
import { Mail } from 'lucide-react';
import { registerWidgetPreset } from '@/features/widgets/registry/presetRegistryStore';
import { MailWidget } from './MailWidget';

registerWidgetPreset('mail', { component: MailWidget, icon: Mail });
