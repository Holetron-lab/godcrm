/**
 * Public-mode mirror of `useDocuments` / `useAtoms` / `useDocumentContent`.
 *
 * Reads from `/api/v3/public/s/:slug/widgets/:widgetId/...` (ADR-0060 P6/B+F).
 * Returns the same shapes as the authenticated hooks so DocumentsProvider can
 * branch on `dataSource` without forking the entire render tree.
 *
 * All mutations are no-op stubs — the public surface is read-only and the
 * provider already enforces `isReadOnly=true` upstream.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { publicApi, type PublicWidgetDocumentRow, type PublicWidgetAtomRow } from '@/features/public/publicApi';
import type { DocumentRegistryItem, DocumentItem } from '../types/documents.types';
import type { DocumentAtom } from './useAtoms';

const NOT_SUPPORTED = () =>
  Promise.reject(new Error('DocumentsWidget mutations are disabled in public mode (ADR-0060 P6).'));

const PUBLIC_DOCS_KEYS = {
  all: ['public-documents-v4'] as const,
  list: (slug: string, widgetId: number) =>
    [...PUBLIC_DOCS_KEYS.all, 'list', slug, widgetId] as const,
  content: (slug: string, widgetId: number, docSlug: string) =>
    [...PUBLIC_DOCS_KEYS.all, 'content', slug, widgetId, docSlug] as const,
};

// --- Registry helpers --------------------------------------------------------

function projectRegistryRow(row: PublicWidgetDocumentRow): DocumentRegistryItem {
  const d = row.data || {};
  // table_id on the registry row is the per-doc atoms table id (per backend
  // scrubber). Mirror it as both `table_id` and `content_table_id` so the
  // internal provider/Sidebar can use either.
  const tableId = typeof d.table_id === 'number' ? d.table_id : 0;
  return {
    id: row.id,
    base_id: row.base_id ?? undefined,
    name: d.name ?? '',
    description: d.description ?? '',
    slug: d.slug ?? '',
    table_id: tableId,
    content_table_id: tableId,
    icon: d.icon ?? undefined,
    category: d.category ?? undefined,
    status: (d.status as DocumentRegistryItem['status']) ?? undefined,
    order_index: typeof d.order_index === 'number' ? d.order_index : undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function projectAtomRowToItem(row: PublicWidgetAtomRow): DocumentItem {
  const d = (row.data || {}) as Record<string, unknown>;
  // Per-doc atoms in the documents widget are rows of the per-doc content
  // table — same row shape as the authenticated path, just scrubbed.
  const order = typeof d.order === 'number'
    ? d.order
    : Number.parseFloat(String(d.order ?? 0)) || 0;
  return {
    id: row.id,
    base_id: row.base_id ?? undefined,
    order,
    level: (d.level as DocumentItem['level']) ?? 'text',
    content: typeof d.content === 'string' ? d.content : undefined,
    content_en: typeof d.content_en === 'string' ? d.content_en : undefined,
    content_ru: typeof d.content_ru === 'string' ? d.content_ru : undefined,
    image_url: typeof d.image_url === 'string' ? d.image_url : undefined,
    image_max_height: typeof d.image_max_height === 'number' ? d.image_max_height : undefined,
    atom_ref: (d.atom_ref as DocumentItem['atom_ref']) ?? null,
    task_ref: (d.task_ref as DocumentItem['task_ref']) ?? null,
    ticket_ref: (d.ticket_ref as DocumentItem['ticket_ref']) ?? null,
    widget_ref: (d.widget_ref as DocumentItem['widget_ref']) ?? null,
    is_collapsed: typeof d.is_collapsed === 'boolean' ? d.is_collapsed : undefined,
    is_hidden: typeof d.is_hidden === 'boolean' ? d.is_hidden : undefined,
    keep_with_next: typeof d.keep_with_next === 'boolean' ? d.keep_with_next : undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
    // Pass through any other content_* localizations
    ...Object.fromEntries(
      Object.entries(d).filter(
        ([k, v]) => k.startsWith('content_') && typeof v === 'string',
      ),
    ),
  } as DocumentItem;
}

// --- Main hook (mirror of useDocuments) --------------------------------------

interface UsePublicDocumentsOptions {
  publicSlug: string;
  widgetId: number;
  enabled?: boolean;
}

export function usePublicDocuments(opts: UsePublicDocumentsOptions) {
  const { publicSlug, widgetId, enabled = true } = opts;

  const documentsQuery = useQuery({
    queryKey: PUBLIC_DOCS_KEYS.list(publicSlug, widgetId),
    queryFn: async () => {
      const res = await publicApi.getWidgetDocuments(publicSlug, widgetId);
      return {
        documents: (res.data?.rows ?? []).map(projectRegistryRow),
        registryTableId: res.data?.registry_table_id ?? null,
      };
    },
    enabled: enabled && !!publicSlug && Number.isFinite(widgetId) && widgetId > 0,
    staleTime: 60_000,
    retry: false,
  });

  const documents = documentsQuery.data?.documents ?? [];
  const registryTableId = documentsQuery.data?.registryTableId ?? null;

  return {
    // State
    documents,
    isInitialized: documentsQuery.isSuccess,
    registryTableId,
    atomsTableId: undefined as number | undefined,
    isLoading: documentsQuery.isLoading,
    error: documentsQuery.error,

    // Mutations — no-op in public mode
    createDocument: NOT_SUPPORTED,
    deleteDocument: NOT_SUPPORTED,
    importSections: NOT_SUPPORTED,
    addItem: NOT_SUPPORTED,
    updateItem: NOT_SUPPORTED,
    deleteItem: NOT_SUPPORTED,

    isCreating: false,
    isImporting: false,
    isDeleting: false,

    // Helpers — same signatures as authenticated hook.
    getLocalizedField: (item: DocumentItem, field: 'title' | 'content', languageCode: string): string => {
      // `title` is not a typed property of DocumentItem (legacy doc-item shape
      // sometimes carries it via dynamic extension), so cast for the lookup.
      const indexed = item as unknown as Record<string, unknown>;
      if (languageCode === 'en' || !languageCode) {
        return (indexed[field] as string) || '';
      }
      const key = `${field}_${languageCode}`;
      const v = indexed[key];
      if (typeof v === 'string' && v.trim()) return v;
      return (indexed[field] as string) || '';
    },
    getNextOrder: (_items: DocumentItem[], _afterItemId?: number): number => 0,

    refresh: () => documentsQuery.refetch(),
  };
}

// --- Per-document content hook (mirror of useDocumentContent) ---------------

interface UsePublicDocumentContentOptions {
  publicSlug: string;
  widgetId: number;
  /** Doc slug or null when nothing is selected. */
  docSlug: string | null;
  enabled?: boolean;
}

