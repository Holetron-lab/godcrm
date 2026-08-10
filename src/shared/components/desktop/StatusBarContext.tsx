/**
 * StatusBarContext - Context for adding custom actions to StatusBar
 * Pages can add their own buttons to the status bar
 */

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

export interface StatusBarAction {
  id: string;
  component: ReactNode;
}

interface StatusBarContextValue {
  actions: StatusBarAction[];
  registerAction: (action: StatusBarAction) => void;
  unregisterAction: (id: string) => void;
  setActions: (actions: StatusBarAction[]) => void;
}

const StatusBarContext = createContext<StatusBarContextValue | null>(null);

// Export context for direct access in StatusBar
export { StatusBarContext };

export function StatusBarProvider({ children }: { children: ReactNode }) {
  const [actions, setActionsState] = useState<StatusBarAction[]>([]);

  const registerAction = useCallback((action: StatusBarAction) => {
    setActionsState(prev => {
      // Replace if exists, otherwise add
      const exists = prev.find(a => a.id === action.id);
      if (exists) {
        return prev.map(a => a.id === action.id ? action : a);
      }
      return [...prev, action];
    });
  }, []);

  const unregisterAction = useCallback((id: string) => {
    setActionsState(prev => prev.filter(a => a.id !== id));
  }, []);

  const setActions = useCallback((newActions: StatusBarAction[]) => {
    setActionsState(newActions);
  }, []);

  return (
    <StatusBarContext.Provider value={{ actions, registerAction, unregisterAction, setActions }}>
      {children}
    </StatusBarContext.Provider>
  );
}

export function useStatusBar() {
  const context = useContext(StatusBarContext);
  if (!context) {
    throw new Error('useStatusBar must be used within StatusBarProvider');
  }
  return context;
}

// Hook for pages to register their actions
export function useStatusBarActions(actions: StatusBarAction[], deps: unknown[] = []) {
  const { setActions } = useStatusBar();

  // Register on mount, clear on unmount
  useState(() => {
    setActions(actions);
    return () => setActions([]);
  });
}
