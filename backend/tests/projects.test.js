// Projects & 3-Level Structure Tests

process.env.TEST_MODE = 'true';
process.env.MASTER_ENCRYPTION_KEY = 'test_master_key_32_characters_long!';

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDatabase, cleanupTestDatabase } from './helpers/test-db.js';
import { dbGet, dbAll } from '../database/connection.js';
import { registerUser } from '../services/AuthService.js';
import { 
  createProject,
  getProjectsByUser,
  autoCreateDefaultProjects
} from '../services/ProjectService.js';

describe.skip('Projects - 3-Level Structure', () => {
  beforeEach(async () => {
    process.env.SKIP_DEV_USER = 'true'; // Don't create dev user in tests
    await setupTestDatabase();
  });

  afterEach(async () => {
    await cleanupTestDatabase();
  });

  // Test 3.1: First user (owner) gets Admin Owner's Space
  test('should auto-create Admin Owner\'s Space for first user', async () => {
    const user = await registerUser({
      email: 'owner@test.com',
      password: 'Pass123',
      name: 'Owner'
    });

    // Check if Admin Owner's Space was created
    const projects = await dbAll('SELECT * FROM projects WHERE owner_id = ? AND type = ?', 
      [user.id, 'admin_owner_space']);

    expect(projects.length).toBe(1);
    expect(projects[0].name).toContain('Admin');
    expect(projects[0].type).toBe('admin_owner_space');
    expect(projects[0].icon).toBeDefined();
  });

  // Test 3.2: Every user gets Personal Space
  test('should auto-create Personal Space for each user', async () => {
    const user1 = await registerUser({
      email: 'user1@test.com',
      password: 'Pass123',
      name: 'User 1'
    });

    const user2 = await registerUser({
      email: 'user2@test.com',
      password: 'Pass123',
      name: 'User 2'
    });

    // Each should have Personal Space
    const projects1 = await dbAll('SELECT * FROM projects WHERE owner_id = ? AND type = ?', 
      [user1.id, 'personal_space']);
    const projects2 = await dbAll('SELECT * FROM projects WHERE owner_id = ? AND type = ?', 
      [user2.id, 'personal_space']);

    expect(projects1.length).toBe(1);
    expect(projects2.length).toBe(1);
    expect(projects1[0].name).toContain('Personal');
    expect(projects2[0].name).toContain('Personal');
  });

  // Test 3.3: Create custom project
  test('should create custom project with theme colors', async () => {
    const user = await registerUser({
      email: 'custom@test.com',
      password: 'Pass123',
      name: 'Custom User'
    });

    const project = await createProject({
      name: 'My Custom Project',
      description: 'Test project',
      icon: '🚀',
      owner_id: user.id,
      theme_primary: '#ff0000',
      theme_secondary: '#00ff00',
      theme_tertiary: '#0000ff'
    });

    expect(project.id).toBeDefined();
    expect(project.name).toBe('My Custom Project');
    expect(project.type).toBe('custom');
    expect(project.icon).toBe('🚀');
    expect(project.theme_primary).toBe('#ff0000');
    expect(project.theme_secondary).toBe('#00ff00');
    expect(project.theme_tertiary).toBe('#0000ff');
  });

  // Test 3.4: Get all projects for user
  test('should get all projects for user (system + custom)', async () => {
    const user = await registerUser({
      email: 'multi@test.com',
      password: 'Pass123',
      name: 'Multi User'
    });

    // Create 2 custom projects
    await createProject({ name: 'Project A', owner_id: user.id });
    await createProject({ name: 'Project B', owner_id: user.id });

    const projects = await getProjectsByUser(user.id);

    // Should have: Admin Space (if first) OR Personal Space + 2 custom
    expect(projects.length).toBeGreaterThanOrEqual(2);
    
    const customProjects = projects.filter(p => p.type === 'custom');
    expect(customProjects.length).toBe(2);
  });

  // Test 3.5: Default theme colors
  test('should use default theme colors if not specified', async () => {
    const user = await registerUser({
      email: 'default@test.com',
      password: 'Pass123',
      name: 'Default User'
    });

    const project = await createProject({
      name: 'Default Theme Project',
      owner_id: user.id
    });

    expect(project.theme_primary).toBe('#0ea5e9');
    expect(project.theme_secondary).toBe('#8b5cf6');
    expect(project.theme_tertiary).toBe('#10b981');
  });
});

describe.skip('Auto-Create Default Projects', () => {
  beforeEach(async () => {
    await setupTestDatabase();
  });

  afterEach(async () => {
    await cleanupTestDatabase();
  });

  // Test 3.6: autoCreateDefaultProjects function
  test('should create Admin Space for first user, Personal Space for others', async () => {
    // First user
    const user1 = await registerUser({
      email: 'first@test.com',
      password: 'Pass123',
      name: 'First'
    });

    const user1Projects = await getProjectsByUser(user1.id);
    const hasAdminSpace = user1Projects.some(p => p.type === 'admin_owner_space');
    const hasPersonalSpace = user1Projects.some(p => p.type === 'personal_space');

    expect(hasAdminSpace).toBe(true);
    expect(hasPersonalSpace).toBe(true); // Both

    // Second user
    const user2 = await registerUser({
      email: 'second@test.com',
      password: 'Pass123',
      name: 'Second'
    });

    const user2Projects = await getProjectsByUser(user2.id);
    const hasAdminSpace2 = user2Projects.some(p => p.type === 'admin_owner_space');
    const hasPersonalSpace2 = user2Projects.some(p => p.type === 'personal_space');

    expect(hasAdminSpace2).toBe(false); // No admin space
    expect(hasPersonalSpace2).toBe(true); // Only personal
  });
});
