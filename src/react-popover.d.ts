// Popover API attributes (HTML `popover`, `popovertarget`, `popovertargetaction`).
// The React 19 runtime forwards these to the DOM, but the pinned `@types/react@18`
// predates them — augment the JSX attribute interfaces so consumers of the popover
// API stay strictly typed (no `any`). Dedicated module file so the augmentation is
// a proper `declare module` merge (globals.d.ts is script-mode by design).
import 'react';

declare module 'react' {
  interface HTMLAttributes<T> {
    popover?: '' | 'auto' | 'manual';
  }
  interface ButtonHTMLAttributes<T> {
    popoverTarget?: string;
    popoverTargetAction?: 'show' | 'hide' | 'toggle';
  }
}
