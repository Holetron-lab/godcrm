/**
 * Missing Column Store
 * ADR-031: Missing Column Resolution Dialog
 * 
 * Zustand store for managing missing column resolution dialog state
 */
import { create } from 'zustand';
import {
  MissingColumnContext,
  ResolutionResult,
  ColumnModel
} from '@/shared/services/MissingColumnResolver';

/**
 * Store state interface
 */
interface MissingColumnState {
  /** Whether dialog is open */
  isOpen: boolean;
  
  /** Single context mode */
  context: MissingColumnContext | null;
  
  /** Batch mode contexts */
  contexts: MissingColumnContext[];
  
  /** Available columns in target table */
  tableColumns: ColumnModel[];
  
  /** Callback when resolution is complete */
  onResolve: ((result: ResolutionResult) => void) | null;
  
  /** Callback for batch resolution */
  onResolveBatch: ((results: ResolutionResult[]) => void) | null;
  
  /** Loading state */
  isLoading: boolean;
}

/**
 * Store actions interface
 */
interface MissingColumnActions {
  /** Show single column resolution dialog */
  showDialog: (params: {
    context: MissingColumnContext;
    tableColumns: ColumnModel[];
    onResolve: (result: ResolutionResult) => void;
  }) => void;
  
  /** Show batch resolution dialog */
  showBatchDialog: (params: {
    contexts: MissingColumnContext[];
    tableColumns: ColumnModel[];
    onResolve: (results: ResolutionResult[]) => void;
  }) => void;
  
  /** Close dialog and reset state */
  closeDialog: () => void;
  
  /** Resolve single context */
  resolve: (result: ResolutionResult) => void;
  
  /** Resolve all batch contexts */
  resolveBatch: (results: ResolutionResult[]) => void;
  
  /** Set loading state */
  setLoading: (loading: boolean) => void;
}

/**
 * Initial state
 */
const initialState: MissingColumnState = {
  isOpen: false,
  context: null,
  contexts: [],
  tableColumns: [],
  onResolve: null,
  onResolveBatch: null,
  isLoading: false
};

/**
 * Missing Column Store
 */
export const useMissingColumnStore = create<MissingColumnState & MissingColumnActions>(
  (set, get) => ({
    ...initialState,
    
    showDialog: ({ context, tableColumns, onResolve }) => {
      set({
        isOpen: true,
        context,
        contexts: [],
        tableColumns,
        onResolve,
        onResolveBatch: null,
        isLoading: false
      });
    },
    
    showBatchDialog: ({ contexts, tableColumns, onResolve }) => {
      set({
        isOpen: true,
        context: null,
        contexts,
        tableColumns,
        onResolve: null,
        onResolveBatch: onResolve,
        isLoading: false
      });
    },
    
    closeDialog: () => {
      const { onResolve, onResolveBatch, contexts } = get();
      
      // Call cancel callback if provided
      if (onResolve) {
        onResolve({ action: 'cancel' });
      }
      if (onResolveBatch) {
        onResolveBatch(contexts.map(() => ({ action: 'cancel' as const })));
      }
      
      set(initialState);
    },
    
    resolve: (result) => {
      const { onResolve } = get();
      if (onResolve) {
        onResolve(result);
      }
      set(initialState);
    },
    
    resolveBatch: (results) => {
      const { onResolveBatch } = get();
      if (onResolveBatch) {
        onResolveBatch(results);
      }
      set(initialState);
    },
    
    setLoading: (loading) => {
      set({ isLoading: loading });
    }
  })
);

/**
 * Hook to check if dialog should show
 */
export const useIsMissingColumnDialogOpen = () => 
  useMissingColumnStore(state => state.isOpen);

/**
 * Hook to get current context
 */
export const useMissingColumnContext = () => 
  useMissingColumnStore(state => state.context);

/**
 * Hook to get batch contexts
 */
export const useMissingColumnContexts = () => 
  useMissingColumnStore(state => state.contexts);

/**
 * Helper to show resolution dialog as a Promise
 * Can be used from services/hooks
 */
export const showMissingColumnDialog = (
  context: MissingColumnContext,
  tableColumns: ColumnModel[]
): Promise<ResolutionResult> => {
  return new Promise((resolve) => {
    useMissingColumnStore.getState().showDialog({
      context,
      tableColumns,
      onResolve: resolve
    });
  });
};

/**
 * Helper to show batch resolution dialog as a Promise
 */
export const showMissingColumnBatchDialog = (
  contexts: MissingColumnContext[],
  tableColumns: ColumnModel[]
): Promise<ResolutionResult[]> => {
  return new Promise((resolve) => {
    useMissingColumnStore.getState().showBatchDialog({
      contexts,
      tableColumns,
      onResolve: resolve
    });
  });
};
