import { useState, useEffect, useCallback, useRef } from 'react';
import '@google/model-viewer';
import { createPortal } from 'react-dom';
import { 
  X, 
  Sun, 
  Moon, 
  Edit3, 
  Save, 
  Download,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Maximize2,
  ChevronLeft,
  ChevronRight,
  FileText,
  Eye
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface FilePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileUrl?: string;
  fileName: string;
  fileType: 'image' | 'markdown' | 'pdf' | 'video' | 'audio' | 'text' | '3d' | 'unknown';
  onSave?: (content: string) => Promise<void>;
  canEdit?: boolean;
  // If provided, markdown/text content is rendered directly without fetching fileUrl.
  inlineContent?: string;
  // Extra controls injected into the header toolbar (left of theme toggle).
  extraHeaderActions?: React.ReactNode;
  // Optional secondary line under the filename (e.g. status pill, category).
  headerSubtitle?: React.ReactNode;
}

// Detect file type from URL
export const detectFileType = (url: string): FilePreviewModalProps['fileType'] => {
  const ext = url.split('.').pop()?.toLowerCase() || '';
  
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext)) {
    return 'image';
  }
  if (['md', 'markdown'].includes(ext)) {
    return 'markdown';
  }
  if (ext === 'pdf') {
    return 'pdf';
  }
  if (['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'].includes(ext)) {
    return 'video';
  }
  if (['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a'].includes(ext)) {
    return 'audio';
  }
  if (['glb', 'gltf'].includes(ext)) {
    return '3d';
  }
  if (['txt', 'log', 'json', 'xml', 'csv', 'html', 'css', 'js', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'cpp', 'c', 'h'].includes(ext)) {
    return 'text';
  }
  
  return 'unknown';
};

// Check if file type is previewable
export const isPreviewable = (url: string): boolean => {
  const type = detectFileType(url);
  return type !== 'unknown';
};

