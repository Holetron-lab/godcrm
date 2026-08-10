import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { 
  FolderOpen,
  Image,
  ChevronRight,
  HardDrive,
  Webhook
} from 'lucide-react';
import { useLanguage } from '@/shared/i18n/LanguageContext';
import { filesApi } from '../api/filesApi';
import { FileBrowser } from './FileBrowser';

// ============================================================================
// Helper: Get file type from mime
// ============================================================================
function getFileType(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType === 'text/csv') return 'spreadsheet';
  if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('tar') || mimeType.includes('7z')) return 'archive';
  if (mimeType.includes('document') || mimeType.includes('pdf') || mimeType.includes('text/')) return 'document';
  return 'default';
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// ============================================================================
// Main FilesPanel Component
// ============================================================================
interface FilesPanelProps {
  projectId: number;
}

export function FilesPanel({ projectId }: FilesPanelProps) {
  const { language } = useLanguage();
  const t = (ru: string, en: string) => language === 'ru' ? ru : en;
  
  // Fetch files for stats
  const { data } = useQuery({
    queryKey: ['files', { projectId }],
    queryFn: () => filesApi.list({ projectId, limit: 5000 }),
    enabled: !!projectId,
  });
  
  const files = data?.files || [];
  
  // Calculate stats
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  const imageCount = files.filter(f => {
    const mime = f.mime_type || f.mimeType || '';
    return mime.startsWith('image/');
  }).length;

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] flex items-center gap-3">
            <FolderOpen className="w-7 h-7 text-amber-500" />
            {t('Файлы', 'Files')}
          </h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">
            {t('Файлы и медиа проекта', 'Project files and media storage')}
          </p>
        </div>
      </div>
      
      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg p-4">
          <div className="text-2xl font-bold text-[var(--text-primary)]">{files.length}</div>
          <div className="text-sm text-[var(--text-tertiary)]">{t('Всего файлов', 'Total Files')}</div>
        </div>
        <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg p-4">
          <div className="text-2xl font-bold text-purple-500">{imageCount}</div>
          <div className="text-sm text-[var(--text-tertiary)]">{t('Изображений', 'Images')}</div>
        </div>
        <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg p-4">
          <div className="text-2xl font-bold text-[var(--text-primary)]">{formatFileSize(totalSize)}</div>
          <div className="text-sm text-[var(--text-tertiary)]">{t('Общий размер', 'Total Size')}</div>
        </div>
      </div>
      
      {/* File Browser Component */}
      <FileBrowser 
        projectId={projectId}
        showUploader={true}
        hideHeader={true}
      />
      
      {/* Info Block */}
      <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-4">
        <h4 className="font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-2 mb-2">
          <HardDrive className="w-4 h-4" />
          {t('О хранилище файлов', 'About File Storage')}
        </h4>
        <ul className="text-sm text-[var(--text-secondary)] space-y-1 list-disc list-inside">
          <li>{t('Файлы хранятся в защищённом хранилище проекта', 'Files are stored in secure project storage')}</li>
          <li>{t('Поддерживаются изображения, документы, видео и другие форматы', 'Images, documents, videos and other formats are supported')}</li>
          <li>{t('Используйте drag-and-drop или кнопку для загрузки', 'Use drag-and-drop or the upload button')}</li>
          <li>{t('Файлы можно прикреплять к записям в таблицах', 'Files can be attached to table records')}</li>
        </ul>
      </div>
      
      {/* Link to Webhooks */}
      <div className="flex items-center justify-center">
        <Link 
          to={`/projects/${projectId}/webhooks`}
          className="flex items-center gap-2 text-sm text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <Webhook className="w-4 h-4" />
          {t('Перейти к Webhooks', 'Go to Webhooks')}
          <ChevronRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}

export default FilesPanel;
