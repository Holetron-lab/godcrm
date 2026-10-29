import { useState, useMemo, useEffect, useRef } from 'react';
import { logger } from '@/shared/utils/logger';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Printer, FileDown, ArrowLeft, ChevronDown, ChevronUp, Palette, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/shared/components/ui';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { apiClient } from '@/shared/utils/apiClient';
import type { ColumnModel, RowModel, ColumnOption } from '@/features/tables/types/table.types';
import { generatePageHTML } from './printHtmlGenerator';

// Columns that should never be printed
const IGNORED_COLUMN_TYPES = new Set([
  'button', 'dialog', 'password', 'vector', 'file', 'image', 'audio'
]);

type Orientation = 'portrait' | 'landscape';

// Scale options (percentage)
const SCALE_OPTIONS = [
  { value: 50, label: '50%' },
  { value: 60, label: '60%' },
  { value: 70, label: '70%' },
  { value: 80, label: '80%' },
  { value: 90, label: '90%' },
  { value: 100, label: '100%' },
  { value: 110, label: '110%' },
  { value: 120, label: '120%' },
  { value: 130, label: '130%' },
  { value: 150, label: '150%' },
];

// A4 dimensions in mm
const A4_PORTRAIT = { width: 210, height: 297 };
const A4_LANDSCAPE = { width: 297, height: 210 };

// Fixed rows per page - simple and predictable
// These are base values at 100% scale, adjusted by scale factor
// Reduced by 20% to prevent overflow, subsequent pages reduced by additional 15%
const BASE_ROWS_FIRST_PAGE = { portrait: 28, landscape: 18 };
const BASE_ROWS_PER_PAGE = { portrait: 27, landscape: 18 };

