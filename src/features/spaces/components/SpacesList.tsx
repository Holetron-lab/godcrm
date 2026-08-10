import { useState, useCallback, useMemo, useEffect, useLayoutEffect, type CSSProperties } from 'react';
import { logger } from '@/shared/utils/logger';
import { useSpacesQuery } from '../hooks/useSpacesQuery';
import { useSpacesOrder } from '../hooks/useSpacesOrder';
import { useSpacesStore, useActiveSpaceId } from '../store/spacesStore';
import { SpaceCard } from './SpaceCard';
import { SpaceCardSettingsModal } from './SpaceCardSettingsModal';
import { DeleteSpaceModal } from './DeleteSpaceModal';
import type { SpaceModel, SpaceType } from '../types/space.types';
import type { SpaceCardSize, SpaceCardSettings, SpaceLayoutConfig } from '../types/spaceCardSettings.types';

interface SpacesListProps {
  onSpaceClick?: (space: SpaceModel) => void;
  searchQuery?: string;
  maxCols?: number;
  typeFilter?: SpaceType | 'all';
  userFilter?: number | 'all';
}

const ROW_HEIGHT_PX = 140;
const GAP_PX = 16;
// Viewport width below which we collapse to the mobile vertical stack
// (auto-height cards, single column). Independent of container width so a
// narrow desktop panel does NOT trigger mobile mode — only an actual
// small-viewport device does.
const MOBILE_VW_PX = 640;
// Comfortable card slot width. Used only to decide step-down threshold:
// if the container can fit 4 cards at this width, we respect the user's
// `maxCols`. Below that, we step down through 3 → 2 → 1.
const TARGET_SLOT_PX = 220;
// Width below which we drop out of "respect maxCols" and start the
// step-down sequence (3 → 2 → 1).
const FOUR_COL_MIN_PX = 4 * TARGET_SLOT_PX + 3 * GAP_PX;

const LAYOUT_STORAGE_KEY = 'god-crm-spaces-layout';

