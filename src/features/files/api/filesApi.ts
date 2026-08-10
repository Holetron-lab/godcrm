// Files API
import { apiClient } from '@/shared/utils/apiClient';

export interface FileModel {
  id: string;
  name: string;
  originalName: string;
  original_name?: string;
  mimeType: string;
  mime_type?: string;
  size: number;
  url: string;
  path?: string;
  spaceId?: number | null;
  space_id?: number | null;
  projectId?: number | null;
  project_id?: number | null;
  tableId?: number | null;
  table_id?: number | null;
  rowId?: string | null;
  row_id?: string | null;
  columnId?: string | null;
  column_id?: string | null;
  uploadedBy?: number | null;
  uploaded_by?: number | null;
  uploadedByName?: string;
  uploaded_by_name?: string;
  description?: string | null;
  createdAt?: string;
  created_at?: string;
}

export interface StorageProvider {
  id: string;
  name: string;
  type: 'local' | 's3' | 'google_drive' | 'dropbox';
  is_default: boolean;
  is_enabled: boolean;
  config: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export type FileVisibility = 'private' | 'internal' | 'public';

export interface UploadOptions {
  spaceId?: number;
  projectId?: number;
  tableId?: number;
  rowId?: string;
  columnId?: string;
  description?: string;
  // ADR-0016 §Phase 5: orphan uploads carry their own visibility. Pass
  // 'internal' for chat attachments / agent generations that any logged-in
  // user should be able to render via <img>. Defaults server-side to
  // 'private' when omitted.
  visibility?: FileVisibility;
  onProgress?: (progress: number) => void;
}

export const filesApi = {
  // Upload files
  upload: async (files: File[], options: UploadOptions = {}): Promise<FileModel | FileModel[]> => {
    const formData = new FormData();
    
    files.forEach(file => {
      formData.append('files', file);
    });
    
    if (options.spaceId) formData.append('spaceId', String(options.spaceId));
    if (options.projectId) formData.append('projectId', String(options.projectId));
    if (options.tableId) formData.append('tableId', String(options.tableId));
    if (options.rowId) formData.append('rowId', options.rowId);
    if (options.columnId) formData.append('columnId', options.columnId);
    if (options.description) formData.append('description', options.description);
    if (options.visibility) formData.append('visibility', options.visibility);
    
    const token = apiClient.getAccessToken();
    
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && options.onProgress) {
          const progress = Math.round((e.loaded / e.total) * 100);
          options.onProgress(progress);
        }
      });
      
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const response = JSON.parse(xhr.responseText);
          resolve(response.data);
        } else {
          try {
            const error = JSON.parse(xhr.responseText);
            reject(new Error(error.error?.message || 'Upload failed'));
          } catch {
            reject(new Error('Upload failed'));
          }
        }
      });
      
      xhr.addEventListener('error', () => {
        reject(new Error('Network error'));
      });
      
      xhr.open('POST', '/api/v3/files/upload');
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }
      xhr.withCredentials = true;
      xhr.send(formData);
    });
  },
  
  // List files
  list: async (params: {
    spaceId?: number;
    projectId?: number;
    tableId?: number;
    rowId?: string;
    page?: number;
    limit?: number;
  } = {}): Promise<{ files: FileModel[]; pagination: { page: number; limit: number; total: number; pages: number } }> => {
    const searchParams = new URLSearchParams();
    if (params.spaceId) searchParams.append('spaceId', String(params.spaceId));
    if (params.projectId) searchParams.append('projectId', String(params.projectId));
    if (params.tableId) searchParams.append('tableId', String(params.tableId));
    if (params.rowId) searchParams.append('rowId', params.rowId);
    if (params.page) searchParams.append('page', String(params.page));
    if (params.limit) searchParams.append('limit', String(params.limit));
    
    const queryString = searchParams.toString();
    const response = await apiClient.get<{ success: boolean; data: { files: FileModel[]; pagination: { page: number; limit: number; total: number; pages: number } } }>(`/files${queryString ? `?${queryString}` : ''}`);
    return response.data;
  },
  
  // Get single file
  get: async (fileId: string): Promise<FileModel> => {
    const response = await apiClient.get<{ success: boolean; data: FileModel }>(`/files/${fileId}`);
    return response.data;
  },
  
  // Delete file
  delete: async (fileId: string): Promise<void> => {
    await apiClient.delete(`/files/${fileId}`);
  },
  
  // Storage providers
  getProviders: async (): Promise<StorageProvider[]> => {
    const response = await apiClient.get<{ success: boolean; data: StorageProvider[] }>('/storage-providers');
    return response.data;
  },
  
  createProvider: async (data: {
    id: string;
    name: string;
    type: string;
    config?: Record<string, unknown>;
    isDefault?: boolean;
  }): Promise<StorageProvider> => {
    const response = await apiClient.post<{ success: boolean; data: StorageProvider }>('/storage-providers', data);
    return response.data;
  },
  
  updateProvider: async (providerId: string, data: {
    name?: string;
    config?: Record<string, unknown>;
    isDefault?: boolean;
    isEnabled?: boolean;
  }): Promise<void> => {
    await apiClient.put(`/storage-providers/${providerId}`, data);
  },
  
  deleteProvider: async (providerId: string): Promise<void> => {
    await apiClient.delete(`/storage-providers/${providerId}`);
  }
};

// Helper function to get file icon by mime type
export const getFileIcon = (mimeType: string): string => {
  if (mimeType.startsWith('image/')) return '🖼️';
  if (mimeType.startsWith('video/')) return '🎥';
  if (mimeType.startsWith('audio/')) return '🎵';
  if (mimeType.startsWith('model/') || mimeType === 'application/octet-stream') return '🧊';
  if (mimeType === 'application/pdf') return '📄';
  if (mimeType.includes('word') || mimeType.includes('document')) return '📝';
  if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) return '📊';
  if (mimeType.includes('powerpoint') || mimeType.includes('presentation')) return '📽️';
  if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('7z')) return '📦';
  if (mimeType.startsWith('text/')) return '📃';
  if (mimeType === 'application/json') return '🔧';
  return '📎';
};

// Format file size
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};