export function PrintPreviewPage() {
  const { language } = useLanguage();
  const t = (ru: string, en: string) => (language === 'ru' ? ru : en);
  const navigate = useNavigate();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  
  const [printData, setPrintData] = useState<{
    columns: ColumnModel[];
    rows: RowModel[];
    tableName: string;
  } | null>(null);
  
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [selectedColumnIds, setSelectedColumnIds] = useState<Set<string>>(new Set());
  const [showColumnSelector, setShowColumnSelector] = useState(true);
  const [scale, setScale] = useState<number>(100);
  const [colorMode, setColorMode] = useState<boolean>(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [previewScale, setPreviewScale] = useState(0.6);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  
  useEffect(() => {
    const updateScale = () => {
      if (previewContainerRef.current) {
        const container = previewContainerRef.current;
        const containerWidth = container.clientWidth - 40;
        const containerHeight = container.clientHeight - 80;
        
        const pageWidth = orientation === 'portrait' ? A4_PORTRAIT.width : A4_LANDSCAPE.width;
        const pageHeight = orientation === 'portrait' ? A4_PORTRAIT.height : A4_LANDSCAPE.height;
        
        const pageWidthPx = pageWidth * 3.78;
        const pageHeightPx = pageHeight * 3.78;
        
        const scaleX = containerWidth / pageWidthPx;
        const scaleY = containerHeight / pageHeightPx;
        
        const newScale = Math.min(scaleX, scaleY, 1);
        setPreviewScale(Math.max(newScale, 0.3));
      }
    };
    
    // Delay initial scale calculation to ensure container is rendered
    if (isDataLoaded) {
      requestAnimationFrame(() => {
        updateScale();
      });
    }
    
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, [orientation, isDataLoaded]);
  
  useEffect(() => {
    const stored = sessionStorage.getItem('printPreviewData');
    if (stored) {
      try {
        const data = JSON.parse(stored);
        setPrintData(data);
        const printable = data.columns.filter((col: ColumnModel) => 
          col.id !== 'id' && 
          col.name !== 'id' &&
          !IGNORED_COLUMN_TYPES.has(col.type)
        );
        setSelectedColumnIds(new Set(printable.map((c: ColumnModel) => c.id)));
        // Signal that data is loaded for scale calculation
        setTimeout(() => setIsDataLoaded(true), 50);
      } catch (e) {
        logger.error('Failed to parse print data:', e);
      }
    }
  }, []);
  
  const printableColumns = useMemo(() => {
    if (!printData?.columns) return [];
    return printData.columns.filter(col => 
      col.id !== 'id' && 
      col.name !== 'id' &&
      !IGNORED_COLUMN_TYPES.has(col.type)
    );
  }, [printData?.columns]);
  
  const selectedColumns = useMemo(() => {
    return printableColumns.filter(col => selectedColumnIds.has(col.id));
  }, [printableColumns, selectedColumnIds]);
  
  // Find columns with relation configs that need data loading
  const relationColumns = useMemo(() => {
    if (!printData?.columns) return [];
    return printData.columns.filter(col => 
      ['select', 'multi-select', 'multi_select'].includes(col.type) &&
      col.config?.relation?.enabled &&
      col.config?.relation?.tableId &&
      col.config?.relation?.valueColumn &&
      col.config?.relation?.labelColumn
    );
  }, [printData?.columns]);
  
  // Load relation options for all relation columns
  const { data: relationOptionsMap } = useQuery({
    queryKey: ['print-relation-options', relationColumns.map(c => `${c.id}:${c.config?.relation?.tableId}`).join(',')],
    queryFn: async () => {
      const map = new Map<string, Map<string, { label: string; color?: string }>>();
      
      for (const col of relationColumns) {
        const relation = col.config?.relation;
        if (!relation?.tableId || !relation?.valueColumn || !relation?.labelColumn) continue;
        const { valueColumn, labelColumn } = relation;
        
        try {
          const response = await apiClient.request<{ 
            data: { rows: Array<Record<string, unknown>> } | Array<Record<string, unknown>>
          }>(`/tables/${relation.tableId}/rows?limit=5000`);
          
          const responseData = response.data as { rows?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
          const rowsData = Array.isArray(responseData) 
            ? responseData 
            : ((responseData as { rows?: Array<Record<string, unknown>>; data?: { rows: Array<Record<string, unknown>> } })?.rows || 
               (responseData as { data?: { rows: Array<Record<string, unknown>> } })?.data?.rows || []);
          
          const optionsMap = new Map<string, { label: string; color?: string }>();
          
          type RowItem = { id?: string | number; data?: Record<string, unknown>; originalId?: string | number };
          rowsData.forEach((row: RowItem) => {
            const rowData = row.data && typeof row.data === 'object' ? row.data : (row as Record<string, unknown>);
            const rowId = row.id;
            const originalId = row.originalId;
            
            let val: string;
            if (relation.valueColumn === 'id') {
              val = String(originalId ?? rowData['id'] ?? rowId ?? '');
            } else {
              val = String(rowData[valueColumn] ?? '');
            }
            
            optionsMap.set(val, {
              label: String(rowData[labelColumn] ?? ''),
              color: relation.colorColumn ? String(rowData[relation.colorColumn] ?? '') || undefined : undefined
            });
          });
          
          map.set(col.id, optionsMap);
        } catch (e) {
          logger.error('Failed to load relation options for column', col.id, e);
        }
      }
      
      return map;
    },
    enabled: relationColumns.length > 0,
    staleTime: 60000,
  });
  
  // Calculate rows per first and subsequent pages based on scale
  const rowsFirstPage = useMemo(() => {
    const base = orientation === 'portrait' ? BASE_ROWS_FIRST_PAGE.portrait : BASE_ROWS_FIRST_PAGE.landscape;
    // More scale = larger content = fewer rows fit
    return Math.floor(base * (100 / scale));
  }, [scale, orientation]);
  
  const rowsPerPage = useMemo(() => {
    const base = orientation === 'portrait' ? BASE_ROWS_PER_PAGE.portrait : BASE_ROWS_PER_PAGE.landscape;
    return Math.floor(base * (100 / scale));
  }, [scale, orientation]);
  
  // Calculate total pages considering first page has fewer rows
  const totalPages = useMemo(() => {
    if (!printData?.rows) return 1;
    const totalRows = printData.rows.length;
    if (totalRows <= rowsFirstPage) return 1;
    // First page + remaining pages
    const remainingRows = totalRows - rowsFirstPage;
    return 1 + Math.ceil(remainingRows / rowsPerPage);
  }, [printData?.rows, rowsFirstPage, rowsPerPage]);
  
  // Calculate start/end indices for a given page
  const getPageRange = (pageNum: number): { startIdx: number; endIdx: number } => {
    if (!printData?.rows) return { startIdx: 0, endIdx: 0 };
    const totalRows = printData.rows.length;
    
    if (pageNum === 1) {
      return { startIdx: 0, endIdx: Math.min(rowsFirstPage, totalRows) };
    } else {
      const startIdx = rowsFirstPage + (pageNum - 2) * rowsPerPage;
      const endIdx = Math.min(startIdx + rowsPerPage, totalRows);
      return { startIdx, endIdx };
    }
  };
  
  useEffect(() => {
    setCurrentPage(1);
  }, [scale, orientation, selectedColumnIds]);
  
  const toggleColumn = (columnId: string) => {
    setSelectedColumnIds(prev => {
      const next = new Set(prev);
      if (next.has(columnId)) {
        next.delete(columnId);
      } else {
        next.add(columnId);
      }
      return next;
    });
  };
  
  const selectAll = () => {
    setSelectedColumnIds(new Set(printableColumns.map(c => c.id)));
  };
  
  const deselectAll = () => {
    setSelectedColumnIds(new Set());
  };
  
  const generateFullHTML = useMemo(() => {
    if (!printData) return '';
    return generatePageHTML({
      printData,
      selectedColumns,
      orientation,
      scale,
      colorMode,
      relationOptionsMap,
      totalPages,
      pageNum: 1,
      forPrint: true,
      getPageRange,
    });
  }, [printData, selectedColumns, orientation, scale, colorMode, relationOptionsMap, totalPages]);

  const previewHTML = useMemo(() => {
    if (!printData) return '';
    return generatePageHTML({
      printData,
      selectedColumns,
      orientation,
      scale,
      colorMode,
      relationOptionsMap,
      totalPages,
      pageNum: currentPage,
      forPrint: false,
      getPageRange,
    });
  }, [printData, selectedColumns, orientation, scale, colorMode, currentPage, rowsFirstPage, rowsPerPage, totalPages, relationOptionsMap]);
  
  useEffect(() => {
    if (iframeRef.current && previewHTML) {
      const doc = iframeRef.current.contentDocument;
      if (doc) {
        doc.open();
        doc.write(previewHTML);
        doc.close();
      }
    }
  }, [previewHTML]);
  
  const handlePrint = () => {
    const printFrame = document.createElement('iframe');
    printFrame.style.position = 'absolute';
    printFrame.style.left = '-9999px';
    printFrame.style.width = '0';
    printFrame.style.height = '0';
    document.body.appendChild(printFrame);
    
    const doc = printFrame.contentDocument;
    if (doc) {
      doc.open();
      doc.write(generateFullHTML);
      doc.close();
      
      setTimeout(() => {
        printFrame.contentWindow?.print();
        setTimeout(() => {
          document.body.removeChild(printFrame);
        }, 100);
      }, 100);
    }
  };
  
  const handleSavePDF = () => {
    handlePrint();
  };
  
  const handleBack = () => {
    // If opened in a popup window, close it; otherwise navigate back
    if (window.opener) {
      window.close();
    } else {
      navigate(-1);
    }
  };
  
  const goToPrevPage = () => {
    setCurrentPage(p => Math.max(1, p - 1));
  };
  
  const goToNextPage = () => {
    setCurrentPage(p => Math.min(totalPages, p + 1));
  };
  
  if (!printData) {
    return (
      <div className="flex items-center justify-center h-screen bg-[var(--bg-primary)]">
        <div className="text-center">
          <div className="text-[var(--text-secondary)] mb-4">{t('Нет данных для печати', 'No data to print')}</div>
          <Button onClick={handleBack}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            {t('Назад', 'Back')}
          </Button>
        </div>
      </div>
    );
  }
  
  const pageDimensions = orientation === 'portrait' ? A4_PORTRAIT : A4_LANDSCAPE;
  
  return (
    <div className="flex h-screen bg-[var(--bg-secondary)]">
      {/* Preview Area - Left Side */}
      <div 
        ref={previewContainerRef}
        className="flex-1 flex flex-col items-center justify-center p-4 overflow-hidden"
      >
        {/* Page Navigation */}
        <div className="flex items-center gap-4 mb-4">
          <button
            onClick={goToPrevPage}
            disabled={currentPage === 1}
            className="p-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-[var(--text-primary)]" />
          </button>
          <span className="text-sm text-[var(--text-primary)] font-medium">
            {t(`Страница ${currentPage} из ${totalPages}`, `Page ${currentPage} of ${totalPages}`)}
          </span>
          <button
            onClick={goToNextPage}
            disabled={currentPage === totalPages}
            className="p-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-primary)] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            <ChevronRight className="w-5 h-5 text-[var(--text-primary)]" />
          </button>
        </div>
        
        {/* Page Preview */}
        <div 
          className="bg-white shadow-2xl rounded-sm overflow-hidden"
          style={{ 
            width: pageDimensions.width + 'mm',
            height: pageDimensions.height + 'mm',
            transform: 'scale(' + previewScale + ')',
            transformOrigin: 'center center',
          }}
        >
          <iframe
            ref={iframeRef}
            className="w-full h-full border-0"
            title="Print Preview"
          />
        </div>
      </div>
      
      {/* Settings Panel - Right Side */}
      <div className="w-80 bg-[var(--bg-primary)] border-l border-[var(--border-primary)] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-[var(--border-primary)]">
          <div className="flex items-center gap-2 mb-2">
            <Printer className="w-5 h-5 text-[var(--color-primary-500)]" />
            <h1 className="text-lg font-semibold text-[var(--text-primary)]">{t('Печать', 'Print')}</h1>
          </div>
          <div className="text-sm text-[var(--text-secondary)]">
            {printData.tableName}
          </div>
          <div className="text-xs text-[var(--text-tertiary)] mt-1">
            {t(`${printData.rows.length} записей`, `${printData.rows.length} records`)} • {t(`${totalPages} стр.`, `${totalPages} pg.`)}
          </div>
        </div>
        
        {/* Settings - flex column, no overflow on this container */}
        <div className="flex-1 flex flex-col min-h-0 p-4 space-y-4">
          {/* Orientation */}
          <div>
            <label className="text-sm font-medium text-[var(--text-primary)] block mb-2">
              {t('Ориентация', 'Orientation')}
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setOrientation('portrait')}
                className={`flex-1 px-3 py-2 rounded-lg border text-sm transition-colors ${
                  orientation === 'portrait'
                    ? 'border-[var(--color-primary-500)] bg-[var(--color-primary-500)]/10 text-[var(--color-primary-600)]'
                    : 'border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                }`}
              >
                <div className="flex flex-col items-center gap-1">
                  <div className={`w-4 h-6 border-2 rounded ${
                    orientation === 'portrait' ? 'border-[var(--color-primary-500)]' : 'border-current'
                  }`} />
                  <span>{t('Книжная', 'Portrait')}</span>
                </div>
              </button>
              <button
                onClick={() => setOrientation('landscape')}
                className={`flex-1 px-3 py-2 rounded-lg border text-sm transition-colors ${
                  orientation === 'landscape'
                    ? 'border-[var(--color-primary-500)] bg-[var(--color-primary-500)]/10 text-[var(--color-primary-600)]'
                    : 'border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                }`}
              >
                <div className="flex flex-col items-center gap-1">
                  <div className={`w-6 h-4 border-2 rounded ${
                    orientation === 'landscape' ? 'border-[var(--color-primary-500)]' : 'border-current'
                  }`} />
                  <span>{t('Альбомная', 'Landscape')}</span>
                </div>
              </button>
            </div>
          </div>
          
          {/* Scale Select */}
          <div>
            <label className="text-sm font-medium text-[var(--text-primary)] block mb-2">
              {t('Масштаб', 'Scale')}
            </label>
            <select
              value={scale}
              onChange={(e) => setScale(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)] focus:border-transparent"
            >
              {SCALE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          
          {/* Color Mode Toggle */}
          <div>
            <label className="text-sm font-medium text-[var(--text-primary)] block mb-2">
              {t('Режим печати', 'Print mode')}
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setColorMode(true)}
                className={`flex-1 px-3 py-2 rounded-lg border text-sm transition-colors ${
                  colorMode
                    ? 'border-[var(--color-primary-500)] bg-[var(--color-primary-500)]/10 text-[var(--color-primary-600)]'
                    : 'border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  <Palette className="w-4 h-4" />
                  <span>{t('Цветная', 'Color')}</span>
                </div>
              </button>
              <button
                onClick={() => setColorMode(false)}
                className={`flex-1 px-3 py-2 rounded-lg border text-sm transition-colors ${
                  !colorMode
                    ? 'border-[var(--color-primary-500)] bg-[var(--color-primary-500)]/10 text-[var(--color-primary-600)]'
                    : 'border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 rounded-full border-2 border-current" />
                  <span>{t('Ч/Б', 'B/W')}</span>
                </div>
              </button>
            </div>
          </div>
          
          {/* Column Selector - Flex to fill remaining space */}
          <div className="flex-1 flex flex-col min-h-0">
            <button
              onClick={() => setShowColumnSelector(!showColumnSelector)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
            >
              <span className="text-sm font-medium text-[var(--text-primary)]">
                {t(`Колонки (${selectedColumnIds.size} из ${printableColumns.length})`, `Columns (${selectedColumnIds.size} of ${printableColumns.length})`)}
              </span>
              {showColumnSelector ? (
                <ChevronUp className="w-4 h-4 text-[var(--text-secondary)]" />
              ) : (
                <ChevronDown className="w-4 h-4 text-[var(--text-secondary)]" />
              )}
            </button>
            
            {showColumnSelector && (
              <div className="mt-2 flex-1 border border-[var(--border-primary)] rounded-lg overflow-hidden flex flex-col min-h-0">
                <div className="flex gap-2 p-2 bg-[var(--bg-secondary)] border-b border-[var(--border-primary)]">
                  <button
                    onClick={selectAll}
                    className="text-xs px-2 py-1 rounded bg-[var(--color-primary-500)] text-white hover:bg-[var(--color-primary-600)] transition-colors"
                  >
                    {t('Все', 'All')}
                  </button>
                  <button
                    onClick={deselectAll}
                    className="text-xs px-2 py-1 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--border-primary)] transition-colors"
                  >
                    {t('Снять', 'Clear')}
                  </button>
                </div>
                
                <div className="flex-1 overflow-y-auto">
                  {printableColumns.map(column => (
                    <label
                      key={column.id}
                      className="flex items-center gap-3 px-3 py-2 hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selectedColumnIds.has(column.id)}
                        onChange={() => toggleColumn(column.id)}
                        className="w-4 h-4 rounded border-[var(--border-primary)] text-[var(--color-primary-500)] focus:ring-[var(--color-primary-500)]"
                      />
                      <span className="text-sm text-[var(--text-primary)] truncate flex-1">
                        {column.displayName || column.name}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        
        {/* Actions */}
        <div className="p-4 border-t border-[var(--border-primary)] space-y-2">
          <Button 
            onClick={handlePrint}
            disabled={selectedColumnIds.size === 0}
            className="w-full flex items-center justify-center gap-2"
          >
            <Printer className="w-4 h-4" />
            {t('Печать', 'Print')}
          </Button>
          <Button 
            variant="secondary"
            onClick={handleSavePDF}
            disabled={selectedColumnIds.size === 0}
            className="w-full flex items-center justify-center gap-2"
          >
            <FileDown className="w-4 h-4" />
            {t('Сохранить PDF', 'Save PDF')}
          </Button>
          <Button 
            variant="secondary"
            onClick={handleBack}
            className="w-full flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            {t('Назад', 'Back')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default PrintPreviewPage;
