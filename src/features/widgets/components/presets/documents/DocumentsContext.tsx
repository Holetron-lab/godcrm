/**
 * Re-export shim — preserves the existing import path for 25+ consumers.
 * Actual implementation lives in ./context/.
 */

export { DocumentsContext, useDocumentsContext } from './context/DocumentsContext';
export { DocumentsProvider } from './context/DocumentsProvider';
export type {
  DocumentsContextValue,
  DocumentsProviderProps,
  RightPanelMode,
  AtomsPanelTab,
  WidgetPickerTarget,
} from './context/types';
