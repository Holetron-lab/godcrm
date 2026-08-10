-- ADR-025: Fitness Module Tables Migration
-- Creates fitness_exercises, fitness_workouts, fitness_sets tables

-- Справочник упражнений (глобальный + user-specific)
CREATE TABLE IF NOT EXISTS fitness_exercises (
  id SERIAL PRIMARY KEY,
  space_id INTEGER REFERENCES spaces(id),  -- NULL = global
  name VARCHAR(255) NOT NULL,
  equipment VARCHAR(100),        -- barbell, dumbbell, machine, bodyweight
  primary_muscle VARCHAR(100),   -- Chest, Back, Shoulders...
  secondary_muscle VARCHAR(100),
  category VARCHAR(50),          -- compound, isolation, cardio
  created_at TIMESTAMP DEFAULT NOW()
);

-- Тренировочные сессии
CREATE TABLE IF NOT EXISTS fitness_workouts (
  id SERIAL PRIMARY KEY,
  space_id INTEGER REFERENCES spaces(id) NOT NULL,
  title VARCHAR(255),
  description TEXT,
  started_at TIMESTAMP NOT NULL,
  ended_at TIMESTAMP,
  notes TEXT,
  source VARCHAR(50) DEFAULT 'manual',  -- manual, csv_hevy, csv_strong, csv_lyfta
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Подходы (основная таблица данных)
CREATE TABLE IF NOT EXISTS fitness_sets (
  id SERIAL PRIMARY KEY,
  workout_id INTEGER REFERENCES fitness_workouts(id) ON DELETE CASCADE,
  exercise_id INTEGER REFERENCES fitness_exercises(id),
  exercise_name VARCHAR(255),    -- denormalized для быстрых запросов
  set_index INTEGER NOT NULL,
  set_type VARCHAR(50) DEFAULT 'normal', -- warmup, normal, dropset, failure
  weight_kg DECIMAL(7,2),
  reps INTEGER,
  rpe DECIMAL(3,1),              -- Rate of Perceived Exertion 1-10
  distance_km DECIMAL(7,3),
  duration_seconds INTEGER,
  is_pr BOOLEAN DEFAULT FALSE,   -- Personal Record marker
  created_at TIMESTAMP DEFAULT NOW()
);

-- Индексы для аналитики
CREATE INDEX IF NOT EXISTS idx_fitness_workouts_space ON fitness_workouts(space_id);
CREATE INDEX IF NOT EXISTS idx_fitness_workouts_date ON fitness_workouts(space_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_fitness_sets_workout ON fitness_sets(workout_id);
CREATE INDEX IF NOT EXISTS idx_fitness_sets_exercise ON fitness_sets(exercise_name);
CREATE INDEX IF NOT EXISTS idx_fitness_sets_pr ON fitness_sets(is_pr) WHERE is_pr = true;

-- Unique constraint для упражнений
CREATE UNIQUE INDEX IF NOT EXISTS idx_fitness_exercises_unique ON fitness_exercises(space_id, name) WHERE space_id IS NOT NULL;

-- Seed global exercises (базовые упражнения)
INSERT INTO fitness_exercises (space_id, name, equipment, primary_muscle, category) VALUES
(NULL, 'Bench Press', 'barbell', 'Chest', 'compound'),
(NULL, 'Squat', 'barbell', 'Quads', 'compound'),
(NULL, 'Deadlift', 'barbell', 'Back', 'compound'),
(NULL, 'Overhead Press', 'barbell', 'Shoulders', 'compound'),
(NULL, 'Barbell Row', 'barbell', 'Back', 'compound'),
(NULL, 'Pull-up', 'bodyweight', 'Back', 'compound'),
(NULL, 'Dip', 'bodyweight', 'Chest', 'compound'),
(NULL, 'Bicep Curl', 'dumbbell', 'Biceps', 'isolation'),
(NULL, 'Tricep Extension', 'cable', 'Triceps', 'isolation'),
(NULL, 'Leg Press', 'machine', 'Quads', 'compound'),
(NULL, 'Lat Pulldown', 'cable', 'Back', 'compound'),
(NULL, 'Leg Curl', 'machine', 'Hamstrings', 'isolation'),
(NULL, 'Leg Extension', 'machine', 'Quads', 'isolation'),
(NULL, 'Lateral Raise', 'dumbbell', 'Shoulders', 'isolation'),
(NULL, 'Face Pull', 'cable', 'Shoulders', 'isolation'),
(NULL, 'Calf Raise', 'machine', 'Calves', 'isolation'),
(NULL, 'Plank', 'bodyweight', 'Core', 'isolation'),
(NULL, 'Russian Twist', 'bodyweight', 'Core', 'isolation'),
(NULL, 'Incline Bench Press', 'barbell', 'Chest', 'compound'),
(NULL, 'Romanian Deadlift', 'barbell', 'Hamstrings', 'compound')
ON CONFLICT DO NOTHING;
