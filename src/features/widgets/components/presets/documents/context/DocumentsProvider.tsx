/**
 * Documents Context — Shared state for all DocumentsV4 components.
 * Slim provider that composes role-specific state hooks.
 */

import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import { logger } from '@/shared/utils/logger';
import type { UserAccessLevel } from '@/shared/types/user-access.types';
import type { DocumentItem, StatusOption } from '../../../../types/documents.types';
import { useDocuments, useDocumentContent } from '../../../../hooks/useDocuments';
import { useAtoms } from '../../../../hooks/useAtoms';
import {
  usePublicDocuments,
  usePublicDocumentContent,
  usePublicAtomsStub,
} from '../../../../hooks/usePublicDocuments';
import {
  buildSectionTreeV4,
  type SectionTreeNodeV4,
} from '../../../../utils/parseMarkdownToAtoms';
import { DocumentsContext } from './DocumentsContext';
import type { DocumentsContextValue, DocumentsProviderProps, WidgetPickerTarget } from './types';
import { useDocumentsState } from './useDocumentsState';
import { useAtomsState } from './useAtomsState';
import { useRightPanelState } from './useRightPanelState';
import { useInlineEditState } from './useInlineEditState';

type ColumnConfig = { target_table_id?: number; display_column?: string; options?: Array<string | { value: string; label?: string }> } | null;
type RegistryColumn = { name: string; column_type: string; config?: ColumnConfig };
type StatusRow = Record<string, unknown> & { id: number };

