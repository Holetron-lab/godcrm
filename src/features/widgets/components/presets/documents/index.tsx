/**
 * Documents Widget v4 - Modular component structure
 *
 * Main index file that composes all subcomponents
 * Each document is stored as a separate table with level-based hierarchy.
 * Supports: h1, h2, h3, text, divider levels
 *
 * ADR-105 AC10: Mobile-responsive layout with breakpoints
 * - Desktop (>1024px): Current layout with sidebar
 * - Tablet (768-1024px): Collapsible sidebar, wider content area
 * - Mobile (<768px): Full-screen document, bottom navigation, overlay sidebar
 *
 * @see TASK-008-DOCUMENTS-V4-TABLES.md
 */

import { cn } from '@/shared/utils/cn';
import type { PresetWidgetProps, Widget } from '../../types/widget.types';
import type { DocumentsWidgetConfig } from '../../types/documents.types';

// Import all subcomponents
import { DocumentsProvider, useDocumentsContext } from './DocumentsContext';
import { DocumentsToolbar } from './DocumentsToolbar';
import { DocumentsSidebar } from './DocumentsSidebar';
import { DocumentsContent } from './DocumentsContent';
import { DocumentsImportPreview } from './DocumentsImportPreview';
import { DocumentsRightPanel } from './DocumentsRightPanel';
import { DocumentsModals } from './DocumentsModals';
import { MobileBottomNav } from './MobileBottomNav';

/**
 * Internal component that uses the context
 */
function DocumentsInternal() {
  const ctx = useDocumentsContext();

  // Mirror table/kanban widgets: the dashboard edit-mode "filters" toggle flips
  // `config.show_filters`. When the owner turns it off, hide the toolbar so the
  // embedded documents widget reads as a clean panel (Task #2).
  const showToolbar = (ctx.config as { show_filters?: boolean } | undefined)?.show_filters !== false;

  return (
    <div className="h-full flex flex-col bg-[var(--bg-primary)] overflow-hidden relative">
      {/* Toolbar — hidden in singleDocFocus mode (the public full-page viewer
          provides its own chrome via PublicLayout; toolbar buttons are
          authoring-centric and would only distract) and when the dashboard
          owner toggled filters off (parity with table/kanban). */}
      {!ctx.singleDocFocus && showToolbar && <DocumentsToolbar />}

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Mobile sidebar overlay backdrop */}
        {ctx.isMobile && ctx.mobileSidebarOpen && (
          <div
            className="absolute inset-0 bg-black/50 z-10 lg:hidden"
            onClick={() => ctx.setMobileSidebarOpen(false)}
          />
        )}

        {/* Left Sidebar - on mobile rendered as overlay.
            Hidden in singleDocFocus mode (ADR-0060 P6/F public full-page
            viewer locks to a single resolved doc — no sibling navigation). */}
        {!ctx.singleDocFocus && <DocumentsSidebar />}

        {/* Main content / Import preview */}
        {ctx.isCreatingMode ? (
          <DocumentsImportPreview />
        ) : (
          <DocumentsContent />
        )}

        {/* Right Panel — also hidden in singleDocFocus mode (it's mostly
            authoring affordances: settings, atoms, drafts). */}
        {!ctx.singleDocFocus && <DocumentsRightPanel />}
      </div>

      {/* Mobile bottom navigation - only on mobile when viewing a document */}
      {ctx.isMobile && ctx.selectedDocument && !ctx.isCreatingMode && (
        <MobileBottomNav />
      )}

      {/* Mobile TOC bottom sheet */}
      {ctx.isMobile && ctx.mobileTocOpen && (
        <MobileTocSheet />
      )}

      {/* Modals */}
      <DocumentsModals />
    </div>
  );
}

/**
 * Mobile Table of Contents bottom sheet
 */
