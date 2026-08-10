/**
 * MarkdownPreviewModal - модальное окно для просмотра Markdown файлов
 * 
 * Загружает .md файл по URL и отображает его с форматированием
 */

import { useState, useEffect } from 'react';
import { X, Download, ExternalLink, Copy, Check, FileText, Maximize2, Minimize2 } from 'lucide-react';
import { MarkdownPreview } from './MarkdownPreview';
import { showToast } from '@/shared/hooks/useToast';
import { useLanguage } from '@/shared/i18n/LanguageContext';

interface MarkdownPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileUrl: string;
  fileName: string;
}

export function MarkdownPreviewModal({ 
  isOpen, 
  onClose, 
  fileUrl, 
  fileName 
}: MarkdownPreviewModalProps) {
  const { language } = useLanguage();
  const t = (ru: string, en: string) => (language === 'ru' ? ru : en);
  const [content, setContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (isOpen && fileUrl) {
      setIsLoading(true);
      setError(null);
      
      fetch(fileUrl)
        .then(response => {
          if (!response.ok) {
            throw new Error(t('Не удалось загрузить файл', 'Failed to load file'));
          }
          return response.text();
        })
        .then(text => {
          setContent(text);
          setIsLoading(false);
        })
        .catch(err => {
          setError(err.message);
          setIsLoading(false);
        });
    }
  }, [isOpen, fileUrl]);

  const handleCopyContent = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    showToast(t('Содержимое скопировано', 'Content copied'), 'success');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = fileUrl;
    link.download = fileName;
    link.click();
  };

  const handleOpenExternal = () => {
    window.open(fileUrl, '_blank');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div 
        className={`
          relative bg-[var(--bg-primary)] rounded-xl shadow-2xl
          flex flex-col overflow-hidden
          ${isFullscreen 
            ? 'w-full h-full rounded-none' 
            : 'w-[90vw] max-w-4xl h-[85vh]'
          }
        `}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-primary-500" />
            <h2 className="text-lg font-semibold text-[var(--text-primary)] truncate max-w-md">
              {fileName}
            </h2>
          </div>
          
          <div className="flex items-center gap-2">
            {/* Copy */}
            <button
              onClick={handleCopyContent}
              className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              title={t('Копировать содержимое', 'Copy content')}
            >
              {copied ? <Check className="w-5 h-5 text-green-500" /> : <Copy className="w-5 h-5" />}
            </button>
            
            {/* Download */}
            <button
              onClick={handleDownload}
              className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              title={t('Скачать файл', 'Download file')}
            >
              <Download className="w-5 h-5" />
            </button>
            
            {/* Open external */}
            <button
              onClick={handleOpenExternal}
              className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              title={t('Открыть в новой вкладке', 'Open in new tab')}
            >
              <ExternalLink className="w-5 h-5" />
            </button>
            
            {/* Fullscreen toggle */}
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              title={isFullscreen ? t('Выйти из полноэкранного режима', 'Exit fullscreen') : t('Полноэкранный режим', 'Fullscreen')}
            >
              {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
            </button>
            
            {/* Close */}
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-red-500/10 text-[var(--text-secondary)] hover:text-red-500 transition-colors"
              title={t('Закрыть', 'Close')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="flex flex-col items-center gap-3">
                <div className="animate-spin w-8 h-8 border-4 border-[var(--color-primary-500)] border-t-transparent rounded-full" />
                <span className="text-[var(--text-tertiary)]">{t('Загрузка документа...', 'Loading document...')}</span>
              </div>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="text-red-500 mb-2">⚠️ {t('Ошибка загрузки', 'Loading error')}</div>
                <p className="text-[var(--text-tertiary)]">{error}</p>
                <button
                  onClick={() => window.location.reload()}
                  className="mt-4 px-4 py-2 bg-[var(--color-primary-500)] text-white rounded-lg hover:bg-[var(--color-primary-600)]"
                >
                  {t('Попробовать снова', 'Try again')}
                </button>
              </div>
            </div>
          ) : (
            <MarkdownPreview content={content} />
          )}
        </div>
      </div>
    </div>
  );
}

export default MarkdownPreviewModal;
