import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSpacesStore } from '../store/spacesStore';
import type { SpaceModel, SpaceWithProjects } from '../types/space.types';

// Reset store before each test
beforeEach(() => {
  useSpacesStore.getState().reset();
});

const mockSpace: SpaceModel = {
  id: 1,
  owner_id: 1,
  name: 'Test Space',
  description: 'Test description',
  icon: '📁',
  type: 'personal',
  theme_primary: '#0ea5e9',
  theme_secondary: '#8b5cf6',
  theme_tertiary: '#10b981',
  settings: null,
  access_control: null,
  projects_count: 2,
  dashboards_count: 1,
  users_count: 3,
  users_by_roles: { owners: 1, admins: 1, editors: 1, viewers: 0 },
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('spacesStore', () => {
  describe('initial state', () => {
    it('should have empty initial state', () => {
      const { spaces, currentSpace, activeSpaceId, loading, error } = useSpacesStore.getState();
      
      expect(spaces).toEqual([]);
      expect(currentSpace).toBeNull();
      expect(activeSpaceId).toBeNull();
      expect(loading).toBe(false);
      expect(error).toBeNull();
    });
  });

  describe('setSpaces', () => {
    it('should set spaces array', () => {
      const { setSpaces } = useSpacesStore.getState();
      
      act(() => {
        setSpaces([mockSpace]);
      });
      
      expect(useSpacesStore.getState().spaces).toEqual([mockSpace]);
    });

    it.todo('should replace existing spaces');
  });

  describe('setCurrentSpace', () => {
    it.todo('should set current space');
    it.todo('should allow null value');
  });

  describe('setActiveSpaceId', () => {
    it.todo('should set active space ID');
    it.todo('should persist to localStorage');
  });

  describe('getSpaceById', () => {
    it('should find space by ID', () => {
      const { setSpaces, getSpaceById } = useSpacesStore.getState();
      
      act(() => {
        setSpaces([mockSpace]);
      });
      
      expect(getSpaceById(1)).toEqual(mockSpace);
    });

    it('should return undefined for non-existent ID', () => {
      const { getSpaceById } = useSpacesStore.getState();
      
      expect(getSpaceById(999)).toBeUndefined();
    });
  });

  describe('addSpace', () => {
    it.todo('should add space to list');
    it.todo('should not duplicate spaces');
  });

  describe('updateSpace', () => {
    it.todo('should update space in list');
    it.todo('should update currentSpace if matches');
    it.todo('should handle partial updates');
  });

  describe('removeSpace', () => {
    it('should remove space from list', () => {
      const { setSpaces, removeSpace } = useSpacesStore.getState();
      
      act(() => {
        setSpaces([mockSpace, { ...mockSpace, id: 2, name: 'Space 2' }]);
        removeSpace(1);
      });
      
      expect(useSpacesStore.getState().spaces).toHaveLength(1);
      expect(useSpacesStore.getState().spaces[0].id).toBe(2);
    });

    it.todo('should clear currentSpace if removed');
    it.todo('should clear activeSpaceId if removed');
  });

  describe('reset', () => {
    it('should reset to initial state', () => {
      const { setSpaces, setActiveSpaceId, reset } = useSpacesStore.getState();
      
      act(() => {
        setSpaces([mockSpace]);
        setActiveSpaceId(1);
        reset();
      });
      
      const state = useSpacesStore.getState();
      expect(state.spaces).toEqual([]);
      expect(state.activeSpaceId).toBeNull();
    });
  });

  describe('loading state', () => {
    it.todo('should set loading state');
    it.todo('should set error state');
  });
});
