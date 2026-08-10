// backend/validation/__tests__/schemas.test.js
// SEC-030: Zod Validation Tests - ADR-015
import { describe, it, expect } from 'vitest';
import { 
  loginSchema, 
  registerSchema,
  createTableSchema, 
  createRowSchema, 
  createSpaceSchema,
  updateRowSchema,
  createProjectSchema,
  createWidgetSchema,
  createApiKeySchema,
  createFolderSchema,
  createColumnSchema
} from '../schemas.js';

describe('Validation Schemas', () => {
  describe('loginSchema', () => {
    it('should accept valid login data', () => {
      const result = loginSchema.safeParse({
        email: 'user@example.com',
        password: 'SecurePassword123'
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid email', () => {
      const result = loginSchema.safeParse({
        email: 'not-an-email',
        password: 'SecurePassword123'
      });
      expect(result.success).toBe(false);
    });

    it('should reject short password', () => {
      const result = loginSchema.safeParse({
        email: 'user@example.com',
        password: '123'
      });
      expect(result.success).toBe(false);
    });

    it('should reject SQL injection attempts in email', () => {
      const result = loginSchema.safeParse({
        email: "admin'--@test.com",
        password: 'SecurePassword123'
      });
      expect(result.success).toBe(false);
    });
  });

  describe('registerSchema', () => {
    it('should accept valid registration data', () => {
      const result = registerSchema.safeParse({
        email: 'newuser@example.com',
        password: 'SecurePass1',
        name: 'New User'
      });
      expect(result.success).toBe(true);
    });

    it('should require uppercase in password', () => {
      const result = registerSchema.safeParse({
        email: 'user@example.com',
        password: 'lowercase123',
        name: 'User'
      });
      expect(result.success).toBe(false);
    });

    it('should require number in password', () => {
      const result = registerSchema.safeParse({
        email: 'user@example.com',
        password: 'NoNumbersHere',
        name: 'User'
      });
      expect(result.success).toBe(false);
    });
  });

  describe('createSpaceSchema', () => {
    it('should accept valid space data', () => {
      const result = createSpaceSchema.safeParse({
        name: 'My Workspace',
        type: 'business',
        description: 'A test workspace'
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid type', () => {
      const result = createSpaceSchema.safeParse({
        name: 'My Workspace',
        type: 'invalid_type'
      });
      expect(result.success).toBe(false);
    });

    it('should reject XSS in name', () => {
      const result = createSpaceSchema.safeParse({
        name: '<script>alert("xss")</script>',
        type: 'personal'
      });
      expect(result.success).toBe(false);
    });
  });

  describe('createTableSchema', () => {
    it('should accept valid table data', () => {
      const result = createTableSchema.safeParse({
        name: 'Customers',
        projectId: 1,
        columns: [
          { name: 'name', type: 'text' },
          { name: 'email', type: 'email' }
        ]
      });
      expect(result.success).toBe(true);
    });

    it('should reject XSS in table name', () => {
      const result = createTableSchema.safeParse({
        name: '<img src=x onerror=alert(1)>',
        projectId: 1
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid column types', () => {
      const result = createTableSchema.safeParse({
        name: 'Test',
        projectId: 1,
        columns: [
          { name: 'col1', type: 'invalid_type' }
        ]
      });
      expect(result.success).toBe(false);
    });

    it('should accept all valid column types', () => {
      const validTypes = [
        'text', 'number', 'date', 'datetime', 'checkbox',
        'select', 'multiselect', 'relation', 'file',
        'email', 'phone', 'url', 'rating', 'currency',
        'formula', 'rollup', 'json', 'markdown'
      ];
      
      for (const type of validTypes) {
        const result = createTableSchema.safeParse({
          name: 'Test',
          projectId: 1,
          columns: [{ name: 'col', type }]
        });
        expect(result.success).toBe(true);
      }
    });
  });

  describe('createRowSchema', () => {
    it('should accept valid row data', () => {
      const result = createRowSchema.safeParse({
        data: { name: 'John', age: 30 }
      });
      expect(result.success).toBe(true);
    });

    it('should require data object', () => {
      const result = createRowSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should accept complex nested data', () => {
      const result = createRowSchema.safeParse({
        data: { 
          info: { nested: true }, 
          tags: ['a', 'b'] 
        }
      });
      expect(result.success).toBe(true);
    });
  });

  describe('updateRowSchema', () => {
    it('should accept partial update', () => {
      const result = updateRowSchema.safeParse({
        data: { status: 'updated' }
      });
      expect(result.success).toBe(true);
    });
  });

  describe('createProjectSchema', () => {
    it('should accept valid project data', () => {
      const result = createProjectSchema.safeParse({
        name: 'My Project',
        type: 'table',
        spaceId: 1
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty name', () => {
      const result = createProjectSchema.safeParse({
        name: '',
        type: 'dashboard'
      });
      expect(result.success).toBe(false);
    });
  });

  describe('createWidgetSchema', () => {
    it('should accept valid preset widget', () => {
      const result = createWidgetSchema.safeParse({
        dashboardId: 1,
        widgetType: 'preset',
        presetName: 'chart',
        title: 'Sales Chart'
      });
      expect(result.success).toBe(true);
    });

    it('should accept custom widget with code', () => {
      const result = createWidgetSchema.safeParse({
        dashboardId: 1,
        widgetType: 'custom',
        title: 'Custom Widget',
        code: 'return <div>Hello</div>;'
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid widget type', () => {
      const result = createWidgetSchema.safeParse({
        dashboardId: 1,
        widgetType: 'invalid',
        title: 'Test'
      });
      expect(result.success).toBe(false);
    });
  });

  describe('createApiKeySchema', () => {
    it('should accept valid API key data', () => {
      const result = createApiKeySchema.safeParse({
        name: 'My API Key',
        scopes: ['read', 'write']
      });
      expect(result.success).toBe(true);
    });

    it('should accept minimal API key', () => {
      const result = createApiKeySchema.safeParse({
        name: 'Simple Key'
      });
      expect(result.success).toBe(true);
    });
  });

  describe('createFolderSchema', () => {
    it('should accept valid folder data', () => {
      const result = createFolderSchema.safeParse({
        name: 'Documents',
        projectId: 1
      });
      expect(result.success).toBe(true);
    });

    it('should accept folder with parent', () => {
      const result = createFolderSchema.safeParse({
        name: 'Subfolder',
        projectId: 1,
        parentId: 5
      });
      expect(result.success).toBe(true);
    });
  });

  describe('createColumnSchema', () => {
    it('should accept valid column', () => {
      const result = createColumnSchema.safeParse({
        name: 'status',
        type: 'select',
        config: { options: ['active', 'inactive'] }
      });
      expect(result.success).toBe(true);
    });
  });
});
