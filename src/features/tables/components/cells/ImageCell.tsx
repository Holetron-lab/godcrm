import { useState, useRef, useCallback } from 'react';
import { logger } from '@/shared/utils/logger';
import { Upload, X, Loader2, ExternalLink } from 'lucide-react';
import { filesApi } from '@/features/files/api/filesApi';

interface ImageCellProps {
  value: unknown;
  rawMode?: boolean;
  tableId?: number;
  rowId?: string;
  columnId?: string;
  onUpdate?: (newValue: string) => void;
  readOnly?: boolean;
  config?: {
    file?: {
      prefix?: string;
      suffix?: string;
      formula?: string;
      saveFormat?: 'url' | 'filename' | 'path';
    };
  };
  rowData?: Record<string, unknown>;
}

// Resolve formula template
const resolveFormula = (formula: string, rowData?: Record<string, unknown>): string => {
  if (!formula || !rowData) return formula || '';
  return formula.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    if (key === 'row_id') {
      const rowId = rowData['id'] ?? rowData['row_id'] ?? rowData['_id'];
      return rowId !== undefined && rowId !== null ? String(rowId) : '';
    }
    const val = rowData[key];
    return val !== undefined && val !== null ? String(val) : '';
  });
};

// Parse image URLs
const parseImageUrls = (value: unknown): string[] => {
  if (!value) return [];
  const str = String(value).trim();
  if (!str) return [];
  return str.split(',').map(url => url.trim()).filter(Boolean);
};

// Apply prefix/suffix
const applyPrefixSuffix = (url: string, prefix?: string, suffix?: string, rowData?: Record<string, unknown>): string => {
  const prefixStr = prefix ? resolveFormula(prefix, rowData) : '';
  const suffixStr = suffix ? resolveFormula(suffix, rowData) : '';
  return `${prefixStr}${url}${suffixStr}`;
};

// Format URL according to saveFormat
const formatFileUrl = (url: string, saveFormat?: 'url' | 'filename' | 'path'): string => {
  if (!saveFormat || saveFormat === 'url') return url;
  
  if (saveFormat === 'filename') {
    const parts = url.split('/');
    return decodeURIComponent(parts[parts.length - 1]);
  }
  
  if (saveFormat === 'path') {
    try {
      const urlObj = new URL(url);
      return urlObj.pathname;
    } catch {
      return url;
    }
  }
  
  return url;
};

export const ImageCell = ({ value, rawMode, tableId, rowId, columnId, onUpdate, readOnly = false, config, rowData }: ImageCellProps) => {
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
      
      const newUrls = uploadedFiles.map(f => {
        const formatted = formatFileUrl(f.url, fileConfig?.saveFormat);
        return applyPrefixSuffix(formatted, fileConfig?.prefix, fileConfig?.suffix, rowData);
      });
      
      const allUrls = [...imageUrls, ...newUrls];
      
      if (onUpdate) {
        onUpdate(allUrls.join(','));
      }
    } catch (error) {
      logger.error('Upload failed:', error);
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  }, [imageUrls, tableId, rowId, columnId, onUpdate, config, rowData, fileConfig]);

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
        {String(value)}
      </span>
    );
  }

  const hasUploadPath = Boolean(fileConfig?.prefix);
  const isInteractive = !readOnly && hasUploadPath;

  if (!hasUploadPath && imageUrls.length === 0) {
    return <span className="text-sm text-[var(--text-tertiary)]">—</span>;
  }

  // Build full URLs for display
  const fullUrls = imageUrls.map(url => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    return applyPrefixSuffix(url, fileConfig?.prefix, fileConfig?.suffix, rowData);
  });

  // Image grid render
  return (
    <div
      className={`
        relative min-h-[40px] rounded-lg transition-all
        ${isInteractive ? 'cursor-pointer' : 'cursor-default'}
        ${isDragOver && isInteractive ? 'ring-2 ring-primary-500 bg-primary-500/10' : ''}
        ${isUploading ? 'pointer-events-none opacity-70' : ''}
      `}
      onDragOver={isInteractive ? handleDragOver : undefined}
      onDragLeave={isInteractive ? handleDragLeave : undefined}
      onDrop={isInteractive ? handleDrop : undefined}
      onClick={isInteractive && fullUrls.length === 0 ? handleClick : undefined}
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
            <span>Drop images here</span>
          </div>
        </div>
      )}

      {isUploading && (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg-primary)]/90 rounded-lg z-10">
          <div className="flex items-center gap-2 text-[var(--text-secondary)]">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Uploading... {uploadProgress}%</span>
          </div>
        </div>
      )}

      {fullUrls.length === 0 ? (
        isInteractive && (
          <div className="flex items-center justify-center gap-2 text-[var(--text-tertiary)] py-2 border-2 border-dashed border-[var(--border-primary)] rounded-lg hover:border-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors">
            <Upload className="w-4 h-4" />
            <span className="text-sm">Add images</span>
          </div>
        )
      ) : (
        <div className="flex flex-wrap gap-2 p-1">
          {fullUrls.map((url, index) => (
            <div
              key={`${url}-${index}`}
              className="group relative rounded-lg overflow-hidden border border-[var(--border-color)] bg-[var(--bg-secondary)] hover:shadow-lg transition-all"
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={url}
                alt={`Image ${index + 1}`}
                className="w-16 h-16 object-cover"
                onError={(e) => {
                  // Fallback to icon if image fails to load
                  (e.target as HTMLImageElement).src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="64" height="64"%3E%3Crect fill="%23ddd" width="64" height="64"/%3E%3Ctext x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" font-size="32"%3E🖼️%3C/text%3E%3C/svg%3E';
                }}
              />
              
              {/* Overlay with actions on hover */}
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 bg-white/90 dark:bg-gray-800/90 rounded hover:bg-white dark:hover:bg-gray-700 transition-colors"
                  onClick={(e) => e.stopPropagation()}
                  title="Open in new tab"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-gray-700 dark:text-gray-300" />
                </a>
                
                {isInteractive && (
                  <button
                    onClick={(e) => handleRemove(index, e)}
                    className="p-1.5 bg-white/90 dark:bg-gray-800/90 rounded hover:bg-red-500 hover:text-white transition-colors"
                    title="Remove image"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
          
          {isInteractive && (
            <button
              onClick={handleClick}
              className="w-16 h-16 flex items-center justify-center border-2 border-dashed border-[var(--border-primary)] rounded-lg hover:border-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/20 text-[var(--text-tertiary)] hover:text-primary-500 transition-colors"
              title="Add more images"
            >
              <Upload className="w-5 h-5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
