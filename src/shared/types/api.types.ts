// src/shared/types/api.types.ts
// ADR-030: DRY Refactoring — Типы для API ответов v3

/**
 * Успешный API ответ
 */
export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  timestamp: string;
}

/**
 * Детали ошибки API
 */
export interface ApiErrorDetails {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Ответ с ошибкой API
 */
export interface ApiErrorResponse {
  success: false;
  error: ApiErrorDetails;
  timestamp: string;
}

/**
 * Объединённый тип для API ответа (success или error)
 * Используй type guard isApiSuccess() для narrowing
 */
export type ApiResult<T> = ApiSuccessResponse<T> | ApiErrorResponse;

/**
 * Type guard для проверки успешного ответа
 * 
 * @example
 * const result = await apiClient.get<User[]>('/users');
 * if (isApiSuccess(result)) {
 *   console.log(result.data); // User[]
 * } else {
 *   console.error(result.error.message);
 * }
 */
export function isApiSuccess<T>(response: ApiResult<T>): response is ApiSuccessResponse<T> {
  return response.success === true;
}

/**
 * Type guard для проверки ответа с ошибкой
 */
export function isApiError<T>(response: ApiResult<T>): response is ApiErrorResponse {
  return response.success === false;
}

/**
 * Типы для пагинации
 */
export interface PaginatedData<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Успешный ответ с пагинацией
 */
export type PaginatedResponse<T> = ApiSuccessResponse<PaginatedData<T>>;

/**
 * Стандартные коды ошибок
 */
export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR'
  | 'DATABASE_ERROR';
