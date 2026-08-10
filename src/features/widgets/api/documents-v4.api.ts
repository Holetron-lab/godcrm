/**
 * Documents v4 API - Table-based document management
 * 
 * @see TASK-008-DOCUMENTS-V4-TABLES.md
 */

import { apiClient } from '@/shared/utils/apiClient';
import type {
  DocumentsInitResponse,
  DocumentsListResponse,
  DocumentCreateResponse,
  DocumentContentResponse,
  DocumentImportV4Response,
  DocumentImportSection,
  AddLanguageResponse,
  DocumentCategory,
} from '../types/documents.types';

const DEFAULT_FOLDER_PATH = 'databases/documents/';

// === FOLDER INITIALIZATION ===

/**
 * Initialize documents folder for a project
 * Creates _registry and _atoms tables
 */
export async function initDocumentsFolder(
  projectId: number,
  folderPath: string = DEFAULT_FOLDER_PATH
): Promise<DocumentsInitResponse> {
  return apiClient.request<DocumentsInitResponse>(
    `/projects/${projectId}/documents/init`,
    {
      method: 'POST',
      body: JSON.stringify({ folder_path: folderPath }),
    }
  );
}

// === DOCUMENT LIST ===

/**
 * List all documents in a project
 */
export async function listDocuments(
  projectId: number,
  folderPath: string = DEFAULT_FOLDER_PATH
): Promise<DocumentsListResponse> {
  const params = new URLSearchParams({ folder_path: folderPath, limit: '5000' });
  return apiClient.request<DocumentsListResponse>(
    `/projects/${projectId}/documents?${params}`
  );
}

// === DOCUMENT CRUD ===

/**
 * Create a new document
 * This creates both a registry entry and a new doc_* table
 */
export async function createDocument(
  projectId: number,
  params: {
    name: string;
    slug?: string;
    description?: string;
    icon?: string;
    category?: DocumentCategory | string;
    folder_path?: string;
    project_id?: number;  // Link to ADR Projects table (1699)
    registry_table_id?: number;  // Widget-scoped custom registry (ADR-0067) — bypasses project+folder_path resolver
  }
): Promise<DocumentCreateResponse> {
  return apiClient.request<DocumentCreateResponse>(
    `/projects/${projectId}/documents`,
    {
      method: 'POST',
      body: JSON.stringify({
        ...params,
        folder_path: params.folder_path || DEFAULT_FOLDER_PATH,
      }),
    }
  );
}

/**
 * Get document content (items from doc_* table)
 */
export async function getDocumentContent(
  documentId: number,
  registryTableId: number
): Promise<DocumentContentResponse> {
  const params = new URLSearchParams({ 
    registry_table_id: String(registryTableId) 
  });
  return apiClient.request<DocumentContentResponse>(
    `/documents/${documentId}/content?${params}`
  );
}

// === IMPORT ===

/**
 * Import sections into a v4 document
 */
export async function importDocumentV4(
  documentId: number,
  registryTableId: number,
  sections: DocumentImportSection[]
): Promise<DocumentImportV4Response> {
  return apiClient.request<DocumentImportV4Response>(
    `/documents/${documentId}/import-v4`,
    {
      method: 'POST',
      body: JSON.stringify({
        registry_table_id: registryTableId,
        sections,
      }),
    }
  );
}

// === LANGUAGE MANAGEMENT ===

/**
 * Add translation columns to all document tables in a project
 */
export async function addDocumentLanguage(
  projectId: number,
  languageCode: string,
  languageName?: string,
  folderPath: string = DEFAULT_FOLDER_PATH
): Promise<AddLanguageResponse> {
  return apiClient.request<AddLanguageResponse>(
    `/projects/${projectId}/documents/add-language`,
    {
      method: 'POST',
      body: JSON.stringify({
        language_code: languageCode,
        language_name: languageName,
        folder_path: folderPath,
      }),
    }
  );
}

// === LEGACY COMPATIBILITY ===
// These functions work with the existing v3 API for backward compatibility

/**
 * Import document using legacy v3 API
 * @deprecated Use importDocumentV4 for new implementations
 */
export async function importDocumentLegacy(
  documentsTableId: number,
  sectionsTableId: number,
  document: { name: string; description?: string; category?: string; icon?: string },
  atoms: Array<{
    type?: string;
    key?: string;
    title: string;
    content: string;
    order_index?: number;
    h2?: string;
    h3?: string;
    local_order?: number;
    temp_id?: string;
    parent_temp_id?: string;
    http_method?: string;
    http_path?: string;
    tags?: string[];
    source_file?: string;
  }>
): Promise<{ success: boolean; data: { document_id: number; section_ids: number[]; section_count: number } }> {
  return apiClient.request(
    '/documents/import',
    {
      method: 'POST',
      body: JSON.stringify({
        document,
        atoms,
        documents_table_id: documentsTableId,
        sections_table_id: sectionsTableId,
      }),
    }
  );
}

/**
 * Export document using legacy v3 API
 */
export async function exportDocumentLegacy(
  documentId: number,
  documentsTableId: number,
  sectionsTableId: number,
  format: 'markdown' | 'json' = 'markdown',
  language?: string
): Promise<string | object> {
  const params = new URLSearchParams({
    documents_table_id: String(documentsTableId),
    sections_table_id: String(sectionsTableId),
    format,
  });
  if (language) params.append('lang', language);

  // Both JSON and text responses are parsed by apiClient
  return apiClient.request(`/documents/${documentId}/export?${params}`);
}
