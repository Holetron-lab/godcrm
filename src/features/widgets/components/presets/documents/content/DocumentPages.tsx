import { useRequestedFocus } from '@/shared/hooks/useRequestedFocus';
import { useState, useRef, useEffect } from 'react';
import { FileText, Loader2, Edit3, Check, Scissors, MessageCircle, Paperclip } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { logger } from '@/shared/utils/logger';
import { apiClient } from '@/shared/utils/apiClient';
import { useDocumentsContext } from '../DocumentsContext';
import { useDocumentChat } from '../useDocumentChat';
import { useAIChat } from '@/features/ai-chat';
import { StatusDropdown } from '../sidebar/StatusDropdown';
import type { DocumentItem, DocumentRegistryItem } from '../../../../types/documents.types';
import { A4_ASPECT_RATIO } from './utils';

const formatCreatedAt = (value?: string): string => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
};

/**
 * DocumentPages - Renders items split into A4 pages with proper aspect ratio
 * Uses real DOM measurements for accurate page breaks - no content cutting
 * Supports both light and dark themes
 */
export interface DocumentPagesProps {
  items: DocumentItem[];
  document: DocumentRegistryItem;
  renderItemContent: (item: DocumentItem, index: number) => React.ReactNode;
  afterHeader?: React.ReactNode;
}

