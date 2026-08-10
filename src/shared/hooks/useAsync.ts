// src/shared/hooks/useAsync.ts
// ADR-030: DRY Refactoring — Хук для управления async операциями

import { useState, useCallback } from 'react';
import { getErrorMessage } from '../utils/errorUtils';

export interface UseAsyncState<T> {
  /** Данные из последнего успешного вызова */
  data: T | null;
  /** Сообщение об ошибке */
  error: string | null;
  /** Индикатор загрузки */
  loading: boolean;
}

export interface UseAsyncReturn<T> extends UseAsyncState<T> {
  /** Выполнить async функцию */
  execute: <R = T>(asyncFn: () => Promise<R>) => Promise<R | undefined>;
  /** Сбросить состояние в начальное */
  reset: () => void;
  /** Установить данные вручную */
  setData: (data: T | null) => void;
  /** Установить ошибку вручную */
  setError: (error: string | null) => void;
}

export interface UseAsyncOptions<T> {
  /** Начальные данные */
  initialData?: T | null;
}

/**
 * Хук для управления состоянием асинхронных операций
 * 
 * @param options - Опции (initialData)
 * @returns { data, error, loading, execute, reset, setData, setError }
 * 
 * @example
 * const { data, loading, error, execute } = useAsync<User[]>();
 * 
 * const loadUsers = async () => {
 *   await execute(async () => {
 *     const response = await fetch('/api/users');
 *     return response.json();
 *   });
 * };
 * 
 * if (loading) return <Spinner />;
 * if (error) return <Error message={error} />;
 * return <UserList users={data} />;
 */
export function useAsync<T>(options: UseAsyncOptions<T> = {}): UseAsyncReturn<T> {
  const { initialData = null } = options;

  const [data, setDataState] = useState<T | null>(initialData);
  const [error, setErrorState] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const execute = useCallback(async <R = T>(asyncFn: () => Promise<R>): Promise<R | undefined> => {
    setLoading(true);
    setErrorState(null);

    try {
      const result = await asyncFn();
      setDataState(result as unknown as T);
      return result;
    } catch (err) {
      const errorMsg = getErrorMessage(err);
      setErrorState(errorMsg);
      setDataState(null);
      return undefined;
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setDataState(null);
    setErrorState(null);
    setLoading(false);
  }, []);

  const setData = useCallback((newData: T | null) => {
    setDataState(newData);
  }, []);

  const setError = useCallback((newError: string | null) => {
    setErrorState(newError);
  }, []);

  return {
    data,
    error,
    loading,
    execute,
    reset,
    setData,
    setError,
  };
}
