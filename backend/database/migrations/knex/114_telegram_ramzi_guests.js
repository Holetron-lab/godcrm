const OWNER_ID = Number(process.env.RAMZI_OWNER_CRM_USER_ID || 17);

export async function up(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) { console.log('[Migration 114] Non-PG dialect — skipping.'); return; }

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS telegram_ramzi_participants (
      telegram_user_id BIGINT PRIMARY KEY,
      label            TEXT,
      role             TEXT NOT NULL CHECK (role IN ('owner', 'guest')),
      status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
      invited_by       INTEGER REFERENCES users(id),
      messages_day     DATE,
      messages_today   INTEGER NOT NULL DEFAULT 0 CHECK (messages_today >= 0),
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at       TIMESTAMPTZ
    )
  `);
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS telegram_ramzi_invites (
      id          SERIAL PRIMARY KEY,
      code_hash   TEXT NOT NULL UNIQUE,
      label       TEXT NOT NULL,
      created_by  INTEGER NOT NULL REFERENCES users(id),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at  TIMESTAMPTZ NOT NULL,
      used_by     BIGINT,
      used_at     TIMESTAMPTZ,
      revoked_at  TIMESTAMPTZ
    )
  `);
  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'godcrm') THEN
        EXECUTE 'ALTER TABLE telegram_ramzi_participants OWNER TO godcrm';
        EXECUTE 'ALTER TABLE telegram_ramzi_invites OWNER TO godcrm';
        EXECUTE 'ALTER SEQUENCE telegram_ramzi_invites_id_seq OWNER TO godcrm';
      END IF;
    END $$;
  `);
  await knex.raw(`
    INSERT INTO telegram_ramzi_participants
      (telegram_user_id, label, role, status, invited_by, created_at)
    SELECT telegram_user_id, name, 'owner', 'active', id, NOW()
    FROM users
    WHERE id = ${OWNER_ID} AND telegram_user_id IS NOT NULL
    ON CONFLICT (telegram_user_id) DO UPDATE SET
      label = EXCLUDED.label, role = 'owner', status = 'active', revoked_at = NULL
  `);

  const legacyProfileKey = await knex('information_schema.columns')
    .select('column_name')
    .where({ table_name: 'telegram_ramzi_profiles', column_name: 'user_id' })
    .first();
  if (!legacyProfileKey) {
    console.log('[Migration 114] Ramzi guest access already applied');
    return;
  }

  await knex.raw('ALTER TABLE telegram_ramzi_profiles ADD COLUMN IF NOT EXISTS telegram_user_id BIGINT');
  await knex.raw(`
    UPDATE telegram_ramzi_profiles AS profile
    SET telegram_user_id = owner.telegram_user_id
    FROM users AS owner
    WHERE profile.user_id = owner.id AND owner.id = ${OWNER_ID}
      AND owner.telegram_user_id IS NOT NULL
  `);
  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM telegram_ramzi_profiles WHERE telegram_user_id IS NULL) THEN
        RAISE EXCEPTION 'Migration 114: every profile must belong to a bound Telegram participant';
      END IF;
    END $$;
  `);
  await knex.raw(`
    ALTER TABLE telegram_ramzi_profiles
      DROP CONSTRAINT telegram_ramzi_profiles_pkey,
      DROP COLUMN user_id,
      ALTER COLUMN telegram_user_id SET NOT NULL,
      ADD CONSTRAINT telegram_ramzi_profiles_pkey PRIMARY KEY (telegram_user_id),
      ADD CONSTRAINT telegram_ramzi_profiles_participant_fk
        FOREIGN KEY (telegram_user_id) REFERENCES telegram_ramzi_participants(telegram_user_id) ON DELETE CASCADE
  `);
  console.log('[Migration 114] Ramzi participants, invites and per-Telegram profiles ensured');
}

export async function down(knex) {
  const isPostgres = knex.client.config.client === 'pg' || knex.client.config.client === 'postgresql';
  if (!isPostgres) return;

  await knex.raw('ALTER TABLE telegram_ramzi_profiles ADD COLUMN user_id INTEGER');
  await knex.raw(`
    UPDATE telegram_ramzi_profiles AS profile
    SET user_id = owner.id
    FROM users AS owner
    WHERE profile.telegram_user_id = owner.telegram_user_id AND owner.id = ${OWNER_ID}
  `);
  await knex.raw('DELETE FROM telegram_ramzi_profiles WHERE user_id IS NULL');
  await knex.raw(`
    ALTER TABLE telegram_ramzi_profiles
      DROP CONSTRAINT telegram_ramzi_profiles_pkey,
      DROP COLUMN telegram_user_id,
      ALTER COLUMN user_id SET NOT NULL,
      ADD CONSTRAINT telegram_ramzi_profiles_pkey PRIMARY KEY (user_id),
      ADD CONSTRAINT telegram_ramzi_profiles_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  `);
  await knex.raw('DROP TABLE IF EXISTS telegram_ramzi_invites');
  await knex.raw('DROP TABLE IF EXISTS telegram_ramzi_participants');
  console.log('[Migration 114] Ramzi guest access rolled back to schema 113');
}
