import { useState, useEffect } from 'react';
import { logger } from '@/shared/utils/logger';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Folder, Grid, List, Download, Trash2, Eye, Search, 
  ChevronLeft, MoreVertical, ExternalLink, Copy, FileText
} from 'lucide-react';
import { Button, Input, Modal } from '@/shared/components/ui';
import { FilePreviewModal, detectFileType, isPreviewable } from './FilePreviewModal';
import { filesApi, getFileIcon, formatFileSize, type FileModel } from '../api/filesApi';
import { FileUploader } from './FileUploader';
import { showToast } from '@/shared/hooks/useToast';

interface FileBrowserProps {
  spaceId?: number;
  projectId?: number;
  tableId?: number;
  rowId?: string;
  showUploader?: boolean;
  onFileSelect?: (file: FileModel) => void;
  className?: string;
  filterType?: 'all' | 'images' | 'documents';
  hideHeader?: boolean;
}

type ViewMode = 'grid' | 'list';

export const FileBrowser = ({
  spaceId,
  projectId,
  tableId,
  rowId,
  showUploader = true,
  onFileSelect,
  className = '',
  filterType = 'all',
  hideHeader = false
}: FileBrowserProps) => {
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFile, setSelectedFile] = useState<FileModel | null>(null);
  const [previewFile, setPreviewFile] = useState<FileModel | null>(null);
  const [deleteConfirmFile, setDeleteConfirmFile] = useState<FileModel | null>(null);
  const queryClient = useQueryClient();

  // Fetch files
  const { data, isLoading, refetch, error } = useQuery({
    queryKey: ['files', { spaceId, projectId, tableId, rowId }],
    queryFn: () => filesApi.list({ spaceId, projectId, tableId, rowId, limit: 100 }),
    enabled: !!(spaceId || projectId || tableId), // Only fetch when we have context
    refetchOnMount: true,
    staleTime: 0, // Always refetch
  });
  
  // Debug
  logger.debug('[FileBrowser] projectId:', projectId, 'spaceId:', spaceId, 'data:', data, 'error:', error);

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: filesApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      showToast('Файл удалён', 'success');
      setDeleteConfirmFile(null);
    },
    onError: (error: Error) => {
      showToast(error.message || 'Ошибка удаления', 'error');
    }
  });

  const files = data?.files || [];

  // Filter files by search and type
  const filteredFiles = files.filter(file => {
    const name = file.original_name || file.originalName || file.name;
    const matchesSearch = name.toLowerCase().includes(searchQuery.toLowerCase());
    
    if (!matchesSearch) return false;
    
    if (filterType === 'all') return true;
    
    const mime = file.mime_type || file.mimeType || '';
    if (filterType === 'images') {
      return mime.startsWith('image/');
    }
    if (filterType === 'documents') {
      return mime.includes('pdf') || mime.includes('document') || mime.includes('text');
    }
    
    return true;
  });

  const handleCopyUrl = (file: FileModel) => {
    navigator.clipboard.writeText(file.url);
    showToast('URL скопирован', 'success');
  };

  const handleDownload = (file: FileModel) => {
    const link = document.createElement('a');
    link.href = file.url;
    link.download = file.original_name || file.originalName || file.name;
    link.click();
  };

  const isImage = (file: FileModel) => {
    const mimeType = file.mime_type || file.mimeType;
    return mimeType?.startsWith('image/');
  };

  const isMarkdown = (file: FileModel) => {
    const mimeType = file.mime_type || file.mimeType || '';
    const fileName = getFileName(file);
    return mimeType === 'text/markdown' || 
           mimeType === 'text/x-markdown' || 
           fileName.toLowerCase().endsWith('.md');
  };

  const canPreview = (file: FileModel) => {
    if (isImage(file) || isMarkdown(file)) return true;
    // Support all previewable types from FilePreviewModal (pdf, video, audio, text, code)
    return isPreviewable(file.url || getFileName(file));
  };

  const getFileName = (file: FileModel) => file.original_name || file.originalName || file.name;
  const getMimeType = (file: FileModel) => file.mime_type || file.mimeType || '';
  const getCreatedAt = (file: FileModel) => file.created_at || file.createdAt;

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header - can be hidden when used inside FilesPanel */}
      {!hideHeader && (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h3 className="text-lg font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Folder className="w-5 h-5" />
            Файлы
            {files.length > 0 && (
              <span className="text-sm font-normal text-[var(--text-tertiary)]">
                ({files.length})
              </span>
            )}
          </h3>

          <div className="flex items-center gap-2">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
              <input
                type="text"
                placeholder="Поиск файлов..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-4 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
              />
            </div>

            {/* View mode toggle */}
            <div className="flex rounded-lg border border-[var(--border-primary)] overflow-hidden">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-2 ${viewMode === 'grid' ? 'bg-[var(--color-primary-500)] text-white' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'}`}
              >
                <Grid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 ${viewMode === 'list' ? 'bg-[var(--color-primary-500)] text-white' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'}`}
              >
                <List className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search and view toggle when header is hidden */}
      {hideHeader && (
        <div className="flex items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-tertiary)]" />
            <input
              type="text"
              placeholder="Поиск файлов..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-[var(--border-primary)] bg-[var(--bg-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]"
            />
          </div>

          <div className="flex rounded-lg border border-[var(--border-primary)] overflow-hidden">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 ${viewMode === 'grid' ? 'bg-[var(--color-primary-500)] text-white' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'}`}
            >
              <Grid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 ${viewMode === 'list' ? 'bg-[var(--color-primary-500)] text-white' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'}`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Uploader */}
      {showUploader && (
        <FileUploader
          spaceId={spaceId}
          projectId={projectId}
          tableId={tableId}
          rowId={rowId}
          onUploadComplete={() => refetch()}
          onError={(error) => showToast(error, 'error')}
        />
      )}

      {/* Files grid/list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin w-8 h-8 border-4 border-[var(--color-primary-500)] border-t-transparent rounded-full" />
        </div>
      ) : filteredFiles.length === 0 ? (
        <div className="text-center py-12 text-[var(--text-tertiary)]">
          {searchQuery ? 'Файлы не найдены' : 'Нет загруженных файлов'}
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {filteredFiles.map((file) => (
            <div
              key={file.id}
              onClick={() => {
                if (onFileSelect) { onFileSelect(file); }
                else if (canPreview(file)) { setPreviewFile(file); }
              }}
              className={`
                group relative rounded-xl border border-[var(--border-primary)] overflow-hidden
                hover:border-[var(--color-primary-500)] hover:shadow-lg transition-all cursor-pointer
                ${selectedFile?.id === file.id ? 'ring-2 ring-[var(--color-primary-500)]' : ''}
              `}
            >
              {/* Preview */}
              <div className="aspect-square bg-[var(--bg-tertiary)] flex items-center justify-center">
                {isImage(file) ? (
                  <img 
                    src={file.url} 
                    alt={getFileName(file)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-4xl">{getFileIcon(getMimeType(file))}</span>
                )}
              </div>

              {/* Info */}
              <div className="p-2">
                <p className="text-sm font-medium text-[var(--text-primary)] truncate" title={getFileName(file)}>
                  {getFileName(file)}
                </p>
                <p className="text-xs text-[var(--text-tertiary)]">
                  {formatFileSize(file.size)}
                </p>
              </div>

              {/* Hover actions */}
              <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                {canPreview(file) && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setPreviewFile(file); }}
                    className="p-1.5 rounded-lg bg-black/50 text-white hover:bg-black/70"
                    title={isMarkdown(file) ? 'Просмотр Markdown' : 'Просмотр'}
                  >
                    {isMarkdown(file) ? <FileText className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); handleDownload(file); }}
                  className="p-1.5 rounded-lg bg-black/50 text-white hover:bg-black/70"
                  title="Скачать"
                >
                  <Download className="w-4 h-4" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleCopyUrl(file); }}
                  className="p-1.5 rounded-lg bg-black/50 text-white hover:bg-black/70"
                  title="Копировать URL"
                >
                  <Copy className="w-4 h-4" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setDeleteConfirmFile(file); }}
                  className="p-1.5 rounded-lg bg-red-500/80 text-white hover:bg-red-500"
                  title="Удалить"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="border border-[var(--border-primary)] rounded-xl overflow-hidden">
          <table className="w-full">
            <thead className="bg-[var(--bg-secondary)]">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-[var(--text-secondary)]">Имя</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-[var(--text-secondary)]">Размер</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-[var(--text-secondary)]">Дата</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-[var(--text-secondary)]">Действия</th>
              </tr>
            </thead>
            <tbody>
              {filteredFiles.map((file) => (
                <tr
                  key={file.id}
                  onClick={() => {
                    if (onFileSelect) { onFileSelect(file); }
                    else if (canPreview(file)) { setPreviewFile(file); }
                  }}
                  className="border-t border-[var(--border-secondary)] hover:bg-[var(--bg-tertiary)] cursor-pointer"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{getFileIcon(getMimeType(file))}</span>
                      <span className="text-sm font-medium text-[var(--text-primary)] truncate max-w-[200px]">
                        {getFileName(file)}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-[var(--text-secondary)]">
                    {formatFileSize(file.size)}
                  </td>
                  <td className="px-4 py-3 text-sm text-[var(--text-secondary)]">
                    {getCreatedAt(file) ? new Date(getCreatedAt(file)!).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {canPreview(file) && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setPreviewFile(file); }}
                          className="p-1.5 rounded hover:bg-[var(--bg-secondary)]"
                          title={isMarkdown(file) ? 'Просмотр Markdown' : 'Просмотр'}
                        >
                          {isMarkdown(file) ? (
                            <FileText className="w-4 h-4 text-[var(--text-secondary)]" />
                          ) : (
                            <Eye className="w-4 h-4 text-[var(--text-secondary)]" />
                          )}
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDownload(file); }}
                        className="p-1.5 rounded hover:bg-[var(--bg-secondary)]"
                        title="Скачать"
                      >
                        <Download className="w-4 h-4 text-[var(--text-secondary)]" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleCopyUrl(file); }}
                        className="p-1.5 rounded hover:bg-[var(--bg-secondary)]"
                        title="Копировать URL"
                      >
                        <Copy className="w-4 h-4 text-[var(--text-secondary)]" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteConfirmFile(file); }}
                        className="p-1.5 rounded hover:bg-red-500/10"
                        title="Удалить"
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Unified file preview modal — supports image, markdown, pdf, video, audio, text */}
      {previewFile && (
        <FilePreviewModal
          isOpen={!!previewFile}
          onClose={() => setPreviewFile(null)}
          fileUrl={previewFile.url}
          fileName={getFileName(previewFile)}
          fileType={detectFileType(previewFile.url || getFileName(previewFile))}
        />
      )}

      {/* Delete confirmation modal */}
      <Modal
        open={!!deleteConfirmFile}
        onOpenChange={() => setDeleteConfirmFile(null)}
        title="Удалить файл?"
      >
        {deleteConfirmFile && (
          <div>
            <p className="text-[var(--text-secondary)] mb-4">
              Вы уверены, что хотите удалить файл "{getFileName(deleteConfirmFile)}"? Это действие нельзя отменить.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleteConfirmFile(null)}>
                Отмена
              </Button>
              <Button 
                variant="danger"
                onClick={() => deleteMutation.mutate(deleteConfirmFile.id)}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? 'Удаление...' : 'Удалить'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
