/**
 * ADR-025: Fitness API Hooks
 * TanStack Query integration for fitness endpoints
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import type {
  FitnessWorkout,
  FitnessSet,
  FitnessExercise,
  FitnessSummary,
  VolumeDataPoint,
  PersonalRecord,
  StreakInfo,
  MuscleVolume,
  ExerciseStats,
  CSVImportResult,
  CreateWorkoutRequest,
  UpdateWorkoutRequest,
  CreateSetRequest,
  UpdateSetRequest,
  WorkoutResponse,
  WorkoutsListResponse,
  SetResponse,
  SummaryResponse,
  VolumeResponse,
  PRsResponse,
  StreakResponse,
  MuscleVolumeResponse,
  ExerciseStatsResponse,
  CSVImportResponse,
  ExercisesListResponse,
  ApiResponse,
} from '../types';

// =============================================================================
// QUERY KEYS
// =============================================================================

export const fitnessKeys = {
  all: ['fitness'] as const,
  workouts: (spaceId: number) => [...fitnessKeys.all, 'workouts', spaceId] as const,
  workout: (workoutId: number) => [...fitnessKeys.all, 'workout', workoutId] as const,
  exercises: (spaceId?: number) => [...fitnessKeys.all, 'exercises', spaceId] as const,
  summary: (spaceId: number) => [...fitnessKeys.all, 'summary', spaceId] as const,
  volume: (spaceId: number, groupBy?: string) => [...fitnessKeys.all, 'volume', spaceId, groupBy] as const,
  prs: (spaceId: number) => [...fitnessKeys.all, 'prs', spaceId] as const,
  streak: (spaceId: number) => [...fitnessKeys.all, 'streak', spaceId] as const,
  muscleVolume: (spaceId: number, days?: number) => [...fitnessKeys.all, 'muscleVolume', spaceId, days] as const,
  exerciseStats: (spaceId: number, exerciseName: string) => [...fitnessKeys.all, 'exerciseStats', spaceId, exerciseName] as const,
};

// =============================================================================
// WORKOUTS QUERIES
// =============================================================================

export function useWorkouts(spaceId: number) {
  return useQuery({
    queryKey: fitnessKeys.workouts(spaceId),
    queryFn: async (): Promise<FitnessWorkout[]> => {
      const response = await apiClient.request<WorkoutsListResponse>(
        `/fitness/workouts?space_id=${spaceId}`
      );
      return response.data;
    },
    enabled: !!spaceId,
  });
}

export function useWorkout(workoutId: number) {
  return useQuery({
    queryKey: fitnessKeys.workout(workoutId),
    queryFn: async (): Promise<FitnessWorkout> => {
      const response = await apiClient.request<WorkoutResponse>(
        `/fitness/workouts/${workoutId}`
      );
      return response.data;
    },
    enabled: !!workoutId,
  });
}

// =============================================================================
// EXERCISES QUERIES
// =============================================================================

export function useExercises(spaceId?: number) {
  return useQuery({
    queryKey: fitnessKeys.exercises(spaceId),
    queryFn: async (): Promise<FitnessExercise[]> => {
      const url = spaceId 
        ? `/fitness/exercises?space_id=${spaceId}`
        : '/fitness/exercises';
      const response = await apiClient.request<ExercisesListResponse>(url);
      return response.data;
    },
  });
}

// =============================================================================
// ANALYTICS QUERIES
// =============================================================================

export function useFitnessSummary(spaceId: number) {
  return useQuery({
    queryKey: fitnessKeys.summary(spaceId),
    queryFn: async (): Promise<FitnessSummary> => {
      const response = await apiClient.request<SummaryResponse>(
        `/fitness/analytics/summary?space_id=${spaceId}`
      );
      return response.data;
    },
    enabled: !!spaceId,
  });
}

export function useVolumeData(spaceId: number, groupBy: 'date' | 'exercise' = 'date') {
  return useQuery({
    queryKey: fitnessKeys.volume(spaceId, groupBy),
    queryFn: async (): Promise<VolumeDataPoint[]> => {
      const response = await apiClient.request<VolumeResponse>(
        `/fitness/analytics/volume?space_id=${spaceId}&group_by=${groupBy}`
      );
      return response.data;
    },
    enabled: !!spaceId,
  });
}

export function usePersonalRecords(spaceId: number, limit?: number) {
  return useQuery({
    queryKey: fitnessKeys.prs(spaceId),
    queryFn: async (): Promise<PersonalRecord[]> => {
      const url = limit
        ? `/fitness/analytics/prs?space_id=${spaceId}&limit=${limit}`
        : `/fitness/analytics/prs?space_id=${spaceId}`;
      const response = await apiClient.request<PRsResponse>(url);
      return response.data;
    },
    enabled: !!spaceId,
  });
}

export function useStreak(spaceId: number) {
  return useQuery({
    queryKey: fitnessKeys.streak(spaceId),
    queryFn: async (): Promise<StreakInfo> => {
      const response = await apiClient.request<StreakResponse>(
        `/fitness/analytics/streak?space_id=${spaceId}`
      );
      return response.data;
    },
    enabled: !!spaceId,
  });
}

export function useMuscleVolume(spaceId: number, days?: number) {
  return useQuery({
    queryKey: fitnessKeys.muscleVolume(spaceId, days),
    queryFn: async (): Promise<MuscleVolume[]> => {
      const url = days
        ? `/fitness/analytics/muscle-volume?space_id=${spaceId}&days=${days}`
        : `/fitness/analytics/muscle-volume?space_id=${spaceId}`;
      const response = await apiClient.request<MuscleVolumeResponse>(url);
      return response.data;
    },
    enabled: !!spaceId,
  });
}

export function useExerciseStats(spaceId: number, exerciseName: string) {
  return useQuery({
    queryKey: fitnessKeys.exerciseStats(spaceId, exerciseName),
    queryFn: async (): Promise<ExerciseStats> => {
      const response = await apiClient.request<ExerciseStatsResponse>(
        `/fitness/analytics/exercise/${encodeURIComponent(exerciseName)}?space_id=${spaceId}`
      );
      return response.data;
    },
    enabled: !!spaceId && !!exerciseName,
  });
}

// =============================================================================
// WORKOUTS MUTATIONS
// =============================================================================

export function useCreateWorkout() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (data: CreateWorkoutRequest): Promise<FitnessWorkout> => {
      const response = await apiClient.request<WorkoutResponse>('/fitness/workouts', {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
      });
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: fitnessKeys.workouts(data.space_id) });
      queryClient.invalidateQueries({ queryKey: fitnessKeys.summary(data.space_id) });
    },
  });
}

export function useUpdateWorkout() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ workoutId, data }: { workoutId: number; data: UpdateWorkoutRequest }): Promise<FitnessWorkout> => {
      const response = await apiClient.request<WorkoutResponse>(`/fitness/workouts/${workoutId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
      });
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: fitnessKeys.workout(data.id) });
      queryClient.invalidateQueries({ queryKey: fitnessKeys.workouts(data.space_id) });
    },
  });
}

export function useDeleteWorkout() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ workoutId, spaceId }: { workoutId: number; spaceId: number }): Promise<void> => {
      await apiClient.request<ApiResponse<{ deleted: boolean }>>(`/fitness/workouts/${workoutId}`, {
        method: 'DELETE',
      });
    },
    onSuccess: (_, { spaceId }) => {
      queryClient.invalidateQueries({ queryKey: fitnessKeys.workouts(spaceId) });
      queryClient.invalidateQueries({ queryKey: fitnessKeys.summary(spaceId) });
      queryClient.invalidateQueries({ queryKey: fitnessKeys.prs(spaceId) });
    },
  });
}

// =============================================================================
// SETS MUTATIONS
// =============================================================================

export function useAddSet() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ workoutId, data }: { workoutId: number; data: CreateSetRequest }): Promise<FitnessSet> => {
      const response = await apiClient.request<SetResponse>(`/fitness/workouts/${workoutId}/sets`, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
      });
      return response.data;
    },
    onSuccess: (_, { workoutId }) => {
      queryClient.invalidateQueries({ queryKey: fitnessKeys.workout(workoutId) });
    },
  });
}

export function useUpdateSet() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ setId, workoutId, data }: { setId: number; workoutId: number; data: UpdateSetRequest }): Promise<FitnessSet> => {
      const response = await apiClient.request<SetResponse>(`/fitness/sets/${setId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
      });
      return response.data;
    },
    onSuccess: (_, { workoutId }) => {
      queryClient.invalidateQueries({ queryKey: fitnessKeys.workout(workoutId) });
    },
  });
}

export function useDeleteSet() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ setId, workoutId }: { setId: number; workoutId: number }): Promise<void> => {
      await apiClient.request<ApiResponse<{ deleted: boolean }>>(`/fitness/sets/${setId}`, {
        method: 'DELETE',
      });
    },
    onSuccess: (_, { workoutId }) => {
      queryClient.invalidateQueries({ queryKey: fitnessKeys.workout(workoutId) });
    },
  });
}

// =============================================================================
// CSV IMPORT MUTATION
// =============================================================================

export function useImportCSV() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ spaceId, file }: { spaceId: number; file: File }): Promise<CSVImportResult> => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('space_id', String(spaceId));
      
      const response = await apiClient.request<CSVImportResponse>('/fitness/import/csv', {
        method: 'POST',
        body: formData,
        // Don't set Content-Type - browser will set it with boundary for FormData
      });
      return response.data;
    },
    onSuccess: (_, { spaceId }) => {
      queryClient.invalidateQueries({ queryKey: fitnessKeys.workouts(spaceId) });
      queryClient.invalidateQueries({ queryKey: fitnessKeys.summary(spaceId) });
      queryClient.invalidateQueries({ queryKey: fitnessKeys.prs(spaceId) });
      queryClient.invalidateQueries({ queryKey: fitnessKeys.muscleVolume(spaceId) });
    },
  });
}
