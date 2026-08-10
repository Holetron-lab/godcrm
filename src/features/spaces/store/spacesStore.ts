import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SpaceModel, SpaceWithProjects } from '../types/space.types';

interface SpacesState {
  // Data
  spaces: SpaceModel[];
  currentSpace: SpaceWithProjects | null;
  activeSpaceId: number | null;
  
  // Loading states
  loading: boolean;
  error: string | null;
  
  // Actions
  setSpaces: (spaces: SpaceModel[]) => void;
  setCurrentSpace: (space: SpaceWithProjects | null) => void;
  setActiveSpaceId: (spaceId: number | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  
  // Computed
  getSpaceById: (spaceId: number) => SpaceModel | undefined;
  
  // Bulk operations
  addSpace: (space: SpaceModel) => void;
  updateSpace: (spaceId: number, updates: Partial<SpaceModel>) => void;
  removeSpace: (spaceId: number) => void;
  
  // Reset
  reset: () => void;
}

const initialState = {
  spaces: [],
  currentSpace: null,
  activeSpaceId: null,
  loading: false,
  error: null
};

/**
 * Spaces Store - State management для Spaces
 * 
 * Управляет списком spaces, текущим выбранным space и загрузкой данных.
 * Использует persist middleware для сохранения activeSpaceId.
 */
export const useSpacesStore = create<SpacesState>()(
  persist(
    (set, get) => ({
      ...initialState,
      
      // Setters
      setSpaces: (spaces) => set({ spaces }),
      setCurrentSpace: (space) => set({ currentSpace: space }),
      setActiveSpaceId: (spaceId) => set({ activeSpaceId: spaceId }),
      setLoading: (loading) => set({ loading }),
      setError: (error) => set({ error }),
      
      // Computed
      getSpaceById: (spaceId) => {
        return get().spaces.find(s => s.id === spaceId);
      },
      
      // Bulk operations
      addSpace: (space) => {
        set(state => ({
          spaces: [...state.spaces, space]
        }));
      },
      
      updateSpace: (spaceId, updates) => {
        set(state => ({
          spaces: state.spaces.map(s => 
            s.id === spaceId ? { ...s, ...updates } : s
          ),
          currentSpace: state.currentSpace?.id === spaceId
            ? { ...state.currentSpace, ...updates }
            : state.currentSpace
        }));
      },
      
      removeSpace: (spaceId) => {
        set(state => ({
          spaces: state.spaces.filter(s => s.id !== spaceId),
          currentSpace: state.currentSpace?.id === spaceId ? null : state.currentSpace,
          activeSpaceId: state.activeSpaceId === spaceId ? null : state.activeSpaceId
        }));
      },
      
      // Reset
      reset: () => set(initialState)
    }),
    {
      name: 'god-crm-spaces-storage',
      partialize: (state) => ({
        activeSpaceId: state.activeSpaceId
      })
    }
  )
);

// Convenience hooks
export const useCurrentSpace = () => useSpacesStore(state => state.currentSpace);
export const useActiveSpaceId = () => useSpacesStore(state => state.activeSpaceId);
export const useSpaces = () => useSpacesStore(state => state.spaces);
