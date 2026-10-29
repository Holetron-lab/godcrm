import { useState, useRef, useCallback } from 'react';
import { logger } from '@/shared/utils/logger';
import { Upload, X, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { columnSettings } from '@/shared/i18n/modules/columnSettings';
import { SafeChatImage } from '@/shared/components/SafeChatImage';
import { FilePreviewModal } from '@/features/files/components/FilePreviewModal';
import { filesApi } from '@/features/files/api/filesApi';
import { parseImageUrls, resolveAttachmentFormula, resolveAttachmentUrl } from './attachmentValue';

export interface ImageDisplayConfig {
  displayMode?: 'stack' | 'carousel' | 'grid' | 'single';
  fit?: 'cover' | 'contain' | 'fill' | 'none';
  shape?: 'square' | 'rounded' | 'circle';
  rowHeight?: number;
  maxImages?: number;
  stackOffset?: number;
  thumbnailSize?: number;
  showCount?: boolean;
  showOnHover?: boolean;
  lightbox?: boolean;
  showFilename?: boolean;
}

interface ImageCellProps {
  value: unknown;
  rawMode?: boolean;
  tableId?: number;
  rowId?: string;
  columnId?: string;
  onUpdate?: (newValue: string) => void;
  readOnly?: boolean;
  config?: {
    image?: ImageDisplayConfig;
    file?: {
      prefix?: string;
      suffix?: string;
      formula?: string;
      saveFormat?: 'url' | 'filename' | 'path';
    };
  };
  rowData?: Record<string, unknown>;
}

// Value parsing lives in ./attachmentValue (shared with FileUploaderField and
// TableViewWidget) so external JSON arrays of {path,...} render the same everywhere.
const resolveFormula = resolveAttachmentFormula;

export const ImageCell = ({ value, rawMode, tableId, rowId, columnId, onUpdate, readOnly = false, config, rowData }: ImageCellProps) => {
  const { language } = useLanguage();
  const labels = columnSettings[language].image;
  const [activeIndex, setActiveIndex] = useState(0);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fileConfig = config?.file;
  
  const computedValue = fileConfig?.formula 
    ? resolveFormula(fileConfig.formula, rowData)
    : value;

  const imageUrls = parseImageUrls(computedValue);

  // Handle image upload
  const handleUpload = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    
    setUploadError(false);
    setIsUploading(true);
    setUploadProgress(0);
    
    try {
      const result = await filesApi.upload(Array.from(files), {
        tableId,
        rowId,
        columnId,
        onProgress: setUploadProgress
      });
      
      const uploadedFiles = Array.isArray(result) ? result : [result];
      
      // Uploads belong to the table's space. Preserve the server URL; column
      // prefix/suffix/saveFormat settings describe external source values only.
      const newUrls = uploadedFiles.map(file => file.url);

      const allUrls = [...imageUrls, ...newUrls];
      
      if (onUpdate) {
        onUpdate(allUrls.join(','));
      }
    } catch (error) {
      logger.error('Upload failed:', error);
      setUploadError(true);
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  }, [imageUrls, tableId, rowId, columnId, onUpdate]);

  const handleRemove = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onUpdate) return;
    const newUrls = imageUrls.filter((_, i) => i !== index);
    onUpdate(newUrls.join(','));
  }, [imageUrls, onUpdate]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    handleUpload(e.dataTransfer.files);
  }, [handleUpload]);

  const handleClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // RAW mode
  if (rawMode) {
    if (!value || value === '') {
      return <span className="font-mono text-xs text-[var(--text-tertiary)]">NULL</span>;
    }
    return (
      <span className="font-mono text-xs text-[var(--text-secondary)] break-all">
        {typeof value === 'object' ? JSON.stringify(value) : String(value)}
      </span>
    );
  }

  const hasUploadPath = Boolean(tableId || fileConfig?.prefix);
  const isInteractive = !readOnly && hasUploadPath;

  if (!hasUploadPath && imageUrls.length === 0) {
    return <span className="text-sm text-[var(--text-tertiary)]">—</span>;
  }

  // Build full URLs for display
  const fullUrls = imageUrls.map(url => resolveAttachmentUrl(url, fileConfig, rowData));

  const imageConfig = config?.image || {};
  const mode = imageConfig.displayMode || 'stack';
  const size = mode === 'grid'
    ? Math.max(16, Math.min(64, imageConfig.thumbnailSize || 32))
    : Math.max(32, Math.min(200, imageConfig.rowHeight || 48));
  const maxImages = Math.max(1, Math.min(10, imageConfig.maxImages || 5));
  const offset = Math.max(4, Math.min(32, imageConfig.stackOffset || 12));
  const current = Math.min(activeIndex, Math.max(0, fullUrls.length - 1));
  const visibleIndices = mode === 'single' ? [0] : mode === 'carousel' ? [current]
    : fullUrls.map((_, index) => index).slice(0, mode === 'stack' ? maxImages : undefined);
  const shape = imageConfig.shape === 'circle' ? 'rounded-full' : imageConfig.shape === 'square' ? 'rounded-none' : 'rounded-lg';
  const focusClass = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500';
  const showCount = imageConfig.showCount !== false && fullUrls.length > 0;
  const lightboxUrl = lightboxIndex === null ? undefined : fullUrls[lightboxIndex];
  let previewName = lightboxUrl?.split(/[?#]/)[0].split('/').pop() || labels.viewer;
  try { previewName = decodeURIComponent(previewName); } catch { /* Keep malformed filenames readable. */ }

  // Image gallery render
  return (
    <div
      className={`
        group/cell relative min-h-[40px] rounded-lg transition-all
        ${isInteractive ? 'cursor-pointer' : 'cursor-default'}
        ${isDragOver && isInteractive ? 'ring-2 ring-primary-500 bg-primary-500/10' : ''}
        ${isUploading ? 'pointer-events-none opacity-70' : ''}
      `}
      onDragOver={isInteractive ? handleDragOver : undefined}
      onDragLeave={isInteractive ? handleDragLeave : undefined}
      onDrop={isInteractive ? handleDrop : undefined}
    >
      {isInteractive && (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            handleUpload(e.target.files);
            e.target.value = '';
          }}
        />
      )}

      {isDragOver && isInteractive && (
        <div className="absolute inset-0 flex items-center justify-center bg-primary-500/20 rounded-lg z-10 border-2 border-dashed border-primary-500">
          <div className="flex items-center gap-2 text-primary-600 dark:text-primary-400 font-medium">
            <Upload className="w-5 h-5" />
            <span>{labels.drop}</span>
          </div>
        </div>
      )}

      {isUploading && (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg-primary)]/90 rounded-lg z-10">
          <div className="flex items-center gap-2 text-[var(--text-secondary)]">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">{labels.uploading} {uploadProgress}%</span>
          </div>
        </div>
      )}

      {fullUrls.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 p-1">
          {mode === 'carousel' && fullUrls.length > 1 && (
            <button type="button" aria-label={labels.previous} disabled={current === 0}
              onClick={e => { e.stopPropagation(); setActiveIndex(current - 1); }}
              className={`p-1 text-[var(--text-primary)] disabled:opacity-40 ${focusClass}`}>
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
          <div className={mode === 'stack' ? 'relative shrink-0' : 'flex flex-wrap gap-2'}
            style={mode === 'stack' ? { width: size + (visibleIndices.length - 1) * offset, height: size + (imageConfig.showFilename ? 24 : 0) } : undefined}>
            {visibleIndices.map(index => {
              const url = fullUrls[index];
              let filename = url.split(/[?#]/)[0].split('/').pop() || '';
              try { filename = decodeURIComponent(filename); } catch { /* Keep malformed filenames readable. */ }
              const image = <SafeChatImage src={url}
                alt={(imageConfig.lightbox !== false ? labels.open : labels.attachment).replace('{number}', String(index + 1))}
                onClick={imageConfig.lightbox !== false ? () => setLightboxIndex(index) : undefined}
                className={`block bg-[var(--bg-secondary)] ${shape} ${imageConfig.showOnHover ? 'transition-transform hover:scale-125 group-focus-within:scale-125' : ''}`}
                style={{ width: size, height: size, objectFit: imageConfig.fit || 'cover' }} />;
              return <div key={`${url}-${index}`}
                className={`group ${mode === 'stack' ? 'absolute' : 'relative'} hover:!z-20 focus-within:!z-20`}
                style={{ width: size, ...(mode === 'stack' ? { left: index * offset, zIndex: visibleIndices.length - index } : {}) }}>
                {image}
                {isInteractive && (
                  <button type="button" disabled={isUploading} title={labels.remove}
                    onClick={e => handleRemove(index, e)}
                    className={`absolute top-0 right-0 p-1 bg-[var(--bg-primary)] text-[var(--text-primary)] rounded opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:text-red-500 ${focusClass}`}>
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
                {imageConfig.showFilename && <span className="block truncate text-xs text-[var(--text-secondary)] mt-1" title={filename}>{filename}</span>}
              </div>;
            })}
          </div>
          {mode === 'carousel' && fullUrls.length > 1 && (
            <button type="button" aria-label={labels.next} disabled={current >= fullUrls.length - 1}
              onClick={e => { e.stopPropagation(); setActiveIndex(current + 1); }}
              className={`p-1 text-[var(--text-primary)] disabled:opacity-40 ${focusClass}`}>
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
      {/* Hover bar pinned to the cell's bottom edge: count on the left, upload on the right;
          the scroll control of the enclosing ScrollableTextCell sits further right (pr-7). */}
      {(showCount || isInteractive) && (
        <div className="sticky bottom-0 flex items-center justify-between gap-2 pr-7 text-xs text-[var(--text-secondary)] bg-[var(--bg-primary)] opacity-0 group-hover/cell:opacity-100 group-focus-within/cell:opacity-100 transition-opacity">
          <span aria-live="polite">
            {showCount && (mode === 'carousel'
              ? labels.position.replace('{current}', String(current + 1)).replace('{total}', String(fullUrls.length))
              : labels.count.replace('{count}', String(fullUrls.length)))}
          </span>
          {isInteractive && (
            <button type="button" disabled={isUploading}
              onClick={e => { e.stopPropagation(); handleClick(); }}
              className={`p-1 rounded hover:text-primary-500 ${focusClass}`}
              title={labels.add} aria-label={labels.add}>
              <Upload className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
      {uploadError &&<p role="alert" className="text-sm text-[var(--color-error)]">{labels.uploadError}</p>}
      {lightboxUrl && <FilePreviewModal isOpen onClose={() => setLightboxIndex(null)}
        fileUrl={lightboxUrl} fileName={previewName} fileType="image" />}
    </div>
  );
};
