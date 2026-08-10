import { useState, useRef, useCallback } from 'react';
import { logger } from '@/shared/utils/logger';
import { Upload, X, Loader2, ExternalLink, Eye } from 'lucide-react';
import { filesApi } from '@/features/files/api/filesApi';
import { FilePreviewModal, detectFileType, isPreviewable } from '@/features/files/components/FilePreviewModal';

interface FileCellProps {
  value: unknown;
  rawMode?: boolean;
  tableId?: number;
  rowId?: string;
  columnId?: string;
  onUpdate?: (newValue: string) => void;
  editable?: boolean;
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

// Resolve formula template like {{column_key}} with values from rowData
// Supports system variables: {{row_id}}, {{value}}
const resolveFormula = (formula: string, rowData?: Record<string, unknown>): string => {
  if (!formula || !rowData) return formula || '';
  return formula.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    // Handle system variables
    if (key === 'row_id') {
      const rowId = rowData['id'] ?? rowData['row_id'] ?? rowData['_id'];
      return rowId !== undefined && rowId !== null ? String(rowId) : '';
    }
    // Regular column value
    const val = rowData[key];
    return val !== undefined && val !== null ? String(val) : '';
  });
};

// Parse file URLs from comma-separated string
const parseFileUrls = (value: unknown): string[] => {
  if (!value) return [];
  const str = String(value).trim();
  if (!str) return [];
  return str.split(',').map(url => url.trim()).filter(Boolean);
};

// Get filename from URL
const getFileName = (url: string): string => {
  const parts = url.split('/');
  return decodeURIComponent(parts[parts.length - 1]);
};

// Get file extension
const getFileExtension = (url: string): string => {
  const fileName = getFileName(url);
  const parts = fileName.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
};

// Check if file is an image
const isImageFile = (url: string): boolean => {
  const ext = getFileExtension(url);
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext);
};

// Get icon for file by extension
const getFileIconByExt = (url: string): string => {
  const ext = getFileExtension(url);
  
  if (isImageFile(url)) return '🖼️';
  if (['pdf'].includes(ext)) return '📄';
  if (['doc', 'docx'].includes(ext)) return '📝';
  if (['xls', 'xlsx'].includes(ext)) return '📊';
  if (['ppt', 'pptx'].includes(ext)) return '📽️';
  if (['txt', 'md', 'markdown'].includes(ext)) return '📃';
  if (['js', 'ts', 'tsx', 'jsx', 'json', 'html', 'css', 'scss', 'py', 'rb', 'go', 'rs', 'java', 'cpp', 'c', 'h'].includes(ext)) return '💻';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '📦';
  if (['mp3', 'wav', 'flac', 'ogg'].includes(ext)) return '🎵';
  if (['mp4', 'avi', 'mov', 'webm', 'mkv'].includes(ext)) return '🎥';
  
  return '📎';
};

// Format URL according to saveFormat setting
const formatFileUrl = (url: string, saveFormat?: 'url' | 'filename' | 'path'): string => {
  if (!saveFormat || saveFormat === 'url') {
    return url; // Full URL (default)
  }
  
  if (saveFormat === 'filename') {
    // Extract just the filename
    return getFileName(url);
  }
  
  if (saveFormat === 'path') {
    // Extract path + filename (everything after domain)
    try {
      const urlObj = new URL(url);
      return urlObj.pathname; // e.g., /uploads/file.pdf
    } catch {
      // If not a valid URL, return as-is
      return url;
    }
  }
  
  return url;
};

// Apply prefix/suffix to formatted URL (with formula support)
const applyPrefixSuffix = (formattedUrl: string, prefix?: string, suffix?: string, rowData?: Record<string, unknown>): string => {
  const prefixStr = prefix ? resolveFormula(prefix, rowData) : '';
  const suffixStr = suffix ? resolveFormula(suffix, rowData) : '';
  return `${prefixStr}${formattedUrl}${suffixStr}`;
};

