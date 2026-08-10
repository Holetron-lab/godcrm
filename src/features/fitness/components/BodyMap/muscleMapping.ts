/**
 * ADR-025: Muscle Mapping Utilities
 * Maps exercise muscle names to SVG element IDs for body map visualization
 * Adapted from LiftShift
 */

/**
 * Maps CSV/DB muscle names to SVG muscle element IDs.
 * Used to highlight the correct body parts on the interactive body map.
 */
export const CSV_TO_SVG_MUSCLE_MAP: Record<string, string[]> = {
  // Generic muscle names (from fitness_exercises table)
  'Abdominals': ['lower-abdominals', 'upper-abdominals'],
  'Abs': ['lower-abdominals', 'upper-abdominals'],
  'Abductors': ['gluteus-medius'],
  'Adductors': ['inner-thigh'],
  'Biceps': ['long-head-bicep', 'short-head-bicep'],
  'Calves': ['gastrocnemius', 'soleus', 'tibialis'],
  'Chest': ['mid-lower-pectoralis', 'upper-pectoralis'],
  'Forearms': ['wrist-extensors', 'wrist-flexors'],
  'Glutes': ['gluteus-maximus', 'gluteus-medius'],
  'Hamstrings': ['medial-hamstrings', 'lateral-hamstrings'],
  'Lats': ['lats'],
  'Lower Back': ['lowerback'],
  'Neck': ['neck'],
  'Quadriceps': ['outer-quadricep', 'rectus-femoris', 'inner-quadricep'],
  'Quads': ['outer-quadricep', 'rectus-femoris', 'inner-quadricep'],
  'Shoulders': ['anterior-deltoid', 'lateral-deltoid', 'posterior-deltoid'],
  'Traps': ['upper-trapezius', 'lower-trapezius', 'traps-middle'],
  'Trapezius': ['upper-trapezius', 'lower-trapezius', 'traps-middle'],
  'Triceps': ['medial-head-triceps', 'long-head-triceps', 'lateral-head-triceps'],
  'Upper Back': ['lats', 'upper-trapezius', 'lower-trapezius', 'traps-middle', 'posterior-deltoid'],
  'Back': ['lats', 'upper-trapezius', 'lower-trapezius', 'traps-middle', 'posterior-deltoid', 'lowerback'],
  'Obliques': ['obliques'],
  
  // Anatomical muscle names
  'chest_clavicular_head': ['upper-pectoralis'],
  'chest_sternal_head': ['mid-lower-pectoralis'],
  'pectoralis_major': ['mid-lower-pectoralis', 'upper-pectoralis'],
  'deltoid_anterior': ['anterior-deltoid'],
  'deltoid_lateral': ['lateral-deltoid'],
  'deltoid_posterior': ['posterior-deltoid'],
  'deltoids': ['anterior-deltoid', 'lateral-deltoid', 'posterior-deltoid'],
  'biceps_brachii': ['long-head-bicep', 'short-head-bicep'],
  'triceps_brachii': ['medial-head-triceps', 'long-head-triceps', 'lateral-head-triceps'],
  'latissimus_dorsi': ['lats'],
  'trapezius': ['upper-trapezius', 'lower-trapezius', 'traps-middle'],
  'erector_spinae': ['lowerback'],
  'gluteus_maximus': ['gluteus-maximus'],
  'gluteus_medius': ['gluteus-medius'],
  'rectus_femoris': ['rectus-femoris'],
  'vastus_lateralis': ['outer-quadricep'],
  'vastus_medialis': ['inner-quadricep'],
  'biceps_femoris': ['lateral-hamstrings'],
  'semitendinosus': ['medial-hamstrings'],
  'gastrocnemius': ['gastrocnemius'],
  'soleus': ['soleus'],
  'rectus_abdominis': ['lower-abdominals', 'upper-abdominals'],
  'external_oblique': ['obliques'],
};

// Lowercase version for case-insensitive matching
const CSV_TO_SVG_MUSCLE_MAP_LOWER: Record<string, string[]> = Object.fromEntries(
  Object.entries(CSV_TO_SVG_MUSCLE_MAP).map(([k, v]) => [k.toLowerCase(), v])
);

/**
 * Get SVG element IDs for a muscle name
 */
export function getSvgIdsForMuscleName(muscleName: string | undefined): string[] {
  const raw = String(muscleName ?? '').trim();
  if (!raw) return [];
  return CSV_TO_SVG_MUSCLE_MAP[raw] ?? CSV_TO_SVG_MUSCLE_MAP_LOWER[raw.toLowerCase()] ?? [];
}

/**
 * Maps SVG muscle IDs to human-readable display names
 */
