import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { UserAccessLevel } from '@/shared/types/user-access.types';
import type {
  DocumentsWidgetConfig,
  DocumentCreateResponse,
  DocumentRegistryItem,
  DocumentItem,
  DocumentImportSection,
  StatusOption,
} from '../../../../types/documents.types';
import type { DocumentAtom } from '../../../../hooks/useAtoms';
import type { SectionTreeNodeV4 } from '../../../../utils/parseMarkdownToAtoms';

export type RightPanelMode = 'settings' | 'atoms';
export type AtomsPanelTab = 'text-blocks' | 'doc-atoms' | 'all-atoms';

/**
 * ADR-0003 widget-embed §Phase1 UI — target for the AddWidgetModal when invoked
 * from a document. `create` inserts a new doc item; `replace` swaps the
 * widget_ref on an existing item.
 */
export type WidgetPickerTarget =
  | { mode: 'create'; afterItemId?: number; beforeItemId?: number }
  | { mode: 'replace'; itemId: number };

export interface DocumentsContextValue {
  projectId: number;
  spaceId: number;
  widgetId: number | undefined;
  config: DocumentsWidgetConfig | undefined;
  atomsTableId: number | null;

  /** ADR-0060 P6/F — 'public' means reads go through publicApi instead of
   *  authenticated /tables/:id endpoints. Always read-only. */
  dataSource: 'private' | 'public';
  /** ADR-0060 P6/F — set when dataSource === 'public'. */
  publicSlug: string | null;
  /** ADR-0060 P6/F — when true, the widget is locked to `selectedDocument`;
   *  sidebar + multi-doc affordances should hide. */
  singleDocFocus: boolean;

  isReadOnly: boolean;
  effectiveRole: UserAccessLevel | null;

  documents: DocumentRegistryItem[];
  isInitialized: boolean;
  registryTableId: number | null;
  isLoading: boolean;

  allAtoms: DocumentAtom[];
  isLoadingAtoms: boolean;
  createAtom: (params: Omit<DocumentAtom, 'id' | 'created_at' | 'updated_at'>) => Promise<{ id: number; base_id?: string }>;
  updateAtom: (params: { atomId: number; data: Partial<DocumentAtom> }) => Promise<any>;
  deleteAtom: (atomId: number) => Promise<any>;
  getAtomById: (atomId: number | string | null) => DocumentAtom | undefined;
  searchAtoms: (query: string) => DocumentAtom[];
  refreshAtoms: () => void;

  selectedDocumentId: number | null;
  setSelectedDocumentId: (id: number | null) => void;
  selectedDocument: DocumentRegistryItem | undefined;

  items: DocumentItem[];
  itemTree: SectionTreeNodeV4[];
  isLoadingContent: boolean;

  selectedItemId: number | null;
  setSelectedItemId: (id: number | null) => void;

  editingItemId: number | null;
  setEditingItemId: (id: number | null) => void;
  editingData: Partial<DocumentItem>;
  setEditingData: (data: Partial<DocumentItem>) => void;

  rightPanelOpen: boolean;
  setRightPanelOpen: (open: boolean) => void;
  rightPanelMode: RightPanelMode;
  setRightPanelMode: (mode: RightPanelMode) => void;
  atomsPanelSearchQuery: string;
  setAtomsPanelSearchQuery: (query: string) => void;
  atomsPanelTab: AtomsPanelTab;
  setAtomsPanelTab: (tab: AtomsPanelTab) => void;

  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  showAllElements: boolean;
  setShowAllElements: (show: boolean) => void;

  statusOptions: StatusOption[];
  isLoadingStatusOptions: boolean;
  /** Resolve a registry row's status to its StatusOption — checks status_id first, then falls back to legacy `status` slug. */
  resolveStatus: (doc: { status_id?: number | null; status?: string | null }) => StatusOption | undefined;

  /** Valid options for the registry's `category` select column. Empty if the column is not a select. */
  categoryOptions: string[];

  searchQuery: string;
  setSearchQuery: (query: string) => void;
  contentSearchQuery: string;
  setContentSearchQuery: (query: string) => void;
  statusFilter: string;
  setStatusFilter: (status: string) => void;