export function DocumentsProvider({
  children,
  config,
  spaceId,
  isEditMode,
  dataSource = 'private',
  publicSlug,
  widgetId: widgetIdOverride,
  initialDocSlug,
  singleDocFocus = false,
  compact = false,
}: DocumentsProviderProps) {
  const projectId = config?.project_id || 0;
  // In public mode the caller passes the widget id explicitly (the page knows
  // it before the widget config is fetched). Authoring mode keeps the existing
  // config-derived id so legacy call sites don't break.
  const widgetId = widgetIdOverride ?? config?.id;
  const storageKey = `documents-widget-v4-${widgetId}`;
  const isPublic = dataSource === 'public';

  // === Top-level data hooks ===
  //
  // ADR-0060 P6/F — branch by `dataSource`. We call BOTH hooks and pick the
  // active one with `enabled: false` on the inactive branch so React rules-of-
  // hooks stay happy. The unused queries are zero-cost when disabled.

  const privateDocs = useDocuments({
    projectId,
    config,
    autoInit: !isPublic,
  });
  const publicDocs = usePublicDocuments({
    publicSlug: publicSlug || '',
    widgetId: widgetId || 0,
    enabled: isPublic,
  });

  const activeDocs = isPublic ? publicDocs : privateDocs;
  const {
    documents,
    isInitialized,
    registryTableId,
    isLoading,
    createDocument,
    deleteDocument,
    importSections,
    addItem,
    updateItem,
    deleteItem,
    getLocalizedField,
    getNextOrder,
    isCreating,
    isImporting,
    isDeleting,
    refresh,
  } = activeDocs;
  // atomsTableId is exposed by both branches but TS narrows the union
  // inconsistently; reach in via index access to keep both shapes happy.
  const atomsTableId =
    (activeDocs as unknown as { atomsTableId?: number }).atomsTableId;

  // === Atoms — read-only public mode uses an empty stub (per-doc atoms are
  // delivered via usePublicDocumentContent below). ===

  const privateAtoms = useAtoms({
    atomsTableId: atomsTableId ?? null,
    enabled: !isPublic && !!atomsTableId,
  });
  const publicAtomsStub = usePublicAtomsStub();

  const {
    atoms: allAtoms,
    isLoading: isLoadingAtoms,
    createAtom,
    updateAtom,
    deleteAtom,
    getAtomById,
    searchAtoms,
    refresh: refreshAtoms,
  } = isPublic
    ? { ...publicAtomsStub, isLoading: false, refresh: publicAtomsStub.refresh }
    : privateAtoms;

  // === Composed state hooks ===

  const docsState = useDocumentsState({ storageKey, config, documents, isInitialized, compact });

  // === ADR-0060 P6/F: initialDocSlug pre-selection ===
  // When the public page mounts with `initialDocSlug`, resolve it against the
  // fetched registry rows and select that doc. Same flow as the existing
  // ?doc= URL handling in useDocumentsState — kept here to avoid coupling
  // the state hook to public-only props.
  useEffect(() => {
    if (!initialDocSlug || !documents.length) return;
    if (docsState.selectedDocumentId) return;
    const target = documents.find((d) => d.slug === initialDocSlug);
    if (target) docsState.setSelectedDocumentId(target.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDocSlug, documents.length, docsState.selectedDocumentId]);
  const atomsState = useAtomsState();
  const rightPanelState = useRightPanelState();
  const inlineEditState = useInlineEditState();

  const {
    selectedDocumentId,
    currentLanguage,
  } = docsState;

  // === ADR-105: Read-only role ===
  // Public mode is always read-only — skip the authed /access lookup entirely
  // (no JWT in public sessions).

  const { data: effectiveRoleData } = useQuery<{ access_level: UserAccessLevel }>({
    queryKey: ['effective-role', 'project', projectId],
    queryFn: async () => {
      const response = await apiClient.get<{ data: { access_level: UserAccessLevel } }>(`/access/project/${projectId}/my-level`);
      return response.data;
    },
    enabled: !isPublic && !!projectId,
    staleTime: 5 * 60_000,
  });

  const effectiveRole: UserAccessLevel | null = isPublic
    ? 'viewer'
    : (effectiveRoleData?.access_level ?? null);
  const isReadOnly = isPublic
    ? true
    : isEditMode !== undefined
      ? !isEditMode
      : effectiveRole !== null
        ? (effectiveRole === 'viewer' || effectiveRole === 'denied')
        : false;

  // === Status options (from _doc_statuses via registry's status_id relation) ===

  const { data: registryColumns } = useQuery<RegistryColumn[]>({
    queryKey: ['registry-columns', registryTableId],
    queryFn: async () => {
      const response = await apiClient.get<{ data: Array<{ name: string; column_type: string; config?: ColumnConfig | string }> }>(`/tables/${registryTableId}/columns`);
      return (response.data || []).map(col => ({
        ...col,
        config: typeof col.config === 'string' ? (() => { try { return JSON.parse(col.config); } catch { return null; } })() : col.config,
      })) as RegistryColumn[];
    },
    // Public mode skips this — registry status/category metadata is not
    // surfaced on the public DocumentsWidget viewer (read-only).
    enabled: !isPublic && !!registryTableId,
    staleTime: 5 * 60_000,
  });

  // Accept either column_type='relation' or column_type='select' as long as
  // the config carries a target_table_id (or relation.enabled). Older registries
  // and ones whose type was toggled to 'select' (e.g. ADRs widget 218 → table 2197)
  // would otherwise lose their dropdown options entirely.
  const statusesTableId = useMemo(() => {
    const col = registryColumns?.find(c => c.name === 'status_id');
    if (!col) return null;
    const cfg = col.config as (ColumnConfig & { relation?: { enabled?: boolean; tableId?: string | number } }) | null;
    const direct = cfg?.target_table_id;
    const relTableId = cfg?.relation?.enabled ? cfg.relation.tableId : undefined;
    const id = direct ?? (relTableId != null ? Number(relTableId) : undefined);
    return Number.isFinite(id as number) ? (id as number) : null;
  }, [registryColumns]);

  // `category` is a select column on the registry with a fixed option list.
  // We need these options for the EditDocumentModal dropdown; sending a free-
  // form string (e.g. "ADR") is rejected by SelectValueResolver with 400.
  const categoryOptions: string[] = useMemo(() => {
    const col = registryColumns?.find(c => c.name === 'category');
    const opts = col?.config?.options;
    if (!Array.isArray(opts)) return [];
    return opts.map(o => (typeof o === 'string' ? o : (o.value ?? o.label ?? ''))).filter(Boolean);
  }, [registryColumns]);

  const { data: statusRows, isLoading: isLoadingStatusOptions } = useQuery<StatusRow[]>({
    queryKey: ['doc-statuses', statusesTableId],
    queryFn: async () => {
      const response = await apiClient.get<{ success?: boolean; data?: { rows?: StatusRow[] } | StatusRow[] }>(`/tables/${statusesTableId}/rows?limit=200`);
      const payload = response.data;
      if (Array.isArray(payload)) return payload;
      return payload?.rows ?? [];
    },
    enabled: !isPublic && !!statusesTableId,
    staleTime: 5 * 60_000,
  });

  const statusOptions: StatusOption[] = useMemo(() => {
    if (!statusRows) return [];
    return statusRows
      .map(r => {
        // /tables/{id}/rows returns rows as { id, data: {slug, label, ...} }.
        // Older shape was flat; support both.
        const d = (r.data && typeof r.data === 'object' ? r.data : r) as Record<string, unknown>;
        return {
          id: r.id,
          slug: String(d.slug ?? ''),
          label: String(d.label ?? d.slug ?? ''),
          icon: d.icon ? String(d.icon) : undefined,
          color: d.color ? String(d.color) : undefined,
          order: typeof d.order === 'number' ? d.order : Number(d.order ?? 0),
          description: d.description ? String(d.description) : undefined,
        };
      })
      .filter(o => o.slug)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [statusRows]);

  const resolveStatus = useCallback((doc: { status_id?: number | null; status?: string | null }): StatusOption | undefined => {
    if (doc.status_id != null) {
      const byId = statusOptions.find(o => o.id === doc.status_id);
      if (byId) return byId;
    }
    if (doc.status) return statusOptions.find(o => o.slug === doc.status);
    return undefined;
  }, [statusOptions]);

  // === Document content + derived items/tree ===
  //
  // Private mode: fetch by (documentId, registryTableId) via authed endpoint.
  // Public mode: fetch by (publicSlug, widgetId, docSlug) via public endpoint.
  // Both produce a `{ items: DocumentItem[] }` shape consumed by the same
  // `items` projector below, so DocumentsContent / DocumentPages render the
  // exact same React tree.

  const privateContent = useDocumentContent(
    selectedDocumentId,
    registryTableId ?? null,
    { enabled: !isPublic && !!selectedDocumentId && !!registryTableId }
  );

  const selectedDocForPublic = docsState.selectedDocument;
  const publicContent = usePublicDocumentContent({
    publicSlug: publicSlug || '',
    widgetId: widgetId || 0,
    docSlug: selectedDocForPublic?.slug || null,
    enabled: isPublic,
  });

  const documentContent = isPublic ? publicContent.data : privateContent.data;
  const isLoadingContent = isPublic ? publicContent.isLoading : privateContent.isLoading;

  // Note: content-language is driven by global useLanguage() with a per-widget
  // sessionStorage override (see useDocumentsState). The previous auto-detect
  // from content_ru/content_en presence was removed because it would silently
  // write an override the user never picked, fighting the global switcher.
  // The `items` resolver below already falls back to content_en when the
  // chosen language has no content, so monolingual docs still render.

  // Detect missing translation when the user switches language:
  // if the just-picked currentLanguage has no content on any item, prompt
  // the user to dispatch the configured translation agent. We watch only
  // `currentLanguage` so the modal does not pop on initial doc load — it
  // appears as a direct reaction to the user toggling the language selector.
  const prevLanguageRef = useRef<string>(currentLanguage);
  useEffect(() => {
    if (isReadOnly) return;
    if (prevLanguageRef.current === currentLanguage) return;
    prevLanguageRef.current = currentLanguage;
    if (!selectedDocumentId) return;
    const rawItems = documentContent?.items || [];
    if (rawItems.length === 0) return;
    const hasTranslation = rawItems.some((item) => {
      const v = (item as unknown as Record<string, unknown>)[`content_${currentLanguage}`];
      return typeof v === 'string' && v.trim().length > 0;
    });
    if (!hasTranslation) {
      docsState.setTranslationMissingLang(currentLanguage);
      docsState.setShowTranslationMissingModal(true);
    }
  }, [currentLanguage, isReadOnly, selectedDocumentId, documentContent, docsState]);

  // Virtual `content` field based on currentLanguage for backwards compat.
  const items: DocumentItem[] = useMemo(() => {
    const rawItems = documentContent?.items || [];
    return rawItems.map(item => ({
      ...item,
      content: item[`content_${currentLanguage}` as keyof typeof item] as string
        || item.content_en
        || item.content
        || '',
    }));
  }, [documentContent, currentLanguage]);

  const getNextOrderWrapped = useCallback((afterItemId?: number): number => {
    return getNextOrder(items, afterItemId);
  }, [items, getNextOrder]);

  const itemTree = useMemo(() =>
    buildSectionTreeV4(items.map(item => ({
      order: item.order,
      level: item.level,
      title: item.title || '',
      content: item.content || '',
      selected: true,
    }))),
    [items]
  );

  // === Provider-owned state (import, modals, refs, widget picker) ===

  const [widgetPickerTarget, setWidgetPickerTarget] = useState<WidgetPickerTarget | null>(null);
  const [urlInput, setUrlInput] = useState('');

  const [showStructureModal, setShowStructureModal] = useState(false);
  const [showAgentsModal, setShowAgentsModal] = useState(false);
  const [showCreateDocumentModal, setShowCreateDocumentModal] = useState(false);
  const [showEditDocumentModal, setShowEditDocumentModal] = useState(false);
  const [editingDocumentId, setEditingDocumentId] = useState<number | null>(null);
  const [structureMode, setStructureMode] = useState(false);

  const [isCreatingMode, setIsCreatingMode] = useState(false);
  const [showFileUploadModal, setShowFileUploadModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importTree, setImportTree] = useState<SectionTreeNodeV4[]>([]);
  const [newDocName, setNewDocName] = useState('');
  const [newDocCategory, setNewDocCategory] = useState('');
  const [newDocDescription, setNewDocDescription] = useState('');
  const [importValidation, setImportValidation] = useState<{ errors: string[]; warnings: string[] }>({ errors: [], warnings: [] });
  const [importLanguage, setImportLanguage] = useState<'en' | 'ru' | 'auto'>('auto');

  const [previewMode, setPreviewMode] = useState<'pages' | 'strip' | 'none'>('strip');
  const [contentScale, setContentScale] = useState<number>(100);
  const [viewScale, setViewScale] = useState<number>(100);
  const [activePreviewOrder, setActivePreviewOrder] = useState<number | null>(null);
  const [editingImportOrder, setEditingImportOrder] = useState<number | null>(null);
  const [editingImportData, setEditingImportData] = useState<{ title?: string; content?: string }>({});

  const widgetRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // === ADR-0060 P6/P: fail-closed mutation guards ===
  // Wraps every mutation method so it short-circuits when the widget is
  // read-only. Defense-in-depth — even if a UI hide is missed (or a future
  // refactor wires a handler past the UI guard), the call still no-ops.
  // Throwing surfaces the violation in dev/test instead of silently mutating.
  const guardedCreateDocument: typeof createDocument = useCallback(async (params) => {
    if (isReadOnly) {
      logger.warn('[DocumentsWidget] createDocument blocked: read-only');
      throw new Error('DocumentsWidget is read-only — createDocument blocked');
    }
    return createDocument(params);
  }, [isReadOnly, createDocument]);

  const guardedDeleteDocument: typeof deleteDocument = useCallback(async (params) => {
    if (isReadOnly) {
      logger.warn('[DocumentsWidget] deleteDocument blocked: read-only');
      throw new Error('DocumentsWidget is read-only — deleteDocument blocked');
    }
    return deleteDocument(params);
  }, [isReadOnly, deleteDocument]);

  const guardedImportSections: typeof importSections = useCallback(async (params) => {
    if (isReadOnly) {
      logger.warn('[DocumentsWidget] importSections blocked: read-only');
      throw new Error('DocumentsWidget is read-only — importSections blocked');
    }
    return importSections(params);
  }, [isReadOnly, importSections]);

  const guardedAddItem: typeof addItem = useCallback(async (params) => {
    if (isReadOnly) {
      logger.warn('[DocumentsWidget] addItem blocked: read-only');
      throw new Error('DocumentsWidget is read-only — addItem blocked');
    }
    return addItem(params);
  }, [isReadOnly, addItem]);

  const guardedUpdateItem: typeof updateItem = useCallback(async (params) => {
    if (isReadOnly) {
      logger.warn('[DocumentsWidget] updateItem blocked: read-only');
      throw new Error('DocumentsWidget is read-only — updateItem blocked');
    }
    return updateItem(params);
  }, [isReadOnly, updateItem]);

  const guardedDeleteItem: typeof deleteItem = useCallback(async (params) => {
    if (isReadOnly) {
      logger.warn('[DocumentsWidget] deleteItem blocked: read-only');
      throw new Error('DocumentsWidget is read-only — deleteItem blocked');
    }
    return deleteItem(params);
  }, [isReadOnly, deleteItem]);

  const guardedCreateAtom: typeof createAtom = useCallback(async (params) => {
    if (isReadOnly) {
      logger.warn('[DocumentsWidget] createAtom blocked: read-only');
      throw new Error('DocumentsWidget is read-only — createAtom blocked');
    }
    return createAtom(params);
  }, [isReadOnly, createAtom]);

  const guardedUpdateAtom: typeof updateAtom = useCallback(async (params) => {
    if (isReadOnly) {
      logger.warn('[DocumentsWidget] updateAtom blocked: read-only');
      throw new Error('DocumentsWidget is read-only — updateAtom blocked');
    }
    return updateAtom(params);
  }, [isReadOnly, updateAtom]);

  const guardedDeleteAtom: typeof deleteAtom = useCallback(async (atomId) => {
    if (isReadOnly) {
      logger.warn('[DocumentsWidget] deleteAtom blocked: read-only');
      throw new Error('DocumentsWidget is read-only — deleteAtom blocked');
    }
    return deleteAtom(atomId);
  }, [isReadOnly, deleteAtom]);

  // === Context value ===

  const value: DocumentsContextValue = {
    projectId,
    spaceId,
    widgetId,
    config,
    atomsTableId: atomsTableId ?? null,

    dataSource,
    publicSlug: publicSlug ?? null,
    singleDocFocus,

    isReadOnly,
    effectiveRole,

    documents,
    isInitialized,
    registryTableId: registryTableId ?? null,
    isLoading,

    allAtoms,
    isLoadingAtoms,
    createAtom: guardedCreateAtom,
    updateAtom: guardedUpdateAtom,
    deleteAtom: guardedDeleteAtom,
    getAtomById,
    searchAtoms,
    refreshAtoms,

    ...docsState,
    ...atomsState,
    ...rightPanelState,
    ...inlineEditState,

    items,
    itemTree,
    isLoadingContent,

    statusOptions,
    isLoadingStatusOptions,
    resolveStatus,

    categoryOptions,

    isCreatingMode,
    setIsCreatingMode,
    showFileUploadModal,
    setShowFileUploadModal,
    importFile,
    setImportFile,
    importTree,
    setImportTree,
    newDocName,
    setNewDocName,
    newDocCategory,
    setNewDocCategory,
    newDocDescription,
    setNewDocDescription,
    importValidation,
    setImportValidation,
    importLanguage,
    setImportLanguage,

    previewMode,
    setPreviewMode,
    contentScale,
    setContentScale,
    viewScale,
    setViewScale,
    activePreviewOrder,
    setActivePreviewOrder,
    editingImportOrder,
    setEditingImportOrder,
    editingImportData,
    setEditingImportData,

    widgetPickerTarget,
    setWidgetPickerTarget,

    urlInput,
    setUrlInput,

    showStructureModal,
    setShowStructureModal,
    showAgentsModal,
    setShowAgentsModal,
    showCreateDocumentModal,
    setShowCreateDocumentModal,
    showEditDocumentModal,
    setShowEditDocumentModal,
    editingDocumentId,
    setEditingDocumentId,
    structureMode,
    setStructureMode,

    widgetRef,
    contentRef,
    previewRef,
    fileInputRef,

    createDocument: guardedCreateDocument,
    deleteDocument: guardedDeleteDocument,
    importSections: guardedImportSections,
    addItem: guardedAddItem,
    updateItem: guardedUpdateItem,
    deleteItem: guardedDeleteItem,
    getLocalizedField,
    getNextOrder: getNextOrderWrapped,
    isCreating,
    isImporting,
    isDeleting,
    refresh,
  };

  return (
    <DocumentsContext.Provider value={value}>
      {children}
    </DocumentsContext.Provider>
  );
}
