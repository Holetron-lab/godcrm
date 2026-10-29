import { apiClient, getBaseUrlSync } from '@/shared/utils/apiClient';
import type { ExcelPreviewResponse } from '../components/CreateTableModal/types';

export class ExcelPreviewError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'ExcelPreviewError';
    this.code = code;
    this.status = status;
  }
}

const readError = async (response: Response): Promise<ExcelPreviewError> => {
  let code = 'PREVIEW_FAILED';
  let message = `Request failed (${response.status})`;
  try {
    const body = await response.json() as { error?: { code?: string; message?: string } | string; message?: string };
    const nested = body && typeof body.error === 'object' ? body.error : undefined;
    if (nested?.code) code = nested.code;
    const text = nested?.message ?? (typeof body.error === 'string' ? body.error : undefined) ?? body.message;
    if (typeof text === 'string' && text.trim()) message = text;
  } catch {
    // Non-JSON body keeps the generic message.
  }
  if (response.status === 429 && code === 'PREVIEW_FAILED') code = 'PREVIEW_BUSY';
  return new ExcelPreviewError(message, code, response.status);
};

export const excelImportApi = {
  // Stateless preview: without sheetIndex only the sheet list is returned.
  // multipart/form-data must not get the JSON Content-Type apiClient adds,
  // so this goes through fetch like filesApi.upload / tablesApi.importRows.
  preview: async (
    projectId: number,
    file: File,
    sheetIndex?: number,
    signal?: AbortSignal
  ): Promise<ExcelPreviewResponse> => {
    const formData = new FormData();
    if (sheetIndex !== undefined) formData.append('sheetIndex', String(sheetIndex));
    formData.append('file', file, file.name);

    const headers: HeadersInit = {};
    const token = apiClient.getAccessToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch(`${getBaseUrlSync()}/projects/${projectId}/tables/excel-preview`, {
      method: 'POST',
      headers,
      body: formData,
      credentials: 'include',
      signal,
    });
    if (!response.ok) throw await readError(response);
    const result = await response.json() as { data: ExcelPreviewResponse };
    return result.data;
  },
};