  isCreatingMode: boolean;
  setIsCreatingMode: (mode: boolean) => void;
  showFileUploadModal: boolean;
  setShowFileUploadModal: (show: boolean) => void;
  importFile: File | null;
  setImportFile: (file: File | null) => void;
  importTree: SectionTreeNodeV4[];
  setImportTree: Dispatch<SetStateAction<SectionTreeNodeV4[]>>;
  newDocName: string;
  setNewDocName: (name: string) => void;
  newDocCategory: string;
  setNewDocCategory: (category: string) => void;
  newDocDescription: string;
  setNewDocDescription: (desc: string) => void;
  importValidation: { errors: string[]; warnings: string[] };
  setImportValidation: (v: { errors: string[]; warnings: string[] }) => void;
  importLanguage: 'en' | 'ru' | 'auto';
  setImportLanguage: (lang: 'en' | 'ru' | 'auto') => void;

  previewMode: 'pages' | 'strip' | 'none';
  setPreviewMode: (mode: 'pages' | 'strip' | 'none') => void;
  contentScale: number;
  setContentScale: (scale: number) => void;
  viewScale: number;
  setViewScale: (scale: number) => void;
  activePreviewOrder: number | null;
  setActivePreviewOrder: (order: number | null) => void;
  editingImportOrder: number | null;
  setEditingImportOrder: (order: number | null) => void;
  editingImportData: { title?: string; content?: string };
  setEditingImportData: Dispatch<SetStateAction<{ title?: string; content?: string }>>;

  currentLanguage: string;
  setCurrentLanguage: (lang: string) => void;
  availableLanguages: Array<{ code: string; name: string; is_default?: boolean }>;

  atomModalItem: DocumentItem | null;
  setAtomModalItem: (item: DocumentItem | null) => void;
  atomKey: string;
  setAtomKey: (key: string) => void;
  atomTitle: string;
  setAtomTitle: (title: string) => void;
  showAtomModal: boolean;
  setShowAtomModal: (show: boolean) => void;
  selectedItemForAtom: DocumentItem | null;
  setSelectedItemForAtom: (item: DocumentItem | null) => void;
  atomSections: Record<number, { enabled: boolean; key: string; title: string }>;
  setAtomSections: React.Dispatch<React.SetStateAction<Record<number, { enabled: boolean; key: string; title: string }>>>;

  showConvertToAtomModal: boolean;
  setShowConvertToAtomModal: (show: boolean) => void;
  convertToAtomItem: DocumentItem | null;
  setConvertToAtomItem: (item: DocumentItem | null) => void;

  showConvertToTicketModal: boolean;
  setShowConvertToTicketModal: (show: boolean) => void;
  convertToTicketItem: DocumentItem | null;
  setConvertToTicketItem: (item: DocumentItem | null) => void;

  widgetPickerTarget: WidgetPickerTarget | null;
  setWidgetPickerTarget: (target: WidgetPickerTarget | null) => void;

  urlInput: string;
  setUrlInput: (url: string) => void;

  showStructureModal: boolean;
  setShowStructureModal: (show: boolean) => void;

  showAgentsModal: boolean;
  setShowAgentsModal: (show: boolean) => void;

  /** Modal that prompts the user to request translation when the
   *  current document has no content for the just-switched language. */
  showTranslationMissingModal: boolean;
  setShowTranslationMissingModal: (show: boolean) => void;
  /** The language code the user switched to (e.g. 'ru', 'en') that
   *  is missing translated content. */
  translationMissingLang: string | null;
  setTranslationMissingLang: (lang: string | null) => void;

  showCreateDocumentModal: boolean;
  setShowCreateDocumentModal: (show: boolean) => void;

  showEditDocumentModal: boolean;
  setShowEditDocumentModal: (show: boolean) => void;
  /**
   * Which document the Edit Document modal should target.
   * Kept separate from `selectedDocumentId` so opening the edit modal does not
   * navigate the underlying viewer to that document.
   */
  editingDocumentId: number | null;
  setEditingDocumentId: (id: number | null) => void;

  structureMode: boolean;
  setStructureMode: (mode: boolean) => void;

  atomsViewMode: boolean;
  setAtomsViewMode: (mode: boolean) => void;

