// src/shared/hooks/useModal.ts
// ADR-030: DRY Refactoring — Общий хук для управления модалками

import { useState, useCallback } from 'react';

export interface UseModalReturn {
  /** Открыто ли модальное окно */
  isOpen: boolean;
  /** Открыть модалку */
  open: () => void;
  /** Закрыть модалку */
  close: () => void;
  /** Переключить состояние */
  toggle: () => void;
}

/**
 * Хук для управления состоянием модального окна
 * 
 * @param initialState - Начальное состояние (default: false)
 * @returns Объект с isOpen, open, close, toggle
 * 
 * @example
 * const { isOpen, open, close } = useModal();
 * 
 * return (
 *   <>
 *     <button onClick={open}>Open Modal</button>
 *     {isOpen && <Modal onClose={close}>Content</Modal>}
 *   </>
 * );
 */
export function useModal(initialState = false): UseModalReturn {
  const [isOpen, setIsOpen] = useState(initialState);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen(prev => !prev), []);

  return { isOpen, open, close, toggle };
}
