/**
 * ADR-025: Fitness Module Types
 * TypeScript definitions for fitness tracking
 */

// =============================================================================
// CORE TYPES
// =============================================================================

export interface FitnessExercise {
  id: number;
  space_id: number | null;
  name: string;
  equipment: string | null;
  primary_muscle: string | null;
  secondary_muscle: string | null;
  category: string | null;
  created_at: string;
}

export interface FitnessWorkout {
  id: number;
  space_id: number;
  title: string | null;
  description: string | null;
  started_at: string;
  ended_at: string | null;
  notes: string | null;
  source: 'manual' | 'csv_hevy' | 'csv_strong' | 'csv_generic';
  created_at: string;
  updated_at: string;
  // Computed fields (from rollups)
  total_sets?: number;
  workout_volume?: number;
  pr_count?: number;
  duration_minutes?: number;
  // Included when fetching single workout
  sets?: FitnessSet[];
}

export interface FitnessSet {
  id: number;
  workout_id: number;
  exercise_id: number | null;
  exercise_name: string;
  set_index: number;
  set_type: SetType;
  weight_kg: number | null;
  reps: number | null;
  rpe: number | null;
  distance_km: number | null;
  duration_seconds: number | null;
  notes: string | null;
  is_pr: boolean;
  created_at: string;
  // Computed fields (from formulas)
  volume?: number;
  estimated_1rm?: number;
  intensity?: number;
}

export type SetType = 'warmup' | 'normal' | 'dropset' | 'failure' | 'amrap';

// =============================================================================
// ANALYTICS TYPES
// =============================================================================

export interface FitnessSummary {
  total_workouts: number;
  total_sets: number;
  total_volume: number;
  total_prs: number;
}

export interface VolumeDataPoint {
  date?: string;
  exercise?: string;
  volume: number;
  sets: number;
}

export interface PersonalRecord {
  exercise_name: string;
  weight_kg: number;
  reps: number;
  achieved_at: string;
}

export interface StreakInfo {
  current_streak: number;
  longest_streak: number;
  workouts_this_week: number;
  total_workout_days: number;
}

export interface MuscleVolume {
  muscle: string;
  volume: number;
}

export interface ExerciseStats {
  exercise_name: string;
  total_sets: number;
  max_weight: number;
  avg_weight: number;
  max_reps: number;
  total_volume: number;
  estimated_1rm: number;
}

// =============================================================================
// API REQUEST/RESPONSE TYPES
// =============================================================================

export interface CreateWorkoutRequest {
  space_id: number;
  title?: string;
  description?: string;
  started_at: string;
  ended_at?: string;
  notes?: string;
}

export interface UpdateWorkoutRequest {
  title?: string;
  description?: string;
  started_at?: string;
  ended_at?: string;
  notes?: string;
}

export interface CreateSetRequest {
  exercise_id?: number;
  exercise_name: string;
  set_index?: number;
  set_type?: SetType;
  weight_kg?: number;
  reps?: number;
  rpe?: number;
  distance_km?: number;
  duration_seconds?: number;
  notes?: string;
  is_pr?: boolean;
}

export interface UpdateSetRequest {
  exercise_name?: string;
  set_index?: number;
  set_type?: SetType;
  weight_kg?: number;
  reps?: number;
  rpe?: number;
  distance_km?: number;
  duration_seconds?: number;
  notes?: string;
  is_pr?: boolean;
}

export interface CSVImportResult {
  format_detected: string;
  workouts_created: number;
  sets_created: number;
  rows_skipped: number;
}

// =============================================================================
// API RESPONSE WRAPPERS
// =============================================================================

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  timestamp: string;
}

export type WorkoutResponse = ApiResponse<FitnessWorkout>;
export type WorkoutsListResponse = ApiResponse<FitnessWorkout[]>;
export type SetResponse = ApiResponse<FitnessSet>;
export type SummaryResponse = ApiResponse<FitnessSummary>;
export type VolumeResponse = ApiResponse<VolumeDataPoint[]>;
export type PRsResponse = ApiResponse<PersonalRecord[]>;
export type StreakResponse = ApiResponse<StreakInfo>;
export type MuscleVolumeResponse = ApiResponse<MuscleVolume[]>;
export type ExerciseStatsResponse = ApiResponse<ExerciseStats>;
export type CSVImportResponse = ApiResponse<CSVImportResult>;
export type ExercisesListResponse = ApiResponse<FitnessExercise[]>;

// =============================================================================
// MUSCLE MAPPING (for Body Heatmap)
// =============================================================================

export type MuscleGroup = 
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'biceps'
  | 'triceps'
  | 'forearms'
  | 'abs'
  | 'obliques'
  | 'quadriceps'
  | 'hamstrings'
  | 'glutes'
  | 'calves'
  | 'traps'
  | 'lats'
  | 'lower_back'
  | 'hip_flexors'
  | 'adductors'
  | 'abductors';

export interface MuscleVolumeMap {
  [muscle: string]: number;
}

// =============================================================================
// UI COMPONENT PROPS
// =============================================================================

export interface FitnessDashboardProps {
  spaceId: number;
}

export interface WorkoutCardProps {
  workout: FitnessWorkout;
  onEdit?: (workout: FitnessWorkout) => void;
  onDelete?: (workoutId: number) => void;
}

export interface SetRowProps {
  set: FitnessSet;
  onUpdate?: (set: FitnessSet) => void;
  onDelete?: (setId: number) => void;
}

export type FitnessTab = 'dashboard' | 'exercises' | 'history' | 'muscles' | 'import';
