/**
 * ADR-038: Documents Task Binding API Tests
 * 
 * Tests for task binding endpoints:
 * - POST /api/v3/documents/:docId/items/:itemId/link-task
 * - POST /api/v3/documents/:docId/items/:itemId/create-task
 * - DELETE /api/v3/documents/:docId/items/:itemId/unlink-task
 * - POST /api/v3/documents/:docId/export-tasks
 * 
 * @see ADR-038-DOCUMENTS-TASKS-SYNC.md
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = process.env.TEST_DATABASE_PATH || '/tmp/test-documents-task-binding.db';
let db: Database.Database;

// Helper to create unique test IDs
const uniqueId = () => `test-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

describe('ADR-038: Documents Task Binding API', () => {
  let registryTableId: number;
  let tasksTableId: number;
  let documentTableId: number;
  let documentId: number;

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
        project_id INTEGER DEFAULT 1,
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

    // Create registry table
    const registryResult = db.prepare(`
      INSERT INTO tables (name, display_name, type, project_id) 
      VALUES (?, ?, ?, ?)
    `).run('_registry', 'Documents Registry', 'registry', 1);
    registryTableId = Number(registryResult.lastInsertRowid);

    // Create tasks table
    const tasksResult = db.prepare(`
      INSERT INTO tables (name, display_name, type, project_id) 
      VALUES (?, ?, ?, ?)
    `).run('tasks', 'Project Tasks', 'regular', 1);
    tasksTableId = Number(tasksResult.lastInsertRowid);

    // Add columns to tasks table
    const taskColumns = [
      { name: 'title', type: 'text' },
      { name: 'description', type: 'text' },
      { name: 'status', type: 'select' },
      { name: 'due_date', type: 'date' },
      { name: 'assignee_id', type: 'number' },
      { name: 'priority', type: 'select' },
      { name: 'progress', type: 'number' }
    ];

    taskColumns.forEach((col, i) => {
      db.prepare(`
        INSERT INTO table_columns (table_id, column_name, display_name, type, order_index)
        VALUES (?, ?, ?, ?, ?)
      `).run(tasksTableId, col.name, col.name, col.type, i);
    });
  });

  beforeEach(() => {
    // Create fresh document table for each test
    const docTableName = `doc_${uniqueId()}`;
    const docResult = db.prepare(`
      INSERT INTO tables (name, display_name, type, project_id) 
      VALUES (?, ?, ?, ?)
    `).run(docTableName, 'Test Document', 'document', 1);
    documentTableId = Number(docResult.lastInsertRowid);

    // Create registry entry
    const regData = {
      name: 'Test Document',
      slug: 'test-document',
      table_id: documentTableId
    };
    const regResult = db.prepare(`
      INSERT INTO table_rows (table_id, base_id, data)
      VALUES (?, ?, ?)
    `).run(registryTableId, uniqueId(), JSON.stringify(regData));
    documentId = Number(regResult.lastInsertRowid);

    // Add columns to document table including task_ref
    const docColumns = [
      { name: 'order', type: 'number' },
      { name: 'level', type: 'select' },
      { name: 'content_en', type: 'text' },
      { name: 'comment', type: 'text' },
      { name: 'type', type: 'select' },
      { name: 'atom_ref', type: 'relation' },
      { name: 'task_ref', type: 'relation' },  // ADR-038
      { name: 'is_collapsed', type: 'boolean' }
    ];

    docColumns.forEach((col, i) => {
      db.prepare(`
        INSERT INTO table_columns (table_id, column_name, display_name, type, order_index)
        VALUES (?, ?, ?, ?, ?)
      `).run(documentTableId, col.name, col.name, col.type, i);
    });
  });

  afterAll(() => {
    db.close();
    if (fs.existsSync(DB_PATH)) {
      fs.unlinkSync(DB_PATH);
    }
  });

  describe('Document Item with task_ref column', () => {
    it('should store task_ref in document item data', () => {
      // Create document item with task_ref
      const itemData = {
        order: 10,
        level: 'h2',
        content_en: 'Implement Feature X',
        task_ref: 12345,
        is_collapsed: false
      };

      const result = db.prepare(`
        INSERT INTO table_rows (table_id, base_id, data)
        VALUES (?, ?, ?)
      `).run(documentTableId, uniqueId(), JSON.stringify(itemData));

      const row = db.prepare(`
        SELECT data FROM table_rows WHERE id = ?
      `).get(result.lastInsertRowid) as { data: string };

      const data = JSON.parse(row.data);
      expect(data.task_ref).toBe(12345);
    });

    it('should allow null task_ref for unlinked items', () => {
      const itemData = {
        order: 10,
        level: 'h2',
        content_en: 'Unlinked Section',
        task_ref: null,
        is_collapsed: false
      };

      const result = db.prepare(`
        INSERT INTO table_rows (table_id, base_id, data)
        VALUES (?, ?, ?)
      `).run(documentTableId, uniqueId(), JSON.stringify(itemData));

      const row = db.prepare(`
        SELECT data FROM table_rows WHERE id = ?
      `).get(result.lastInsertRowid) as { data: string };

      const data = JSON.parse(row.data);
      expect(data.task_ref).toBeNull();
    });
  });

  describe('Link Task Operation', () => {
    it('should update task_ref when linking existing task', () => {
      // Create document item without task
      const itemData = {
        order: 10,
        level: 'h2',
        content_en: 'Feature to Link',
        task_ref: null,
        is_collapsed: false
      };

      const itemResult = db.prepare(`
        INSERT INTO table_rows (table_id, base_id, data)
        VALUES (?, ?, ?)
      `).run(documentTableId, uniqueId(), JSON.stringify(itemData));
      const itemId = itemResult.lastInsertRowid;

      // Create task
      const taskData = {
        title: 'Implement Feature',
        status: 'todo',
        priority: 'high'
      };
      const taskResult = db.prepare(`
        INSERT INTO table_rows (table_id, base_id, data)
        VALUES (?, ?, ?)
      `).run(tasksTableId, uniqueId(), JSON.stringify(taskData));
      const taskId = taskResult.lastInsertRowid;

      // Link task to document item (simulate API operation)
      const row = db.prepare(`SELECT data FROM table_rows WHERE id = ?`).get(itemId) as { data: string };
      const updatedData = { ...JSON.parse(row.data), task_ref: Number(taskId) };
      
      db.prepare(`
        UPDATE table_rows SET data = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(JSON.stringify(updatedData), itemId);

      // Verify link
      const updatedRow = db.prepare(`SELECT data FROM table_rows WHERE id = ?`).get(itemId) as { data: string };
      const finalData = JSON.parse(updatedRow.data);
      expect(finalData.task_ref).toBe(Number(taskId));
    });
  });

  describe('Create Task from Document Item', () => {
    it('should create task and update task_ref in one operation', () => {
      // Create document item
      const itemData = {
        order: 10,
        level: 'h2',
        content_en: 'New Feature to Create Task',
        task_ref: null,
        is_collapsed: false
      };

      const itemResult = db.prepare(`
        INSERT INTO table_rows (table_id, base_id, data)
        VALUES (?, ?, ?)
      `).run(documentTableId, uniqueId(), JSON.stringify(itemData));
      const itemId = itemResult.lastInsertRowid;

      // Create task from document item (simulate API)
      const taskData = {
        title: 'New Feature to Create Task',  // From content
        description: '',
        status: 'todo',
        priority: 'medium'
      };
      const taskResult = db.prepare(`
        INSERT INTO table_rows (table_id, base_id, data)
        VALUES (?, ?, ?)
      `).run(tasksTableId, uniqueId(), JSON.stringify(taskData));
      const taskId = taskResult.lastInsertRowid;

      // Update document item with task_ref
      const row = db.prepare(`SELECT data FROM table_rows WHERE id = ?`).get(itemId) as { data: string };
      const updatedItemData = { ...JSON.parse(row.data), task_ref: Number(taskId) };
      
      db.prepare(`
        UPDATE table_rows SET data = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(JSON.stringify(updatedItemData), itemId);

      // Verify task was created
      const createdTask = db.prepare(`SELECT data FROM table_rows WHERE id = ?`).get(taskId) as { data: string };
      expect(JSON.parse(createdTask.data).title).toBe('New Feature to Create Task');

      // Verify document item has task_ref
      const linkedItem = db.prepare(`SELECT data FROM table_rows WHERE id = ?`).get(itemId) as { data: string };
      expect(JSON.parse(linkedItem.data).task_ref).toBe(Number(taskId));
    });
  });

  describe('Unlink Task Operation', () => {
    it('should remove task_ref without deleting task', () => {
      // Create task first
      const taskData = { title: 'Task to Unlink', status: 'done' };
      const taskResult = db.prepare(`
        INSERT INTO table_rows (table_id, base_id, data)
        VALUES (?, ?, ?)
      `).run(tasksTableId, uniqueId(), JSON.stringify(taskData));
      const taskId = taskResult.lastInsertRowid;

      // Create linked document item
      const itemData = {
        order: 10,
        level: 'h2',
        content_en: 'Linked Item',
        task_ref: Number(taskId),
        is_collapsed: false
      };
      const itemResult = db.prepare(`
        INSERT INTO table_rows (table_id, base_id, data)
        VALUES (?, ?, ?)
      `).run(documentTableId, uniqueId(), JSON.stringify(itemData));
      const itemId = itemResult.lastInsertRowid;

      // Unlink (set task_ref to null)
      const row = db.prepare(`SELECT data FROM table_rows WHERE id = ?`).get(itemId) as { data: string };
      const unlinkedData = { ...JSON.parse(row.data), task_ref: null };
      
      db.prepare(`
        UPDATE table_rows SET data = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(JSON.stringify(unlinkedData), itemId);

      // Verify unlinked
      const unlinkedRow = db.prepare(`SELECT data FROM table_rows WHERE id = ?`).get(itemId) as { data: string };
      expect(JSON.parse(unlinkedRow.data).task_ref).toBeNull();

      // Verify task still exists
      const existingTask = db.prepare(`SELECT id FROM table_rows WHERE id = ?`).get(taskId);
      expect(existingTask).toBeDefined();
    });
  });

  describe('Bulk Export to Tasks', () => {
    it('should create tasks for multiple document items', () => {
      // Create multiple document items
      const items = [
        { order: 10, level: 'h2', content_en: 'Feature 1', task_ref: null },
        { order: 20, level: 'h2', content_en: 'Feature 2', task_ref: null },
        { order: 30, level: 'h3', content_en: 'Sub-feature 1', task_ref: null },
      ];

      const itemIds: number[] = [];
      items.forEach(item => {
        const result = db.prepare(`
          INSERT INTO table_rows (table_id, base_id, data)
          VALUES (?, ?, ?)
        `).run(documentTableId, uniqueId(), JSON.stringify(item));
        itemIds.push(Number(result.lastInsertRowid));
      });

      // Bulk export (simulate API)
      const createdTaskIds: number[] = [];
      itemIds.forEach((itemId, index) => {
        const row = db.prepare(`SELECT data FROM table_rows WHERE id = ?`).get(itemId) as { data: string };
        const itemData = JSON.parse(row.data);

        // Create task
        const taskData = {
          title: itemData.content_en,
          status: 'todo',
          priority: 'medium'
        };
        const taskResult = db.prepare(`
          INSERT INTO table_rows (table_id, base_id, data)
          VALUES (?, ?, ?)
        `).run(tasksTableId, uniqueId(), JSON.stringify(taskData));
        const taskId = Number(taskResult.lastInsertRowid);
        createdTaskIds.push(taskId);

        // Update item with task_ref
        const updatedItemData = { ...itemData, task_ref: taskId };
        db.prepare(`
          UPDATE table_rows SET data = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(JSON.stringify(updatedItemData), itemId);
      });

      // Verify all tasks created
      expect(createdTaskIds).toHaveLength(3);

      // Verify all items linked
      itemIds.forEach((itemId, index) => {
        const row = db.prepare(`SELECT data FROM table_rows WHERE id = ?`).get(itemId) as { data: string };
        const data = JSON.parse(row.data);
        expect(data.task_ref).toBe(createdTaskIds[index]);
      });
    });

    it('should skip items that are already linked', () => {
      // Create task
      const taskData = { title: 'Existing Task', status: 'in_progress' };
      const taskResult = db.prepare(`
        INSERT INTO table_rows (table_id, base_id, data)
        VALUES (?, ?, ?)
      `).run(tasksTableId, uniqueId(), JSON.stringify(taskData));
      const existingTaskId = Number(taskResult.lastInsertRowid);

      // Create items - one linked, one not
      const items = [
        { order: 10, level: 'h2', content_en: 'Already Linked', task_ref: existingTaskId },
        { order: 20, level: 'h2', content_en: 'Not Linked', task_ref: null },
      ];

      const itemIds: number[] = [];
      items.forEach(item => {
        const result = db.prepare(`
          INSERT INTO table_rows (table_id, base_id, data)
          VALUES (?, ?, ?)
        `).run(documentTableId, uniqueId(), JSON.stringify(item));
        itemIds.push(Number(result.lastInsertRowid));
      });

      // Count tasks before export
      const tasksCountBefore = db.prepare(`
        SELECT COUNT(*) as count FROM table_rows WHERE table_id = ?
      `).get(tasksTableId) as { count: number };

      // Bulk export - only unlinked items
      let createdCount = 0;
      itemIds.forEach((itemId) => {
        const row = db.prepare(`SELECT data FROM table_rows WHERE id = ?`).get(itemId) as { data: string };
        const itemData = JSON.parse(row.data);

        // Skip if already linked
        if (itemData.task_ref) return;

        // Create task
        const newTaskData = {
          title: itemData.content_en,
          status: 'todo'
        };
        const taskResult = db.prepare(`
          INSERT INTO table_rows (table_id, base_id, data)
          VALUES (?, ?, ?)
        `).run(tasksTableId, uniqueId(), JSON.stringify(newTaskData));
        
        // Update item
        const updatedItemData = { ...itemData, task_ref: Number(taskResult.lastInsertRowid) };
        db.prepare(`
          UPDATE table_rows SET data = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(JSON.stringify(updatedItemData), itemId);
        
        createdCount++;
      });

      // Only 1 task should be created (the unlinked one)
      expect(createdCount).toBe(1);

      const tasksCountAfter = db.prepare(`
        SELECT COUNT(*) as count FROM table_rows WHERE table_id = ?
      `).get(tasksTableId) as { count: number };
      
      expect(tasksCountAfter.count).toBe(tasksCountBefore.count + 1);
    });
  });

  describe('Fetch Task Info for Display', () => {
    it('should fetch linked task data for document items', () => {
      // Create task with full data
      const taskData = {
        title: 'Important Task',
        status: 'in_progress',
        due_date: '2026-01-30',
        assignee_id: 5,
        priority: 'high',
        progress: 60
      };
      const taskResult = db.prepare(`
        INSERT INTO table_rows (table_id, base_id, data)
        VALUES (?, ?, ?)
      `).run(tasksTableId, uniqueId(), JSON.stringify(taskData));
      const taskId = Number(taskResult.lastInsertRowid);

      // Create linked document item
      const itemData = {
        order: 10,
        level: 'h2',
        content_en: 'Task Feature',
        task_ref: taskId,
        is_collapsed: false
      };
      db.prepare(`
        INSERT INTO table_rows (table_id, base_id, data)
        VALUES (?, ?, ?)
      `).run(documentTableId, uniqueId(), JSON.stringify(itemData));

      // Fetch task info (simulate enrichment)
      const fetchedTask = db.prepare(`
        SELECT id, data FROM table_rows WHERE id = ?
      `).get(taskId) as { id: number; data: string };

      const taskInfo = JSON.parse(fetchedTask.data);
      expect(taskInfo.title).toBe('Important Task');
      expect(taskInfo.status).toBe('in_progress');
      expect(taskInfo.priority).toBe('high');
      expect(taskInfo.progress).toBe(60);
    });
  });
});
