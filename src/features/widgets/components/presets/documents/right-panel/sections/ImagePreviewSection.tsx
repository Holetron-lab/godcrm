import { useRef, useState } from 'react';
import { Link, Upload, Loader2 } from 'lucide-react';
import { logger } from '@/shared/utils/logger';
import { cn } from '@/shared/utils/cn';
import { filesApi } from '@/features/files/api/filesApi';
import { useDocumentUpdate } from '../hooks/useDocumentUpdate';

interface ImagePreviewSectionProps {
  item: { id: number; image_url?: string; content?: string; image_max_height?: number };
  tableId: number;
}

export function ImagePreviewSection({ item, tableId }: ImagePreviewSectionProps) {
  const updateItem = useDocumentUpdate(item.id, tableId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const currentUrl = item.image_url || item.content || '';
  const maxHeight = item.image_max_height || 300;

  const handleUrlChange = async (url: string) => {
    await updateItem({ image_url: url || null });
  };

  const handleMaxHeightChange = async (height: number) => {
    await updateItem({ image_max_height: height });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const result = await filesApi.upload([file], {});
      const uploadedFile = Array.isArray(result) ? result[0] : result;
      if (uploadedFile?.url) {
        const fullUrl = uploadedFile.url.startsWith('http')
          ? uploadedFile.url
          : `https://crm.hltrn.cc${uploadedFile.url}`;
        await handleUrlChange(fullUrl);
      }
    } catch (err) {
      logger.error('Image upload failed:', err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-3">
      {/* Preview */}
      {currentUrl && (
        <div className="p-2 bg-[var(--bg-tertiary)] rounded-lg">
          <img
            src={currentUrl}
            alt="Preview"
            className="max-h-32 rounded mx-auto"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        </div>
      )}

      {/* URL Input */}
      <div>
        <label className="block text-[10px] uppercase text-[var(--text-tertiary)] mb-1 flex items-center gap-1">
          <Link className="w-3 h-3" /> URL изображения
        </label>
        <input
          type="text"
          value={currentUrl}
          onChange={(e) => handleUrlChange(e.target.value)}
          placeholder="https://..."
          className="w-full px-2 py-1.5 rounded text-xs bg-[var(--bg-tertiary)] border border-[var(--border-primary)] font-mono"
        />
      </div>

      {/* Upload Button */}
      <div>
        <label className="block text-[10px] uppercase text-[var(--text-tertiary)] mb-1 flex items-center gap-1">
          <Upload className="w-3 h-3" /> Или загрузите файл
        </label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileUpload}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className={cn(
            "w-full flex items-center justify-center gap-2 px-3 py-2 rounded text-xs border border-dashed transition-colors",
            uploading
              ? "border-[var(--border-primary)] bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] cursor-wait"
              : "border-[var(--border-secondary)] hover:border-[var(--color-primary-500)] hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]"
          )}
        >
          {uploading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Загрузка...
            </>
          ) : (
            <>
              <Upload className="w-4 h-4" />
              Выбрать изображение
            </>
          )}
        </button>
      </div>

      {/* Max Height */}
      <div>
        <label className="block text-[10px] uppercase text-[var(--text-tertiary)] mb-1">
          Макс. высота (px)
        </label>
        <input
          type="number"
          value={maxHeight}
          onChange={(e) => handleMaxHeightChange(parseInt(e.target.value) || 300)}
          min={50}
          max={1000}
          className="w-24 px-2 py-1.5 rounded text-xs bg-[var(--bg-tertiary)] border border-[var(--border-primary)]"
        />
      </div>

      {/* Clear button */}
      {currentUrl && (
        <button
          onClick={() => handleUrlChange('')}
          className="w-full px-3 py-1.5 rounded text-xs text-red-400 hover:bg-red-500/10 border border-red-500/30"
        >
          Удалить изображение
        </button>
      )}
    </div>
  );
}
