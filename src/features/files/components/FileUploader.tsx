import { useState, useCallback, useRef } from 'react';
import { Upload, X, File, Image, CheckCircle, AlertCircle } from 'lucide-react';
import { Button } from '@/shared/components/ui';
import { filesApi, getFileIcon, formatFileSize, type FileModel } from '../api/filesApi';

interface FileUploaderProps {
  spaceId?: number;
  projectId?: number;
  tableId?: number;
  rowId?: string;
  columnId?: string;
  onUploadComplete?: (files: FileModel[]) => void;
  onError?: (error: string) => void;
  multiple?: boolean;
  accept?: string;
  maxSize?: number; // in MB
  className?: string;
}

interface UploadingFile {
  file: File;
  progress: number;
  status: 'uploading' | 'success' | 'error';
  error?: string;
  result?: FileModel;
}

export const FileUploader = ({
  spaceId,
  projectId,
  tableId,
  rowId,
  columnId,
  onUploadComplete,
  onError,
  multiple = true,
  accept,
  maxSize = 50,
  className = ''
}: FileUploaderProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFiles(files);
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      handleFiles(files);
    }
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleFiles = async (files: File[]) => {
    // Validate file sizes
    const validFiles = files.filter(file => {
      if (file.size > maxSize * 1024 * 1024) {
        onError?.(`File "${file.name}" is too large. Max size is ${maxSize}MB`);
        return false;
      }
      return true;
    });

    if (validFiles.length === 0) return;

    // Initialize uploading state
    const newUploadingFiles: UploadingFile[] = validFiles.map(file => ({
      file,
      progress: 0,
      status: 'uploading' as const
    }));

    setUploadingFiles(prev => [...prev, ...newUploadingFiles]);

    // Upload each file
    const uploadPromises = validFiles.map(async (file, index) => {
      try {
        const result = await filesApi.upload([file], {
          spaceId,
          projectId,
          tableId,
          rowId,
          columnId,
          onProgress: (progress) => {
            setUploadingFiles(prev => prev.map((uf, i) => 
              uf.file === file ? { ...uf, progress } : uf
            ));
          }
        });

        const uploadedFile = Array.isArray(result) ? result[0] : result;

        setUploadingFiles(prev => prev.map(uf => 
          uf.file === file ? { ...uf, status: 'success', progress: 100, result: uploadedFile } : uf
        ));

        return uploadedFile;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Upload failed';
        
        setUploadingFiles(prev => prev.map(uf => 
          uf.file === file ? { ...uf, status: 'error', error: errorMessage } : uf
        ));
        
        onError?.(errorMessage);
        return null;
      }
    });

    const results = await Promise.all(uploadPromises);
    const successfulUploads = results.filter((r): r is FileModel => r !== null);
    
    if (successfulUploads.length > 0) {
      onUploadComplete?.(successfulUploads);
    }

    // Clear completed uploads after a delay
    setTimeout(() => {
      setUploadingFiles(prev => prev.filter(uf => uf.status === 'uploading'));
    }, 3000);
  };

  const removeUploadingFile = (file: File) => {
    setUploadingFiles(prev => prev.filter(uf => uf.file !== file));
  };

  const isImage = (file: File) => file.type.startsWith('image/');

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Drop zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`
          relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer
          transition-all duration-200 ease-in-out
          ${isDragging 
            ? 'border-[var(--color-primary-500)] bg-[var(--color-primary-500)]/10' 
            : 'border-[var(--border-primary)] hover:border-[var(--color-primary-500)] hover:bg-[var(--bg-tertiary)]'
          }
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple={multiple}
          accept={accept}
          onChange={handleFileSelect}
          className="hidden"
        />
        
        <Upload className={`w-12 h-12 mx-auto mb-4 ${isDragging ? 'text-[var(--color-primary-500)]' : 'text-[var(--text-tertiary)]'}`} />
        
        <p className="text-lg font-medium text-[var(--text-primary)] mb-1">
          {isDragging ? 'Отпустите файлы' : 'Перетащите файлы сюда'}
        </p>
        <p className="text-sm text-[var(--text-secondary)]">
          или <span className="text-[var(--color-primary-500)] hover:underline">выберите файлы</span>
        </p>
        <p className="text-xs text-[var(--text-tertiary)] mt-2">
          Максимальный размер: {maxSize}MB
        </p>
      </div>

      {/* Uploading files list */}
      {uploadingFiles.length > 0 && (
        <div className="space-y-2">
          {uploadingFiles.map((uf, index) => (
            <div
              key={`${uf.file.name}-${index}`}
              className="flex items-center gap-3 p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-primary)]"
            >
              {/* Preview or icon */}
              <div className="w-10 h-10 flex-shrink-0 rounded-lg bg-[var(--bg-tertiary)] flex items-center justify-center overflow-hidden">
                {isImage(uf.file) && uf.status === 'success' && uf.result?.url ? (
                  <img 
                    src={uf.result.url} 
                    alt={uf.file.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-xl">{getFileIcon(uf.file.type)}</span>
                )}
              </div>

              {/* File info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                  {uf.file.name}
                </p>
                <p className="text-xs text-[var(--text-tertiary)]">
                  {formatFileSize(uf.file.size)}
                </p>
                
                {/* Progress bar */}
                {uf.status === 'uploading' && (
                  <div className="mt-1 h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-[var(--color-primary-500)] transition-all duration-300"
                      style={{ width: `${uf.progress}%` }}
                    />
                  </div>
                )}
              </div>

              {/* Status indicator */}
              <div className="flex-shrink-0">
                {uf.status === 'uploading' && (
                  <span className="text-sm text-[var(--text-secondary)]">{uf.progress}%</span>
                )}
                {uf.status === 'success' && (
                  <CheckCircle className="w-5 h-5 text-green-500" />
                )}
                {uf.status === 'error' && (
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 text-red-500" />
                    <button
                      onClick={() => removeUploadingFile(uf.file)}
                      className="p-1 hover:bg-[var(--bg-tertiary)] rounded"
                    >
                      <X className="w-4 h-4 text-[var(--text-tertiary)]" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