export function usePublicDocumentContent(opts: UsePublicDocumentContentOptions) {
  const { publicSlug, widgetId, docSlug, enabled = true } = opts;
  return useQuery({
    queryKey: PUBLIC_DOCS_KEYS.content(publicSlug, widgetId, docSlug ?? ''),
    queryFn: async () => {
      if (!docSlug) return null;
      const res = await publicApi.getWidgetDocumentAtoms(publicSlug, widgetId, docSlug);
      const items = (res.data?.rows ?? []).map(projectAtomRowToItem);
      return {
        table_id: res.data?.table_id ?? null,
        items,
      };
    },
    enabled: enabled && !!publicSlug && !!docSlug && Number.isFinite(widgetId) && widgetId > 0,
    staleTime: 30_000,
    retry: false,
  });
}

// --- Atoms (placeholder — public docs widget has no global atoms list) -------
//
// The authenticated useAtoms reads from a shared atoms table; the public docs
// endpoints return atoms per-document. For the read-only viewer this is
// enough — we return empty arrays so the AtomsList view shows "no atoms",
// which is fine because singleDocFocus hides that affordance anyway.

export function usePublicAtomsStub(): {
  atoms: DocumentAtom[];
  isLoading: boolean;
  createAtom: typeof NOT_SUPPORTED;
  updateAtom: typeof NOT_SUPPORTED;
  deleteAtom: typeof NOT_SUPPORTED;
  getAtomById: (id: number | string | null) => DocumentAtom | undefined;
  searchAtoms: (q: string) => DocumentAtom[];
  refresh: () => void;
} {
  return useMemo(
    () => ({
      atoms: [],
      isLoading: false,
      createAtom: NOT_SUPPORTED,
      updateAtom: NOT_SUPPORTED,
      deleteAtom: NOT_SUPPORTED,
      getAtomById: () => undefined,
      searchAtoms: () => [],
      refresh: () => undefined,
    }),
    [],
  );
}
