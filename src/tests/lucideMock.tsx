// lucideMock — a lucide-react module mock that cannot go stale.
//
// Ten suites used to hand-list every icon they expected a component to render:
//
//   vi.mock('lucide-react', () => ({
//     Bot: (p) => <div data-testid="bot-icon" {...p} />,
//     ... 24 more ...
//   }));
//
// The list is a whitelist, so the day a component renders one more icon the
// mock throws `No "Shield" export is defined on the "lucide-react" mock` from
// inside render() — and every single test in that file fails at once, with a
// message that points at the icon rather than at the change. That is where 40
// of the 224 recorded failures came from: SettingsPanel gained <Shield/> and
// <Bell/>, ChatHeader and ChatTurn gained theirs.
//
// This returns a Proxy instead: any icon name resolves to a stub, so adding an
// icon to a component can never break a test again. The `data-testid` keeps the
// convention the suites already query by — PascalCase → kebab-case + `-icon`
// (MoreVertical → more-vertical-icon) — with ALIASES for the handful the suites
// named differently, so no existing assertion changes meaning.

import * as React from 'react';

type IconProps = { className?: string; [key: string]: unknown };

/** `MoreVertical` → `more-vertical`; digits stay attached (`Link2` → `link2`). */
const kebab = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase();

/** Names the suites query by something other than the derived kebab-case. */
const ALIASES: Record<string, string> = {
  Loader2: 'loader-icon',
  Trash2: 'trash-icon',
  CheckCircle2: 'check-circle-icon',
  SlidersHorizontal: 'sliders-icon'
};

const stub = (testId: string) => {
  const Icon = ({ className, ...props }: IconProps) =>
    React.createElement('div', { className, 'data-testid': testId, ...props });
  Icon.displayName = testId;
  return Icon;
};

/**
 * Use as the whole factory:
 *
 *   vi.mock('lucide-react', async () =>
 *     (await import('@/tests/lucideMock')).lucideMock());
 *
 * The dynamic import is required: `vi.mock` factories are hoisted above the
 * file's imports, so a top-level `import { lucideMock }` would be in the
 * temporal dead zone when the factory runs.
 *
 * @param overrides per-suite testId overrides, e.g. `{ ChevronRight: 'chevron-icon' }`
 *   — InboxPanel queries that one without the direction, ChatTurn queries
 *   `chevron-right-icon`, and both are load-bearing.
 */
export function lucideMock(overrides: Record<string, string> = {}) {
  const cache = new Map<string, ReturnType<typeof stub>>();

  return new Proxy(
    {},
    {
      get(_target, prop) {
        // A module namespace gets probed for these before it is ever read as
        // icons; answering with a component would break interop and await.
        if (typeof prop !== 'string') return undefined;
        if (prop === '__esModule') return true;
        if (prop === 'then') return undefined;

        if (!cache.has(prop)) {
          cache.set(prop, stub(overrides[prop] ?? ALIASES[prop] ?? `${kebab(prop)}-icon`));
        }
        return cache.get(prop);
      },
      // `import * as x` and spreads need the namespace to look enumerable.
      has: () => true,
      getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true })
    }
  );
}

export default lucideMock;
