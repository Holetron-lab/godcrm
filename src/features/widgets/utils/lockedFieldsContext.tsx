/**
 * ADR-0005 C-4 — Locked-fields context for widget-atom settings rails.
 *
 * When a widget is rendered as an atom inside a document, the document
 * author's `settings_override` (atoms_v2.settings_override JSON) MAY pin
 * specific config fields. Any settings panel that opens from such a
 * widget-atom must:
 *   1. Show a 🔒 next to the locked field's label.
 *   2. Disable the corresponding input.
 *   3. Hint the user (tooltip): "Заблокировано автором документа".
 *
 * Settings panels read this context via `useLockedFields()`. Outside a
 * widget-atom (e.g. global widget settings opened from the dashboard),
 * the provider is absent — the hook returns a no-op default that treats
 * everything as unlocked, so existing call-sites are unaffected.
 *
 * Locked-path semantics live in `./mergeWidgetConfig.ts`
 * (`getLockedPaths`, `isFieldLocked`). The provider here just exposes
 * those helpers as a React context so deeply-nested per-preset settings
 * components don't need explicit prop drilling.
 */

import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { getLockedPaths, isFieldLocked } from './mergeWidgetConfig';

export const LOCKED_TOOLTIP_RU = 'Заблокировано автором документа';

interface LockedFieldsValue {
  /** All dot-paths present in settings_override (leaves + their ancestors via isLocked). */
  lockedPaths: string[];
  /** True if the override object exists and has at least one path. */
  hasAnyLock: boolean;
  /** Convenience checker — accepts a dot-path like "filter" or "filter.column". */
  isLocked: (field: string) => boolean;
}

const DEFAULT_VALUE: LockedFieldsValue = {
  lockedPaths: [],
  hasAnyLock: false,
  isLocked: () => false,
};

const LockedFieldsContext = createContext<LockedFieldsValue>(DEFAULT_VALUE);

export interface LockedFieldsProviderProps {
  /**
   * The atom-level `settings_override` JSON (or its already-parsed object).
   * `null`/`undefined` ⇒ provider acts as a no-op (nothing is locked).
   */
  settingsOverride?: Record<string, unknown> | string | null | undefined;
  children: ReactNode;
}

function parseOverride(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return null;
}

export function LockedFieldsProvider({ settingsOverride, children }: LockedFieldsProviderProps) {
  const value = useMemo<LockedFieldsValue>(() => {
    const parsed = parseOverride(settingsOverride);
    if (!parsed) return DEFAULT_VALUE;
    const lockedPaths = getLockedPaths(parsed);
    if (lockedPaths.length === 0) return DEFAULT_VALUE;
    return {
      lockedPaths,
      hasAnyLock: true,
      isLocked: (field: string) => isFieldLocked(lockedPaths, field),
    };
  }, [settingsOverride]);

  return (
    <LockedFieldsContext.Provider value={value}>
      {children}
    </LockedFieldsContext.Provider>
  );
}

export function useLockedFields(): LockedFieldsValue {
  return useContext(LockedFieldsContext);
}
