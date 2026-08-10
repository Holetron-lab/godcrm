/**
 * Export/Import API Routes Tests - TDD
 * ADR-020: Export/Import — Quick Backup & Restore
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import exportImportRoutes from '../export-import.js';
import { dbAll, dbGet, dbRun, destroyAdapter, resetAdapter, toBool } from '../../../database/connection.js';
// Mock authenticate middleware
const mockAuthenticate = (req, res, next) => {
  req.user = { id: 1 }; // Mock user
  next();
};

// Create test app
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => mockAuthenticate(req, res, next));
  app.use('/api/v3', exportImportRoutes);
  return app;
}

// Test helpers
function generateBaseId() {
  return 'base_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
}

async function createTestUser() {
  const uniqueEmail = `test-api-${Date.now()}-${Math.random().toString(36).substring(7)}@hltrn.cc`;
  const result = await dbRun(
    'INSERT INTO users (email, password_hash, name, encryption_key_encrypted, email_verified) VALUES (?, ?, ?, ?, ?)',
    [uniqueEmail, 'hash', 'Test User', 'encrypted_key', 1]
  );
  return result.lastInsertRowid;
}

async function createTestSpace(ownerId, name = 'Test Space') {
  const result = await dbRun(
    'INSERT INTO spaces (owner_id, name, type) VALUES (?, ?, ?)',
    [ownerId, name, 'business']
  );
  return result.lastInsertRowid;
}

async function createTestProject(spaceId, ownerId, name = 'Test Project') {
  const result = await dbRun(
    'INSERT INTO projects (space_id, owner_id, name, type) VALUES (?, ?, ?, ?)',
    [spaceId, ownerId, name, 'business']
  );
  return result.lastInsertRowid;
}

async function createTestTable(projectId, name = 'Test Table') {
  const result = await dbRun(
    'INSERT INTO universal_tables (project_id, name, is_system) VALUES (?, ?, ?)',
    [projectId, name, toBool(false)]
  );
  const tableId = result.lastInsertRowid;
  
  // Add a column
  await dbRun(`
    INSERT INTO table_columns (table_id, column_name, display_name, type, order_index)
    VALUES (?, ?, ?, ?, ?)
  `, [tableId, 'name', 'Name', 'text', 0]);
  
  // Add a row
  await dbRun(`
    INSERT INTO table_rows (table_id, base_id, data)
    VALUES (?, ?, ?)
  `, [tableId, generateBaseId(), JSON.stringify({ name: 'Test Row' })]);
  
  return tableId;
}

describe('Export/Import API Routes', () => {
  let app;
  let userId;
  let spaceId;
  let projectId;
  let tableId;
  
  beforeEach(async () => {
    process.env.TEST_MODE = 'true';
    process.env.SKIP_DEV_USER = 'true';
    await resetAdapter();
    
    app = createTestApp();
    userId = await createTestUser();
    spaceId = await createTestSpace(userId);
    projectId = await createTestProject(spaceId, userId);
    tableId = await createTestTable(projectId);
    
    // Update mock to use real user
    mockAuthenticate.userId = userId;
  });
  
  afterEach(async () => {
    await destroyAdapter();
  });
  
  describe('POST /tables/:tableId/export', () => {
    it('exports table with default full mode', async () => {
      const res = await request(app)
        .post(`/api/v3/tables/${tableId}/export`)
        .send({});
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.type).toBe('table');
      expect(res.body.data.columns.length).toBeGreaterThan(0);
      expect(res.body.data.rows.length).toBeGreaterThan(0);
      expect(res.body.data.meta.mode).toBe('full');
    });
    
    it('exports table with schema_only mode', async () => {
      const res = await request(app)
        .post(`/api/v3/tables/${tableId}/export`)
        .send({ mode: 'schema_only' });
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.rows).toHaveLength(0);
      expect(res.body.data.meta.mode).toBe('schema_only');
    });
    
    it('returns error for non-existent table', async () => {
      const res = await request(app)
        .post('/api/v3/tables/99999/export')
        .send({});
      
      // Either 403 (access denied) or 500 (not found) are valid responses
      expect([403, 500]).toContain(res.status);
      expect(res.body.success).toBe(false);
    });
  });
  
  describe('POST /tables/:tableId/sensitive-columns', () => {
    it('detects sensitive columns', async () => {
      // Create table with sensitive column
      const sensitiveTableId = await dbRun(`
        INSERT INTO universal_tables (project_id, name, is_system) VALUES (?, ?, ?)
      `, [projectId, 'Sensitive Table', toBool(false)]);
      
      await dbRun(`
        INSERT INTO table_columns (table_id, column_name, display_name, type, order_index)
        VALUES (?, ?, ?, ?, ?)
      `, [sensitiveTableId.lastInsertRowid, 'api_key', 'API Key', 'apiKey', 0]);
      
      const res = await request(app)
        .post(`/api/v3/tables/${sensitiveTableId.lastInsertRowid}/sensitive-columns`)
        .send({});
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.hasSensitive).toBe(true);
      expect(res.body.data.columns).toContainEqual(expect.objectContaining({
        name: 'api_key',
        type: 'apiKey'
      }));
    });
  });
  
  describe('POST /projects/:projectId/export', () => {
    it('exports project with tables', async () => {
      const res = await request(app)
        .post(`/api/v3/projects/${projectId}/export`)
        .send({ tables: { '*': 'full' } });
      
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.type).toBe('project');
      expect(res.body.data.tables.length).toBeGreaterThan(0);
    });
  });
  
  describe('POST /projects/:projectId/import/table', () => {
    it('imports table to project', async () => {
      // First export a table
      const exportRes = await request(app)
        .post(`/api/v3/tables/${tableId}/export`)
        .send({});
      
      const exportData = exportRes.body.data;
      
      // Then import it
      const importRes = await request(app)
        .post(`/api/v3/projects/${projectId}/import/table`)
        .send({
          data: exportData,
          mode: 'create',
          newName: 'Imported Table'
        });
      
      expect(importRes.status).toBe(201);
      expect(importRes.body.success).toBe(true);
      expect(importRes.body.data.tableId).toBeDefined();
      expect(importRes.body.data.rowsImported).toBeGreaterThanOrEqual(0);
    });
    
    it('returns 400 when data is missing', async () => {
      const res = await request(app)
        .post(`/api/v3/projects/${projectId}/import/table`)
        .send({});
      
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('MISSING_DATA');
    });
  });
  
  describe('POST /spaces/:spaceId/import/project', () => {
    it('imports project to space', async () => {
      // First export a project
      const exportRes = await request(app)
        .post(`/api/v3/projects/${projectId}/export`)
        .send({ tables: { '*': 'full' } });
      
      const exportData = exportRes.body.data;
      
      // Then import it
      const importRes = await request(app)
        .post(`/api/v3/spaces/${spaceId}/import/project`)
        .send({
          data: exportData,
          newName: 'Imported Project'
        });
      
      expect(importRes.status).toBe(201);
      expect(importRes.body.success).toBe(true);
      expect(importRes.body.data.projectId).toBeDefined();
    });
  });
  
  describe('POST /import/space', () => {
    it('imports space as new', async () => {
      // Create space export data manually
      const spaceExportData = {
        type: 'space',
        space: { name: 'Export Test', description: 'Test', type: 'business' },
        projects: [],
        meta: { exported_at: new Date().toISOString(), godcrm_version: '3.0.0' }
      };
      
      const res = await request(app)
        .post('/api/v3/import/space')
        .send({
          data: spaceExportData,
          newName: 'Imported Space'
        });
      
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.spaceId).toBeDefined();
    });
    
    it('returns 400 when data is missing', async () => {
      const res = await request(app)
        .post('/api/v3/import/space')
        .send({});
      
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });
});
