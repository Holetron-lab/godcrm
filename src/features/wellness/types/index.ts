/**
 * ADR-027: Wellness Module Types
 * TypeScript definitions for wellness tracking (health profile, vitals, gamification)
 */

// =============================================================================
// PROFILE TYPES
// =============================================================================

export type Gender = 'male' | 'female' | 'other';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type VitalType = 
  | 'weight' 
  | 'heart_rate' 
  | 'blood_pressure_sys' 
  | 'blood_pressure_dia' 
  | 'temperature' 
  | 'spo2' 
  | 'blood_glucose' 
  | 'body_fat_pct' 
  | 'body_battery';

export type StreakType = 'workout' | 'vitals_logged' | 'nutrition_logged';

export interface WellnessProfile {
  id: number;
  space_id: number;
  height_cm: number | null;
  current_weight_kg: number | null;
  target_weight_kg: number | null;
  birth_date: string | null;
  gender: Gender | null;
  activity_level: ActivityLevel;
  bmr_kcal: number | null;
  tdee_kcal: number | null;
  created_at: string;
  updated_at: string;
}

export interface WellnessProfileInput {
  height_cm?: number;
  current_weight_kg?: number;
  target_weight_kg?: number;
  birth_date?: string;
  gender?: Gender;
  activity_level?: ActivityLevel;
}

// =============================================================================
// VITALS TYPES
// =============================================================================

export interface WellnessVital {
  id: number;
  space_id: number;
  vital_type: VitalType;
  value: number;
  unit: string;
  recorded_at: string;
  notes: string | null;
  source: string;
  created_at: string;
}

export interface WellnessVitalInput {
  vital_type: VitalType;
  value: number;
  unit?: string;
  recorded_at?: string;
  notes?: string;
  source?: string;
}

export interface VitalLatest {
  vital_type: VitalType;
  value: number;
  unit: string;
  recorded_at: string;
}

export interface VitalTrend {
  date: string;
  avg_value: number;
  min_value: number;
  max_value: number;
}

// =============================================================================
// GAMIFICATION TYPES
// =============================================================================

export interface GamificationSummary {
  level: number;
  current_xp: number;
  xp_for_next_level: number;
  total_points: number;
  total_spent: number;
  points_balance: number;
  xp_progress_percent: number;
}

export interface PointsLog {
  id: number;
  space_id: number;
  action_type: string;
  points: number;
  description: string | null;
  created_at: string;
}

export interface Achievement {
  id: number;
  code: string;
  name: string;
  description: string | null;
  icon: string | null;
  points_reward: number;
  xp_reward: number;
  category: string;
  // User progress fields (when fetched with user achievements)
  unlocked_at?: string | null;
  progress?: number;
  target?: number;
}

export interface UserAchievement {
  achievement: Achievement;
  unlocked_at: string | null;
  progress: number;
  target: number;
}

// =============================================================================
// STREAKS TYPES
// =============================================================================

export interface WellnessStreak {
  streak_type: StreakType;
  current_streak: number;
  longest_streak: number;
  last_activity_at: string | null;
}

// =============================================================================
// DASHBOARD TYPES
// =============================================================================

export interface WellnessDashboard {
  profile: WellnessProfile | null;
  latest_vitals: VitalLatest[];
  gamification: GamificationSummary;
  streaks: WellnessStreak[];
}

// =============================================================================
// API RESPONSE TYPES
// =============================================================================

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  timestamp?: string;
  error?: string;
}

export type ProfileResponse = ApiResponse<WellnessProfile>;
export type VitalsListResponse = ApiResponse<WellnessVital[]>;
export type VitalResponse = ApiResponse<WellnessVital>;
export type LatestVitalsResponse = ApiResponse<VitalLatest[]>;
export type TrendsResponse = ApiResponse<VitalTrend[]>;
export type GamificationResponse = ApiResponse<GamificationSummary>;
export type AchievementsResponse = ApiResponse<Achievement[]>;
export type StreaksResponse = ApiResponse<WellnessStreak[]>;
export type DashboardResponse = ApiResponse<WellnessDashboard>;
