import { useEffect, useMemo, useRef } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/features/auth/store/authStore';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { useSpacesQuery } from '@/features/spaces/hooks/useSpacesQuery';
import { useSpacesStore, useSpaces, useActiveSpaceId } from '@/features/spaces/store/spacesStore';
import { AIChatProvider, AIChatPanel, useAIChat } from '@/features/ai-chat';
import { showToast } from '@/shared/hooks/useToast';
import { EmbedHeader } from './EmbedHeader';
import { getTicketEmbedConfig, isTicketEmbedRequest } from './ticketEmbedConfig';
import { useEmbedTicketAuth } from './useEmbedTicketAuth';

/**
 * ADR-176 — Universal embeddable AI chat overlay.
 *
 * A top-level route (outside the auth-guarded <Layout>) that renders the AI chat
 * as a full-viewport surface below a repurposed mobile header. Meant to be loaded
 * inside a floating-bubble iframe on third-party sites via /public/embed.js.
 *
 * The embedded panel reuses the existing AIChatPanel unchanged: in a narrow embed
 * frame (< 768px) the panel takes its mobile presentation (`fixed top-14 … bottom-0`,
 * full width) which slots directly beneath EmbedHeader (h-14). No panel fork.
 */

// Lives inside AIChatProvider — keep the panel open for the life of the embed.
// The in-panel close button is the sole dismiss affordance (the parent launcher
// hides while open, ADR-176 WS-B): on close we ask the host embed.js to collapse
// the drawer, then re-arm the panel so the iframe is ready (already-open) next
// launch. Target '*' is safe — the payload is a bare close flag and embed.js
// verifies the sender origin.
function EmbedChatSurface() {
  const { isOpen, openChat } = useAIChat();
  // Distinguish the ARMING mount (provider starts isOpen=false, never opened) from
  // a genuine user close (open → closed). Only the latter collapses the host drawer.
  // Without this guard the first mount posts `godcrm-embed:close` and the host
  // retracts the strip the user just opened — the "opens then closes on 1st click,
  // works on 2nd" race (the iframe survives, so the 2nd click finds it already open).
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (isOpen) {
      wasOpenRef.current = true;
      return;
    }
    if (wasOpenRef.current) {
      try {
        window.parent?.postMessage({ type: 'godcrm-embed:close' }, '*');
      } catch {
        /* no parent / cross-origin restriction — nothing to collapse */
      }
    }
    openChat(); // (re-)arm so the iframe is ready-open for the next launch
  }, [isOpen, openChat]);
  // Fill the frame in BOTH modes. The panel's desktop presentation is a
  // fixed-width `relative` drawer that block-flows to one side of the w-screen
  // root, leaving the other half empty — docking it left OR right just moves the
  // gap. `fillContainer` sets `width:100%` so both edges bind to the frame with
  // no dead space. In a real overlay the iframe is a narrow strip → the panel's
  // mobile presentation (`fixed left-0 right-0`) fills it and stays single-column;
  // in split / a wide standalone window the desktop panel fills and goes two-column
  // via its own `isWideMode`. Same expansion glue as the in-app panel — no fork.
  return <AIChatPanel fillContainer />;
}

function EmbedNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[var(--bg-primary)] p-6 text-center">
      <p className="text-sm text-[var(--text-secondary)]">{children}</p>
    </div>
  );
}

export function EmbedChatRoute() {
  const location = useLocation();
  if (isTicketEmbedRequest(location.pathname, location.search)) return <TicketEmbedChatRoute />;
  return <CookieEmbedChatRoute />;
}

function TicketEmbedChatRoute() {
  const location = useLocation();
  const { t } = useLanguage();
  const auth = useEmbedTicketAuth(getTicketEmbedConfig(location.search, location.pathname));
  const mode = useMemo(
    () => (new URLSearchParams(location.search).get('mode') === 'split' ? 'split' : 'overlay'),
    [location.search],
  );

  if (auth.status === 'error') {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[var(--bg-primary)] p-6 text-center">
        <div className="flex flex-col items-center gap-4">
          <p role="alert" className="text-sm text-[var(--text-secondary)]">{auth.error}</p>
          <button type="button" onClick={auth.retry} className="rounded-md border border-[var(--border-primary)] px-3 py-2 text-sm">
            {t('common.retryConnection')}
          </button>
        </div>
      </div>
    );
  }
  if (auth.status !== 'ready' || !auth.session) return <EmbedNotice>{t('common.loadingChat')}</EmbedNotice>;
  return <TicketEmbedWorkspace spaceId={auth.session.spaceId} mode={mode} />;
}

