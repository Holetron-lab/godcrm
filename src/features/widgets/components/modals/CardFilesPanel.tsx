import { useRef } from 'react';
import { Upload, Trash2, Paperclip, Eye, Loader2, ExternalLink } from 'lucide-react';
import type { AttachedFile } from './card-detail-types';
import { getFileIcon } from './FilePreviewModal';

interface CardFilesPanelProps {
  files: AttachedFile[];
  uploading: boolean;
  isPublicReadOnly: boolean;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void | Promise<void>;
  onRemove: (fileId: string) => void;
  onPreview: (file: AttachedFile) => void;
}

export function CardFilesPanel({
  files,
  uploading,
  isPublicReadOnly,
  onUpload,
  onRemove,
  onPreview,
}: CardFilesPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      await onUpload(e);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="mt-6 pt-4 border-t border-[var(--border-secondary)]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wide flex items-center gap-1.5">
          <Paperclip className="w-3.5 h-3.5" />
          Файлы ({files.length})
        </h3>
        {!isPublicReadOnly && (
          <>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="text-xs text-[var(--color-primary-500)] hover:text-[var(--color-primary-600)] flex items-center gap-1 disabled:opacity-50"
            >
              {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
              {uploading ? 'Загрузка...' : 'Добавить'}
            </button>
            <input ref={fileInputRef} type="file" multiple onChange={handleUpload} className="hidden" />
          </>
        )}
      </div>

      {files.length > 0 ? (
        <div className="space-y-1.5">
          {files.map((file) => (
            <div
              key={file.id}
              className="flex items-center gap-2 p-2 bg-[var(--bg-tertiary)] rounded-lg group hover:bg-[var(--bg-primary)] transition cursor-pointer"
              onClick={() => onPreview(file)}
            >
              <span className="text-base flex-shrink-0">{getFileIcon(file)}</span>
              <span className="flex-1 text-sm text-[var(--text-primary)] truncate">{file.name}</span>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                <button
                  onClick={(e) => { e.stopPropagation(); onPreview(file); }}
                  className="p-1 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:text-primary-500"
                  title="Просмотр"
                >
                  <Eye className="w-3.5 h-3.5" />
                </button>
                {file.url && !isPublicReadOnly && (
                  <a
                    href={file.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="p-1 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:text-[var(--color-primary-500)]"
                    title="Открыть"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
                {!isPublicReadOnly && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onRemove(file.id); }}
                    className="p-1 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:text-red-500"
                    title="Удалить"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : !isPublicReadOnly ? (
        <div
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-[var(--border-secondary)] rounded-lg p-4 text-center cursor-pointer hover:border-[var(--color-primary-500)] hover:bg-[var(--color-primary-500)]/5 transition"
        >
          <Upload className="w-6 h-6 mx-auto mb-1.5 text-[var(--text-tertiary)]" />
          <p className="text-xs text-[var(--text-tertiary)]">Нажмите для загрузки</p>
        </div>
      ) : (
        <p className="text-xs text-[var(--text-tertiary)] italic">Нет вложений</p>
      )}
    </div>
  );
}
