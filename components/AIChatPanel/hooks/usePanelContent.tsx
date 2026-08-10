/**
 * usePanelContent — Barrel re-export (ADR-119).
 * Panel renderers have been split into focused modules under ./usePanelContent/.
 */
export { renderPanelContentFromDeps } from './usePanelContent/index';
export type { PanelContentDeps } from './usePanelContent/PanelContentTypes';
