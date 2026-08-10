import { Columns2, PanelRight } from 'lucide-react';
import { ThemeToggle } from '@/shared/components/layout/ThemeToggle';
import type { SpaceModel } from '@/features/spaces/types/space.types';
import { SpaceListPopover } from './SpaceListPopover';

export type EmbedMode = 'overlay' | 'split';

export interface EmbedHeaderProps {
  spaces: SpaceModel[];
  activeSpaceId: number | null;
  onSelectSpace: (spaceId: number) => void;
  /** Current host presentation — drives the overlay⇄split toggle. */
  mode: EmbedMode;
}

/**
 * Ask the host page (embed.js overlay OR split.html shell) to switch presentation.
 * The chat lives in an iframe on edit.godcrm.ai; the host is on design-test — it
 * verifies our origin before acting, so '*' target is safe. embed.js handles
 * mode:'split' (→ /split); split.html handles mode:'overlay' (→ / with overlay).
 */
function requestMode(target: EmbedMode) {
  try {
    window.parent?.postMessage({ type: 'godcrm-embed:mode', mode: target }, '*');
  } catch {
    /* no parent / cross-origin — nothing to switch */
  }
}

/**
 * EmbedHeader (ADR-176) — the repurposed mobile header for the embeddable chat
 * overlay. It is the 56px (h-14) top bar the mobile AIChatPanel expects above
 * itself (`fixed top-14 …`). Keeps the space breadcrumb (now a switcher) and
 * ThemeToggle; drops FullscreenToggle (embeds control their own frame) and the
 * ⋮ HeaderActionsMenu.
 *
 * ponytail: HeaderActionsMenu (⋮) intentionally omitted — it couples the entire
 * Layout modal stack (create table/project/widget, data-source wizard, edit/delete
 * space…) which has no meaning inside a chat-only embed. If a concrete embed action
 * is ever needed, add a slim embed-scoped menu rather than dragging in LayoutModals.
 */
export function EmbedHeader({ spaces, activeSpaceId, onSelectSpace, mode }: EmbedHeaderProps) {
  const toSplit = mode === 'overlay';
  return (
    <header className="fixed top-0 left-0 right-0 h-14 z-50 flex items-center gap-2 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3">
      <svg
        width="20"
        height="20"
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="flex-shrink-0 drop-shadow-sm"
        aria-hidden="true"
      >
        <ellipse cx="32" cy="32" rx="28" ry="12" fill="var(--color-primary-400)" opacity="0.4" />
        <ellipse cx="32" cy="32" rx="22" ry="9" fill="var(--color-primary-500)" opacity="0.6" />
        <ellipse cx="32" cy="32" rx="16" ry="6" fill="var(--color-primary-400)" opacity="0.8" />
        <ellipse cx="32" cy="32" rx="10" ry="3.5" fill="var(--color-primary-300)" />
      </svg>
      <span className="flex-shrink-0 text-sm text-[var(--text-tertiary)]">/</span>

      <div className="flex-1 min-w-0">
        <SpaceListPopover spaces={spaces} activeSpaceId={activeSpaceId} onSelect={onSelectSpace} />
      </div>

      <ThemeToggle />

      <button
        type="button"
        onClick={() => requestMode(toSplit ? 'split' : 'overlay')}
        className="p-2 rounded-md hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] transition-colors"
        title={toSplit ? 'Разделить экран (split)' : 'Наложить поверх (overlay)'}
        aria-label={toSplit ? 'Switch to split view' : 'Switch to overlay view'}
      >
        {toSplit ? <Columns2 className="w-4 h-4" /> : <PanelRight className="w-4 h-4" />}
      </button>
    </header>
  );
}
