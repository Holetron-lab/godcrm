/**
 * Space Variables API Tests (ADR-026)
 * Testing REST API endpoints for space variables
 * 
 * 🔴 RED → 🟢 GREEN → 🔵 REFACTOR
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import spacesRoutes from '../spaces.js';
import { dbAll, dbGet, dbRun, destroyAdapter, resetAdapter } from '../../../database/connection.js';
import { ensureCoreSystemTablesForSpace } from '../../../services/SystemTablesCreator.js';

// Create test app
const app = express();
app.use(express.json());

// Mock authenticate middleware
app.use((req, res, next) => {
  req.user = { id: 1, role: 'owner' };
  next();
});

app.use('/api/v3/spaces', spacesRoutes);

// ============================================================
// Helper Functions
// ============================================================

async function createTestUser() {
  const uniqueEmail = `test-spacevar-${Date.now()}@hltrn.cc`;
  const result = await dbRun(
    'INSERT INTO users (email, password_hash, name, encryption_key_encrypted, email_verified) VALUES (?, ?, ?, ?, ?)',
    [uniqueEmail, 'hash', 'Test User', 'encrypted_key', 1]
  );
  return result.lastInsertRowid;
}

async function createTestSpace(ownerId) {
  const result = await dbRun(
    'INSERT INTO spaces (owner_id, name, type) VALUES (?, ?, ?)',
    [ownerId, 'Test Space', 'business']
  );
  return result.lastInsertRowid;
}

async function addVariableToTable(tableId, variableData) {
  const data = JSON.stringify({
    name: variableData.name,
    scope_type: variableData.scope_type || 'space',
    scope_ref: variableData.scope_ref || null,
    formula: variableData.formula || '',
    description: variableData.description || '',
    stream_id: variableData.stream_id || 1,
    order_index: variableData.order_index || 0,
    cached_value: variableData.cached_value || null,
    cached_at: null,
    dependencies: JSON.stringify([])
  });
  
  // Generate unique base_id (required field)
  const baseId = `var_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const result = await dbRun(
    'INSERT INTO table_rows (table_id, base_id, data) VALUES (?, ?, ?)',
    [tableId, baseId, data]
  );
  return result.lastInsertRowid;
}

// ============================================================
// TESTS
// ============================================================

describe('Space Variables API (ADR-026)', () => {
  let userId;
  let spaceId;
  let variablesTableId;

  beforeEach(async () => {
    process.env.TEST_MODE = 'true';
    process.env.SKIP_DEV_USER = 'true';
    await resetAdapter();
    
    // Create test data
    userId = await createTestUser();
    spaceId = await createTestSpace(userId);
    
    // Ensure system tables including Variables
    const systemTables = await ensureCoreSystemTablesForSpace(spaceId);
    variablesTableId = systemTables.variablesTableId;
  });

  afterEach(async () => {
    await destroyAdapter();
  });

  // ============================================================
  // 🔴 RED PHASE: GET /api/v3/spaces/:spaceId/variables
  // ============================================================
  
  describe('GET /api/v3/spaces/:spaceId/variables', () => {
    /**
     * BEHAVIOR: When I request variables for a space
     * GIVEN a space with Variables table
     * THEN I should get the tableId and list of variables
     */
    test('should return variables table info and empty list for new space', async () => {
      const response = await request(app)
        .get(`/api/v3/spaces/${spaceId}/variables`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.tableId).toBe(variablesTableId);
      expect(response.body.data.variables).toEqual([]);
    });

    test('should return all variables with their values', async () => {
      // Add some test variables
      await addVariableToTable(variablesTableId, {
        name: '$tax_rate',
        scope_type: 'space',
        formula: '0.20',
        cached_value: '0.20'
      });
      await addVariableToTable(variablesTableId, {
        name: '$total_revenue',
        scope_type: 'table',
        scope_ref: 15,
        formula: 'SUM({{amount}})',
        cached_value: '150000'
      });

      const response = await request(app)
        .get(`/api/v3/spaces/${spaceId}/variables`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.variables).toHaveLength(2);
      
      const taxVar = response.body.data.variables.find(v => v.name === '$tax_rate');
      expect(taxVar).toBeDefined();
      expect(taxVar.scope).toBe('space');
      expect(taxVar.value).toBe('0.20');
      
      const revenueVar = response.body.data.variables.find(v => v.name === '$total_revenue');
      expect(revenueVar).toBeDefined();
      expect(revenueVar.scope).toBe('table');
      expect(revenueVar.scopeRef).toBe(15);
    });

    test('should return 404 for non-existent space', async () => {
      const response = await request(app)
        .get('/api/v3/spaces/999999/variables')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });
  });

  // ============================================================
  // 🔴 RED PHASE: POST /api/v3/spaces/:spaceId/variables/recalculate
  // ============================================================
  
  describe('POST /api/v3/spaces/:spaceId/variables/recalculate', () => {
    /**
     * BEHAVIOR: When I trigger recalculation of all variables
     * GIVEN a space with variables
     * THEN all variable values should be recalculated
     */
    test('should recalculate all variables and return status', async () => {
      // Add test variable
      await addVariableToTable(variablesTableId, {
        name: '$simple_const',
        scope_type: 'space',
        formula: '42',
        cached_value: null
      });

      const response = await request(app)
        .post(`/api/v3/spaces/${spaceId}/variables/recalculate`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(typeof response.body.data.calculated).toBe('number');
      expect(typeof response.body.data.cached).toBe('number');
      expect(Array.isArray(response.body.data.errors)).toBe(true);
    });

    test('should update cached_value after recalculation', async () => {
      // Add test variable with simple numeric formula
      const rowId = await addVariableToTable(variablesTableId, {
        name: '$pi',
        scope_type: 'space',
        formula: '3.14159',
        cached_value: null
      });

      await request(app)
        .post(`/api/v3/spaces/${spaceId}/variables/recalculate`)
        .expect(200);

      // Check that cached_value was updated
      const row = await dbGet(
        'SELECT data FROM table_rows WHERE id = ?',
        [rowId]
      );
      const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      expect(data.cached_value).toBe('3.14159');
    });
  });
});
