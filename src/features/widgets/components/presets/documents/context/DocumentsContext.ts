import { createContext, useContext } from 'react';
import type { DocumentsContextValue } from './types';

export const DocumentsContext = createContext<DocumentsContextValue | null>(null);

export function useDocumentsContext() {
  const context = useContext(DocumentsContext);
  if (!context) {
    throw new Error('useDocumentsContext must be used within DocumentsProvider');
  }
  return context;
}
