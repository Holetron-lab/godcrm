/**
 * Wellness/Fitness Widget Types
 * @see ADR-025: Fitness Module - LiftShift Clone
 * @see ADR-027: Wellness Ecosystem
 */

export interface FitnessWidgetConfig {
  // Table IDs from widget creation
  workouts_table_id?: number;
  sets_table_id?: number;
  exercises_table_id?: number;
  
  // Wellness table IDs (ADR-027)
  profile_table_id?: number;
  vitals_table_id?: number;
  levels_table_id?: number;
  achievements_table_id?: number;
  streaks_table_id?: number;
  
  // Column mappings for workouts
  workouts_startDateColumn?: string;
  workouts_titleColumn?: string;
  workouts_endDateColumn?: string;
  workouts_notesColumn?: string;
  
  // Column mappings for sets
  sets_workoutColumn?: string;
  sets_exerciseColumn?: string;
  sets_weightColumn?: string;
  sets_repsColumn?: string;
  sets_setIndexColumn?: string;
  sets_rpeColumn?: string;
  sets_isPrColumn?: string;
  
  // Column mappings for exercises
  exercises_nameColumn?: string;
  exercises_muscleColumn?: string;
  exercises_equipmentColumn?: string;
  
  // Column mappings for vitals (ADR-027)
  vitals_typeColumn?: string;
  vitals_valueColumn?: string;
  vitals_dateColumn?: string;
  
  // View preferences
  defaultView?: 'dashboard' | 'wellness' | 'exercises' | 'history' | 'import';
  showMuscleHeatmap?: boolean;
  showStats?: boolean;
}

export type FitnessTab = 'dashboard' | 'wellness' | 'exercises' | 'history' | 'import';

// Alias for wellness context
export type WellnessWidgetConfig = FitnessWidgetConfig;
export type WellnessTab = FitnessTab;
