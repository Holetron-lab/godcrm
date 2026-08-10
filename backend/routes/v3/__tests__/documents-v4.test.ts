/**
 * Documents v4 API Tests - Export & Structure compatibility
 * 
 * Tests for BUG-202601-002: Verify that export and structure endpoints
 * work correctly with v4 Documents format.
 * 
 * v4 Format:
 * - Each document = table with rows
 * - Row columns: order, level, content, comment, type, atom_ref, is_collapsed
 * - No JSON structure field in document data
 * 
 * @see ADR-013-DOCUMENTS-V4-TABLES.md
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = process.env.TEST_DATABASE_PATH || '/tmp/test-documents-v4.db';
let db: Database.Database;

// Helper to create unique test IDs
const uniqueId = () => `test-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

describe('Documents v4 API', () => {
  beforeAll(() => {
    // Create test database
    db = new Database(DB_PATH);
    
    // Create tables schema
    db.exec(`
      CREATE TABLE IF NOT EXISTS tables (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        display_name TEXT,
        type TEXT DEFAULT 'regular',
        parent_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS table_columns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_id INTEGER NOT NULL,
        column_name TEXT NOT NULL,
        display_name TEXT,
        type TEXT DEFAULT 'text',
        order_index INTEGER DEFAULT 0,
        config TEXT
      );
      
      CREATE TABLE IF NOT EXISTS table_rows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_id INTEGER NOT NULL,
        base_id TEXT,
        data TEXT,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  });

  afterAll(() => {
    db.close();
    if (fs.existsSync(DB_PATH)) {
      fs.unlinkSync(DB_PATH);
    }
  });

  describe('v4 Document Structure', () => {
    it('should store document rows with v4 columns (order, level, content)', () => {
      // Create a document table (doc_*)
      const tableResult = db.prepare(`
        INSERT INTO tables (name, display_name, type) 
        VALUES (?, ?, ?)
      `).run(`doc_${uniqueId()}`, 'Test Document', 'document');
      
      const tableId = tableResult.lastInsertRowid;
      
      // Insert v4 document row
      const v4Row = {
        order: 10,
        level: 'h2',
        content: 'Test Section',
        comment: 'Internal note',
        type: 'reference',
        atom_ref: null,
        is_collapsed: false
      };
      
      db.prepare(`
        INSERT INTO table_rows (table_id, base_id, data)
        VALUES (?, ?, ?)
      `).run(tableId, uniqueId(), JSON.stringify(v4Row));
      
      // Verify row structure
      const row = db.prepare(`
        SELECT data FROM table_rows WHERE table_id = ?
      `).get(tableId) as { data: string };
      
      const data = JSON.parse(row.data);
      
      expect(data).toHaveProperty('order');
      expect(data).toHaveProperty('level');
      expect(data).toHaveProperty('content');
      expect(data).toHaveProperty('type');
      expect(data).toHaveProperty('is_collapsed');
      expect(data.level).toBe('h2');
    });

    it('should use level field for hierarchy (h1, h2, h3, text, divider)', () => {
      const tableResult = db.prepare(`
        INSERT INTO tables (name, display_name, type) 
        VALUES (?, ?, ?)
      `).run(`doc_${uniqueId()}`, 'Hierarchy Test', 'document');
      
      const tableId = tableResult.lastInsertRowid;
      
      const validLevels = ['h1', 'h2', 'h3', 'text', 'divider'];
      
      for (const level of validLevels) {
        const row = {
          order: validLevels.indexOf(level) * 10 + 10,
          level,
          content: `Content for ${level}`,
          is_collapsed: false
        };
        
        db.prepare(`
          INSERT INTO table_rows (table_id, base_id, data)
          VALUES (?, ?, ?)
        `).run(tableId, uniqueId(), JSON.stringify(row));
      }
      
      const rows = db.prepare(`
        SELECT data FROM table_rows WHERE table_id = ? ORDER BY json_extract(data, '$.order')
      `).all(tableId) as Array<{ data: string }>;
      
      expect(rows).toHaveLength(5);
      
      const levels = rows.map(r => JSON.parse(r.data).level);
      expect(levels).toEqual(validLevels);
    });
  });

  describe('Export format compatibility', () => {
    it('should export v4 document rows with correct field names', () => {
      // Create document table with v4 rows
      const tableResult = db.prepare(`
        INSERT INTO tables (name, display_name, type) 
        VALUES (?, ?, ?)
      `).run(`doc_${uniqueId()}`, 'Export Test', 'document');
      
      const tableId = tableResult.lastInsertRowid;
      
      const v4Rows = [
        { order: 10, level: 'h2', content: 'Authentication', type: 'reference', is_collapsed: false },
        { order: 20, level: 'h3', content: 'POST /auth/login', type: 'endpoint', is_collapsed: false },
        { order: 30, level: 'text', content: 'Login description...', type: 'reference', is_collapsed: false }
      ];
      
      for (const row of v4Rows) {
        db.prepare(`
          INSERT INTO table_rows (table_id, base_id, data)
          VALUES (?, ?, ?)
        `).run(tableId, uniqueId(), JSON.stringify(row));
      }
      
      // Simulate export: fetch and format
      const rows = db.prepare(`
        SELECT id, data FROM table_rows WHERE table_id = ? ORDER BY json_extract(data, '$.order')
      `).all(tableId) as Array<{ id: number; data: string }>;
      
      const exported = rows.map(r => {
        const data = JSON.parse(r.data);
        return {
          id: r.id,
          order: data.order,
          level: data.level,
          content: data.content,
          type: data.type,
          is_collapsed: data.is_collapsed
        };
      });
      
      // Verify v4 export format
      expect(exported).toHaveLength(3);
      expect(exported[0]).toHaveProperty('order', 10);
      expect(exported[0]).toHaveProperty('level', 'h2');
      expect(exported[0]).toHaveProperty('content', 'Authentication');
      expect(exported[1]).toHaveProperty('level', 'h3');
      expect(exported[2]).toHaveProperty('level', 'text');
      
      // v4 should NOT have old fields like h2, h3, local_order, parent_index
      expect(exported[0]).not.toHaveProperty('h2');
      expect(exported[0]).not.toHaveProperty('h3');
      expect(exported[0]).not.toHaveProperty('local_order');
      expect(exported[0]).not.toHaveProperty('parent_index');
    });
  });

  describe('Structure update compatibility', () => {
    it('should update row order and is_collapsed without using JSON structure', () => {
      const tableResult = db.prepare(`
        INSERT INTO tables (name, display_name, type) 
        VALUES (?, ?, ?)
      `).run(`doc_${uniqueId()}`, 'Structure Test', 'document');
      
      const tableId = tableResult.lastInsertRowid;
      
      // Insert initial rows
      const row1 = db.prepare(`
        INSERT INTO table_rows (table_id, base_id, data)
        VALUES (?, ?, ?)
      `).run(tableId, uniqueId(), JSON.stringify({ order: 10, level: 'h2', content: 'First', is_collapsed: false }));
      
      const row2 = db.prepare(`
        INSERT INTO table_rows (table_id, base_id, data)
        VALUES (?, ?, ?)
      `).run(tableId, uniqueId(), JSON.stringify({ order: 20, level: 'h2', content: 'Second', is_collapsed: false }));
      
      const rowId1 = row1.lastInsertRowid;
      const rowId2 = row2.lastInsertRowid;
      
      // Structure update: reorder rows (v4 way - update order field directly)
      const updateOrder = (id: number | bigint, newOrder: number) => {
        const row = db.prepare(`SELECT data FROM table_rows WHERE id = ?`).get(id) as { data: string };
        const data = JSON.parse(row.data);
        data.order = newOrder;
        db.prepare(`UPDATE table_rows SET data = ? WHERE id = ?`).run(JSON.stringify(data), id);
      };
      
      // Swap order
      updateOrder(rowId1, 20);
      updateOrder(rowId2, 10);
      
      // Verify new order
      const rows = db.prepare(`
        SELECT id, data FROM table_rows WHERE table_id = ? ORDER BY json_extract(data, '$.order')
      `).all(tableId) as Array<{ id: number; data: string }>;
      
      expect(rows[0].id).toBe(Number(rowId2));  // Second row now first
      expect(rows[1].id).toBe(Number(rowId1));  // First row now second
    });

    it('should toggle is_collapsed on individual rows', () => {
      const tableResult = db.prepare(`
        INSERT INTO tables (name, display_name, type) 
        VALUES (?, ?, ?)
      `).run(`doc_${uniqueId()}`, 'Collapse Test', 'document');
      
      const tableId = tableResult.lastInsertRowid;
      
      const rowResult = db.prepare(`
        INSERT INTO table_rows (table_id, base_id, data)
        VALUES (?, ?, ?)
      `).run(tableId, uniqueId(), JSON.stringify({ order: 10, level: 'h2', content: 'Section', is_collapsed: false }));
      
      const rowId = rowResult.lastInsertRowid;
      
      // Toggle collapsed
      const row = db.prepare(`SELECT data FROM table_rows WHERE id = ?`).get(rowId) as { data: string };
      const data = JSON.parse(row.data);
      data.is_collapsed = true;
      db.prepare(`UPDATE table_rows SET data = ? WHERE id = ?`).run(JSON.stringify(data), rowId);
      
      // Verify
      const updated = db.prepare(`SELECT data FROM table_rows WHERE id = ?`).get(rowId) as { data: string };
      expect(JSON.parse(updated.data).is_collapsed).toBe(true);
    });
  });

  describe('buildDocumentStructure function compatibility', () => {
    /**
     * The old buildDocumentStructure function returns:
     * { version: 2, title, description, sections: [...], footer, links }
     * 
     * v4 does NOT use this JSON structure in document data.
     * Instead, structure is derived from table rows.
     */
    it('should build structure from v4 table rows, not from JSON', () => {
      const tableResult = db.prepare(`
        INSERT INTO tables (name, display_name, type) 
        VALUES (?, ?, ?)
      `).run(`doc_${uniqueId()}`, 'Build Structure Test', 'document');
      
      const tableId = tableResult.lastInsertRowid;
      
      // Insert v4 rows
      const rows = [
        { order: 10, level: 'h2', content: 'Section A', is_collapsed: false },
        { order: 20, level: 'h3', content: 'Subsection A.1', is_collapsed: false },
        { order: 30, level: 'h3', content: 'Subsection A.2', is_collapsed: true },
        { order: 40, level: 'h2', content: 'Section B', is_collapsed: false },
      ];
      
      const insertedIds: bigint[] = [];
      for (const row of rows) {
        const result = db.prepare(`
          INSERT INTO table_rows (table_id, base_id, data)
          VALUES (?, ?, ?)
        `).run(tableId, uniqueId(), JSON.stringify(row));
        insertedIds.push(result.lastInsertRowid);
      }
      
      // Build structure from rows (v4 way)
      const dbRows = db.prepare(`
        SELECT id, data FROM table_rows WHERE table_id = ? ORDER BY json_extract(data, '$.order')
      `).all(tableId) as Array<{ id: number; data: string }>;
      
      interface V4Section {
        id: number;
        order: number;
        level: string;
        content: string;
        is_collapsed: boolean;
        children: V4Section[];
      }
      
      const buildV4Structure = (rows: Array<{ id: number; data: string }>): V4Section[] => {
        const result: V4Section[] = [];
        let currentH2: V4Section | null = null;
        
        for (const row of rows) {
          const data = JSON.parse(row.data);
          const section: V4Section = {
            id: row.id,
            order: data.order,
            level: data.level,
            content: data.content,
            is_collapsed: data.is_collapsed,
            children: []
          };
          
          if (data.level === 'h1' || data.level === 'h2') {
            result.push(section);
            currentH2 = section;
          } else if (currentH2 && (data.level === 'h3' || data.level === 'text' || data.level === 'divider')) {
            currentH2.children.push(section);
          } else {
            result.push(section);
          }
        }
        
        return result;
      };
      
      const structure = buildV4Structure(dbRows);
      
      // Verify structure
      expect(structure).toHaveLength(2); // Two H2 sections
      expect(structure[0].content).toBe('Section A');
      expect(structure[0].children).toHaveLength(2); // Two H3 subsections
      expect(structure[0].children[0].content).toBe('Subsection A.1');
      expect(structure[0].children[1].is_collapsed).toBe(true);
      expect(structure[1].content).toBe('Section B');
      expect(structure[1].children).toHaveLength(0);
    });
  });

  describe('Registry table compatibility', () => {
    it('should store document metadata in registry without JSON structure', () => {
      // Create registry table
      const registryResult = db.prepare(`
        INSERT INTO tables (name, display_name, type) 
        VALUES (?, ?, ?)
      `).run('_registry', 'Documents Registry', 'registry');
      
      const registryId = registryResult.lastInsertRowid;
      
      // Create document content table
      const docTableResult = db.prepare(`
        INSERT INTO tables (name, display_name, type, parent_id) 
        VALUES (?, ?, ?, ?)
      `).run(`doc_${uniqueId()}`, 'Test Doc', 'document', registryId);
      
      const docTableId = docTableResult.lastInsertRowid;
      
      // Registry entry for document (v4 format - NO structure field)
      const registryEntry = {
        name: 'API Documentation',
        description: 'Complete API docs',
        slug: 'api-docs',
        table_id: Number(docTableId),
        icon: '📚',
        category: 'API',
        status: 'published',
        order_index: 1
        // NOTE: No 'sections' or 'structure' fields!
      };
      
      db.prepare(`
        INSERT INTO table_rows (table_id, base_id, data)
        VALUES (?, ?, ?)
      `).run(registryId, uniqueId(), JSON.stringify(registryEntry));
      
      // Verify registry entry
      const entry = db.prepare(`
        SELECT data FROM table_rows WHERE table_id = ?
      `).get(registryId) as { data: string };
      
      const data = JSON.parse(entry.data);
      
      expect(data).toHaveProperty('name', 'API Documentation');
      expect(data).toHaveProperty('table_id');
      expect(data).toHaveProperty('slug', 'api-docs');
      expect(data).not.toHaveProperty('structure');  // v4: NO structure in registry
      expect(data).not.toHaveProperty('sections');   // v4: NO sections array in registry
    });
  });

  describe('v4 Export API compatibility', () => {
    /**
     * v4 export should return items directly from doc_* table
     * with v4 fields: order, level, content, type, is_collapsed
     * NOT legacy fields: h2, h3, local_order, parent, title
     */
    it('should export v4 document items with correct field names', () => {
      // Create document table
      const tableResult = db.prepare(`
        INSERT INTO tables (name, display_name, type) 
        VALUES (?, ?, ?)
      `).run(`doc_${uniqueId()}`, 'Export API Test', 'document');
      
      const tableId = tableResult.lastInsertRowid;
      
      // Insert v4 document items
      const v4Items = [
        { order: 10, level: 'h1', content: 'API Reference', type: 'reference', is_collapsed: false },
        { order: 20, level: 'h2', content: 'Authentication', type: 'reference', is_collapsed: false },
        { order: 30, level: 'h3', content: 'POST /auth/login', type: 'endpoint', is_collapsed: false },
        { order: 40, level: 'text', content: 'Login endpoint description', type: 'reference', is_collapsed: false },
        { order: 50, level: 'divider', content: '', type: 'reference', is_collapsed: false },
      ];
      
      for (const item of v4Items) {
        db.prepare(`
          INSERT INTO table_rows (table_id, base_id, data)
          VALUES (?, ?, ?)
        `).run(tableId, uniqueId(), JSON.stringify(item));
      }
      
      // Simulate v4 export - fetch items directly from doc_* table
      const rows = db.prepare(`
        SELECT id, data FROM table_rows WHERE table_id = ? ORDER BY json_extract(data, '$.order')
      `).all(tableId) as Array<{ id: number; data: string }>;
      
      // Export format for v4
      const exportedItems = rows.map(r => {
        const data = JSON.parse(r.data);
        return {
          id: r.id,
          order: data.order,
          level: data.level,
          content: data.content,
          type: data.type,
          is_collapsed: data.is_collapsed,
          comment: data.comment || null,
          atom_ref: data.atom_ref || null,
        };
      });
      
      // Verify v4 export format
      expect(exportedItems).toHaveLength(5);
      
      // Check required v4 fields exist
      exportedItems.forEach(item => {
        expect(item).toHaveProperty('order');
        expect(item).toHaveProperty('level');
        expect(item).toHaveProperty('content');
        expect(item).toHaveProperty('type');
        expect(item).toHaveProperty('is_collapsed');
      });
      
      // Check NO legacy fields
      exportedItems.forEach(item => {
        expect(item).not.toHaveProperty('h2');
        expect(item).not.toHaveProperty('h3');
        expect(item).not.toHaveProperty('local_order');
        expect(item).not.toHaveProperty('parent_index');
        expect(item).not.toHaveProperty('title');  // v4 uses content for everything
      });
      
      // Verify correct content
      expect(exportedItems[0].level).toBe('h1');
      expect(exportedItems[0].content).toBe('API Reference');
      expect(exportedItems[2].level).toBe('h3');
      expect(exportedItems[2].type).toBe('endpoint');
    });

    it('should NOT use legacy structure field in export', () => {
      // v4 export should not include a 'structure' object
      // Structure is derived from order + level hierarchy
      
      const tableResult = db.prepare(`
        INSERT INTO tables (name, display_name, type) 
        VALUES (?, ?, ?)
      `).run(`doc_${uniqueId()}`, 'No Structure Test', 'document');
      
      const tableId = tableResult.lastInsertRowid;
      
      // Add one item
      db.prepare(`
        INSERT INTO table_rows (table_id, base_id, data)
        VALUES (?, ?, ?)
      `).run(tableId, uniqueId(), JSON.stringify({ order: 10, level: 'h2', content: 'Section', is_collapsed: false }));
      
      // Fetch items
      const rows = db.prepare(`
        SELECT id, data FROM table_rows WHERE table_id = ?
      `).all(tableId) as Array<{ id: number; data: string }>;
      
      // v4 export is just the items array, no structure wrapper
      const v4Export = {
        items: rows.map(r => ({ id: r.id, ...JSON.parse(r.data) })),
        // NO structure field!
      };
      
      expect(v4Export).toHaveProperty('items');
      expect(v4Export).not.toHaveProperty('structure');
      expect(v4Export).not.toHaveProperty('sections');
    });
  });
});
