import { useState, useRef, useCallback } from 'react';
import { Upload, Loader2, X, Plus } from 'lucide-react';
import { logger } from '@/shared/utils/logger';
import { filesApi } from '@/features/files/api/filesApi';
import { getFileNameFromUrl, getFileIcon } from './kanban-utils';

// Mini File Uploader Component for Kanban cards
export interface MiniFileUploaderProps {
  value: string;
  fieldName: string;
  displayName: string;
  onUpdate: (field: string, value: string) => void;
}

export function MiniFileUploader({ value, fieldName, displayName, onUpdate }: MiniFileUploaderProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fileUrls = value ? String(value).split(',').filter(f => f.trim()) : [];

  const handleUpload = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsUploading(true);
    try {
      const result = await filesApi.upload(Array.from(files), {});
      const uploaded = Array.isArray(result) ? result : [result];
      const newUrls = uploaded.map(f => f.url);
      const allUrls = [...fileUrls, ...newUrls];
      onUpdate(fieldName, allUrls.join(','));
    } catch (error) {
      logger.error('Upload failed:', error);
    } finally {
      setIsUploading(false);
    }
  }, [fileUrls, fieldName, onUpdate]);

  const handleRemove = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const newUrls = fileUrls.filter((_, i) => i !== index);
    onUpdate(fieldName, newUrls.join(','));
  }, [fileUrls, fieldName, onUpdate]);

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); };
  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); handleUpload(e.dataTransfer.files); };

  return (
    <div className="flex-1 min-w-0 overflow-hidden">
      {/* Drop zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`
          relative min-h-[48px] rounded border-2 border-dashed transition-all cursor-pointer p-2 overflow-hidden
          ${isDragOver
            ? 'border-primary-500 bg-primary-500/10'
            : 'border-[var(--border-secondary)] hover:border-primary-400 hover:bg-primary-500/5'
          }
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleUpload(e.target.files)}
        />

        {isUploading ? (
          <div className="flex items-center justify-center gap-2 text-xs text-primary-500">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Загрузка...</span>
          </div>
        ) : fileUrls.length === 0 ? (
          <div className="flex items-center justify-center gap-2 text-xs text-[var(--text-tertiary)]">
            <Upload className="w-3.5 h-3.5" />
            <span>Перетащите файлы или нажмите</span>
          </div>
        ) : (
          <div className="space-y-1 overflow-hidden">
            {fileUrls.map((url, idx) => {
              const fullUrl = url.startsWith('http') ? url : `https://crm.hltrn.cc${url}`;
              const fileName = getFileNameFromUrl(url);
              return (
                <div key={idx} className="flex items-center gap-2 group min-w-0 max-w-full">
                  <span className="text-sm flex-shrink-0">{getFileIcon(url)}</span>
                  <a
                    href={fullUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 text-xs text-primary-500 hover:underline truncate min-w-0"
                    onClick={(e) => e.stopPropagation()}
                    title={fileName}
                  >
                    {fileName}
                  </a>
                  <button
                    onClick={(e) => handleRemove(idx, e)}
                    className="flex-shrink-0 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-500/10 text-red-500 transition"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
            {/* Add more hint */}
            <div className="flex items-center gap-1 text-[10px] text-[var(--text-tertiary)] pt-1">
              <Plus className="w-3 h-3" />
              <span>Добавить ещё</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
