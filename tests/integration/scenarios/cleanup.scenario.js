#!/usr/bin/env node
/**
 * 🧹 CLEANUP SCENARIO
 * 
 * Удаляет все тестовые данные, созданные master scenario.
 * ВАЖНО: НЕ удаляет testowner@hltrn.cc
 * 
 * Использование:
 *   node tests/integration/scenarios/cleanup.scenario.js
 *   
 * Опции:
 *   --dry-run   Показать что будет удалено, но не удалять
 *   --force     Удалить без подтверждения
 */

const BASE_URL = process.env.TEST_API_URL || 'https://devcrm.hltrn.cc/api/v3';

const TEST_OWNER_EMAIL = 'testowner@hltrn.cc';
const TEST_EMAIL_PATTERNS = [
  /@test\.godcrm\.local$/,
  /^admin-\d+/,
  /^manager-\d+/,
  /^employee-\d+/,
  /^viewer-\d+/,
  /^test-\d+/
];

// ============================================================================
// API CLIENT
// ============================================================================

class CleanupApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.token = null;
  }

  setToken(token) {
    this.token = token;
  }

  async request(method, path, body = null) {
    const url = `${this.baseUrl}${path}`;
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const options = { method, headers };
    if (body && ['POST', 'PATCH', 'PUT'].includes(method)) {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, options);
      const data = await response.json();
      return { status: response.status, ok: response.ok, data: data.data || data, error: data.error };
    } catch (error) {
      return { status: 0, ok: false, error: error.message };
    }
  }

  get(path) { return this.request('GET', path); }
  post(path, body) { return this.request('POST', path, body); }
  delete(path) { return this.request('DELETE', path); }
}

const api = new CleanupApiClient(BASE_URL);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function log(emoji, message) {
  const timestamp = new Date().toISOString().slice(11, 19);
  console.log(`[${timestamp}] ${emoji} ${message}`);
}

function isTestEmail(email) {
  if (!email) return false;
  if (email === TEST_OWNER_EMAIL) return false; // NEVER delete testowner
  
  return TEST_EMAIL_PATTERNS.some(pattern => pattern.test(email));
}

// ============================================================================
// CLEANUP STEPS
// ============================================================================

async function loginAsOwner(email, password) {
  log('🔐', 'Logging in as admin for cleanup...');
  
  // First try testowner
  const result = await api.post('/auth/login', { email, password });
  
  if (!result.ok) {
    throw new Error(`Failed to login: ${result.error}`);
  }

  api.setToken(result.data.token);
  log('✅', `Logged in as ${email}`);
  return result.data;
}

async function findTestUsers() {
  log('🔍', 'Finding test users...');
  
  // Get all users (requires admin access)
  const result = await api.get('/users');
  
  if (!result.ok) {
    log('⚠️', 'Could not get users list, may need admin access');
    return [];
  }

  const users = Array.isArray(result.data) ? result.data : [];
  const testUsers = users.filter(u => isTestEmail(u.email));
  
  log('📊', `Found ${testUsers.length} test users to cleanup`);
  return testUsers;
}

async function findTestSpaces() {
  log('🔍', 'Finding test spaces...');
  
  const result = await api.get('/spaces');
  
  if (!result.ok) {
    return [];
  }

  const spaces = Array.isArray(result.data) ? result.data : [];
  // Filter spaces created by test users or with test names
  const testSpaces = spaces.filter(s => 
    s.name?.includes('Test Space') || 
    s.name?.includes("'s Workspace")
  );
  
  log('📊', `Found ${testSpaces.length} test spaces to cleanup`);
  return testSpaces;
}

async function findTestProjects() {
  log('🔍', 'Finding test projects...');
  
  const result = await api.get('/projects');
  
  if (!result.ok) {
    return [];
  }

  const projects = Array.isArray(result.data) ? result.data : [];
  const testProjects = projects.filter(p => 
    p.name?.includes('Test Project') ||
    p.name?.includes('Project ')
  );
  
  log('📊', `Found ${testProjects.length} test projects to cleanup`);
  return testProjects;
}