// Reconstruct full URL from stored value (reverse of formatFileUrl)
const reconstructFullUrl = (storedValue: string, saveFormat?: 'url' | 'filename' | 'path', prefix?: string, suffix?: string): string => {
  // Remove prefix/suffix if present
  let value = storedValue;
  if (prefix && value.startsWith(prefix)) {
    value = value.substring(prefix.length);
  }
  if (suffix && value.endsWith(suffix)) {
    value = value.substring(0, value.length - suffix.length);
  }
  
  // If already a full URL, return as-is
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value;
  }
  
  // If saveFormat is filename or path, we need to reconstruct
  // For now, return as-is since we don't have base URL
  // In real scenario, you might want to prepend base URL from config
  return value;
};

export const FileCell = ({ value, rawMode, tableId, rowId, columnId, onUpdate, editable = false, readOnly = false, config, rowData }: FileCellProps) => {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const [previewFile, setPreviewFile] = useState<{ url: string; name: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fileConfig = config?.file;
  
  // If formula is set, compute the value from it
  const computedValue = fileConfig?.formula 
    ? resolveFormula(fileConfig.formula, rowData)
    : value;

  const fileUrls = parseFileUrls(computedValue);

  // Handle file upload
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
      
      // Format URLs according to saveFormat and apply prefix/suffix with formula support
      const newUrls = uploadedFiles.map(f => {
        const formatted = formatFileUrl(f.url, fileConfig?.saveFormat);
        return applyPrefixSuffix(formatted, fileConfig?.prefix, fileConfig?.suffix, rowData);
      });
      
      const allUrls = [...fileUrls, ...newUrls];
      
      if (onUpdate) {
        onUpdate(allUrls.join(','));
      }
    } catch (error) {
      logger.error('Upload failed:', error);
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  }, [fileUrls, tableId, rowId, columnId, onUpdate, config, rowData, fileConfig]);

  // Handle file removal
  const handleRemove = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onUpdate) return;
    const newUrls = fileUrls.filter((_, i) => i !== index);
    onUpdate(newUrls.join(','));
  }, [fileUrls, onUpdate]);

  // Drag & drop handlers
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

  // RAW mode - show data as-is
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

  // Check if upload path is configured (prefix must be set)
  const hasUploadPath = Boolean(fileConfig?.prefix);

  // Check if cell is interactive (can upload/edit)
  // Cell is interactive only if not readOnly AND upload path is configured
  const isInteractive = !readOnly && hasUploadPath;

  // If no upload path configured and no files - show dash
  if (!hasUploadPath && fileUrls.length === 0) {
    return <span className="text-sm text-[var(--text-tertiary)]">—</span>;
  }

  // Main render - dropzone with file list
  return (
    <div
      className={`
        relative min-h-[32px] rounded-lg border-2 border-dashed transition-all
        ${isInteractive ? 'cursor-pointer' : 'cursor-default'}
        ${isDragOver && isInteractive
          ? 'border-primary-500 bg-primary-500/10' 
          : 'border-transparent'
        }
        ${isInteractive && !isDragOver ? 'hover:border-[var(--border-primary)] hover:bg-[var(--bg-secondary)]/50' : ''}
        ${isUploading ? 'pointer-events-none opacity-70' : ''}
      `}
      onDragOver={isInteractive ? handleDragOver : undefined}
      onDragLeave={isInteractive ? handleDragLeave : undefined}
      onDrop={isInteractive ? handleDrop : undefined}
      onClick={isInteractive ? handleClick : undefined}
    >
      {/* Hidden file input - only render if interactive */}
      {isInteractive && (
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            handleUpload(e.target.files);
            e.target.value = '';
          }}
        />
      )}

      {/* Upload overlay on drag */}
      {isDragOver && isInteractive && (
        <div className="absolute inset-0 flex items-center justify-center bg-primary-500/20 rounded-lg z-10">
          <div className="flex items-center gap-2 text-primary-500 font-medium">
            <Upload className="w-5 h-5" />
            <span>Drop files here</span>
          </div>
        </div>
      )}

      {/* Uploading indicator */}
      {isUploading && (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg-primary)]/80 rounded-lg z-10">
          <div className="flex items-center gap-2 text-[var(--text-secondary)]">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Uploading... {uploadProgress}%</span>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="p-1.5">
        {fileUrls.length === 0 ? (
          isInteractive ? (
            <div className="flex items-center gap-2 text-[var(--text-tertiary)] py-0.5">
              <Upload className="w-4 h-4 flex-shrink-0" />
              <span className="text-sm">Click or drop files</span>
            </div>
          ) : (
            <span className="text-sm text-[var(--text-tertiary)]">—</span>
          )
        ) : (
          <div className="flex flex-col gap-1">
            {fileUrls.map((url, index) => {
              // Compute full URL for display and links
              const fileConfig = config?.file;
              
              // If formula is used, the URL is already computed from formula
              // We need to apply prefix/suffix to the computed value
              let fullUrl: string;
              if (fileConfig?.formula) {
                // Formula mode: url is already computed, apply prefix/suffix
                fullUrl = applyPrefixSuffix(url, fileConfig?.prefix, fileConfig?.suffix, rowData);
              } else {
                // Regular mode: reconstruct from stored value
                fullUrl = reconstructFullUrl(url, fileConfig?.saveFormat, fileConfig?.prefix, fileConfig?.suffix);
                // If still not a valid URL after reconstruction, try applying prefix/suffix
                if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://')) {
                  fullUrl = applyPrefixSuffix(url, fileConfig?.prefix, fileConfig?.suffix, rowData);
                }
              }
              
              const fileName = getFileName(fullUrl);
              const isImage = isImageFile(fullUrl);
              const icon = getFileIconByExt(fullUrl);
              
              return (
                <div
                  key={`${url}-${index}`}
                  className="group flex items-center gap-2 py-0.5 px-1 rounded hover:bg-[var(--bg-tertiary)] transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  {isImage ? (
                    <img 
                      src={fullUrl} 
                      alt={fileName} 
                      className="w-5 h-5 object-cover rounded flex-shrink-0"
                      onError={(e) => {
                        (e.target as HTMLImageElement).className = 'hidden';
                      }}
                    />
                  ) : (
                    <span className="text-base flex-shrink-0 w-5 text-center">{icon}</span>
                  )}
                  
                  {/* File name: click opens preview for previewable files, otherwise opens in new tab */}
                  {isPreviewable(fullUrl) ? (
                    <span
                      role="button"
                      tabIndex={0}
                      className="flex-1 truncate text-sm text-[var(--text-secondary)] hover:text-primary-500 hover:underline cursor-pointer"
                      title={fileName}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPreviewFile({ url: fullUrl, name: fileName });
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setPreviewFile({ url: fullUrl, name: fileName }); } }}
                    >
                      {fileName}
                    </span>
                  ) : (
                    <a
                      href={fullUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 truncate text-sm text-[var(--text-secondary)] hover:text-primary-500 hover:underline"
                      title={fileName}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {fileName}
                    </a>
                  )}

                  {/* Preview button (eye icon) - only for previewable files */}
                  {isPreviewable(fullUrl) && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        setPreviewFile({ url: fullUrl, name: fileName });
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setPreviewFile({ url: fullUrl, name: fileName }); } }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 text-[var(--text-tertiary)] hover:text-green-500 transition-opacity cursor-pointer"
                      title="Preview"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </span>
                  )}
                  
                  <a
                    href={fullUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="opacity-0 group-hover:opacity-100 p-0.5 text-[var(--text-tertiary)] hover:text-primary-500 transition-opacity"
                    onClick={(e) => e.stopPropagation()}
                    title="Open in new tab"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  
                  {isInteractive && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => handleRemove(index, e)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleRemove(index, e); }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 text-[var(--text-tertiary)] hover:text-red-500 transition-opacity cursor-pointer"
                      title="Remove file"
                    >
                      <X className="w-3.5 h-3.5" />
                    </span>
                  )}
                </div>
              );
            })}
            
            {isInteractive && (
              <div className="flex items-center gap-2 text-[var(--text-tertiary)] py-0.5 px-1 opacity-50 hover:opacity-100">
                <Upload className="w-3.5 h-3.5" />
                <span className="text-xs">+ Add more</span>
              </div>
            )}
          </div>
        )}
      </div>
      
      {/* File Preview Modal */}
      {previewFile && (
        <FilePreviewModal
          isOpen={!!previewFile}
          onClose={() => setPreviewFile(null)}
          fileUrl={previewFile.url}
          fileName={previewFile.name}
          fileType={detectFileType(previewFile.url)}
        />
      )}
    </div>
  );
};