export const SVG_MUSCLE_NAMES: Record<string, string> = {
  'gastrocnemius': 'Calves',
  'soleus': 'Calves',
  'tibialis': 'Calves',
  'outer-quadricep': 'Quadriceps',
  'rectus-femoris': 'Quadriceps',
  'inner-quadricep': 'Quadriceps',
  'lower-abdominals': 'Abdominals',
  'upper-abdominals': 'Abdominals',
  'obliques': 'Obliques',
  'mid-lower-pectoralis': 'Chest',
  'upper-pectoralis': 'Chest',
  'long-head-bicep': 'Biceps',
  'short-head-bicep': 'Biceps',
  'wrist-extensors': 'Forearms',
  'wrist-flexors': 'Forearms',
  'anterior-deltoid': 'Shoulders',
  'lateral-deltoid': 'Shoulders',
  'posterior-deltoid': 'Shoulders',
  'upper-trapezius': 'Traps',
  'lower-trapezius': 'Traps',
  'traps-middle': 'Traps',
  'lats': 'Lats',
  'lowerback': 'Lower Back',
  'medial-hamstrings': 'Hamstrings',
  'lateral-hamstrings': 'Hamstrings',
  'gluteus-maximus': 'Glutes',
  'gluteus-medius': 'Glutes',
  'medial-head-triceps': 'Triceps',
  'long-head-triceps': 'Triceps',
  'lateral-head-triceps': 'Triceps',
  'neck': 'Neck',
  'inner-thigh': 'Adductors',
};

/**
 * Maps SVG muscle IDs to their parent muscle group
 */
export const SVG_MUSCLE_GROUPS: Record<string, string> = {
  'anterior-deltoid': 'Shoulders',
  'lateral-deltoid': 'Shoulders',
  'posterior-deltoid': 'Shoulders',
  'mid-lower-pectoralis': 'Chest',
  'upper-pectoralis': 'Chest',
  'long-head-bicep': 'Biceps',
  'short-head-bicep': 'Biceps',
  'medial-head-triceps': 'Triceps',
  'long-head-triceps': 'Triceps',
  'lateral-head-triceps': 'Triceps',
  'lower-abdominals': 'Abdominals',
  'upper-abdominals': 'Abdominals',
  'outer-quadricep': 'Quadriceps',
  'rectus-femoris': 'Quadriceps',
  'inner-quadricep': 'Quadriceps',
  'medial-hamstrings': 'Hamstrings',
  'lateral-hamstrings': 'Hamstrings',
  'gluteus-maximus': 'Glutes',
  'gluteus-medius': 'Glutes',
  'gastrocnemius': 'Calves',
  'soleus': 'Calves',
  'tibialis': 'Calves',
  'upper-trapezius': 'Traps',
  'lower-trapezius': 'Traps',
  'traps-middle': 'Traps',
  'wrist-extensors': 'Forearms',
  'wrist-flexors': 'Forearms',
  'lats': 'Lats',
  'lowerback': 'Lower Back',
  'obliques': 'Obliques',
  'neck': 'Neck',
  'inner-thigh': 'Adductors',
};

/** All interactive SVG muscle IDs */
export const INTERACTIVE_MUSCLE_IDS = [
  'upper-trapezius',
  'gastrocnemius',
  'tibialis',
  'soleus',
  'outer-quadricep',
  'rectus-femoris',
  'inner-quadricep',
  'inner-thigh',
  'wrist-extensors',
  'wrist-flexors',
  'long-head-bicep',
  'short-head-bicep',
  'obliques',
  'lower-abdominals',
  'upper-abdominals',
  'mid-lower-pectoralis',
  'upper-pectoralis',
  'anterior-deltoid',
  'lateral-deltoid',
  'medial-hamstrings',
  'lateral-hamstrings',
  'gluteus-maximus',
  'gluteus-medius',
  'lowerback',
  'lats',
  'medial-head-triceps',
  'long-head-triceps',
  'lateral-head-triceps',
  'posterior-deltoid',
  'lower-trapezius',
  'traps-middle',
] as const;

export type InteractiveMuscleId = typeof INTERACTIVE_MUSCLE_IDS[number];

/**
 * Get volume-based color for muscle highlighting
 * Uses warm color gradient (yellow → orange → red)
 */
export function getVolumeColor(volume: number, maxVolume: number): string {
  if (!volume || !maxVolume || maxVolume === 0) {
    return 'var(--bg-tertiary, #374151)'; // Default gray
  }
  
  const intensity = Math.min(volume / maxVolume, 1);
  
  // Gradient from light yellow to deep orange
  if (intensity < 0.2) return 'rgb(254, 243, 199)'; // yellow-100
  if (intensity < 0.4) return 'rgb(253, 224, 71)';  // yellow-300
  if (intensity < 0.6) return 'rgb(250, 204, 21)';  // yellow-400
  if (intensity < 0.8) return 'rgb(234, 179, 8)';   // yellow-500
  return 'rgb(202, 138, 4)'; // yellow-600
}

/**
 * Get related SVG IDs for a muscle group
 */
export function getRelatedMuscleIds(muscleGroup: string | null): string[] {
  if (!muscleGroup) return [];
  
  // If it's already an SVG ID, get the group and find all related
  const groupName = SVG_MUSCLE_GROUPS[muscleGroup];
  if (groupName) {
    return Object.entries(SVG_MUSCLE_GROUPS)
      .filter(([, group]) => group === groupName)
      .map(([id]) => id);
  }
  
  // If it's a group name, find all matching IDs
  return Object.entries(SVG_MUSCLE_GROUPS)
    .filter(([, group]) => group === muscleGroup)
    .map(([id]) => id);
}
