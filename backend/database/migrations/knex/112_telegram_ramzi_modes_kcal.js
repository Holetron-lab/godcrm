const NEW_STEPS = [
  'equipment', 'dislikes', 'allergies', 'kcal_opt_in', 'sex', 'age',
  'height', 'weight', 'activity', 'goal', 'edit_equipment',
  'edit_dislikes', 'edit_allergies', 'complete',
];
const OLD_STEPS = ['equipment', 'dislikes', 'allergies', 'complete'];
const NEW_COLUMNS = [
  'kcal_opt_in', 'sex', 'age', 'height_cm', 'weight_kg', 'activity_level',
  'goal', 'daily_kcal', 'macros_json', 'last_mode', 'pantry_text',
];

export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) { console.log('[Migration 112] Non-PG dialect — skipping.'); return; }

  await knex.raw(`
    ALTER TABLE telegram_ramzi_profiles
      ADD COLUMN IF NOT EXISTS kcal_opt_in BOOLEAN,
      ADD COLUMN IF NOT EXISTS sex TEXT CONSTRAINT telegram_ramzi_profiles_sex_check
        CHECK (sex IN ('male', 'female')),
      ADD COLUMN IF NOT EXISTS age INTEGER CONSTRAINT telegram_ramzi_profiles_age_check
        CHECK (age BETWEEN 18 AND 100),
      ADD COLUMN IF NOT EXISTS height_cm INTEGER CONSTRAINT telegram_ramzi_profiles_height_check
        CHECK (height_cm BETWEEN 120 AND 250),
      ADD COLUMN IF NOT EXISTS weight_kg NUMERIC(5, 1) CONSTRAINT telegram_ramzi_profiles_weight_check
        CHECK (weight_kg BETWEEN 30 AND 400),
      ADD COLUMN IF NOT EXISTS activity_level TEXT CONSTRAINT telegram_ramzi_profiles_activity_check
        CHECK (activity_level IN ('sedentary', 'light', 'moderate', 'active', 'very_active')),
      ADD COLUMN IF NOT EXISTS goal TEXT CONSTRAINT telegram_ramzi_profiles_goal_check
        CHECK (goal IN ('loss', 'maintain', 'gain')),
      ADD COLUMN IF NOT EXISTS daily_kcal INTEGER CONSTRAINT telegram_ramzi_profiles_kcal_check
        CHECK (daily_kcal BETWEEN 800 AND 10000),
      ADD COLUMN IF NOT EXISTS macros_json JSONB,
      ADD COLUMN IF NOT EXISTS last_mode TEXT CONSTRAINT telegram_ramzi_profiles_mode_check
        CHECK (last_mode IN ('mood', 'pantry')),
      ADD COLUMN IF NOT EXISTS pantry_text TEXT
  `);
  await knex.raw('ALTER TABLE telegram_ramzi_profiles DROP CONSTRAINT IF EXISTS telegram_ramzi_profiles_step_check');
  await knex.raw(`
    ALTER TABLE telegram_ramzi_profiles
      ADD CONSTRAINT telegram_ramzi_profiles_step_check
      CHECK (step IN (${NEW_STEPS.map((step) => `'${step}'`).join(', ')}))
  `);
  console.log('[Migration 112] Ramzi modes and calorie profile ensured');
}

export async function down(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) return;

  await knex.raw('ALTER TABLE telegram_ramzi_profiles DROP CONSTRAINT IF EXISTS telegram_ramzi_profiles_step_check');
  await knex.raw(`
    UPDATE telegram_ramzi_profiles
    SET step = 'complete'
    WHERE step NOT IN (${OLD_STEPS.map((step) => `'${step}'`).join(', ')})
  `);
  await knex.raw(`
    ALTER TABLE telegram_ramzi_profiles
      ADD CONSTRAINT telegram_ramzi_profiles_step_check
      CHECK (step IN (${OLD_STEPS.map((step) => `'${step}'`).join(', ')}))
  `);
  await knex.raw(`
    ALTER TABLE telegram_ramzi_profiles
      ${NEW_COLUMNS.map((column) => `DROP COLUMN IF EXISTS ${column}`).join(',\n      ')}
  `);
  console.log('[Migration 112] Ramzi modes and calorie profile rolled back');
}