const loadLayoutFromStorage = (): SpaceLayoutConfig => {
  try {
    const stored = localStorage.getItem(LAYOUT_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
};

const saveLayoutToStorage = (layout: SpaceLayoutConfig) => {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  } catch (e) {
    logger.error('Failed to save layout to localStorage:', e);
  }
};

type LayoutItem = { space: SpaceModel; span: number };

const sizeToSlots = (size?: SpaceCardSize): number => {
  if (size === 'full') return 4;
  if (size === 'threeQuarter') return 3;
  if (size === 'half') return 2;
  return 1;
};

// Pack cards into rows of N slots using each card's preferred size.
// Each card prefers 1..4 slots (quarter/half/3-4/full). Cards that don't
// fit the row tail wrap to the next row, and leftover slots in the row
// are distributed back across the trailing cards round-robin from tail
// to head, so every row (including the last) is fully filled.
const packRows = (
  cards: SpaceModel[],
  layoutConfig: SpaceLayoutConfig,
  N: number,
): LayoutItem[] => {
  const items: LayoutItem[] = [];
  const rowBoundaries: { startIdx: number; endIdx: number; used: number }[] = [];
  let rowStart = 0;
  let used = 0;

  for (const space of cards) {
    const preferred = sizeToSlots(layoutConfig[space.id]?.size);
    const effective = Math.max(1, Math.min(preferred, N));
    if (used + effective > N) {
      rowBoundaries.push({ startIdx: rowStart, endIdx: items.length - 1, used });
      rowStart = items.length;
      used = 0;
    }
    items.push({ space, span: effective });
    used += effective;
  }
  if (items.length > 0) {
    rowBoundaries.push({ startIdx: rowStart, endIdx: items.length - 1, used });
  }

  for (const row of rowBoundaries) {
    let leftover = N - row.used;
    if (leftover <= 0) continue;
    let idx = row.endIdx;
    while (leftover > 0) {
      items[idx].span += 1;
      leftover--;
      idx = idx > row.startIdx ? idx - 1 : row.endIdx;
    }
  }

  return items;
};

export const SpacesList = ({ onSpaceClick, searchQuery = '', maxCols = 6, typeFilter = 'all', userFilter = 'all' }: SpacesListProps) => {
  const { data: spaces, isLoading, error } = useSpacesQuery();
  const { getSpaceOrder } = useSpacesOrder();
  const activeSpaceId = useActiveSpaceId();
  const setActiveSpaceId = useSpacesStore(state => state.setActiveSpaceId);

  const [layoutConfig, setLayoutConfig] = useState<SpaceLayoutConfig>(loadLayoutFromStorage);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [selectedSpaceForSettings, setSelectedSpaceForSettings] = useState<SpaceModel | null>(null);
  const [spaceToDelete, setSpaceToDelete] = useState<SpaceModel | null>(null);

  // Mobile mode = viewport-based, NOT container-based. A narrow desktop
  // panel (chat open, sidebar) keeps the desktop grid; only an actual
  // small-viewport device flips into the auto-height vertical stack.
  const [vw, setVw] = useState<number>(() =>
    typeof window === 'undefined' ? 1024 : window.innerWidth,
  );
  useEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const isMobile = vw < MOBILE_VW_PX;

  // Container width drives desktop step-down. Measured from the actual
  // grid wrapper (NOT the viewport) so the layout responds to chat /
  // sidebar resize, not just screen size. Callback ref so the effect
  // re-runs when the element actually mounts (the loading skeleton
  // renders first and the wrapper appears later — a plain useRef +
  // useLayoutEffect([]) misses that mount).
  const [wrapperEl, setWrapperEl] = useState<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  useLayoutEffect(() => {
    if (!wrapperEl) return;
    const measure = () => {
      const w = wrapperEl.getBoundingClientRect().width;
      if (w > 0) setContainerWidth(Math.round(w));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrapperEl);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [wrapperEl]);

  // Desktop columns:
  //   - mobile viewport → N=1 (vertical stack, auto-height — handled below)
  //   - container ≥ FOUR_COL_MIN_PX → respect user's `maxCols`
  //   - container narrower → step down 3 → 2 → 1 based on what actually fits
  const N = useMemo(() => {
    if (isMobile) return 1;
    if (containerWidth <= 0) return maxCols;
    if (containerWidth >= FOUR_COL_MIN_PX) return maxCols;
    const fits = Math.floor((containerWidth + GAP_PX) / (TARGET_SLOT_PX + GAP_PX));
    return Math.max(1, Math.min(3, fits));
  }, [isMobile, containerWidth, maxCols]);

  const handleSpaceClick = (space: SpaceModel) => {
    setActiveSpaceId(space.id);
    onSpaceClick?.(space);
  };

  const handleSizeChange = useCallback((spaceId: number, size: SpaceCardSize) => {
    setLayoutConfig(prev => {
      const newConfig = {
        ...prev,
        [spaceId]: {
          ...prev[spaceId],
          size,
          showProjects: prev[spaceId]?.showProjects ?? true,
          showDashboards: prev[spaceId]?.showDashboards ?? true,
          showUsers: prev[spaceId]?.showUsers ?? false,
          showDescription: prev[spaceId]?.showDescription ?? true,
          order: prev[spaceId]?.order ?? 0
        }
      };
      saveLayoutToStorage(newConfig);
      return newConfig;
    });
  }, []);

  const handleSettingsClick = useCallback((space: SpaceModel) => {
    setSelectedSpaceForSettings(space);
    setSettingsModalOpen(true);
  }, []);

  const handleSettingsSave = useCallback((spaceId: number, settings: SpaceCardSettings) => {
    setLayoutConfig(prev => {
      const newConfig = {
        ...prev,
        [spaceId]: settings
      };
      saveLayoutToStorage(newConfig);
      return newConfig;
    });
    setSettingsModalOpen(false);
    setSelectedSpaceForSettings(null);
  }, []);

  const handleDelete = useCallback((space: SpaceModel) => {
    setSpaceToDelete(space);
  }, []);

  const handleDuplicate = useCallback((space: SpaceModel) => {
    logger.debug('Duplicate space:', space.id);
  }, []);

  const handleExport = useCallback((space: SpaceModel) => {
    logger.debug('Export space:', space.id);
  }, []);

  const getCardSettings = (spaceId: number): SpaceCardSettings | undefined => {
    return layoutConfig[spaceId];
  };

  const sortedSpaces = useMemo(() => {
    if (!spaces) return undefined;
    const q = searchQuery.trim().toLowerCase();
    const filtered = spaces.filter((s) => {
      if (q && !(s.name || '').toLowerCase().includes(q)) return false;
      if (typeFilter !== 'all' && s.type !== typeFilter) return false;
      if (userFilter !== 'all') {
        // Match owner OR any member (any role) by system user id.
        const isOwner = s.owner_id === userFilter;
        const isMember = (s.users || []).some((u) => u.system_user_id === userFilter);
        if (!isOwner && !isMember) return false;
      }
      return true;
    });
    return filtered.slice().sort((a, b) => {
      const orderA = getSpaceOrder(a.id, a.type);
      const orderB = getSpaceOrder(b.id, b.type);
      return orderA - orderB;
    });
  }, [spaces, searchQuery, typeFilter, userFilter, getSpaceOrder]);

  const cardLayout = useMemo<LayoutItem[]>(() => {
    if (!sortedSpaces) return [];
    return packRows(sortedSpaces, layoutConfig, N);
  }, [sortedSpaces, layoutConfig, N]);

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-48 animate-pulse rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)]"
          >
            <div className="p-5">
              <div className="mb-3 flex items-center gap-3">
                <div className="h-12 w-12 rounded-lg bg-[var(--bg-tertiary)]" />
                <div className="flex-1 space-y-2">
                  <div className="h-5 w-32 rounded bg-[var(--bg-tertiary)]" />
                  <div className="h-4 w-20 rounded bg-[var(--bg-tertiary)]" />
                </div>
              </div>
              <div className="mb-3 space-y-2">
                <div className="h-4 w-full rounded bg-[var(--bg-tertiary)]" />
                <div className="h-4 w-3/4 rounded bg-[var(--bg-tertiary)]" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 dark:border-red-900 dark:bg-red-950/30">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/50">
            <svg className="h-6 w-6 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h3 className="mb-1 text-lg font-semibold text-red-900 dark:text-red-200">
              Failed to Load Spaces
            </h3>
            <p className="text-sm text-red-700 dark:text-red-300">
              {error.toString()}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!spaces || spaces.length === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed border-[var(--border-primary)] bg-[var(--bg-secondary)] p-12 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--bg-tertiary)]">
          <svg className="h-8 w-8 text-[var(--text-tertiary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
          </svg>
        </div>
        <h3 className="mb-2 text-lg font-semibold text-[var(--text-primary)]">
          No Spaces Yet
        </h3>
        <p className="text-sm text-[var(--text-secondary)]">
          Create your first workspace to get started with GOD CRM
        </p>
      </div>
    );
  }

  // CSS Grid with N equal tracks. Each card spans K columns via `grid-column`.
  // `minmax(0, 1fr)` is critical — it lets columns shrink so card content
  // (long descriptions, project lists) cannot push tracks wider than 1/N.
  // Width = 100% of the page container (parent SpacesPage caps width via
  // `pageMaxWidthPx`), so resizing happens at the page level.
  const gridStyle: CSSProperties = isMobile
    ? {
        gridTemplateColumns: '1fr',
        gridAutoRows: 'auto',
        gap: `${GAP_PX}px`,
        width: '100%',
      }
    : {
        gridTemplateColumns: `repeat(${N}, minmax(0, 1fr))`,
        gridAutoRows: `${ROW_HEIGHT_PX}px`,
        gap: `${GAP_PX}px`,
        width: '100%',
      };

  return (
    <>
      <div ref={setWrapperEl} className="w-full">
        <div
          className="grid"
          style={gridStyle}
          data-spaces-debug={`N=${N} cw=${containerWidth}`}
        >
          {cardLayout.map(({ space, span }) => {
            const settings = getCardSettings(space.id);
            const rowSpan = !isMobile && settings?.height === 'double' ? 2 : 1;
            const itemStyle: CSSProperties = isMobile
              ? { width: '100%' }
              : { gridColumn: `span ${span}`, gridRow: `span ${rowSpan}` };
            return (
              <div
                key={space.id}
                className="min-w-0 min-h-0"
                style={itemStyle}
              >
                <SpaceCard
                  space={space}
                  isActive={space.id === activeSpaceId}
                  onClick={handleSpaceClick}
                  cardSettings={settings}
                  onSettingsClick={handleSettingsClick}
                  onSizeChange={handleSizeChange}
                  onDelete={handleDelete}
                  onDuplicate={handleDuplicate}
                  onExport={handleExport}
                  effectiveSlots={span}
                  mobileMode={isMobile}
                  rowHeightPx={ROW_HEIGHT_PX}
                />
              </div>
            );
          })}
        </div>
      </div>

      {selectedSpaceForSettings && (
        <SpaceCardSettingsModal
          open={settingsModalOpen}
          onOpenChange={setSettingsModalOpen}
          space={selectedSpaceForSettings}
          currentSettings={getCardSettings(selectedSpaceForSettings.id)}
          onSave={handleSettingsSave}
        />
      )}

      {spaceToDelete && (
        <DeleteSpaceModal
          open={!!spaceToDelete}
          onOpenChange={(open) => { if (!open) setSpaceToDelete(null); }}
          space={{ id: spaceToDelete.id, name: spaceToDelete.name }}
        />
      )}
    </>
  );
};