function MobileTocSheet() {
  const ctx = useDocumentsContext();

  const headingItems = ctx.items.filter(
    item => item.level === 'h1' || item.level === 'h2' || item.level === 'h3'
  );

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-50"
        onClick={() => ctx.setMobileTocOpen(false)}
      />
      {/* Bottom sheet */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-[var(--bg-primary)] border-t border-[var(--border-primary)] rounded-t-2xl max-h-[60vh] flex flex-col animate-slide-up">
        {/* Handle */}
        <div className="flex justify-center py-2">
          <div className="w-10 h-1 rounded-full bg-[var(--text-tertiary)] opacity-50" />
        </div>
        <div className="px-4 pb-2 text-sm font-semibold text-[var(--text-secondary)]">
          Table of Contents
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {headingItems.length > 0 ? (
            <div className="space-y-1">
              {headingItems.map(item => (
                <button
                  key={item.id}
                  onClick={() => {
                    ctx.setSelectedItemId(item.id);
                    ctx.setMobileTocOpen(false);
                    const element = document.getElementById(`item-${item.id}`);
                    if (element) {
                      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                  }}
                  className={cn(
                    "w-full text-left px-3 py-2.5 rounded-lg text-sm min-h-[44px] flex items-center",
                    "hover:bg-[var(--bg-tertiary)] active:bg-[var(--bg-tertiary)]",
                    ctx.selectedItemId === item.id && 'bg-[var(--color-primary-500)]/10 text-[var(--color-primary-400)]',
                    item.level === 'h2' && 'pl-6',
                    item.level === 'h3' && 'pl-9'
                  )}
                >
                  <span className={cn(
                    "mr-2 text-[10px] uppercase font-mono px-1 py-0.5 rounded",
                    item.level === 'h1' ? 'bg-purple-500/20 text-purple-400' :
                    item.level === 'h2' ? 'bg-blue-500/20 text-blue-400' :
                    'bg-green-500/20 text-green-400'
                  )}>
                    {item.level}
                  </span>
                  <span className="truncate">{item.content || 'Untitled'}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-[var(--text-tertiary)] text-sm">
              No headings found
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * Public-mode props (ADR-0060 P6/F).
 * When `dataSource === 'public'`, reads go through the public API and the
 * widget renders read-only without auth.
 */
export interface DocumentsWidgetPublicProps {
  dataSource?: 'private' | 'public';
  /** Space `public_slug` (required when `dataSource === 'public'`). */
  publicSlug?: string;
  /** Widget id (required when `dataSource === 'public'`). */
  widgetId?: number;
  /** Pre-select a doc by slug on mount. */
  initialDocSlug?: string;
  /** Hide sidebar + lock to the selected doc (one-doc viewer mode). */
  singleDocFocus?: boolean;
  /** Dashboard-embedded (compact) render — collapses the doc-list sidebar by
   *  default so the widget reads as a panel. Standalone module page omits it
   *  and keeps the sidebar open. (Task #2) */
  compact?: boolean;
}

/**
 * Main DocumentsWidget component
 * Wraps everything in the context provider
 *
 * Accepts either:
 * - { widget, data } from DashboardWidgetCard / WidgetRenderer
 * - { config, spaceId, isEditMode } from WidgetViewPage (standalone module)
 * - DocumentsWidgetPublicProps (ADR-0060 P6/F) — public read-only mode
 */
export function DocumentsWidget(
  props:
    | PresetWidgetProps
    | ({ widget?: Widget; data?: unknown[]; config?: DocumentsWidgetConfig; spaceId?: number | string; isEditMode?: boolean } & DocumentsWidgetPublicProps),
) {
  // Support both prop shapes: { widget } from dashboard, or { config, spaceId } from standalone
  const widget = (props as any).widget as Widget | undefined;
  const wc = widget?.config || {};

  const config: DocumentsWidgetConfig = (props as any).config || {
    project_id: (wc.project_id as number) || 0,
    folder_path: (wc.folder_path as string) || 'databases/documents/',
    registry_table_id: wc.registry_table_id as number | undefined,
    atoms_table_id: wc.atoms_table_id as number | undefined,
    ...(wc as any),
  };

  const spaceId = (props as any).spaceId || (wc.project_id || '').toString();
  const isEditMode = (props as any).isEditMode ?? true;

  // Public-mode passthrough (ADR-0060 P6/F).
  const dataSource = (props as any).dataSource as 'private' | 'public' | undefined;
  const publicSlug = (props as any).publicSlug as string | undefined;
  const widgetIdProp = (props as any).widgetId as number | undefined;
  const initialDocSlug = (props as any).initialDocSlug as string | undefined;
  const singleDocFocus = (props as any).singleDocFocus as boolean | undefined;
  const compact = (props as any).compact as boolean | undefined;

  return (
    <DocumentsProvider
      config={config}
      spaceId={spaceId}
      isEditMode={isEditMode}
      dataSource={dataSource}
      publicSlug={publicSlug}
      widgetId={widgetIdProp}
      initialDocSlug={initialDocSlug}
      singleDocFocus={singleDocFocus}
      compact={compact}
    >
      <DocumentsInternal />
    </DocumentsProvider>
  );
}

export default DocumentsWidget;
