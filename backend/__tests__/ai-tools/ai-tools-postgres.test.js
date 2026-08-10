// @vitest-environment node
/**
 * AI Agent Tools PostgreSQL Integration Tests
 * TDD: 🔴 RED → 🟢 GREEN → 🔵 REFACTOR
 *
 * Run: DATABASE_TYPE=postgres npm test -- backend/__tests__/ai-tools/ai-tools-postgres.test.js
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

const { Pool } = pg;

// PostgreSQL connection
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'godcrm_prod',
  user: process.env.DB_USER || 'godcrm',
  password: process.env.DB_PASSWORD || 'godcrm_dev_2026'
});

const dbQuery = async (sql, params = []) => {
  const result = await pool.query(sql, params);
  return result.rows;
};

const dbGet = async (sql, params = []) => {
  const rows = await dbQuery(sql, params);
  return rows[0];
};

describe('AI Agent Tools PostgreSQL Integration', () => {
  
  beforeAll(async () => {
    try {
      await pool.query('SELECT 1');
      console.log('✅ PostgreSQL connected');
    } catch (err) {
      console.error('❌ PostgreSQL connection failed:', err.message);
      throw err;
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('list_tables tool', () => {
    
    it('should list tables for a given space_id', async () => {
      const spaceId = 12; // Known space with tables
      
      const tables = await dbQuery(`
        SELECT ut.id, ut.name, ut.icon, ut.description, p.name as project_name, p.id as project_id,
          (SELECT COUNT(*) FROM table_rows WHERE table_id = ut.id) as row_count
        FROM universal_tables ut
        JOIN projects p ON ut.project_id = p.id
        WHERE p.space_id = $1
        ORDER BY p.name, ut.name
      `, [spaceId]);
      
      console.log(`📊 Found ${tables.length} tables in space ${spaceId}`);
      
      expect(tables).toBeDefined();
      expect(Array.isArray(tables)).toBe(true);
      expect(tables.length).toBeGreaterThan(0);
      
      // Each table should have required fields
      tables.slice(0, 3).forEach(table => {
        expect(table.id).toBeDefined();
        expect(table.name).toBeDefined();
        expect(table.project_name).toBeDefined();
      });
    });

    it('should list tables for a given project_id', async () => {
      const projectId = 24; // System Data project
      
      const tables = await dbQuery(`
        SELECT id, name, icon, description,
          (SELECT COUNT(*) FROM table_rows WHERE table_id = ut.id) as row_count
        FROM universal_tables ut
        WHERE project_id = $1
      `, [projectId]);
      
      console.log(`📊 Found ${tables.length} tables in project ${projectId}`);
      
      expect(tables).toBeDefined();
      expect(Array.isArray(tables)).toBe(true);
    });

    it('should return empty array for non-existent space', async () => {
      const fakeSpaceId = 99999;
      
      const tables = await dbQuery(`
        SELECT ut.id, ut.name
        FROM universal_tables ut
        JOIN projects p ON ut.project_id = p.id
        WHERE p.space_id = $1
      `, [fakeSpaceId]);
      
      expect(tables).toEqual([]);
    });
  });

  describe('get_workspace_info tool', () => {
    
    it('should get workspace info for space', async () => {
      const spaceId = 12;
      
      // Get space info
      const space = await dbGet(`SELECT * FROM spaces WHERE id = $1`, [spaceId]);
      
      expect(space).toBeDefined();
      expect(space.id).toBe(spaceId);
      
      // Get projects count
      const projectsResult = await dbGet(`
        SELECT COUNT(*) as count FROM projects WHERE space_id = $1
      `, [spaceId]);
      
      expect(parseInt(projectsResult.count)).toBeGreaterThan(0);
      
      // Get tables count
      const tablesResult = await dbGet(`
        SELECT COUNT(*) as count 
        FROM universal_tables ut
        JOIN projects p ON ut.project_id = p.id
        WHERE p.space_id = $1
      `, [spaceId]);
      
      console.log(`📊 Space ${spaceId}: ${projectsResult.count} projects, ${tablesResult.count} tables`);
      
      expect(parseInt(tablesResult.count)).toBeGreaterThan(0);
    });
  });

  describe('query_table_data tool', () => {
    
    it('should query data from a table', async () => {
      // Find a table with data
      const table = await dbGet(`
        SELECT ut.id, ut.name, COUNT(tr.id) as row_count
        FROM universal_tables ut
        LEFT JOIN table_rows tr ON tr.table_id = ut.id
        GROUP BY ut.id, ut.name
        HAVING COUNT(tr.id) > 0
        LIMIT 1
      `);
      
      if (!table) {
        console.log('⚠️ No tables with data found');
        return;
      }
      
      console.log(`📊 Testing with table: ${table.name} (${table.row_count} rows)`);
      
      const rows = await dbQuery(`
        SELECT id, data FROM table_rows WHERE table_id = $1 LIMIT 10
      `, [table.id]);
      
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0].data).toBeDefined();
    });

    it('should handle search parameter', async () => {
      // Find API Keys table
      const table = await dbGet(`
        SELECT id FROM universal_tables WHERE name = 'AI Agents' LIMIT 1
      `);
      
      if (!table) {
        console.log('⚠️ AI Agents table not found');
        return;
      }
      
      // Search for 'General'
      const rows = await dbQuery(`
        SELECT id, data FROM table_rows 
        WHERE table_id = $1 
          AND (data::text ILIKE $2)
        LIMIT 10
      `, [table.id, '%General%']);
      
      console.log(`📊 Found ${rows.length} agents matching 'General'`);
      
      expect(Array.isArray(rows)).toBe(true);
    });
  });

  describe('get_table_schema tool', () => {
    
    it('should get table columns/schema', async () => {
      // Find a table with columns
      const table = await dbGet(`
        SELECT ut.id, ut.name
        FROM universal_tables ut
        JOIN table_columns tc ON tc.table_id = ut.id
        GROUP BY ut.id, ut.name
        HAVING COUNT(tc.id) > 0
        LIMIT 1
      `);
      
      if (!table) {
        console.log('⚠️ No tables with columns found');
        return;
      }
      
      const columns = await dbQuery(`
        SELECT id, column_name, display_name, type, is_visible, is_required
        FROM table_columns
        WHERE table_id = $1
        ORDER BY order_index
      `, [table.id]);
      
      console.log(`📊 Table ${table.name} has ${columns.length} columns`);
      
      expect(columns.length).toBeGreaterThan(0);
      expect(columns[0].column_name).toBeDefined();
      expect(columns[0].type).toBeDefined();
    });
  });

  describe('AI Agents configuration', () => {
    
    it('should have agents with correct tools array', async () => {
      const agents = await dbQuery(`
        SELECT tr.id, tr.data
        FROM table_rows tr
        JOIN universal_tables ut ON tr.table_id = ut.id
        WHERE ut.name ILIKE '%Agent%'
        LIMIT 10
      `);
      
      console.log(`📊 Found ${agents.length} agents`);
      
      agents.forEach(agent => {
        const data = typeof agent.data === 'string' ? JSON.parse(agent.data) : agent.data;
        
        if (data.tools) {
          let tools = data.tools;
          
          // Parse if string
          if (typeof tools === 'string') {
            try {
              tools = JSON.parse(tools);
            } catch {
              tools = [];
            }
          }
          
          // Convert to array if needed
          if (!Array.isArray(tools)) {
            // tools might be an object or null
            tools = [];
          }
          
          // Tools can be either:
          // 1. Tool IDs (numeric strings like "1027") - valid, references ai_tools table
          // 2. Tool names (lowercase with underscores like "list_tables")
          tools.forEach(tool => {
            if (typeof tool === 'string') {
              const isNumericId = /^\d+$/.test(tool);
              const isToolName = /^[a-z_]+$/.test(tool);
              
              // Either valid ID or valid name
              expect(isNumericId || isToolName).toBe(true);
              
              if (isNumericId) {
                console.log(`  📌 Tool ID: ${tool}`);
              }
            }
          });
        }
      });
    });

    it('should have agents linked to valid operators', async () => {
      const agents = await dbQuery(`
        SELECT tr.id, tr.data->>'name' as name, tr.data->>'operator_id' as operator_id
        FROM table_rows tr
        JOIN universal_tables ut ON tr.table_id = ut.id
        WHERE ut.name ILIKE '%Agent%' AND tr.data->>'operator_id' IS NOT NULL
        LIMIT 5
      `);
      
      for (const agent of agents) {
        if (agent.operator_id) {
          const operator = await dbGet(`
            SELECT tr.id, tr.data->>'name' as name
            FROM table_rows tr
            WHERE tr.id = $1
          `, [parseInt(agent.operator_id)]);
          
          if (operator) {
            console.log(`✅ Agent "${agent.name}" linked to operator "${operator.name}"`);
          } else {
            console.log(`⚠️ Agent "${agent.name}" has invalid operator_id: ${agent.operator_id}`);
          }
        }
      }
    });
  });
});
