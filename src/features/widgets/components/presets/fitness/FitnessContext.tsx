/**
 * Fitness Widget Context - Shared state for FitnessWidget components
 * @see ADR-025: Fitness Module
 */

import { createContext, useContext, useState, type ReactNode } from 'react';
import type { FitnessWidgetConfig, FitnessTab } from '../../../types/fitness.types';

interface FitnessContextValue {
  // Config
  config: FitnessWidgetConfig;
  spaceId: number;
  isEditMode?: boolean;
  
  // Active tab
  activeTab: FitnessTab;
  setActiveTab: (tab: FitnessTab) => void;
  
  // Table IDs (resolved from config or API)
  workoutsTableId: number | null;
  setsTableId: number | null;
  exercisesTableId: number | null;
}

const FitnessContext = createContext<FitnessContextValue | null>(null);

export function useFitnessContext() {
  const ctx = useContext(FitnessContext);
  if (!ctx) {
    throw new Error('useFitnessContext must be used within FitnessProvider');
  }
  return ctx;
}

interface FitnessProviderProps {
  config: FitnessWidgetConfig;
  spaceId: number;
  isEditMode?: boolean;
  children: ReactNode;
}

export function FitnessProvider({ config, spaceId, isEditMode, children }: FitnessProviderProps) {
  const [activeTab, setActiveTab] = useState<FitnessTab>(config.defaultView || 'dashboard');
  
  // Resolve table IDs from config
  const workoutsTableId = config.workouts_table_id || null;
  const setsTableId = config.sets_table_id || null;
  const exercisesTableId = config.exercises_table_id || null;
  
  const value: FitnessContextValue = {
    config,
    spaceId,
    isEditMode,
    activeTab,
    setActiveTab,
    workoutsTableId,
    setsTableId,
    exercisesTableId,
  };
  
  return (
    <FitnessContext.Provider value={value}>
      {children}
    </FitnessContext.Provider>
  );
}
