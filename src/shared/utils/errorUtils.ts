// src/shared/utils/errorUtils.ts
// ADR-030: DRY Refactoring — Общие утилиты для обработки ошибок

/**
 * Безопасное извлечение сообщения об ошибке из любого типа
 * 
 * @param err - Ошибка любого типа (Error, string, unknown)
 * @param fallback - Сообщение по умолчанию, если не удалось извлечь
 * @returns Строка с сообщением об ошибке
 * 
 * @example
 * // С Error
 * getErrorMessage(new Error('Something wrong')) // 'Something wrong'
 * 
 * // С string
 * getErrorMessage('Network failed') // 'Network failed'
 * 
 * // С unknown
 * getErrorMessage(null) // 'Unknown error'
 * getErrorMessage(undefined, 'Fallback msg') // 'Fallback msg'
 */
export function getErrorMessage(err: unknown, fallback = 'Unknown error'): string {
  // Error instance
  if (err instanceof Error) {
    return err.message;
  }
  
  // String
  if (typeof err === 'string') {
    return err;
  }
  
  // Object with message property (like AxiosError)
  if (
    err !== null &&
    typeof err === 'object' &&
    'message' in err &&
    typeof (err as { message: unknown }).message === 'string'
  ) {
    return (err as { message: string }).message;
  }
  
  return fallback;
}
