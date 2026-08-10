// Projects-Spaces Integration Tests - v0.003.000
// TDD: RED Phase - Tests for space_id in projects
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDatabase, cleanupTestDatabase } from './helpers/test-db.js';
import { createProject, getProjectsBySpace, getProjectById, updateProject, deleteProject } from '../services/ProjectService.js';
import { createSpace } from '../services/SpaceService.js';
import { dbGet, sqlTrue } from '../database/connection.js';

describe.skip('ProjectService with Spaces', () => {
  beforeEach(async () => {
    await setupTestDatabase();
  });

  afterEach(async () => {
    await cleanupTestDatabase();
  });

  describe.skip('createProject', () => {
    test('should create project in space', async () => {
      const space = await createSpace({
        owner_id: 1,
        name: 'Test Space',
        type: 'personal'
      });

      const project = await createProject({
        space_id: space.id,
        name: 'My Project',
        description: 'Test project',
        icon: '📊',
        owner_id: 1
      });

      expect(project.id).toBeDefined();
      expect(project.space_id).toBe(space.id);
      expect(project.name).toBe('My Project');
      expect(project.owner_id).toBe(1);
    });

    test('should reject project without space_id', async () => {
      await expect(
        createProject({
          name: 'Orphan Project',
          owner_id: 1
        })
      ).rejects.toThrow('space_id is required');
    });

    test('should reject project with invalid space_id', async () => {
      await expect(
        createProject({
          space_id: 999,
          name: 'Project',
          owner_id: 1
        })
      ).rejects.toThrow('Space not found');
    });

    test('should auto-create primary table for project', async () => {
      const space = await createSpace({
        owner_id: 1,
        name: 'Test Space',
        type: 'personal'
      });

      const project = await createProject({
        space_id: space.id,
        name: 'CRM',
        owner_id: 1
      });

      // Check that primary_table_id is set
      expect(project.primary_table_id).toBeDefined();
      
      // Verify table exists
      const table = await dbGet('SELECT * FROM universal_tables WHERE id = ?', [project.primary_table_id]);
      expect(table).toBeDefined();
      expect(table.project_id).toBe(project.id);
      expect(table.is_system).toBe(0);
    });

    test('should auto-create project dashboard', async () => {
      const space = await createSpace({
        owner_id: 1,
        name: 'Test Space',
        type: 'personal'
      });

      const project = await createProject({
        space_id: space.id,
        name: 'CRM',
        owner_id: 1
      });

      // Check dashboard exists
      const dashboard = await dbGet(`SELECT * FROM dashboards WHERE project_id = ? AND is_default = ${sqlTrue()}`, [project.id]);
      expect(dashboard).toBeDefined();
      expect(dashboard.project_id).toBe(project.id);
      expect(dashboard.user_id).toBeNull();
      expect(dashboard.space_id).toBeNull();
    });

    test('should use default icon if not provided', async () => {
      const space = await createSpace({ owner_id: 1, name: 'Test', type: 'personal' });
      
      const project = await createProject({
        space_id: space.id,
        name: 'Project',
        owner_id: 1
      });

      expect(project.icon).toBe('📁');
    });

    test('should use default themes if not provided', async () => {
      const space = await createSpace({ owner_id: 1, name: 'Test', type: 'personal' });
      
      const project = await createProject({
        space_id: space.id,
        name: 'Project',
        owner_id: 1
      });

      expect(project.theme_primary).toBe('#0ea5e9');
      expect(project.theme_secondary).toBe('#8b5cf6');
      expect(project.theme_tertiary).toBe('#10b981');
    });
  });

  describe.skip('getProjectsBySpace', () => {
    test('should return all projects in space', async () => {
      const space = await createSpace({ owner_id: 1, name: 'Test', type: 'personal' });
      
      await createProject({ space_id: space.id, name: 'Project 1', owner_id: 1 });
      await createProject({ space_id: space.id, name: 'Project 2', owner_id: 1 });

      const projects = await getProjectsBySpace(space.id);
      expect(projects).toHaveLength(2);
      expect(projects[0].name).toBe('Project 1');
      expect(projects[1].name).toBe('Project 2');
    });

    test('should return empty array if space has no projects', async () => {
      const space = await createSpace({ owner_id: 1, name: 'Test', type: 'personal' });
      
      const projects = await getProjectsBySpace(space.id);
      expect(projects).toEqual([]);
    });

    test('should not return projects from other spaces', async () => {
      const space1 = await createSpace({ owner_id: 1, name: 'Space 1', type: 'personal' });
      const space2 = await createSpace({ owner_id: 1, name: 'Space 2', type: 'business' });
      
      await createProject({ space_id: space1.id, name: 'Project 1', owner_id: 1 });
      await createProject({ space_id: space2.id, name: 'Project 2', owner_id: 1 });

      const projects = await getProjectsBySpace(space1.id);
      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe('Project 1');
    });
  });

  describe.skip('updateProject', () => {
    test('should update project name', async () => {
      const space = await createSpace({ owner_id: 1, name: 'Test', type: 'personal' });
      const project = await createProject({
        space_id: space.id,
        name: 'Old Name',
        owner_id: 1
      });

      const updated = await updateProject(project.id, {
        name: 'New Name'
      });

      expect(updated.name).toBe('New Name');
      expect(updated.space_id).toBe(space.id);
    });

    test('should not allow changing space_id', async () => {
      const space1 = await createSpace({ owner_id: 1, name: 'Space 1', type: 'personal' });
      const space2 = await createSpace({ owner_id: 1, name: 'Space 2', type: 'business' });
      const project = await createProject({
        space_id: space1.id,
        name: 'Project',
        owner_id: 1
      });

      await expect(
        updateProject(project.id, { space_id: space2.id })
      ).rejects.toThrow('Cannot change space_id');
    });
  });

  describe.skip('deleteProject', () => {
    test('should delete project', async () => {
      const space = await createSpace({ owner_id: 1, name: 'Test', type: 'personal' });
      const project = await createProject({
        space_id: space.id,
        name: 'To Delete',
        owner_id: 1
      });

      await deleteProject(project.id);

      const deleted = await getProjectById(project.id);
      expect(deleted).toBeNull();
    });

    test('should cascade delete tables', async () => {
      const space = await createSpace({ owner_id: 1, name: 'Test', type: 'personal' });
      const project = await createProject({
        space_id: space.id,
        name: 'Project',
        owner_id: 1
      });

      await deleteProject(project.id);

      // Check tables are deleted
      const tables = await dbGet('SELECT * FROM universal_tables WHERE project_id = ?', [project.id]);
      expect(tables).toBeUndefined();
    });

    test('should cascade delete dashboards', async () => {
      const space = await createSpace({ owner_id: 1, name: 'Test', type: 'personal' });
      const project = await createProject({
        space_id: space.id,
        name: 'Project',
        owner_id: 1
      });

      await deleteProject(project.id);

      // Check dashboard is deleted
      const dashboard = await dbGet('SELECT * FROM dashboards WHERE project_id = ?', [project.id]);
      expect(dashboard).toBeUndefined();
    });
  });

  describe.skip('CASCADE behavior', () => {
    test('should delete projects when space is deleted', async () => {
      const space = await createSpace({ owner_id: 1, name: 'Test', type: 'personal' });
      const project = await createProject({
        space_id: space.id,
        name: 'Project',
        owner_id: 1
      });

      const { deleteSpace } = await import('../services/SpaceService.js');
      await deleteSpace(space.id);

      // Project should be deleted
      const deleted = await getProjectById(project.id);
      expect(deleted).toBeNull();
    });
  });
});
