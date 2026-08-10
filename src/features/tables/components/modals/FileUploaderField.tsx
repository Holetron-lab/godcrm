import { useState, useCallback, useRef, useEffect } from 'react';
import { logger } from '@/shared/utils/logger';
import { Eye, Upload, X } from 'lucide-react';
import { Input } from '@/shared/components/ui';
import { filesApi } from '@/features/files/api/filesApi';

const parseFileUrls = (value: unknown): string[] => {
  if (!value) return [];
  const str = String(value).trim();
  if (!str) return [];
  return str.split(',').map((url) => url.trim()).filter(Boolean);
};

const getFileNameFromUrl = (url: string): string => {
  const parts = url.split('/');
  return decodeURIComponent(parts[parts.length - 1] || url);
};

interface FileUploaderFieldProps {
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
  tableId?: string;
  columnId?: string;
  accept?: string; // e.g. "image/*" for images only
  isImageType?: boolean; // Show image previews
}

export function FileUploaderField({ value, onChange, disabled, tableId, columnId, accept, isImageType }: FileUploaderFieldProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [downloadToSystem, setDownloadToSystem] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const fileUrls = parseFileUrls(value);

  // Upload files to server
  const handleUpload = useCallback(async (files: File[] | FileList | null) => {
    if (!files || (Array.isArray(files) ? files.length === 0 : files.length === 0)) return;
    setIsUploading(true);
    try {
      const fileArray = Array.isArray(files) ? files : Array.from(files);
      const result = await filesApi.upload(fileArray, {
        tableId: tableId ? Number(tableId) : undefined,
        columnId
      });
      const uploaded = Array.isArray(result) ? result : [result];
      const newUrls = uploaded.map((file) => file.url);
      onChange([...fileUrls, ...newUrls].join(','));
    } catch (error) {
      logger.error('Upload failed:', error);
    } finally {
      setIsUploading(false);
    }
  }, [fileUrls, onChange, tableId, columnId]);

  // Handle paste from clipboard (Ctrl+V)
  const handlePaste = useCallback(async (e: ClipboardEvent) => {
    if (disabled || isUploading) return;

    const items = e.clipboardData?.items;
    if (!items) return;

    const filesToUpload: File[] = [];

    for (const item of Array.from(items)) {
      // Check for image in clipboard
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          // If accept is set, check if file type matches
          if (accept && !file.type.match(accept.replace('*', '.*'))) {
            continue;
          }
          filesToUpload.push(file);
        }
      }
    }

    if (filesToUpload.length > 0) {
      e.preventDefault();
      await handleUpload(filesToUpload);
    }
  }, [disabled, isUploading, accept, handleUpload]);

  // Global paste listener when component is focused
  const [isFocused, setIsFocused] = useState(false);

  // Add global paste listener when focused
  useEffect(() => {
    if (!isFocused) return;

    const handler = (e: Event) => handlePaste(e as ClipboardEvent);
    document.addEventListener('paste', handler);
    return () => document.removeEventListener('paste', handler);
  }, [isFocused, handlePaste]);

  // Handle URL input - add external URL or download to system
  const handleAddUrl = useCallback(async () => {
    const url = urlInput.trim();
    if (!url) return;

    // Validate URL
    try {
      new URL(url);
    } catch {
      logger.error('Invalid URL:', url);
      return;
    }

    if (downloadToSystem) {
      // Download file from URL and upload to our system
      setIsUploading(true);
      try {
        const response = await fetch(url);
        const blob = await response.blob();
        const filename = url.split('/').pop() || 'downloaded-file';
        const file = new File([blob], filename, { type: blob.type });
        await handleUpload([file]);
      } catch (error) {
        logger.error('Failed to download file from URL:', error);
      } finally {
        setIsUploading(false);
      }
    } else {
      // Just add the external URL directly
      onChange([...fileUrls, url].join(','));
    }

    setUrlInput('');
    setShowUrlInput(false);
  }, [urlInput, downloadToSystem, fileUrls, onChange, handleUpload]);

  const handleRemove = useCallback((index: number) => {
    const next = fileUrls.filter((_, i) => i !== index);
    onChange(next.join(','));
  }, [fileUrls, onChange]);

  // Check if URL is an image
  const isImageUrl = (url: string) => {
    return /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)(\?.*)?$/i.test(url) ||
           url.includes('/uploads/') || // Our uploads are usually images
           isImageType;
  };

  return (
    <div
      ref={dropZoneRef}
      className="flex flex-col gap-2"
      tabIndex={0}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      onPaste={(e) => handlePaste(e.nativeEvent)}
    >
      {/* Upload buttons row */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || isUploading}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-[var(--border-primary)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Upload className="w-4 h-4" />
          {isUploading ? 'Загрузка...' : 'Выбрать файл'}
        </button>

        <button
          type="button"
          onClick={() => setShowUrlInput(!showUrlInput)}
          disabled={disabled || isUploading}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-[var(--border-primary)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          🔗 URL
        </button>

        {isImageType && (
          <span className="text-xs text-[var(--text-tertiary)]">
            или Ctrl+V для вставки
          </span>
        )}
      </div>

      {/* URL input section */}
      {showUrlInput && (
        <div className="flex flex-col gap-2 p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]">
          <div className="flex items-center gap-2">
            <Input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://example.com/image.png"
              className="flex-1"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddUrl();
                }
              }}
            />
            <button
              type="button"
              onClick={handleAddUrl}
              disabled={!urlInput.trim() || isUploading}
              className="px-3 py-2 rounded-lg bg-[var(--color-primary-500)] text-white text-sm hover:bg-[var(--color-primary-600)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Добавить
            </button>
          </div>
          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
            <input
              type="checkbox"
              checked={downloadToSystem}
              onChange={(e) => setDownloadToSystem(e.target.checked)}
              className="w-4 h-4 rounded border-[var(--border-primary)] text-[var(--color-primary-500)]"
            />
            Загрузить файл в систему (скачать и сохранить локально)
          </label>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={accept}
        className="hidden"
        onChange={(e) => {
          handleUpload(e.target.files);
          e.target.value = '';
        }}
        disabled={disabled || isUploading}
      />

      {/* File/Image list */}
      {fileUrls.length > 0 && (
        <div className={`flex ${isImageType ? 'flex-wrap gap-2' : 'flex-col gap-1'}`}>
          {fileUrls.map((url, index) => (
            <div
              key={`${url}-${index}`}
              className={`relative group ${
                isImageType && isImageUrl(url)
                  ? 'w-20 h-20 rounded-lg overflow-hidden border border-[var(--border-primary)]'
                  : 'flex items-center gap-2 text-sm'
              }`}
            >
              {isImageType && isImageUrl(url) ? (
                <>
                  <img
                    src={url}
                    alt={getFileNameFromUrl(url)}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      // Fallback if image fails to load
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => handleRemove(index)}
                    disabled={disabled}
                    className="absolute top-1 right-1 p-1 rounded-full bg-red-500 text-white opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                    title="Удалить"
                  >
                    <X className="w-3 h-3" />
                  </button>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                    title="Открыть"
                  >
                    <Eye className="w-5 h-5 text-white" />
                  </a>
                </>
              ) : (
                <>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate text-[var(--color-primary-600)] hover:underline max-w-[200px]"
                  >
                    {getFileNameFromUrl(url)}
                  </a>
                  <button
                    type="button"
                    onClick={() => handleRemove(index)}
                    disabled={disabled}
                    className="p-1 text-[var(--text-tertiary)] hover:text-[var(--color-error)] disabled:opacity-50"
                    title="Удалить файл"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