export const FilePreviewModal = ({
  isOpen,
  onClose,
  fileUrl,
  fileName,
  fileType,
  onSave,
  canEdit = false,
  inlineContent,
  extraHeaderActions,
  headerSubtitle,
}: FilePreviewModalProps) => {
  const [isDarkBg, setIsDarkBg] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [content, setContent] = useState('');
  const [editContent, setEditContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Image specific state
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  
  // Load content for text-based files
  useEffect(() => {
    if (!isOpen) return;

    if (fileType === 'markdown' || fileType === 'text') {
      // Inline content bypasses the fetch — used by chat row atoms that
      // assemble markdown from registry rows on the fly.
      if (inlineContent !== undefined) {
        setContent(inlineContent);
        setEditContent(inlineContent);
        setLoading(false);
        setError(null);
        return;
      }
      if (!fileUrl) return;
      setLoading(true);
      setError(null);

      fetch(fileUrl)
        .then(res => {
          if (!res.ok) throw new Error('Failed to load file');
          return res.text();
        })
        .then(text => {
          setContent(text);
          setEditContent(text);
        })
        .catch(err => setError(err.message))
        .finally(() => setLoading(false));
    }
  }, [isOpen, fileUrl, fileType, inlineContent]);
  
  // Reset state on close
  useEffect(() => {
    if (!isOpen) {
      setIsEditing(false);
      setZoom(1);
      setRotation(0);
      setError(null);
    }
  }, [isOpen]);
  
  const handleSave = useCallback(async () => {
    if (!onSave) return;
    
    setSaving(true);
    try {
      await onSave(editContent);
      setContent(editContent);
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [editContent, onSave]);
  
  const handleDownload = useCallback(() => {
    if (fileUrl) {
      const a = document.createElement('a');
      a.href = fileUrl;
      a.download = fileName;
      a.click();
      return;
    }
    if (!content) return;
    const ext = fileType === 'markdown' ? 'md' : 'txt';
    const safeName = fileName.endsWith(`.${ext}`) ? fileName : `${fileName}.${ext}`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeName;
    a.click();
    URL.revokeObjectURL(url);
  }, [fileUrl, fileName, fileType, content]);
  
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (isEditing) {
        setIsEditing(false);
        setEditContent(content);
      } else {
        onClose();
      }
    }
  }, [isEditing, content, onClose]);
  
  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);
  
  if (!isOpen) return null;
  
  const bgClass = isDarkBg 
    ? 'bg-[#1a1a1a] text-gray-100' 
    : 'bg-white text-gray-900';
  
  const toolbarBgClass = isDarkBg
    ? 'bg-[#2a2a2a] border-[#3a3a3a]'
    : 'bg-gray-100 border-gray-200';
    
  const modalContent = (
    <div 
      className="fixed inset-0 z-[100] flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      
      {/* Modal — responsive: full screen on mobile, 95vw/90vh on desktop */}
      <div
        className={`relative w-[100vw] h-[100vh] sm:w-[95vw] sm:h-[90vh] sm:max-w-7xl sm:rounded-lg shadow-2xl flex flex-col overflow-hidden ${bgClass}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`flex items-center justify-between px-3 py-2 sm:px-4 sm:py-3 border-b ${toolbarBgClass}`}>
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
            <FileText className="w-4 h-4 sm:w-5 sm:h-5 opacity-60 flex-shrink-0" />
            <div className="flex flex-col min-w-0">
              <span className="font-medium truncate max-w-[50vw] sm:max-w-md text-sm sm:text-base">{fileName}</span>
              {headerSubtitle && (
                <div className="text-xs opacity-70 truncate max-w-[50vw] sm:max-w-md">{headerSubtitle}</div>
              )}
            </div>
          </div>

          {/* Toolbar */}
          <div className="flex items-center gap-2">
            {extraHeaderActions && (
              <>
                {extraHeaderActions}
                <div className="w-px h-5 bg-current opacity-20" />
              </>
            )}
            {/* Theme toggle */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setIsDarkBg(!isDarkBg); }}
              className={`p-2 rounded-lg transition-colors ${isDarkBg ? 'hover:bg-white/10' : 'hover:bg-black/10'}`}
              title={isDarkBg ? 'Light background' : 'Dark background'}
            >
              {isDarkBg ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            
            {/* Image controls */}
            {fileType === 'image' && (
              <>
                <div className="w-px h-5 bg-current opacity-20" />
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setZoom(z => Math.max(0.25, z - 0.25)); }}
                  className={`p-2 rounded-lg transition-colors ${isDarkBg ? 'hover:bg-white/10' : 'hover:bg-black/10'}`}
                  title="Zoom out"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <span className="text-sm opacity-60 min-w-[3rem] text-center">{Math.round(zoom * 100)}%</span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setZoom(z => Math.min(4, z + 0.25)); }}
                  className={`p-2 rounded-lg transition-colors ${isDarkBg ? 'hover:bg-white/10' : 'hover:bg-black/10'}`}
                  title="Zoom in"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setRotation(r => (r + 90) % 360); }}
                  className={`p-2 rounded-lg transition-colors ${isDarkBg ? 'hover:bg-white/10' : 'hover:bg-black/10'}`}
                  title="Rotate"
                >
                  <RotateCw className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setZoom(1); setRotation(0); }}
                  className={`p-2 rounded-lg transition-colors ${isDarkBg ? 'hover:bg-white/10' : 'hover:bg-black/10'}`}
                  title="Reset"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
              </>
            )}
            
            {/* Edit controls for markdown/text */}
            {(fileType === 'markdown' || fileType === 'text') && canEdit && (
              <>
                <div className="w-px h-5 bg-current opacity-20" />
                {isEditing ? (
                  <>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setIsEditing(false); }}
                      className={`p-2 rounded-lg transition-colors ${isDarkBg ? 'hover:bg-white/10' : 'hover:bg-black/10'}`}
                      title="Preview"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleSave(); }}
                      disabled={saving}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors disabled:opacity-50"
                    >
                      <Save className="w-4 h-4" />
                      <span className="text-sm">{saving ? 'Saving...' : 'Save'}</span>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setIsEditing(true); }}
                    className={`p-2 rounded-lg transition-colors ${isDarkBg ? 'hover:bg-white/10' : 'hover:bg-black/10'}`}
                    title="Edit"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                )}
              </>
            )}
            
            <div className="w-px h-5 bg-current opacity-20" />
            
            {/* Download */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleDownload(); }}
              className={`p-2 rounded-lg transition-colors ${isDarkBg ? 'hover:bg-white/10' : 'hover:bg-black/10'}`}
              title="Download"
            >
              <Download className="w-4 h-4" />
            </button>
            
            {/* Close */}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              className={`p-2 rounded-lg transition-colors ${isDarkBg ? 'hover:bg-white/10' : 'hover:bg-black/10'}`}
              title="Close (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-auto">
          {loading && (
            <div className="flex items-center justify-center h-full">
              <div className="animate-spin w-8 h-8 border-2 border-current border-t-transparent rounded-full" />
            </div>
          )}
          
          {error && (
            <div className="flex items-center justify-center h-full text-red-500">
              <p>{error}</p>
            </div>
          )}
          
          {!loading && !error && (
            <>
              {/* Image Preview */}
              {fileType === 'image' && (
                <div className="flex items-center justify-center h-full p-4 overflow-auto">
                  <img
                    src={fileUrl}
                    alt={fileName}
                    className="max-w-none transition-transform duration-200"
                    style={{ 
                      transform: `scale(${zoom}) rotate(${rotation}deg)`,
                      transformOrigin: 'center'
                    }}
                    draggable={false}
                  />
                </div>
              )}
              
              {/* Markdown Preview/Edit */}
              {fileType === 'markdown' && (
                isEditing ? (
                  <div className="h-full flex">
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className={`flex-1 p-4 font-mono text-sm resize-none outline-none ${isDarkBg ? 'bg-[#1a1a1a]' : 'bg-white'}`}
                      spellCheck={false}
                    />
                  </div>
                ) : (
                  <div className={`p-6 prose prose-lg max-w-none ${isDarkBg ? 'prose-invert' : ''}`}>
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        // Custom heading styles
                        h1: ({ children }) => (
                          <h1 className={`text-3xl font-bold ${isDarkBg ? 'text-gray-100' : 'text-gray-900'} border-b ${isDarkBg ? 'border-gray-700' : 'border-gray-300'} pb-3 mb-6 mt-2`}>
                            {children}
                          </h1>
                        ),
                        h2: ({ children }) => (
                          <h2 className={`text-2xl font-semibold ${isDarkBg ? 'text-gray-100' : 'text-gray-900'} border-b ${isDarkBg ? 'border-gray-700' : 'border-gray-200'} pb-2 mb-4 mt-8`}>
                            {children}
                          </h2>
                        ),
                        h3: ({ children }) => (
                          <h3 className={`text-xl font-semibold ${isDarkBg ? 'text-gray-200' : 'text-gray-800'} mb-3 mt-6`}>
                            {children}
                          </h3>
                        ),
                        h4: ({ children }) => (
                          <h4 className={`text-lg font-semibold ${isDarkBg ? 'text-gray-200' : 'text-gray-800'} mb-2 mt-4`}>
                            {children}
                          </h4>
                        ),
                        h5: ({ children }) => (
                          <h5 className={`text-base font-semibold ${isDarkBg ? 'text-gray-300' : 'text-gray-700'} mb-2 mt-3`}>
                            {children}
                          </h5>
                        ),
                        h6: ({ children }) => (
                          <h6 className={`text-sm font-semibold ${isDarkBg ? 'text-gray-400' : 'text-gray-600'} mb-1 mt-2`}>
                            {children}
                          </h6>
                        ),
                        // Paragraphs
                        p: ({ children }) => (
                          <p className={`${isDarkBg ? 'text-gray-300' : 'text-gray-700'} mb-4 leading-relaxed`}>
                            {children}
                          </p>
                        ),
                        // Lists
                        ul: ({ children }) => (
                          <ul className={`list-disc list-inside ${isDarkBg ? 'text-gray-300' : 'text-gray-700'} mb-4 space-y-1 pl-2`}>
                            {children}
                          </ul>
                        ),
                        ol: ({ children }) => (
                          <ol className={`list-decimal list-inside ${isDarkBg ? 'text-gray-300' : 'text-gray-700'} mb-4 space-y-1 pl-2`}>
                            {children}
                          </ol>
                        ),
                        li: ({ children }) => (
                          <li className={`${isDarkBg ? 'text-gray-300' : 'text-gray-700'}`}>
                            {children}
                          </li>
                        ),
                        // Links
                        a: ({ href, children }) => (
                          <a 
                            href={href} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-primary-500 hover:text-primary-400 hover:underline"
                          >
                            {children}
                          </a>
                        ),
                        // Blockquote
                        blockquote: ({ children }) => (
                          <blockquote className={`border-l-4 ${isDarkBg ? 'border-primary-500 bg-gray-800/50' : 'border-primary-500 bg-primary-50'} pl-4 py-2 my-4 rounded-r-lg`}>
                            {children}
                          </blockquote>
                        ),
                        // Horizontal rule
                        hr: () => (
                          <hr className={`my-6 ${isDarkBg ? 'border-gray-700' : 'border-gray-300'}`} />
                        ),
                        // Strong
                        strong: ({ children }) => (
                          <strong className={`font-semibold ${isDarkBg ? 'text-gray-100' : 'text-gray-900'}`}>
                            {children}
                          </strong>
                        ),
                        // Emphasis
                        em: ({ children }) => (
                          <em className={`italic ${isDarkBg ? 'text-gray-300' : 'text-gray-700'}`}>
                            {children}
                          </em>
                        ),
                        // Code
                        code({ node, className, children, ...props }) {
                          const match = /language-(\w+)/.exec(className || '');
                          const codeString = String(children).replace(/\n$/, '');
                          const isInline = !className && !codeString.includes('\n');
                          
                          // Inline code
                          if (isInline) {
                            return (
                              <code className={`${isDarkBg ? 'bg-gray-800 text-pink-400' : 'bg-gray-100 text-pink-600'} px-1.5 py-0.5 rounded text-sm font-mono`} {...props}>
                                {children}
                              </code>
                            );
                          }
                          
                          // Code block with language - use syntax highlighter
                          if (match) {
                            return (
                              <SyntaxHighlighter
                                style={isDarkBg ? oneDark : oneLight}
                                language={match[1]}
                                PreTag="div"
                                className="rounded-lg my-4"
                              >
                                {codeString}
                              </SyntaxHighlighter>
                            );
                          }
                          
                          // Plain code block (ASCII diagrams, etc.) - render as monospace pre
                          // Use specific monospace font stack for proper box-drawing character alignment
                          return (
                            <code 
                              className={`block whitespace-pre ${isDarkBg ? 'text-gray-300' : 'text-gray-700'}`}
                              style={{
                                fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', 'Consolas', 'Liberation Mono', 'Menlo', monospace",
                                fontSize: '14px',
                                lineHeight: '1.15',
                                letterSpacing: '0',
                              }}
                              {...props}
                            >
                              {children}
                            </code>
                          );
                        },
                        // Pre - wrapper for code blocks
                        pre: ({ children }) => (
                          <pre 
                            className={`${isDarkBg ? 'bg-gray-800/80' : 'bg-gray-100'} rounded-lg overflow-x-auto my-4 p-4`}
                            style={{
                              fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', 'Consolas', 'Liberation Mono', 'Menlo', monospace",
                              lineHeight: '1.15',
                            }}
                          >
                            {children}
                          </pre>
                        ),
                        // Tables
                        table: ({ children }) => (
                          <div className="overflow-x-auto my-4">
                            <table className={`min-w-full border ${isDarkBg ? 'border-gray-700' : 'border-gray-300'} rounded-lg overflow-hidden`}>
                              {children}
                            </table>
                          </div>
                        ),
                        thead: ({ children }) => (
                          <thead className={isDarkBg ? 'bg-gray-800' : 'bg-gray-100'}>
                            {children}
                          </thead>
                        ),
                        th: ({ children }) => (
                          <th className={`px-4 py-2 text-left text-sm font-semibold ${isDarkBg ? 'text-gray-100 border-gray-700' : 'text-gray-900 border-gray-300'} border-b`}>
                            {children}
                          </th>
                        ),
                        td: ({ children }) => (
                          <td className={`px-4 py-2 text-sm ${isDarkBg ? 'text-gray-300 border-gray-700' : 'text-gray-700 border-gray-200'} border-b`}>
                            {children}
                          </td>
                        ),
                        tr: ({ children }) => (
                          <tr className={isDarkBg ? 'hover:bg-gray-800/50' : 'hover:bg-gray-50'}>
                            {children}
                          </tr>
                        ),
                        // Images
                        img: ({ src, alt }) => (
                          <img 
                            src={src} 
                            alt={alt || ''} 
                            className="max-w-full h-auto rounded-lg shadow-md my-4"
                          />
                        ),
                      }}
                    >
                      {content}
                    </ReactMarkdown>
                  </div>
                )
              )}
              
              {/* Text Preview/Edit */}
              {fileType === 'text' && (
                isEditing ? (
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className={`w-full h-full p-4 font-mono text-sm resize-none outline-none ${isDarkBg ? 'bg-[#1a1a1a]' : 'bg-white'}`}
                    spellCheck={false}
                  />
                ) : (
                  <pre className={`p-4 font-mono text-sm whitespace-pre-wrap ${isDarkBg ? 'text-gray-300' : 'text-gray-700'}`}>
                    {content}
                  </pre>
                )
              )}
              
              {/* PDF Preview */}
              {fileType === 'pdf' && (
                <iframe
                  src={fileUrl}
                  className="w-full h-full"
                  title={fileName}
                />
              )}
              
              {/* Video Preview */}
              {fileType === 'video' && (
                <div className="flex items-center justify-center h-full p-4">
                  <video
                    src={fileUrl}
                    controls
                    className="max-w-full max-h-full rounded-lg shadow-lg"
                    style={{ maxHeight: 'calc(90vh - 60px)' }}
                  >
                    Your browser does not support video playback.
                  </video>
                </div>
              )}
              
              {/* Audio Preview */}
              {fileType === 'audio' && (
                <div className="flex flex-col items-center justify-center h-full p-8 gap-6">
                  <div className={`w-32 h-32 rounded-full flex items-center justify-center ${isDarkBg ? 'bg-white/10' : 'bg-black/10'}`}>
                    <span className="text-6xl">🎵</span>
                  </div>
                  <p className="text-lg font-medium">{fileName}</p>
                  <audio
                    src={fileUrl}
                    controls
                    className="w-full max-w-md"
                  >
                    Your browser does not support audio playback.
                  </audio>
                </div>
              )}
              
              {/* 3D Model Preview */}
              {fileType === '3d' && (
                <div className="flex items-center justify-center h-full w-full p-4">
                  {/* @ts-ignore - model-viewer web component */}
                  <model-viewer
                    src={fileUrl}
                    alt={fileName}
                    auto-rotate
                    camera-controls
                    shadow-intensity="1"
                    environment-image="neutral"
                    style={{
                      width: '100%',
                      height: '100%',
                      minHeight: '400px',
                      backgroundColor: isDarkBg ? '#1a1a1a' : '#f5f5f5',
                      borderRadius: '8px',
                    }}
                  />
                </div>
              )}

              {/* Unknown type */}
              {fileType === 'unknown' && (
                <div className="flex flex-col items-center justify-center h-full p-8 gap-4">
                  <span className="text-6xl">📎</span>
                  <p className="text-lg font-medium">{fileName}</p>
                  <p className="opacity-60">Preview not available for this file type</p>
                  <button
                    onClick={handleDownload}
                    className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    Download
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
  
  // Use portal to render modal outside of button hierarchy
  return createPortal(modalContent, document.body);
};

export default FilePreviewModal;
