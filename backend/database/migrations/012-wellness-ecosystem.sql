-- =============================================================
-- MIGRATION: 012-wellness-ecosystem.sql
-- ADR-027: Wellness Ecosystem — Тамагочи для Человека
-- Phase 1: Foundation (Profile, Vitals, Gamification)
-- =============================================================

-- Профиль пользователя (физические параметры)
CREATE TABLE IF NOT EXISTS wellness_profiles (
  id SERIAL PRIMARY KEY,
  space_id INTEGER REFERENCES spaces(id) NOT NULL UNIQUE,
  gender VARCHAR(10),                    -- male, female, other
  birth_date DATE,
  height_cm INTEGER,
  target_weight_kg DECIMAL(5,2),
  activity_level VARCHAR(20),            -- sedentary, light, moderate, active, very_active
  bmr INTEGER,                           -- Basal Metabolic Rate (calculated)
  tdee INTEGER,                          -- Total Daily Energy Expenditure
  timezone VARCHAR(50) DEFAULT 'UTC',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- =============================================================
-- VITALS MODULE
-- =============================================================

-- Показатели здоровья
CREATE TABLE IF NOT EXISTS wellness_vitals (
  id SERIAL PRIMARY KEY,
  space_id INTEGER REFERENCES spaces(id) NOT NULL,
  measured_at TIMESTAMP NOT NULL,
  vital_type VARCHAR(50) NOT NULL,        -- weight, heart_rate, blood_pressure_sys, 
                                          -- blood_pressure_dia, temperature, spo2, 
                                          -- blood_glucose, body_fat_pct, body_battery
  value DECIMAL(10,3) NOT NULL,
  unit VARCHAR(20),                       -- kg, bpm, mmHg, C, %, mg/dL
  source VARCHAR(50) DEFAULT 'manual',    -- manual, garmin, apple_health, oura
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Индекс для быстрого поиска последних значений
CREATE INDEX IF NOT EXISTS idx_vitals_latest ON wellness_vitals(space_id, vital_type, measured_at DESC);
CREATE INDEX IF NOT EXISTS idx_vitals_space ON wellness_vitals(space_id);

-- =============================================================
-- GAMIFICATION MODULE
-- =============================================================

-- Очки
CREATE TABLE IF NOT EXISTS wellness_points (
  id SERIAL PRIMARY KEY,
  space_id INTEGER REFERENCES spaces(id) NOT NULL,
  earned_at TIMESTAMP DEFAULT NOW(),
  points INTEGER NOT NULL,
  source_type VARCHAR(50) NOT NULL,       -- vital, workout, habit, goal, achievement, streak
  source_id INTEGER,
  reason VARCHAR(255),
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_points_space ON wellness_points(space_id, earned_at DESC);

-- Уровни пользователя
CREATE TABLE IF NOT EXISTS wellness_levels (
  id SERIAL PRIMARY KEY,
  space_id INTEGER REFERENCES spaces(id) NOT NULL UNIQUE,
  current_level INTEGER DEFAULT 1,
  total_xp INTEGER DEFAULT 0,
  level_xp INTEGER DEFAULT 0,             -- XP in current level
  title VARCHAR(100) DEFAULT 'Beginner',
  avatar_url TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Справочник достижений (глобальный)
CREATE TABLE IF NOT EXISTS wellness_achievements (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  icon VARCHAR(100),
  category VARCHAR(50),                   -- fitness, nutrition, consistency, health
  tier VARCHAR(20) DEFAULT 'bronze',      -- bronze, silver, gold, platinum
  condition JSONB NOT NULL,               -- {"type": "streak", "streak_type": "workout", "count": 7}
  points_reward INTEGER DEFAULT 50,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Достижения пользователей
CREATE TABLE IF NOT EXISTS wellness_user_achievements (
  id SERIAL PRIMARY KEY,
  space_id INTEGER REFERENCES spaces(id) NOT NULL,
  achievement_id INTEGER REFERENCES wellness_achievements(id),
  earned_at TIMESTAMP,
  progress DECIMAL(5,2) DEFAULT 0,        -- 0-100%
  UNIQUE(space_id, achievement_id)
);

-- Streaks
CREATE TABLE IF NOT EXISTS wellness_streaks (
  id SERIAL PRIMARY KEY,
  space_id INTEGER REFERENCES spaces(id) NOT NULL,
  streak_type VARCHAR(50) NOT NULL,       -- workout, vitals_logged, nutrition_logged, water_goal
  current_count INTEGER DEFAULT 0,
  longest_count INTEGER DEFAULT 0,
  last_activity_date DATE,
  started_at DATE,
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(space_id, streak_type)
);

CREATE INDEX IF NOT EXISTS idx_streaks_space ON wellness_streaks(space_id);

-- =============================================================
-- SEED DATA: Default Achievements
-- =============================================================

INSERT INTO wellness_achievements (name, description, icon, category, tier, condition, points_reward) VALUES
-- Vitals Achievements
('First Check-in', 'Log your first vital sign', '❤️', 'health', 'bronze', '{"type": "count", "table": "wellness_vitals", "count": 1}', 10),
('Health Monitor', 'Log vitals for 7 days in a row', '📊', 'health', 'silver', '{"type": "streak", "streak_type": "vitals_logged", "count": 7}', 50),
('Vital Master', 'Log vitals for 30 days in a row', '🏆', 'health', 'gold', '{"type": "streak", "streak_type": "vitals_logged", "count": 30}', 200),

-- Fitness Achievements (cross-reference with ADR-025)
('First Workout', 'Complete your first workout', '💪', 'fitness', 'bronze', '{"type": "count", "table": "fitness_workouts", "count": 1}', 10),
('Week Warrior', 'Work out 7 days in a row', '🔥', 'fitness', 'silver', '{"type": "streak", "streak_type": "workout", "count": 7}', 50),
('Month Master', 'Work out 30 days in a row', '🏆', 'fitness', 'gold', '{"type": "streak", "streak_type": "workout", "count": 30}', 200),
('Century Club', 'Complete 100 workouts', '💯', 'fitness', 'platinum', '{"type": "count", "table": "fitness_workouts", "count": 100}', 500),

-- Level Achievements
('Level 5', 'Reach Level 5', '⭐', 'consistency', 'bronze', '{"type": "level", "level": 5}', 25),
('Level 10', 'Reach Level 10', '🌟', 'consistency', 'silver', '{"type": "level", "level": 10}', 75),
('Level 25', 'Reach Level 25', '✨', 'consistency', 'gold', '{"type": "level", "level": 25}', 150),
('Level 50', 'Reach Level 50', '🎖️', 'consistency', 'platinum', '{"type": "level", "level": 50}', 500)

ON CONFLICT DO NOTHING;

-- =============================================================
-- COMMENT: Level Thresholds
-- =============================================================

-- XP requirements per level (exponential curve)
-- Level 1: 0 XP, Level 2: 100 XP, Level 3: ~283 XP, Level 4: ~400 XP...
-- Formula: required_xp = round(100 * (level ^ 1.5))

COMMENT ON TABLE wellness_levels IS 'Level XP formula: required_xp = round(100 * (level ^ 1.5))';
COMMENT ON TABLE wellness_vitals IS 'Supported vital_types: weight, heart_rate, blood_pressure_sys, blood_pressure_dia, temperature, spo2, blood_glucose, body_fat_pct, body_battery';