  ticketsViewMode: boolean;
  setTicketsViewMode: (mode: boolean) => void;
  ticketsStateFilter: number[];
  setTicketsStateFilter: (states: number[]) => void;
  ticketsSortBy: 'created' | 'updated' | 'state' | 'priority';
  setTicketsSortBy: (sortBy: 'created' | 'updated' | 'state' | 'priority') => void;
  ticketsSortOrder: 'asc' | 'desc';
  setTicketsSortOrder: (order: 'asc' | 'desc') => void;
  ticketsDisplayMode: 'list' | 'cards';
  setTicketsDisplayMode: (mode: 'list' | 'cards') => void;

  atomsDisplayMode: 'list' | 'cards';
  setAtomsDisplayMode: (mode: 'list' | 'cards') => void;

  showDocumentsGrid: boolean;
  setShowDocumentsGrid: (show: boolean) => void;

  isMobile: boolean;
  isTablet: boolean;
  breakpoint: 'mobile' | 'tablet' | 'desktop';
  mobileSidebarOpen: boolean;
  setMobileSidebarOpen: (open: boolean) => void;
  mobileTocOpen: boolean;
  setMobileTocOpen: (open: boolean) => void;

  expandedNodes: Set<number>;
  setExpandedNodes: (nodes: Set<number> | ((prev: Set<number>) => Set<number>)) => void;
  copied: boolean;
  setCopied: (copied: boolean) => void;

  widgetRef: React.RefObject<HTMLDivElement>;
  contentRef: React.RefObject<HTMLDivElement>;
  previewRef: React.RefObject<HTMLDivElement>;
  fileInputRef: React.RefObject<HTMLInputElement>;

  createDocument: (params: { name: string; slug?: string; description?: string; icon?: string; category?: string; project_id?: number }) => Promise<DocumentCreateResponse>;
  deleteDocument: (params: { documentId: number; deleteTable?: boolean }) => Promise<{ success: boolean; data: { document_id: number; table_deleted: boolean } }>;
  importSections: (params: { documentId: number; sections: DocumentImportSection[] }) => Promise<{ success: boolean }>;
  addItem: (params: { documentId: number; item: Partial<DocumentItem> }) => Promise<{ id: number; tableId: number }>;
  updateItem: (params: { documentId: number; itemId: number; tableId: number; data: Partial<DocumentItem> }) => Promise<{ success: boolean }>;
  deleteItem: (params: { documentId: number; itemId: number; tableId: number }) => Promise<{ success: boolean }>;
  getLocalizedField: (item: DocumentItem, field: 'title' | 'content', languageCode: string) => string;
  getNextOrder: () => number;
  isCreating: boolean;
  isImporting: boolean;
  isDeleting: boolean;
  refresh: () => void;
}

/**
 * Public-mode props (ADR-0060 P6/F — public DocumentsWidget mirror).
 *
 * When `dataSource === 'public'`, the provider reads from
 * `/api/v3/public/s/:publicSlug/widgets/:widgetId/...` instead of the
 * authenticated `/tables/:id/...` endpoints. `publicSlug` and `widgetId`
 * MUST be supplied. Everything else (read-only gating, single-doc focus)
 * is opt-in.
 */
export interface DocumentsPublicProps {
  /** Data source — defaults to 'private' (authenticated). */
  dataSource?: 'private' | 'public';
  /** Space public_slug, required when dataSource === 'public'. */
  publicSlug?: string;
  /** Widget id, required when dataSource === 'public' (the legacy
   *  `/s/<slug>/docs/<docSlug>` route resolves this at the page level). */
  widgetId?: number;
  /** Force-select a specific doc by slug on mount. */
  initialDocSlug?: string;
  /** Hide sidebar + lock to the resolved initial doc (single-page view). */
  singleDocFocus?: boolean;
}

export interface DocumentsProviderProps extends DocumentsPublicProps {
  children: ReactNode;
  config: DocumentsWidgetConfig | undefined;
  spaceId: number;
  isEditMode?: boolean;
  /** Dashboard-embedded (compact) render — collapses the doc-list sidebar by
   *  default. (Task #2) */
  compact?: boolean;
}
