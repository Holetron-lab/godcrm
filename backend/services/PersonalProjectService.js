import Database from 'better-sqlite3';

const DB_FILE = process.env.DB_PATH || process.env.DATABASE_PATH || '/var/lib/business-crm-data/crm.db';
const db = new Database(DB_FILE, { fileMustExist: false });
const PERSONAL_TAG = 'personal';
const OWNER_ADMIN_TAG = 'owner_admin';

const getUser = (userId) => {
  return db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(userId);
};

const ensureBusinessForUser = (userId) => {
  let business = db
    .prepare('SELECT id, name FROM businesses WHERE owner_id = ? ORDER BY created_at ASC LIMIT 1')
    .get(userId);

  if (!business) {
    const user = getUser(userId);
    const workspaceName = user?.name ? `${user.name} Workspace` : `Workspace #${userId}`;
    const result = db
      .prepare('INSERT INTO businesses (name, description, owner_id) VALUES (?, ?, ?)')
      .run(workspaceName, 'Personal workspace for private tables', userId);
    business = { id: result.lastInsertRowid, name: workspaceName };
  }

  return business;
};

const formatProjectRecord = (record) => {
  if (!record) return null;
  let logo = null;
  if (record.notes) {
    try {
      const meta = JSON.parse(record.notes);
      logo = meta?.logo ?? null;
    } catch {
      logo = null;
    }
  }

  return {
    ...record,
    logo
  };
};

export const ensurePersonalProject = (userId) => {
  // Check for new-style personal_space project first
  let project = db
    .prepare('SELECT * FROM projects WHERE owner_id = ? AND type = ?')
    .get(userId, 'personal_space');

  if (!project) {
    // Create new-style personal space project
    const user = getUser(userId);
    const projectName = 'Personal Space';
    const description = 'Your private workspace';
    const icon = '👤';
    
    const insert = db
      .prepare(
        `INSERT INTO projects (
          name,
          description,
          icon,
          type,
          owner_id,
          theme_primary,
          theme_secondary,
          theme_tertiary
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        projectName,
        description,
        icon,
        'personal_space',
        userId,
        '#0ea5e9',  // Primary blue
        '#8b5cf6',  // Secondary purple
        '#10b981'   // Tertiary green
      );

    project = db
      .prepare('SELECT * FROM projects WHERE id = ?')
      .get(insert.lastInsertRowid);
  }

  return project;
};

export const ensurePersonalProjectId = (userId) => {
  const project = ensurePersonalProject(userId);
  return project?.id ?? null;
};

const getOwnerUser = () =>
  db.prepare('SELECT id, name, email FROM users WHERE role = ? ORDER BY id ASC LIMIT 1').get('owner');

export const ensureOwnerAdminSpace = () => {
  const owner = getOwnerUser();
  if (!owner) {
    return null;
  }

  // Check for new-style admin_owner_space project
  let project = db
    .prepare('SELECT * FROM projects WHERE owner_id = ? AND type = ?')
    .get(owner.id, 'admin_owner_space');

  if (!project) {
    // Create new-style admin owner space
    const insert = db
      .prepare(
        `INSERT INTO projects (
          name,
          description,
          icon,
          type,
          owner_id,
          theme_primary,
          theme_secondary,
          theme_tertiary,
          settings
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "Admin Owner's Space",
        'System administration and user management',
        '⚙️',
        'admin_owner_space',
        owner.id,
        '#ef4444',  // Red
        '#f97316',  // Orange
        '#fbbf24',  // Yellow
        JSON.stringify({ visibility: 'owner_only' })
      );

    project = db
      .prepare('SELECT * FROM projects WHERE id = ?')
      .get(insert.lastInsertRowid);
  }

  return project;
};
