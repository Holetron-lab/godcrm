/**
 * ADR-027: Wellness API Hooks
 * TanStack Query integration for wellness endpoints
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/utils/apiClient';
import type {
  WellnessProfile,
  WellnessProfileInput,
  WellnessVital,
  WellnessVitalInput,
  VitalLatest,
  VitalTrend,
  GamificationSummary,
  Achievement,
  WellnessStreak,
  WellnessDashboard,
  ProfileResponse,
  VitalsListResponse,
  VitalResponse,
  LatestVitalsResponse,
  TrendsResponse,
  GamificationResponse,
  AchievementsResponse,
  StreaksResponse,
  DashboardResponse,
  VitalType,
} from '../types';

// =============================================================================
// QUERY KEYS
// =============================================================================

export const wellnessKeys = {
  all: ['wellness'] as const,
  profile: (spaceId: number) => [...wellnessKeys.all, 'profile', spaceId] as const,
  vitals: (spaceId: number) => [...wellnessKeys.all, 'vitals', spaceId] as const,
  vitalsLatest: (spaceId: number) => [...wellnessKeys.all, 'vitals-latest', spaceId] as const,
  vitalsTrends: (spaceId: number, vitalType: VitalType) => 
    [...wellnessKeys.all, 'vitals-trends', spaceId, vitalType] as const,
  gamification: (spaceId: number) => [...wellnessKeys.all, 'gamification', spaceId] as const,
  achievements: (spaceId: number) => [...wellnessKeys.all, 'achievements', spaceId] as const,
  streaks: (spaceId: number) => [...wellnessKeys.all, 'streaks', spaceId] as const,
  dashboard: (spaceId: number) => [...wellnessKeys.all, 'dashboard', spaceId] as const,
};

// =============================================================================
// PROFILE QUERIES & MUTATIONS
// =============================================================================

export function useWellnessProfile(spaceId: number) {
  return useQuery({
    queryKey: wellnessKeys.profile(spaceId),
    queryFn: async (): Promise<WellnessProfile | null> => {
      try {
        const response = await apiClient.request<ProfileResponse>(
          `/wellness/profile?space_id=${spaceId}`
        );
        return response.data;
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
          return null;
        }
        throw error;
      }
    },
    enabled: !!spaceId,
  });
}

export function useUpdateWellnessProfile(spaceId: number) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (data: WellnessProfileInput): Promise<WellnessProfile> => {
      const response = await apiClient.request<ProfileResponse>(
        `/wellness/profile?space_id=${spaceId}`,
        {
          method: 'PUT',
          body: JSON.stringify(data),
        }
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: wellnessKeys.profile(spaceId) });
      queryClient.invalidateQueries({ queryKey: wellnessKeys.dashboard(spaceId) });
    },
  });
}

// =============================================================================
// VITALS QUERIES & MUTATIONS
// =============================================================================

export function useWellnessVitals(spaceId: number, options?: {
  vitalType?: VitalType;
  limit?: number;
  offset?: number;
}) {
  const { vitalType, limit = 50, offset = 0 } = options || {};
  
  return useQuery({
    queryKey: [...wellnessKeys.vitals(spaceId), vitalType, limit, offset],
    queryFn: async (): Promise<WellnessVital[]> => {
      const params = new URLSearchParams({
        space_id: spaceId.toString(),
        limit: limit.toString(),
        offset: offset.toString(),
      });
      if (vitalType) {
        params.append('vital_type', vitalType);
      }
      const response = await apiClient.request<VitalsListResponse>(
        `/wellness/vitals?${params}`
      );
      return response.data;
    },
    enabled: !!spaceId,
  });
}

export function useLatestVitals(spaceId: number) {
  return useQuery({
    queryKey: wellnessKeys.vitalsLatest(spaceId),
    queryFn: async (): Promise<VitalLatest[]> => {
      const response = await apiClient.request<LatestVitalsResponse>(
        `/wellness/vitals/latest?space_id=${spaceId}`
      );
      return response.data;
    },
    enabled: !!spaceId,
  });
}

export function useVitalsTrends(spaceId: number, vitalType: VitalType, days: number = 30) {
  return useQuery({
    queryKey: wellnessKeys.vitalsTrends(spaceId, vitalType),
    queryFn: async (): Promise<VitalTrend[]> => {
      const response = await apiClient.request<TrendsResponse>(
        `/wellness/vitals/trends?space_id=${spaceId}&vital_type=${vitalType}&days=${days}`
      );
      return response.data;
    },
    enabled: !!spaceId && !!vitalType,
  });
}

export function useLogVital(spaceId: number) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (data: WellnessVitalInput): Promise<WellnessVital> => {
      const response = await apiClient.request<VitalResponse>(
        `/wellness/vitals?space_id=${spaceId}`,
        {
          method: 'POST',
          body: JSON.stringify(data),
        }
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: wellnessKeys.vitals(spaceId) });
      queryClient.invalidateQueries({ queryKey: wellnessKeys.vitalsLatest(spaceId) });
      queryClient.invalidateQueries({ queryKey: wellnessKeys.gamification(spaceId) });
      queryClient.invalidateQueries({ queryKey: wellnessKeys.streaks(spaceId) });
      queryClient.invalidateQueries({ queryKey: wellnessKeys.dashboard(spaceId) });
    },
  });
}

// =============================================================================
// GAMIFICATION QUERIES
// =============================================================================

export function useGamificationSummary(spaceId: number) {
  return useQuery({
    queryKey: wellnessKeys.gamification(spaceId),
    queryFn: async (): Promise<GamificationSummary> => {
      const response = await apiClient.request<GamificationResponse>(
        `/wellness/gamification/summary?space_id=${spaceId}`
      );
      return response.data;
    },
    enabled: !!spaceId,
  });
}

export function useAchievements(spaceId: number) {
  return useQuery({
    queryKey: wellnessKeys.achievements(spaceId),
    queryFn: async (): Promise<Achievement[]> => {
      const response = await apiClient.request<AchievementsResponse>(
        `/wellness/gamification/achievements?space_id=${spaceId}`
      );
      return response.data;
    },
    enabled: !!spaceId,
  });
}

// =============================================================================
// STREAKS QUERIES
// =============================================================================

export function useWellnessStreaks(spaceId: number) {
  return useQuery({
    queryKey: wellnessKeys.streaks(spaceId),
    queryFn: async (): Promise<WellnessStreak[]> => {
      const response = await apiClient.request<StreaksResponse>(
        `/wellness/streaks?space_id=${spaceId}`
      );
      return response.data;
    },
    enabled: !!spaceId,
  });
}

// =============================================================================
// DASHBOARD QUERY (COMBINED)
// =============================================================================

export function useWellnessDashboard(spaceId: number) {
  return useQuery({
    queryKey: wellnessKeys.dashboard(spaceId),
    queryFn: async (): Promise<WellnessDashboard> => {
      const response = await apiClient.request<DashboardResponse>(
        `/wellness/dashboard?space_id=${spaceId}`
      );
      return response.data;
    },
    enabled: !!spaceId,
    staleTime: 30_000, // Cache for 30 seconds
  });
}
