import { useState, useEffect } from 'react';
import { logger } from '@/shared/utils/logger';
import { X, Image, File, ExternalLink, Download } from 'lucide-react';
import type { AttachedFile } from './card-detail-types';

interface FilePreviewModalProps {
  file: AttachedFile | null;
  onClose: () => void;
}

export function FilePreviewModal({ file, onClose }: FilePreviewModalProps) {
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isImage = file?.type.startsWith('image/') || false;
  const isPdf = file?.name.toLowerCase().endsWith('.pdf') || false;
  const textExtensions = ['txt', 'md', 'json', 'js', 'ts', 'tsx', 'css', 'html', 'xml', 'yaml', 'yml', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'sh', 'bash', 'sql', 'env', 'gitignore', 'dockerfile'];
  const isText = file ? textExtensions.some(ext => file.name.toLowerCase().endsWith(`.${ext}`)) : false;

  // Load text content
  useEffect(() => {
    if (file?.url && isText) {
      setLoading(true);
      setTextContent(null);
      fetch(file.url)
        .then(res => res.text())
        .then(text => {
          setTextContent(text);
          setLoading(false);
        })
        .catch(err => {
          logger.error('Failed to load file:', err);
          setTextContent('Ошибка загрузки файла');
          setLoading(false);
        });
    }
  }, [file?.url, isText]);

  if (!file || !file.url) return null;

  // Determine syntax highlighting class based on extension
  const getLanguageClass = (filename: string): string => {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const langMap: Record<string, string> = {
      'js': 'javascript', 'ts': 'typescript', 'tsx': 'typescript', 'jsx': 'javascript',
      'json': 'json', 'md': 'markdown', 'py': 'python', 'go': 'go', 'rs': 'rust',
      'sql': 'sql', 'css': 'css', 'html': 'html', 'xml': 'xml', 'yaml': 'yaml', 'yml': 'yaml',
      'sh': 'bash', 'bash': 'bash', 'java': 'java', 'c': 'c', 'cpp': 'cpp', 'h': 'c'
    };
    return langMap[ext] || 'text';
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-[var(--bg-secondary)] rounded-xl shadow-2xl max-w-5xl max-h-[90vh] w-full flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-primary)]">
          <div className="flex items-center gap-3">
            {isImage ? <Image className="w-5 h-5 text-primary-500" /> : <File className="w-5 h-5 text-[var(--text-tertiary)]" />}
            <span className="font-medium text-[var(--text-primary)] truncate">{file.name}</span>
            {isText && <span className="text-xs px-2 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]">{getLanguageClass(file.name)}</span>}
          </div>
          <div className="flex items-center gap-2">
            <a
              href={file.url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--color-primary-500)]"
              title="Открыть в новой вкладке"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
            <a
              href={file.url}
              download={file.name}
              className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--color-primary-500)]"
              title="Скачать"
            >
              <Download className="w-4 h-4" />
            </a>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto bg-[var(--bg-tertiary)]">
          {isImage ? (
            <div className="p-4 flex items-center justify-center min-h-[400px]">
              <img
                src={file.url}
                alt={file.name}
                className="max-w-full max-h-[70vh] object-contain rounded-lg shadow-lg"
              />
            </div>
          ) : isPdf ? (
            <iframe
              src={file.url}
              className="w-full h-full min-h-[600px]"
              title={file.name}
            />
          ) : isText ? (
            <div className="p-4">
              {loading ? (
                <div className="flex items-center justify-center py-12 text-[var(--text-tertiary)]">
                  <div className="animate-spin w-6 h-6 border-2 border-[var(--color-primary-500)] border-t-transparent rounded-full mr-3" />
                  Загрузка...
                </div>
              ) : (
                <pre className="bg-[var(--bg-primary)] rounded-lg p-4 overflow-x-auto text-sm font-mono text-[var(--text-secondary)] whitespace-pre-wrap break-words">
                  {textContent}
                </pre>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center py-16">
              <div className="text-center">
                <File className="w-16 h-16 mx-auto mb-4 text-[var(--text-tertiary)]" />
                <p className="text-[var(--text-secondary)] mb-4">Предпросмотр недоступен для этого типа файла</p>
                <a
                  href={file.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--color-primary-500)] text-white rounded-lg hover:bg-[var(--color-primary-600)] transition"
                >
                  <ExternalLink className="w-4 h-4" />
                  Открыть файл
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function getFileIcon(file: AttachedFile) {
  if (file.type.startsWith('image/')) return '🖼️';
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf') return '📄';
  if (['doc', 'docx'].includes(ext)) return '📝';
  if (['xls', 'xlsx'].includes(ext)) return '📊';
  if (['zip', 'rar', '7z'].includes(ext)) return '📦';
  if (['mp3', 'wav'].includes(ext)) return '🎵';
  if (['mp4', 'avi', 'mov'].includes(ext)) return '🎥';
  if (['js', 'ts', 'tsx', 'py', 'go', 'rs'].includes(ext)) return '💻';
  if (['md', 'txt'].includes(ext)) return '📃';
  return '📎';
}
