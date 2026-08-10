import { useMemo } from 'react';
import { Loader2, FolderOpen, Plus, X } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { useDocumentsContext } from '../DocumentsContext';
import type { DocumentRegistryItem } from '../../../../types/documents.types';
import { DocumentTile } from './DocumentTile';

/**
 * DocumentsGrid - Grid of A4-proportioned document preview tiles
 * Shows all documents as paper-like cards
 */
export function DocumentsGrid() {
  const ctx = useDocumentsContext();
  const { t } = useLanguage();

  // Filter documents by status and search query
  const filteredDocuments = useMemo(() => {
    let docs = ctx.documents;

    // Filter by status
    if (ctx.statusFilter && ctx.statusFilter !== 'all') {
      docs = docs.filter(doc => doc.status === ctx.statusFilter);
    }

    // Filter by search query
    if (ctx.searchQuery.trim()) {
      const q = ctx.searchQuery.toLowerCase();
      docs = docs.filter(doc =>
        doc.name?.toLowerCase().includes(q) ||
        doc.description?.toLowerCase().includes(q) ||
        doc.category?.toLowerCase().includes(q)
      );
    }

    return docs;
  }, [ctx.documents, ctx.searchQuery, ctx.statusFilter]);

  // Group documents by category
  const groupedDocuments = useMemo(() => {
    const groups: Record<string, DocumentRegistryItem[]> = {};
    const uncategorized: DocumentRegistryItem[] = [];

    for (const doc of filteredDocuments) {
      if (doc.category) {
        if (!groups[doc.category]) {
          groups[doc.category] = [];
        }
        groups[doc.category].push(doc);
      } else {
        uncategorized.push(doc);
      }
    }

    return { groups, uncategorized };
  }, [filteredDocuments]);

  const hasCategories = Object.keys(groupedDocuments.groups).length > 0;

  if (ctx.isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--color-primary-500)]" />
      </div>
    );
  }

  if (filteredDocuments.length === 0) {
    const isEmpty = ctx.documents.length === 0;
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <FolderOpen className="w-16 h-16 text-[var(--text-tertiary)] mb-4" />
        <h2 className="text-xl font-semibold mb-2">
          {isEmpty ? t('documents.noDocuments') : t('documents.nothingFound')}
        </h2>
        <p className="text-[var(--text-secondary)] max-w-md">
          {isEmpty ? t('documents.createFirst') : t('documents.tryDifferentSearch')}
        </p>
        {isEmpty && !ctx.isReadOnly && (
          <button
            onClick={() => ctx.setShowCreateDocumentModal(true)}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-primary-500)] text-white text-sm font-medium hover:bg-[var(--color-primary-600)]"
          >
            <Plus className="w-4 h-4" />
            {t('documents.createDocument')}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-2">{t('documents.gridTitle')}</h1>
        <p className="text-sm text-[var(--text-secondary)]">
          {filteredDocuments.length} {t('documents.countUnit')}
        </p>
      </div>

      {/* Render by categories if they exist */}
      {hasCategories ? (
        <div className="space-y-8">
          {/* Categorized documents */}
          {Object.entries(groupedDocuments.groups).sort(([a], [b]) => a.localeCompare(b)).map(([category, docs]) => (
            <div key={category}>
              <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500" />
                {category}
                <span className="text-sm font-normal text-[var(--text-tertiary)]">({docs.length})</span>
              </h2>
                  <div
                    className="grid gap-6"
                    style={{
                      gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
                    }}
                  >
                    {docs.map(doc => (
                      <DocumentTile
                        key={doc.id}
                        doc={doc}
                        onClick={() => ctx.setSelectedDocumentId(doc.id)}
                      />
                    ))}
                  </div>
                </div>
              ))}

              {/* Uncategorized documents */}
              {groupedDocuments.uncategorized.length > 0 && (
                <div>
                  <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-gray-400" />
                    {t('documents.uncategorized')}
                    <span className="text-sm font-normal text-[var(--text-tertiary)]">({groupedDocuments.uncategorized.length})</span>
                  </h2>
                  <div
                    className="grid gap-6"
                    style={{
                      gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
                    }}
                  >
                    {groupedDocuments.uncategorized.map(doc => (
                      <DocumentTile
                        key={doc.id}
                        doc={doc}
                        onClick={() => ctx.setSelectedDocumentId(doc.id)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* All documents in one grid */
            <div
              className="grid gap-6"
              style={{
                gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
              }}
            >
          {filteredDocuments.map(doc => (
            <DocumentTile
              key={doc.id}
              doc={doc}
              onClick={() => ctx.setSelectedDocumentId(doc.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * DocumentsGridOverlay - Overlay showing documents grid while keeping current document open
 * Allows switching documents without losing context
 */
export function DocumentsGridOverlay() {
  const ctx = useDocumentsContext();
  const { t } = useLanguage();

  // Filter documents by status and search query
  const filteredDocuments = useMemo(() => {
    let docs = ctx.documents;

    // Filter by status
    if (ctx.statusFilter && ctx.statusFilter !== 'all') {
      docs = docs.filter(doc => doc.status === ctx.statusFilter);
    }

    // Filter by search query
    if (ctx.searchQuery.trim()) {
      const q = ctx.searchQuery.toLowerCase();
      docs = docs.filter(doc =>
        doc.name?.toLowerCase().includes(q) ||
        doc.description?.toLowerCase().includes(q) ||
        doc.category?.toLowerCase().includes(q)
      );
    }

    return docs;
  }, [ctx.documents, ctx.searchQuery, ctx.statusFilter]);

  // Group documents by category
  const groupedDocuments = useMemo(() => {
    const groups: Record<string, DocumentRegistryItem[]> = {};
    const uncategorized: DocumentRegistryItem[] = [];

    for (const doc of filteredDocuments) {
      if (doc.category) {
        if (!groups[doc.category]) {
          groups[doc.category] = [];
        }
        groups[doc.category].push(doc);
      } else {
        uncategorized.push(doc);
      }
    }

    return { groups, uncategorized };
  }, [filteredDocuments]);

  const hasCategories = Object.keys(groupedDocuments.groups).length > 0;

  const handleSelectDocument = (docId: number) => {
    ctx.setSelectedDocumentId(docId);
    ctx.setShowDocumentsGrid(false);
    ctx.setAtomsViewMode(false);
  };

  const handleClose = () => {
    ctx.setShowDocumentsGrid(false);
  };

  return (
    <div className="absolute inset-0 z-40 bg-black/50 backdrop-blur-sm flex items-center justify-center p-8">
      <div className="bg-[var(--bg-primary)] rounded-xl border border-[var(--border-primary)] shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-primary)]">
          <div>
            <h2 className="text-lg font-semibold">{t('documents.selectDocument')}</h2>
            <p className="text-sm text-[var(--text-secondary)]">
              {filteredDocuments.length} {t('documents.countUnit')}
            </p>
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-[var(--bg-tertiary)] rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {filteredDocuments.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-8">
              <FolderOpen className="w-16 h-16 text-[var(--text-tertiary)] mb-4" />
              <h3 className="text-lg font-semibold mb-2">
                {ctx.documents.length === 0 ? t('documents.noDocuments') : t('documents.nothingFound')}
              </h3>
              <p className="text-[var(--text-secondary)] max-w-md">
                {ctx.documents.length === 0
                  ? t('documents.createFirst')
                  : t('documents.tryDifferentSearch')
                }
              </p>
            </div>
          ) : hasCategories ? (
            <div className="space-y-8">
              {/* Categorized documents */}
              {Object.entries(groupedDocuments.groups).sort(([a], [b]) => a.localeCompare(b)).map(([category, docs]) => (
                <div key={category}>
                  <h3 className="text-base font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                    {category}
                    <span className="text-sm font-normal text-[var(--text-tertiary)]">({docs.length})</span>
                  </h3>
                  <div
                    className="grid gap-6"
                    style={{
                      gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
                    }}
                  >
                    {docs.map(doc => (
                      <DocumentTile
                        key={doc.id}
                        doc={doc}
                        onClick={() => handleSelectDocument(doc.id)}
                        isSelected={doc.id === ctx.selectedDocumentId}
                      />
                    ))}
                  </div>
                </div>
              ))}

              {/* Uncategorized documents */}
              {groupedDocuments.uncategorized.length > 0 && (
                <div>
                  <h3 className="text-base font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-gray-400" />
                    {t('documents.uncategorized')}
                    <span className="text-sm font-normal text-[var(--text-tertiary)]">({groupedDocuments.uncategorized.length})</span>
                  </h3>
                  <div
                    className="grid gap-6"
                    style={{
                      gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
                    }}
                  >
                    {groupedDocuments.uncategorized.map(doc => (
                      <DocumentTile
                        key={doc.id}
                        doc={doc}
                        onClick={() => handleSelectDocument(doc.id)}
                        isSelected={doc.id === ctx.selectedDocumentId}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* All documents in one grid */
            <div
              className="grid gap-6"
              style={{
                gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
              }}
            >
              {filteredDocuments.map(doc => (
                <DocumentTile
                  key={doc.id}
                  doc={doc}
                  onClick={() => handleSelectDocument(doc.id)}
                  isSelected={doc.id === ctx.selectedDocumentId}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
