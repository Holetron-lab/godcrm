// React Query hooks for Spaces
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { spacesApi } from '../api/spacesApi';
import { useSpacesStore } from '../store/spacesStore';
import type { CreateSpacePayload } from '../types/space.types';

// Query Keys
export const spacesKeys = {
  all: ['spaces'] as const,
  lists: () => [...spacesKeys.all, 'list'] as const,
  list: () => [...spacesKeys.lists()] as const,
  details: () => [...spacesKeys.all, 'detail'] as const,
  detail: (id: number) => [...spacesKeys.details(), id] as const
};

/**
 * Hook для загрузки всех spaces
 * Автоматически обновляет store при успешной загрузке
 */
export const useSpacesQuery = () => {
  const setSpaces = useSpacesStore(state => state.setSpaces);
  const setError = useSpacesStore(state => state.setError);

  return useQuery({
    queryKey: spacesKeys.list(),
    queryFn: async () => {
      try {
        const spaces = await spacesApi.list();
        setSpaces(spaces);
        setError(null);
        return spaces;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load spaces';
        setError(message);
        throw error;
      }
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    retry: 1
  });
};

/**
 * Hook для загрузки одного space с проектами
 */
export const useSpaceQuery = (spaceId: number | null) => {
  const setCurrentSpace = useSpacesStore(state => state.setCurrentSpace);
  const setError = useSpacesStore(state => state.setError);

  return useQuery({
    queryKey: spacesKeys.detail(spaceId!),
    queryFn: async () => {
      if (!spaceId) return null;
      try {
        const space = await spacesApi.getById(spaceId);
        setCurrentSpace(space);
        setError(null);
        return space;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to load space';
        setError(message);
        throw error;
      }
    },
    enabled: !!spaceId,
    staleTime: 1000 * 60 * 5
  });
};

/**
 * Hook для создания нового space
 */
export const useCreateSpaceMutation = () => {
  const queryClient = useQueryClient();
  const addSpace = useSpacesStore(state => state.addSpace);
  const setError = useSpacesStore(state => state.setError);

  return useMutation({
    mutationFn: (payload: CreateSpacePayload) => spacesApi.create(payload),
    onSuccess: (newSpace) => {
      addSpace(newSpace);
      queryClient.invalidateQueries({ queryKey: spacesKeys.lists() });
      setError(null);
    }
  });
};

/**
 * Hook для удаления space
 */
export const useDeleteSpaceMutation = () => {
  const queryClient = useQueryClient();
  const removeSpace = useSpacesStore(state => state.removeSpace);
  const setError = useSpacesStore(state => state.setError);

  return useMutation({
    mutationFn: (spaceId: number) => spacesApi.delete(spaceId),
    onSuccess: (_, spaceId) => {
      removeSpace(spaceId);
      queryClient.invalidateQueries({ queryKey: spacesKeys.lists() });
      setError(null);
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to delete space';
      setError(message);
    }
  });
};