export function DocumentPages({ items, document, renderItemContent, afterHeader }: DocumentPagesProps) {
  const ctx = useDocumentsContext();
  const { openDocumentChat } = useDocumentChat();
  const { attachRowToMessage } = useAIChat();
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const headerMeasureRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<DocumentItem[][]>([]);
  const [pageBreaks, setPageBreaks] = useState<boolean[]>([]); // Track which pages end with page_break
  const [pageWidth, setPageWidth] = useState(595); // Default A4 width in px at 72dpi
  const [measurementKey, setMeasurementKey] = useState(0);
  const [measuredHeaderHeight, setMeasuredHeaderHeight] = useState(0);

  // Document header editing state
  const [editingHeader, setEditingHeader] = useState(false);
  const requestedFocusRef = useRequestedFocus<HTMLInputElement>(editingHeader);
  const [editDocName, setEditDocName] = useState('');
  const [editDocDescription, setEditDocDescription] = useState('');
  const [isSavingHeader, setIsSavingHeader] = useState(false);

  // Start editing document header
  const startEditingHeader = () => {
    setEditDocName(document.name || '');
    setEditDocDescription(document.description || '');
    setEditingHeader(true);
  };

  // Save document header changes
  const saveDocumentHeader = async () => {
    if (!ctx.registryTableId || !document.id) return;

    setIsSavingHeader(true);
    try {
      await apiClient.request(
        `/tables/${ctx.registryTableId}/rows/${document.id}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            data: {
              name: editDocName,
              description: editDocDescription,
            }
          }),
        }
      );
      ctx.refresh();
      setEditingHeader(false);
    } catch (error) {
      logger.error('Failed to save document header:', error);
    } finally {
      setIsSavingHeader(false);
    }
  };

  // Cancel editing
  const cancelEditingHeader = () => {
    setEditingHeader(false);
    setEditDocName('');
    setEditDocDescription('');
  };

  // Calculate page width based on container
  useEffect(() => {
    const updatePageWidth = () => {
      if (containerRef.current) {
        const containerWidth = containerRef.current.clientWidth;
        const baseWidth = Math.min(595, containerWidth - 80);
        setPageWidth(baseWidth);
      }
    };

    updatePageWidth();
    window.addEventListener('resize', updatePageWidth);
    return () => window.removeEventListener('resize', updatePageWidth);
  }, []);

  // Calculate page height from width using A4 aspect ratio
  const pageHeight = pageWidth * A4_ASPECT_RATIO;

  // Content font size - affected by contentScale (100% = real 100%, no multiplier)
  const baseFontSize = Math.max(10, pageWidth * 0.022);
  const scaleFactor = ctx.contentScale / 100;
  const contentFontSize = baseFontSize * scaleFactor;

  const isPagedMode = ctx.previewMode === 'pages';

  // Content area height with padding
  const paddingY = pageHeight * 0.06; // Reduced padding for more content space
  const paddingX = pageWidth * 0.08;
  const footerReserve = 24; // Space for page number
  const maxContentHeight = pageHeight - paddingY * 2 - footerReserve;

  // Force re-measurement when items or scale changes
  useEffect(() => {
    setMeasurementKey(k => k + 1);
  }, [items, ctx.contentScale, pageWidth]);

  // Measure header height
  useEffect(() => {
    if (headerMeasureRef.current && isPagedMode) {
      const rect = headerMeasureRef.current.getBoundingClientRect();
      setMeasuredHeaderHeight(rect.height + 16); // Add margin
    }
  }, [measurementKey, isPagedMode, contentFontSize]);

  // Measure actual heights and split into pages
  useEffect(() => {
    if (items.length === 0) {
      setPages([[]]);
      return;
    }

    // For strip/none - all items on one "page"
    if (!isPagedMode) {
      setPages([items.filter(item => !item.is_hidden)]);
      return;
    }

    // Wait for measurement container
    if (!measureRef.current) {
      setPages([items.filter(item => !item.is_hidden)]);
      return;
    }

    // Measure each item's actual rendered height
    const measureContainer = measureRef.current;
    const itemElements = measureContainer.querySelectorAll('[data-item-id]');
    const itemHeights = new Map<number, number>();

    itemElements.forEach((el) => {
      const itemId = parseInt(el.getAttribute('data-item-id') || '0', 10);
      const rect = el.getBoundingClientRect();
      itemHeights.set(itemId, rect.height + 4); // Small gap between items
    });

    // Calculate available height for first page (minus header)
    const maxFirstPageContentHeight = maxContentHeight - measuredHeaderHeight;

    // Now split into pages based on real heights
    // Handle: page_break, keep_with_next, and normal items
    const visibleItems = items.filter(item => !item.is_hidden);
    const itemsPerPage: DocumentItem[][] = [];
    const pageHasBreak: boolean[] = []; // Track if page ends with page_break
    let currentPage: DocumentItem[] = [];
    let currentHeight = 0;
    let isFirstPage = true;

    for (let i = 0; i < visibleItems.length; i++) {
      const item = visibleItems[i];
      const nextItem = visibleItems[i + 1];

      // page_break forces a new page after current content
      if (item.level === 'page_break') {
        if (currentPage.length > 0) {
          itemsPerPage.push(currentPage);
          pageHasBreak.push(true); // This page ends with page_break
          currentPage = [];
          currentHeight = 0;
          isFirstPage = false;
        }
        continue; // Don't add page_break to page content
      }

      const itemHeight = itemHeights.get(item.id) || 30;
      const maxHeight = isFirstPage ? maxFirstPageContentHeight : maxContentHeight;

      // Check if this item has keep_with_next and calculate combined height
      let combinedHeight = itemHeight;
      if (item.keep_with_next && nextItem && nextItem.level !== 'page_break') {
        const nextHeight = itemHeights.get(nextItem.id) || 30;
        combinedHeight = itemHeight + nextHeight;
      }

      // Headers (h2, h3) automatically keep with next text block
      const isHeader = item.level === 'h2' || item.level === 'h3';
      if (isHeader && nextItem && (nextItem.level === 'text' || nextItem.level === 'image')) {
        const nextHeight = itemHeights.get(nextItem.id) || 30;
        combinedHeight = itemHeight + nextHeight;
      }

      // If combined items don't fit and we have items on current page, start new page
      if (currentHeight + combinedHeight > maxHeight && currentPage.length > 0) {
        itemsPerPage.push(currentPage);
        pageHasBreak.push(false); // Natural page break, not forced
        currentPage = [item];
        currentHeight = itemHeight;
        isFirstPage = false;
      } else {
        currentPage.push(item);
        currentHeight += itemHeight;
      }
    }

    if (currentPage.length > 0) {
      itemsPerPage.push(currentPage);
      pageHasBreak.push(false); // Last page doesn't end with break
    }

    if (itemsPerPage.length === 0) {
      itemsPerPage.push([]);
      pageHasBreak.push(false);
    }

    setPages(itemsPerPage);
    setPageBreaks(pageHasBreak);
  }, [items, isPagedMode, measurementKey, maxContentHeight, measuredHeaderHeight]);

  const showBorder = ctx.previewMode !== 'none';

  // View scale for zoom (100% displays as 140% to match visual expectations)
  const viewScaleFactor = (ctx.viewScale / 100) * 1.4;

  // Calculate scaled dimensions to reserve proper scroll space
  const scaledHeight = pages.length * (pageHeight + 24) * viewScaleFactor; // 24 = gap

  return (
    <div
      ref={containerRef}
      className="flex flex-col items-center"
      style={{
        minHeight: `${scaledHeight + 100}px`, // Reserve space for scaled content
        paddingTop: '24px',
        paddingBottom: '24px',
      }}
    >
      {/* Hidden measurement container - renders all items for height calculation */}
      {isPagedMode && (
        <>
          {/* Measure header */}
          <div
            ref={headerMeasureRef}
            className="absolute opacity-0 pointer-events-none -z-10"
            style={{
              width: `${pageWidth - paddingX * 2}px`,
              fontSize: `${contentFontSize}px`,
              left: '-9999px',
            }}
            aria-hidden="true"
          >
            <div className="pb-3 border-b border-gray-200">
              <div className="flex items-center gap-3">
                <span style={{ fontSize: `${contentFontSize * 1.8}px` }}>{document.icon || '📄'}</span>
                <div>
                  <h1 style={{ fontSize: `${contentFontSize * 1.6}px`, fontWeight: 700 }}>
                    {document.name}
                  </h1>
                  {document.description && (
                    <p style={{ fontSize: `${contentFontSize * 0.85}px`, marginTop: '4px' }}>
                      {document.description}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Measure items */}
          <div
            ref={measureRef}
            key={measurementKey}
            className="absolute opacity-0 pointer-events-none -z-10"
            style={{
              width: `${pageWidth - paddingX * 2}px`,
              fontSize: `${contentFontSize}px`,
              lineHeight: 1.5,
              left: '-9999px',
            }}
            aria-hidden="true"
          >
            {items.filter(item => !item.is_hidden).map((item, index) => (
              <div key={item.id} data-item-id={item.id}>
                {renderItemContent(item, index)}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Scaled container */}
      <div
        style={{
          transform: `scale(${viewScaleFactor})`,
          transformOrigin: 'top center',
        }}
      >
        <div className="flex flex-col items-center gap-6">
          {pages.map((pageItems, pageIndex) => (
            <div
              key={pageIndex}
              className={cn(
                "relative flex flex-col",
                showBorder && "shadow-2xl rounded-sm bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-gray-700",
                !showBorder && "bg-transparent"
              )}
              style={{
                width: `${pageWidth}px`,
                // Height: fixed for pages mode, auto for strip/none
                height: isPagedMode ? `${pageHeight}px` : 'auto',
                minHeight: isPagedMode ? undefined : '200px',
                padding: `${paddingY}px ${paddingX}px`,
                overflow: 'hidden', // Prevent content from overflowing the page
              }}
            >
              {/* Page number footer - only in pages mode */}
              {isPagedMode && (
                <div
                  className="absolute bottom-2 left-0 right-0 text-center text-gray-400 dark:text-gray-500"
                  style={{ fontSize: `${contentFontSize * 0.7}px` }}
                >
                  Страница {pageIndex + 1} из {pages.length}
                </div>
              )}

              {/* First page header - scales with content, editable on click */}
              {pageIndex === 0 && (
                <div className="mb-3 pb-2 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                  {editingHeader ? (
                    /* Editing mode */
                    <div className="flex items-start gap-3">
                      <span style={{ fontSize: `${contentFontSize * 1.8}px` }}>{document.icon || '📄'}</span>
                      <div className="flex-1 space-y-2">
                        <input
                          type="text"
                          value={editDocName}
                          onChange={(e) => setEditDocName(e.target.value)}
                          className="w-full px-2 py-1 font-bold text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800 border border-blue-500 rounded outline-none"
                          style={{ fontSize: `${contentFontSize * 1.6}px` }}
                          placeholder="Название документа"
                          ref={requestedFocusRef}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              saveDocumentHeader();
                            }
                            if (e.key === 'Escape') cancelEditingHeader();
                          }}
                        />
                        <textarea
                          value={editDocDescription}
                          onChange={(e) => setEditDocDescription(e.target.value)}
                          className="w-full px-2 py-1 text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-800 border border-blue-500 rounded outline-none resize-none"
                          style={{ fontSize: `${contentFontSize * 0.85}px` }}
                          placeholder="Описание документа (необязательно)"
                          rows={2}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && e.ctrlKey) {
                              e.preventDefault();
                              saveDocumentHeader();
                            }
                            if (e.key === 'Escape') cancelEditingHeader();
                          }}
                        />
                        <div className="flex items-center gap-2">
                          <button
                            onClick={saveDocumentHeader}
                            disabled={isSavingHeader || !editDocName.trim()}
                            className="px-3 py-1 text-xs font-medium text-white bg-blue-500 rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                          >
                            {isSavingHeader ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                            Сохранить
                          </button>
                          <button
                            onClick={cancelEditingHeader}
                            className="px-3 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
                          >
                            Отмена
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Display mode - clickable to edit */
                    <div className="group rounded-lg -m-2 p-2 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                      <div role="presentation"
                        className="flex items-center gap-3 cursor-pointer"
                        onClick={startEditingHeader}
                        title="Нажмите чтобы редактировать"
                      >
                        <span style={{ fontSize: `${contentFontSize * 1.8}px` }}>{document.icon || '📄'}</span>
                        <div className="flex-1">
                          <h1
                            className="font-bold text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors"
                            style={{ fontSize: `${contentFontSize * 1.6}px` }}
                          >
                            <button type="button" className="text-left">{document.name}</button>
                          </h1>
                          <div className="flex items-center gap-2" style={{ marginTop: '2px' }}>
                            {document.description ? (
                              <p
                                className="flex-1 text-gray-600 dark:text-gray-400 group-hover:text-blue-500/70 dark:group-hover:text-blue-400/70 transition-colors"
                                style={{ fontSize: `${contentFontSize * 0.85}px` }}
                              >
                                {document.description}
                              </p>
                            ) : (
                              <p
                                className="flex-1 text-gray-400 dark:text-gray-500 italic opacity-0 group-hover:opacity-100 transition-opacity"
                                style={{ fontSize: `${contentFontSize * 0.85}px` }}
                              >
                                Добавить описание...
                              </p>
                            )}
                            {/* Chat + Attach buttons - inline with description.
                                Internal-only — hidden on the public surface
                                (ADR-0060). */}
                            {ctx.dataSource !== 'public' && (
                              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openDocumentChat(document.id, document.name || '');
                                  }}
                                  className="p-1 rounded bg-blue-500/80 text-white hover:bg-blue-600 transition-colors"
                                  title="Open chat"
                                >
                                  <MessageCircle className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    attachRowToMessage({
                                      table_id: ctx.registryTableId || 0,
                                      row_id: document.id,
                                      table_name: 'Documents',
                                      table_icon: '📄',
                                      row_title: document.name || `#${document.id}`,
                                    });
                                  }}
                                  className="p-1 rounded bg-green-500/80 text-white hover:bg-green-600 transition-colors"
                                  title="Attach to message"
                                >
                                  <Paperclip className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                        <Edit3 className="w-4 h-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Meta row (Status · Type · Created) — below the header divider */}
              {pageIndex === 0 && !editingHeader && (
                <div
                  className="mb-3 flex flex-wrap items-center gap-y-2 text-gray-600 dark:text-gray-300 flex-shrink-0"
                  style={{ fontSize: `${contentFontSize * 1.1}px`, columnGap: `${contentFontSize * 2.5}px` }}

                >
                  <span className="inline-flex items-center gap-2">
                    <span className="font-semibold tracking-wide">Status:</span>
                    <StatusDropdown
                      doc={document}
                      registryTableId={ctx.registryTableId ?? null}
                      onUpdate={ctx.refresh}
                      size="md"
                    />
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="font-semibold tracking-wide">Type:</span>
                    <span className="text-gray-800 dark:text-gray-100 font-medium">
                      {document.category || '—'}
                    </span>
                  </span>
                  {document.created_at && (
                    <span className="inline-flex items-center gap-2 ml-auto">
                      <span className="font-semibold tracking-wide">Created:</span>
                      <span className="text-gray-700 dark:text-gray-200 font-normal tabular-nums">
                        {formatCreatedAt(document.created_at)}
                      </span>
                    </span>
                  )}
                </div>
              )}

              {/* After-header slot (BDD panel etc.) — first page only */}
              {pageIndex === 0 && afterHeader && (
                <div className="mb-3 flex-shrink-0">{afterHeader}</div>
              )}

              {/* Page content */}
              <div
                className="flex-1 text-gray-900 dark:text-gray-100"
                style={{
                  '--content-scale': scaleFactor,
                  fontSize: `${contentFontSize}px`,
                  lineHeight: 1.5,
                } as React.CSSProperties}
              >
                {pageItems.map((item, index) => renderItemContent(item, index))}

                {/* Page break indicator at bottom of page */}
                {pageBreaks[pageIndex] && (
                  <div className="flex items-center gap-2 mt-4 pt-2">
                    <div className="flex-1 border-t border-dashed border-gray-400 dark:border-gray-500" />
                    <Scissors className="w-4 h-4 text-gray-400 dark:text-gray-500 rotate-90" />
                    <div className="flex-1 border-t border-dashed border-gray-400 dark:border-gray-500" />
                  </div>
                )}
              </div>

              {/* Empty page */}
              {pageItems.length === 0 && pageIndex === 0 && (
                <div className="flex flex-col items-center justify-center flex-1 text-gray-400 dark:text-gray-500">
                  <FileText className="w-12 h-12 mb-4 opacity-50" />
                  <p>Документ пуст</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