async function deleteEntities(type, entities, deleteFn) {
  if (entities.length === 0) return;
  
  log('🗑️', `Deleting ${entities.length} ${type}...`);
  
  let deleted = 0;
  let failed = 0;
  
  for (const entity of entities) {
    const result = await deleteFn(entity);
    if (result.ok) {
      deleted++;
    } else {
      failed++;
      log('⚠️', `Failed to delete ${type} ${entity.id}: ${result.error}`);
    }
  }
  
  log('📊', `Deleted ${deleted}/${entities.length} ${type} (${failed} failed)`);
}

// ============================================================================
// MAIN CLEANUP
// ============================================================================

async function runCleanup(options = {}) {
  const { dryRun = false, adminEmail = null, adminPassword = null } = options;

  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('     🧹 CLEANUP SCENARIO - GOD CRM');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
  
  if (dryRun) {
    console.log('⚠️  DRY RUN MODE - No data will be deleted\n');
  }

  console.log(`🛡️  Protected account: ${TEST_OWNER_EMAIL}`);
  console.log('');

  try {
    // Login
    if (!adminEmail || !adminPassword) {
      log('⚠️', 'Admin credentials required. Use --email and --password options');
      log('ℹ️', 'Example: node cleanup.scenario.js --email admin@example.com --password secret');
      return { success: false, error: 'Admin credentials required' };
    }

    await loginAsOwner(adminEmail, adminPassword);

    // Find entities to delete
    const testUsers = await findTestUsers();
    const testSpaces = await findTestSpaces();
    const testProjects = await findTestProjects();

    if (dryRun) {
      console.log('\n📋 Entities to be deleted:\n');
      
      console.log('Users:');
      testUsers.forEach(u => console.log(`  - ${u.email} (ID: ${u.id})`));
      
      console.log('\nSpaces:');
      testSpaces.forEach(s => console.log(`  - ${s.name} (ID: ${s.id})`));
      
      console.log('\nProjects:');
      testProjects.forEach(p => console.log(`  - ${p.name} (ID: ${p.id})`));
      
      console.log('\n⚠️  DRY RUN - No changes made');
      return { success: true, dryRun: true };
    }

    // Delete in order: rows -> tables -> widgets -> projects -> spaces -> users
    await deleteEntities('projects', testProjects, p => api.delete(`/projects/${p.id}`));
    await deleteEntities('spaces', testSpaces, s => api.delete(`/spaces/${s.id}`));
    await deleteEntities('users', testUsers, u => api.delete(`/users/${u.id}`));

    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('     ✅ CLEANUP COMPLETED');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
    
    return { success: true };

  } catch (error) {
    console.error('');
    console.error('═══════════════════════════════════════════════════════');
    console.error('     ❌ CLEANUP FAILED');
    console.error('═══════════════════════════════════════════════════════');
    console.error('');
    console.error('Error:', error.message);
    
    return { success: false, error: error.message };
  }
}

// Export for test runner
export { runCleanup, isTestEmail };

// Parse CLI args and run
if (process.argv[1] && process.argv[1].includes('cleanup.scenario.js')) {
  const args = process.argv.slice(2);
  const options = {
    dryRun: args.includes('--dry-run'),
    adminEmail: null,
    adminPassword: null
  };

  const emailIdx = args.indexOf('--email');
  if (emailIdx !== -1 && args[emailIdx + 1]) {
    options.adminEmail = args[emailIdx + 1];
  }

  const passIdx = args.indexOf('--password');
  if (passIdx !== -1 && args[passIdx + 1]) {
    options.adminPassword = args[passIdx + 1];
  }

  runCleanup(options).then(result => {
    process.exit(result.success ? 0 : 1);
  });
}