function TicketEmbedWorkspace({ spaceId, mode }: { spaceId: number; mode: 'overlay' | 'split' }) {
  const { t } = useLanguage();
  const { isLoading: spacesLoading, isError: spacesError } = useSpacesQuery();
  const spaces = useSpaces();
  const setActiveSpaceId = useSpacesStore((s) => s.setActiveSpaceId);
  const boundSpace = spaces.find((space) => space.id === spaceId);

  useEffect(() => {
    if (boundSpace) setActiveSpaceId(spaceId);
  }, [boundSpace, spaceId, setActiveSpaceId]);

  if (spacesLoading) return <EmbedNotice>{t('common.loadingChat')}</EmbedNotice>;
  if (spacesError || !boundSpace) {
    return <EmbedNotice>{t('common.ticketSpaceAccessDenied')}</EmbedNotice>;
  }

  return (
    <div className="h-screen w-screen overflow-hidden pt-14 bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <EmbedHeader spaces={[boundSpace]} activeSpaceId={spaceId} onSelectSpace={() => {}} mode={mode} />
      <AIChatProvider spaceId={spaceId}>
        <EmbedChatSurface />
      </AIChatProvider>
    </div>
  );
}

function CookieEmbedChatRoute() {
  const location = useLocation();
  const { user, initialized } = useAuthStore((s) => ({ user: s.user, initialized: s.initialized }));

  const { isLoading: spacesLoading, isError: spacesError } = useSpacesQuery();
  const spaces = useSpaces();
  const activeSpaceId = useActiveSpaceId();
  const setActiveSpaceId = useSpacesStore((s) => s.setActiveSpaceId);

  // Requested space from the iframe: ?space=<id> (embed.js forwards data-space).
  // "auto" / missing / non-numeric → no pin, fall back to persisted or first.
  const requestedSpace = useMemo(() => {
    const raw = new URLSearchParams(location.search).get('space');
    if (!raw || raw === 'auto') return null;
    const n = Number(raw);
    return Number.isInteger(n) ? n : null;
  }, [location.search]);

  // Host presentation forwarded by the loader: split reserves a page gutter;
  // overlay floats above it. Drives the header's overlay⇄split toggle.
  const mode = useMemo(
    () => (new URLSearchParams(location.search).get('mode') === 'split' ? 'split' : 'overlay'),
    [location.search],
  );

  // Resolve the active space once spaces are loaded (ADR-176 default #3: never a
  // white screen — a pinned-but-inaccessible space falls back to the first with a toast).
  const resolvedRef = useRef(false);
  useEffect(() => {
    if (spacesLoading || spaces.length === 0 || resolvedRef.current) return;
    resolvedRef.current = true;

    const accessible = (id: number | null) => id != null && spaces.some((s) => s.id === id);

    if (accessible(requestedSpace)) {
      setActiveSpaceId(requestedSpace);
    } else if (requestedSpace != null) {
      const fallback = spaces[0];
      setActiveSpaceId(fallback.id);
      showToast(`Спейс недоступен — открыт «${fallback.name}»`, 'info');
    } else if (!accessible(activeSpaceId)) {
      setActiveSpaceId(spaces[0].id);
    }
    // else: persisted activeSpaceId is valid — keep it.
  }, [spacesLoading, spaces, requestedSpace, activeSpaceId, setActiveSpaceId]);

  // Same-origin SSO: no session on the embed origin → hop to login, come back.
  if (initialized && !user) {
    return <Navigate to="/auth/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (!initialized || spacesLoading) return <EmbedNotice>Loading GOD CRM chat…</EmbedNotice>;
  if (spacesError) return <EmbedNotice>Couldn’t load your spaces. Check your connection and reload.</EmbedNotice>;

  const effectiveSpaceId: number | undefined =
    activeSpaceId != null && spaces.some((s) => s.id === activeSpaceId) ? activeSpaceId : undefined;

  return (
    // pt-14 clears the fixed 56px EmbedHeader so the panel's desktop (relative)
    // presentation — used in split mode once the tile is wider than 768px — starts
    // below the header instead of under it. The mobile presentation is `fixed
    // top-14` and ignores the padding, so overlay mode is unaffected.
    <div className="h-screen w-screen overflow-hidden pt-14 bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <EmbedHeader
        spaces={spaces}
        activeSpaceId={effectiveSpaceId ?? null}
        onSelectSpace={setActiveSpaceId}
        mode={mode}
      />
      {/* key remounts the chat contour on space switch — clean agents/conversations per space */}
      <AIChatProvider key={effectiveSpaceId ?? 'none'} spaceId={effectiveSpaceId}>
        {/* Panel fills the frame in both modes (no side-dock gap). Narrowness of an
            overlay strip comes from the host iframe width, not the panel. */}
        <EmbedChatSurface />
      </AIChatProvider>
    </div>
  );
}

export default EmbedChatRoute;
