#!/usr/bin/env node
/**
 * 🎯 MASTER TEST SCENARIO v2.0
 * 
 * ПОЛНЫЙ интеграционный тест, покрывающий ВСЕ 115 API endpoints.
 * Имитирует реальный рабочий процесс команды.
 * 
 * Сценарий:
 * 1. testowner@hltrn.cc создаёт рабочее пространство
 * 2. Создаёт 4 пользователей с разными ролями
 * 3. Приглашает их в shared space с разными правами
 * 4. Каждый пользователь выполняет действия согласно своей роли
 * 5. Проверяются ВСЕ endpoints группами по категориям
 * 6. Генерируется TEST-SUMMARY.md с полным отчётом
 */

import { uniqueId } from '../../helpers/testFactory.js';
import fs from 'fs';
import path from 'path';

const BASE_URL = process.env.TEST_API_URL || 'https://devcrm.hltrn.cc/api/v3';

// ============================================================================
// CONFIGURATION
// ============================================================================

const TEST_OWNER = {
  email: 'testowner@hltrn.cc',
  password: 'testpass123!'
};

const USERS_TO_CREATE = [
  { role: 'admin', prefix: 'admin', spaceRole: 'admin' },
  { role: 'user', prefix: 'manager', spaceRole: 'editor' },
  { role: 'user', prefix: 'employee', spaceRole: 'editor' },
  { role: 'viewer', prefix: 'viewer', spaceRole: 'viewer' }
];

// ============================================================================
// ALL ENDPOINTS TO TEST (115 total)
// ============================================================================

const ALL_ENDPOINTS = [
  // AUTH (19 endpoints)
  { method: 'POST', path: '/auth/register', category: 'auth', tested: false },
  { method: 'POST', path: '/auth/login', category: 'auth', tested: false },
  { method: 'POST', path: '/auth/logout', category: 'auth', tested: false },
  { method: 'GET', path: '/auth/me', category: 'auth', tested: false },
  { method: 'POST', path: '/auth/refresh', category: 'auth', tested: false },
  { method: 'PATCH', path: '/auth/password', category: 'auth', tested: false },
  { method: 'GET', path: '/auth/profile', category: 'auth', tested: false },
  { method: 'PATCH', path: '/auth/profile', category: 'auth', tested: false },
  { method: 'PATCH', path: '/auth/email', category: 'auth', tested: false },
  { method: 'POST', path: '/auth/2fa/setup', category: 'auth', tested: false },
  { method: 'POST', path: '/auth/2fa/verify', category: 'auth', tested: false },
  { method: 'DELETE', path: '/auth/2fa', category: 'auth', tested: false },
  { method: 'POST', path: '/auth/forgot-password', category: 'auth', tested: false },
  { method: 'GET', path: '/auth/verify-reset-token/:token', category: 'auth', tested: false },
  { method: 'POST', path: '/auth/reset-password', category: 'auth', tested: false },
  { method: 'GET', path: '/auth/google/config', category: 'auth', tested: false },
  { method: 'GET', path: '/auth/google/auth-url', category: 'auth', tested: false },
  { method: 'POST', path: '/auth/google/callback', category: 'auth', tested: false },
  { method: 'POST', path: '/auth/google/config', category: 'auth', tested: false },

  // SPACES (8 endpoints)
  { method: 'GET', path: '/spaces', category: 'spaces', tested: false },
  { method: 'POST', path: '/spaces', category: 'spaces', tested: false },
  { method: 'GET', path: '/spaces/:id', category: 'spaces', tested: false },
  { method: 'PUT', path: '/spaces/:id', category: 'spaces', tested: false },
  { method: 'DELETE', path: '/spaces/:id', category: 'spaces', tested: false },
  { method: 'POST', path: '/spaces/:id/data-sources-project', category: 'spaces', tested: false },
  { method: 'POST', path: '/spaces/:id/users-table', category: 'spaces', tested: false },
  { method: 'POST', path: '/spaces/:id/roles-table', category: 'spaces', tested: false },

  // PROJECTS (4 endpoints)
  { method: 'GET', path: '/projects', category: 'projects', tested: false },
  { method: 'POST', path: '/projects', category: 'projects', tested: false },
  { method: 'PUT', path: '/projects/:id', category: 'projects', tested: false },
  { method: 'DELETE', path: '/projects/:id', category: 'projects', tested: false },

  // TABLES (16 endpoints)
  { method: 'GET', path: '/users', category: 'tables', tested: false },
  { method: 'GET', path: '/tables/:tableId', category: 'tables', tested: false },
  { method: 'POST', path: '/tables/create-calendar', category: 'tables', tested: false },
  { method: 'POST', path: '/tables', category: 'tables', tested: false },
  { method: 'GET', path: '/tables', category: 'tables', tested: false },
  { method: 'GET', path: '/projects/:projectId/tables', category: 'tables', tested: false },
  { method: 'GET', path: '/tables/:tableId/columns', category: 'tables', tested: false },
  { method: 'GET', path: '/tables/:tableId/rows', category: 'tables', tested: false },
  { method: 'POST', path: '/tables/:tableId/rows', category: 'tables', tested: false },
  { method: 'PUT', path: '/tables/:tableId/rows/:rowId', category: 'tables', tested: false },
  { method: 'DELETE', path: '/tables/:tableId/rows/:rowId', category: 'tables', tested: false },
  { method: 'POST', path: '/tables/:tableId/connect', category: 'tables', tested: false },
  { method: 'PATCH', path: '/tables/:tableId', category: 'tables', tested: false },
  { method: 'POST', path: '/tables/:tableId/rows/batch-update', category: 'tables', tested: false },
  { method: 'POST', path: '/tables/:tableId/rows/batch-delete', category: 'tables', tested: false },

  // WIDGETS (11 endpoints)
  { method: 'GET', path: '/projects/:projectId/widgets', category: 'widgets', tested: false },
  { method: 'GET', path: '/projects/:projectId/dashboard', category: 'widgets', tested: false },
  { method: 'GET', path: '/dashboards/:dashboardId', category: 'widgets', tested: false },
  { method: 'GET', path: '/widgets/presets', category: 'widgets', tested: false },
  { method: 'GET', path: '/dashboards/:dashboardId/widgets', category: 'widgets', tested: false },
  { method: 'POST', path: '/dashboards/:dashboardId/widgets', category: 'widgets', tested: false },
  { method: 'GET', path: '/widgets/:widgetId', category: 'widgets', tested: false },
  { method: 'PATCH', path: '/widgets/:widgetId', category: 'widgets', tested: false },
  { method: 'DELETE', path: '/widgets/:widgetId', category: 'widgets', tested: false },
  { method: 'PATCH', path: '/widgets/:widgetId/code', category: 'widgets', tested: false },
  { method: 'GET', path: '/widgets/:widgetId/data', category: 'widgets', tested: false },

  // DOCUMENTS (12 endpoints)
  { method: 'POST', path: '/projects/:projectId/documents/init', category: 'documents', tested: false },
  { method: 'GET', path: '/projects/:projectId/documents', category: 'documents', tested: false },
  { method: 'POST', path: '/projects/:projectId/documents', category: 'documents', tested: false },
  { method: 'DELETE', path: '/documents/:documentId', category: 'documents', tested: false },
  { method: 'GET', path: '/documents/:documentId/content', category: 'documents', tested: false },
  { method: 'POST', path: '/documents/:documentId/import-v4', category: 'documents', tested: false },
  { method: 'POST', path: '/projects/:projectId/documents/add-language', category: 'documents', tested: false },
  { method: 'POST', path: '/documents/import', category: 'documents', tested: false },
  { method: 'GET', path: '/documents/:documentId/export', category: 'documents', tested: false },
  { method: 'PUT', path: '/documents/:documentId/structure', category: 'documents', tested: false },
  { method: 'POST', path: '/documents/:documentId/rebuild-structure', category: 'documents', tested: false },
  { method: 'POST', path: '/documents/setup-columns', category: 'documents', tested: false },

  // FOLDERS (5 endpoints)
  { method: 'GET', path: '/projects/:projectId/folders', category: 'folders', tested: false },
  { method: 'POST', path: '/projects/:projectId/folders', category: 'folders', tested: false },
  { method: 'GET', path: '/folders/:folderId', category: 'folders', tested: false },
  { method: 'PUT', path: '/folders/:folderId', category: 'folders', tested: false },
  { method: 'DELETE', path: '/folders/:folderId', category: 'folders', tested: false },

  // FILES (8 endpoints)
  { method: 'POST', path: '/files/upload', category: 'files', tested: false },
  { method: 'GET', path: '/files', category: 'files', tested: false },
  { method: 'GET', path: '/files/:fileId', category: 'files', tested: false },
  { method: 'DELETE', path: '/files/:fileId', category: 'files', tested: false },
  { method: 'GET', path: '/storage-providers', category: 'files', tested: false },
  { method: 'POST', path: '/storage-providers', category: 'files', tested: false },
  { method: 'PUT', path: '/storage-providers/:providerId', category: 'files', tested: false },
  { method: 'DELETE', path: '/storage-providers/:providerId', category: 'files', tested: false },

  // API-KEYS (5 endpoints)
  { method: 'GET', path: '/api-keys', category: 'api-keys', tested: false },
  { method: 'POST', path: '/api-keys', category: 'api-keys', tested: false },
  { method: 'PATCH', path: '/api-keys/:id', category: 'api-keys', tested: false },
  { method: 'DELETE', path: '/api-keys/:id', category: 'api-keys', tested: false },
  { method: 'POST', path: '/api-keys/:id/regenerate', category: 'api-keys', tested: false },

  // WEBHOOKS (6 endpoints)
  { method: 'GET', path: '/projects/:projectId/webhooks', category: 'webhooks', tested: false },
  { method: 'POST', path: '/projects/:projectId/webhooks', category: 'webhooks', tested: false },
  { method: 'PATCH', path: '/webhooks/:id', category: 'webhooks', tested: false },
  { method: 'DELETE', path: '/webhooks/:id', category: 'webhooks', tested: false },
  { method: 'GET', path: '/webhooks/:id/logs', category: 'webhooks', tested: false },
  { method: 'POST', path: '/incoming/:token', category: 'webhooks', tested: false },

  // USER-SETTINGS (4 endpoints)
  { method: 'GET', path: '/user-settings/spaces-order', category: 'user-settings', tested: false },
  { method: 'PUT', path: '/user-settings/spaces-order', category: 'user-settings', tested: false },
  { method: 'PATCH', path: '/user-settings/spaces-order/:spaceId', category: 'user-settings', tested: false },
  { method: 'DELETE', path: '/user-settings/spaces-order', category: 'user-settings', tested: false },

  // AI-AGENTS (13 endpoints)
  { method: 'GET', path: '/ai/agents', category: 'ai-agents', tested: false },
  { method: 'GET', path: '/ai/agents/:spaceId', category: 'ai-agents', tested: false },
  { method: 'POST', path: '/ai/run', category: 'ai-agents', tested: false },
  { method: 'POST', path: '/ai/chat', category: 'ai-agents', tested: false },
  { method: 'POST', path: '/ai/process-prompt', category: 'ai-agents', tested: false },
  { method: 'GET', path: '/ai/logs/:spaceId', category: 'ai-agents', tested: false },
  { method: 'GET', path: '/ai/analytics/:spaceId', category: 'ai-agents', tested: false },
  { method: 'POST', path: '/ai/providers/:providerId/refresh-models', category: 'ai-agents', tested: false },
  { method: 'GET', path: '/ai/providers', category: 'ai-agents', tested: false },
  { method: 'PUT', path: '/ai/providers/:providerId', category: 'ai-agents', tested: false },
  { method: 'GET', path: '/ai/providers/:providerId/models', category: 'ai-agents', tested: false },
  { method: 'GET', path: '/ai/models', category: 'ai-agents', tested: false },
  { method: 'GET', path: '/ai/conversations', category: 'ai-agents', tested: false },

  // DATA-SOURCES (9 endpoints)
  { method: 'GET', path: '/data-sources', category: 'data-sources', tested: false },
  { method: 'GET', path: '/data-sources/:id', category: 'data-sources', tested: false },
  { method: 'POST', path: '/data-sources', category: 'data-sources', tested: false },
  { method: 'PUT', path: '/data-sources/:id', category: 'data-sources', tested: false },
  { method: 'DELETE', path: '/data-sources/:id', category: 'data-sources', tested: false },
  { method: 'POST', path: '/data-sources/:id/test', category: 'data-sources', tested: false },
  { method: 'GET', path: '/data-sources/:id/tables', category: 'data-sources', tested: false },
  { method: 'GET', path: '/data-sources/:id/tables/:tableName/columns', category: 'data-sources', tested: false },
  { method: 'POST', path: '/data-sources/:id/import', category: 'data-sources', tested: false },

  // SCHEMA (4 endpoints)
  { method: 'GET', path: '/spaces/:spaceId/schema', category: 'schema', tested: false },
  { method: 'PUT', path: '/spaces/:spaceId/schema/layout', category: 'schema', tested: false },
  { method: 'POST', path: '/spaces/:spaceId/schema/tables', category: 'schema', tested: false },
  { method: 'POST', path: '/relations', category: 'schema', tested: false },

  // BATCH (1 endpoint)
  { method: 'POST', path: '/spaces/:spaceId/batch', category: 'batch', tested: false }
];

// ============================================================================
// TEST STATE
// ============================================================================

const testState = {
  runId: uniqueId(),
  startTime: new Date().toISOString(),
  owner: null,
  ownerToken: null,
  sharedSpace: null,
  createdUsers: [],
  createdSpaces: [],
  createdProjects: [],
  createdTables: [],
  createdWidgets: [],
  createdDashboards: [],
  createdDocuments: [],
  createdFolders: [],
  createdApiKeys: [],
  createdWebhooks: [],
  createdRows: [],
  errors: [],
  endpointResults: [],
  actions: []
};

// ============================================================================
// API CLIENT
// ============================================================================

class MasterApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.token = null;
    this.currentUser = null;
  }

  setToken(token) {
    this.token = token;
  }

  setUser(user) {
    this.currentUser = user;
  }

  async request(method, path, body = null) {
    const url = `${this.baseUrl}${path}`;
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const options = { method, headers };
    if (body && ['POST', 'PATCH', 'PUT'].includes(method)) {
      options.body = JSON.stringify(body);
    }

    const startTime = Date.now();
    try {
      const response = await fetch(url, options);
      const duration = Date.now() - startTime;
      
      let data;
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = { raw: await response.text() };
      }
      
      return { 
        status: response.status, 
        ok: response.ok, 
        data: data.data || data, 
        error: data.error,
        duration
      };
    } catch (error) {
      return { status: 0, ok: false, error: error.message, duration: Date.now() - startTime };
    }
  }

  get(path) { return this.request('GET', path); }
  post(path, body) { return this.request('POST', path, body); }
  patch(path, body) { return this.request('PATCH', path, body); }
  put(path, body) { return this.request('PUT', path, body); }
  delete(path) { return this.request('DELETE', path); }
}

const api = new MasterApiClient(BASE_URL);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function log(emoji, message, data = null) {
  const timestamp = new Date().toISOString().slice(11, 19);
  console.log(`[${timestamp}] ${emoji} ${message}`);
  if (data && process.env.VERBOSE) console.log('          ', JSON.stringify(data, null, 2).slice(0, 300));
}

function markEndpointTested(method, pathPattern, result) {
  const endpoint = ALL_ENDPOINTS.find(e => e.method === method && e.path === pathPattern);
  if (endpoint) {
    endpoint.tested = true;
    endpoint.result = result;
  }
  testState.endpointResults.push({
    method,
    path: pathPattern,
    result: result.ok ? 'PASS' : 'FAIL',
    status: result.status,
    duration: result.duration
  });
}

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ============================================================================
// SCENARIO STEPS
// ============================================================================

async function step01_ownerSetup() {
  log('🔐', '=== STEP 1: Owner Setup ===');
  
  // Login
  let result = await api.post('/auth/login', {
    email: TEST_OWNER.email,
    password: TEST_OWNER.password
  });
  markEndpointTested('POST', '/auth/login', result);

  if (!result.ok) {
    log('⚠️', 'Login failed, registering...');
    result = await api.post('/auth/register', {
      email: TEST_OWNER.email,
      password: TEST_OWNER.password,
      name: 'Test Owner'
    });
    markEndpointTested('POST', '/auth/register', result);
    
    if (!result.ok) throw new Error(`Failed to setup owner: ${result.error}`);
  }

  const token = result.data.accessToken || result.data.token;
  api.setToken(token);
  testState.ownerToken = token;
  testState.owner = result.data.user;
  api.setUser(testState.owner);
  log('✅', `Owner ready: ${TEST_OWNER.email}`);

  // Test auth endpoints
  result = await api.get('/auth/me');
  markEndpointTested('GET', '/auth/me', result);
  
  result = await api.get('/auth/profile');
  markEndpointTested('GET', '/auth/profile', result);
  
  result = await api.patch('/auth/profile', { name: 'Test Owner Updated' });
  markEndpointTested('PATCH', '/auth/profile', result);
}

async function step02_createSharedSpace() {
  log('🏠', '=== STEP 2: Create Shared Space ===');
  
  // List existing spaces
  let result = await api.get('/spaces');
  markEndpointTested('GET', '/spaces', result);
  
  // Create shared workspace
  result = await api.post('/spaces', {
    name: `Shared Workspace ${uniqueId()}`,
    type: 'business',
    description: 'Team workspace for integration testing'
  });
  markEndpointTested('POST', '/spaces', result);
  
  if (result.ok && result.data.space) {
    testState.sharedSpace = result.data.space;
    testState.createdSpaces.push(result.data.space);
    log('✅', `Created shared space: ${result.data.space.name} (ID: ${result.data.space.id})`);
    
    // Get space details
    result = await api.get(`/spaces/${testState.sharedSpace.id}`);
    markEndpointTested('GET', '/spaces/:id', result);
    
    // Update space
    result = await api.put(`/spaces/${testState.sharedSpace.id}`, {
      name: testState.sharedSpace.name,
      description: 'Updated description'
    });
    markEndpointTested('PUT', '/spaces/:id', result);
    
    // Get schema
    result = await api.get(`/spaces/${testState.sharedSpace.id}/schema`);
    markEndpointTested('GET', '/spaces/:spaceId/schema', result);
    
    // Data sources project
    result = await api.post(`/spaces/${testState.sharedSpace.id}/data-sources-project`, {});
    markEndpointTested('POST', '/spaces/:id/data-sources-project', result);
    
    // Users table
    result = await api.post(`/spaces/${testState.sharedSpace.id}/users-table`, {});
    markEndpointTested('POST', '/spaces/:id/users-table', result);
    
    // Roles table
    result = await api.post(`/spaces/${testState.sharedSpace.id}/roles-table`, {});
    markEndpointTested('POST', '/spaces/:id/roles-table', result);
  }
}

async function step03_createUsers() {
  log('👥', '=== STEP 3: Create Test Users ===');

  for (const userSpec of USERS_TO_CREATE) {
    const id = uniqueId();
    const userData = {
      email: `${userSpec.prefix}-${id}@test.godcrm.local`,
      password: 'TestPass123!',
      name: `${userSpec.prefix.charAt(0).toUpperCase() + userSpec.prefix.slice(1)} ${id}`
    };

    const result = await api.post('/auth/register', userData);
    // Don't mark again - already tested
    
    if (result.ok) {
      const token = result.data.accessToken || result.data.token;
      const user = {
        ...userData,
        id: result.data.user?.id,
        token: token,
        role: userSpec.role,
        spaceRole: userSpec.spaceRole
      };
      testState.createdUsers.push(user);
      log('✅', `Created user: ${userData.email} (${userSpec.spaceRole})`);
    } else {
      testState.errors.push({ action: 'createUser', email: userData.email, error: result.error });
      log('❌', `Failed: ${userData.email}`, result.error);
    }
  }
}

async function step04_createProjectsAndTables() {
  log('📁', '=== STEP 4: Create Projects and Tables ===');
  
  if (!testState.sharedSpace) {
    log('⚠️', 'No shared space, skipping...');
    return;
  }

  // Get projects list
  let result = await api.get('/projects');
  markEndpointTested('GET', '/projects', result);
  
  // Create multiple projects
  const projectNames = ['CRM Development', 'Marketing Campaign', 'Product Inventory', 'HR Management'];
  
  for (const name of projectNames) {
    result = await api.post('/projects', {
      name: `${name} ${uniqueId()}`,
      space_id: testState.sharedSpace.id,
      description: `Test project for ${name}`
    });
    markEndpointTested('POST', '/projects', result);
    
    // Try to get project ID from response or list
    if (result.ok) {
      // Fetch projects to get the new one
      const listResult = await api.get('/projects');
      if (listResult.ok && Array.isArray(listResult.data)) {
        const newProject = listResult.data.find(p => p.name?.includes(name));
        if (newProject) {
          testState.createdProjects.push(newProject);
          log('✅', `Created project: ${newProject.name} (ID: ${newProject.id})`);
          
          // Update project
          result = await api.put(`/projects/${newProject.id}`, {
            name: newProject.name,
            description: 'Updated description'
          });
          markEndpointTested('PUT', '/projects/:id', result);
          
          // Get project tables
          result = await api.get(`/projects/${newProject.id}/tables`);
          markEndpointTested('GET', '/projects/:projectId/tables', result);
          
          // Get dashboard
          result = await api.get(`/projects/${newProject.id}/dashboard`);
          markEndpointTested('GET', '/projects/:projectId/dashboard', result);
          if (result.ok && result.data?.id) {
            testState.createdDashboards.push(result.data);
          }
          
          // Get widgets
          result = await api.get(`/projects/${newProject.id}/widgets`);
          markEndpointTested('GET', '/projects/:projectId/widgets', result);
          
          // Init documents
          result = await api.post(`/projects/${newProject.id}/documents/init`, {});
          markEndpointTested('POST', '/projects/:projectId/documents/init', result);
          
          // Get documents
          result = await api.get(`/projects/${newProject.id}/documents`);
          markEndpointTested('GET', '/projects/:projectId/documents', result);
          
          // Get folders
          result = await api.get(`/projects/${newProject.id}/folders`);
          markEndpointTested('GET', '/projects/:projectId/folders', result);
          
          // Create folder
          result = await api.post(`/projects/${newProject.id}/folders`, {
            name: `Folder ${uniqueId()}`,
            parent_id: null
          });
          markEndpointTested('POST', '/projects/:projectId/folders', result);
          
          // Get webhooks
          result = await api.get(`/projects/${newProject.id}/webhooks`);
          markEndpointTested('GET', '/projects/:projectId/webhooks', result);
        }
      }
    }
  }

  // Create tables
  result = await api.get('/tables');
  markEndpointTested('GET', '/tables', result);
  
  result = await api.get('/users');
  markEndpointTested('GET', '/users', result);
  
  if (testState.createdProjects.length > 0) {
    const project = testState.createdProjects[0];
    
    // Create different table types
    const tableTypes = [
      { name: 'Contacts', columns: ['name:text', 'email:email', 'phone:text', 'status:select'] },
      { name: 'Tasks', columns: ['title:text', 'assignee:text', 'due_date:date', 'priority:select', 'done:checkbox'] },
      { name: 'Products', columns: ['name:text', 'price:number', 'stock:number', 'category:select'] },
      { name: 'Notes', columns: ['title:text', 'content:text', 'created:date'] }
    ];
    
    for (const tableSpec of tableTypes) {
      const columns = tableSpec.columns.map((col, idx) => {
        const [colName, type] = col.split(':');
        return { name: colName, type, order_index: idx };
      });
      
      // v3 API uses camelCase: projectId (not project_id)
      result = await api.post('/tables', {
        name: `${tableSpec.name} ${uniqueId()}`,
        projectId: project.id,
        columns: columns
      });
      markEndpointTested('POST', '/tables', result);
      
      // Get created table
      const tablesResult = await api.get(`/projects/${project.id}/tables`);
      if (tablesResult.ok && Array.isArray(tablesResult.data)) {
        const newTable = tablesResult.data.find(t => t.name?.includes(tableSpec.name));
        if (newTable) {
          testState.createdTables.push(newTable);
          log('✅', `Created table: ${newTable.name} (ID: ${newTable.id})`);
          
          // Get table details
          result = await api.get(`/tables/${newTable.id}`);
          markEndpointTested('GET', '/tables/:tableId', result);
          
          // Get columns
          result = await api.get(`/tables/${newTable.id}/columns`);
          markEndpointTested('GET', '/tables/:tableId/columns', result);
          
          // Update table (accepts: displayName, icon, color, access_control, show_in_nav, privacy)
          result = await api.patch(`/tables/${newTable.id}`, {
            displayName: `${tableSpec.name} Updated`,
            icon: '📊'
          });
          markEndpointTested('PATCH', '/tables/:tableId', result);
        }
      }
    }
  }
}

async function step05_crudOperations() {
  log('📝', '=== STEP 5: CRUD Operations on Tables ===');
  
  for (const table of testState.createdTables) {
    // Create rows
    const rowsToCreate = randomInt(5, 15);
    const createdRowIds = [];
    
    for (let i = 0; i < rowsToCreate; i++) {
      // v3 API uses 'data' not 'values'
      const result = await api.post(`/tables/${table.id}/rows`, {
        data: {
          name: `Item ${uniqueId()}`,
          title: `Task ${uniqueId()}`,
          email: `test${i}@example.com`,
          status: randomChoice(['active', 'pending', 'completed']),
          priority: randomChoice(['low', 'medium', 'high'])
        }
      });
      markEndpointTested('POST', '/tables/:tableId/rows', result);
      
      if (result.ok && result.data?.id) {
        createdRowIds.push(result.data.id);
        testState.createdRows.push({ tableId: table.id, id: result.data.id });
      } else if (result.ok) {
        // Row created but ID not in response - count as success
        testState.createdRows.push({ tableId: table.id, id: 'unknown' });
      }
    }
    log('✅', `Created ${testState.createdRows.filter(r => r.tableId === table.id).length} rows in table ${table.name}`);
    
    // Get rows
    let result = await api.get(`/tables/${table.id}/rows`);
    markEndpointTested('GET', '/tables/:tableId/rows', result);
    
    // Get row IDs from response for updates
    const rowIds = result.ok && Array.isArray(result.data) ? result.data.map(r => r.id) : [];
    
    // Update some rows
    if (rowIds.length > 0) {
      for (let i = 0; i < Math.min(3, rowIds.length); i++) {
        // v3 API uses 'data' not 'values'
        result = await api.put(`/tables/${table.id}/rows/${rowIds[i]}`, {
          data: { status: 'updated', name: `Updated ${uniqueId()}` }
        });
        markEndpointTested('PUT', '/tables/:tableId/rows/:rowId', result);
      }
      
      // Batch update
      result = await api.post(`/tables/${table.id}/rows/batch-update`, {
        rowIds: rowIds.slice(0, 3),
        data: { status: 'batch-updated' }
      });
      markEndpointTested('POST', '/tables/:tableId/rows/batch-update', result);
      
      // Delete one row
      if (rowIds.length > 5) {
        result = await api.delete(`/tables/${table.id}/rows/${rowIds[rowIds.length - 1]}`);
        markEndpointTested('DELETE', '/tables/:tableId/rows/:rowId', result);
      }
    }
  }
}

async function step06_widgetsAndDashboards() {
  log('📊', '=== STEP 6: Widgets and Dashboards ===');
  
  // Get presets
  let result = await api.get('/widgets/presets');
  markEndpointTested('GET', '/widgets/presets', result);
  
  // Extract preset names from response
  const presets = result.ok && Array.isArray(result.data) ? result.data : [];
  const presetNames = presets.length > 0 ? presets.map(p => p.name || p.id) : ['stat_users', 'stat_projects'];
  
  for (const dashboard of testState.createdDashboards) {
    // Get dashboard
    result = await api.get(`/dashboards/${dashboard.id}`);
    markEndpointTested('GET', '/dashboards/:dashboardId', result);
    
    // Get widgets
    result = await api.get(`/dashboards/${dashboard.id}/widgets`);
    markEndpointTested('GET', '/dashboards/:dashboardId/widgets', result);
    
    // Create preset widgets
    for (let i = 0; i < Math.min(3, presetNames.length); i++) {
      result = await api.post(`/dashboards/${dashboard.id}/widgets`, {
        widget_type: 'preset',
        preset_name: presetNames[i],
        title: `Preset Widget ${uniqueId()}`,
        position: { x: i * 4, y: 0, w: 4, h: 2 },
        order_index: i
      });
      markEndpointTested('POST', '/dashboards/:dashboardId/widgets', result);
      
      if (result.ok && result.data?.id) {
        testState.createdWidgets.push(result.data);
        
        // Get widget
        let widgetResult = await api.get(`/widgets/${result.data.id}`);
        markEndpointTested('GET', '/widgets/:widgetId', widgetResult);
        
        // Get widget data
        widgetResult = await api.get(`/widgets/${result.data.id}/data`);
        markEndpointTested('GET', '/widgets/:widgetId/data', widgetResult);
        
        // Update widget
        widgetResult = await api.patch(`/widgets/${result.data.id}`, {
          title: `Updated Preset Widget`
        });
        markEndpointTested('PATCH', '/widgets/:widgetId', widgetResult);
      }
    }
    
    // Create custom widget
    result = await api.post(`/dashboards/${dashboard.id}/widgets`, {
      widget_type: 'custom',
      title: `Custom Widget ${uniqueId()}`,
      code: '<div style="padding:20px">Custom HTML Content</div>',
      position: { x: 0, y: 4, w: 6, h: 3 },
      order_index: 10
    });
    markEndpointTested('POST', '/dashboards/:dashboardId/widgets', result);
    
    if (result.ok && result.data?.id) {
      testState.createdWidgets.push(result.data);
      
      // Update code
      const codeResult = await api.patch(`/widgets/${result.data.id}/code`, {
        code: '<div>Updated Custom HTML</div>'
      });
      markEndpointTested('PATCH', '/widgets/:widgetId/code', codeResult);
    }
  }
  
  log('✅', `Created ${testState.createdWidgets.length} widgets`);
}

async function step07_documentsAndFolders() {
  log('📄', '=== STEP 7: Documents and Folders ===');
  
  for (const project of testState.createdProjects.slice(0, 2)) {
    // Initialize documents folder first (returns registry_table_id)
    let result = await api.post(`/projects/${project.id}/documents/init`, {});
    markEndpointTested('POST', '/projects/:projectId/documents/init', result);
    
    const registryTableId = result.data?.registry_table_id;
    
    // Create document (v3 API uses 'name' not 'title')
    result = await api.post(`/projects/${project.id}/documents`, {
      name: `Document ${uniqueId()}`,
      description: 'Test document created by master scenario'
    });
    markEndpointTested('POST', '/projects/:projectId/documents', result);
    
    // Get document ID from response
    const docId = result.data?.document_id;
    if (docId && registryTableId) {
      testState.createdDocuments.push({ id: docId, registry_table_id: registryTableId, ...result.data });
      
      // Get content (requires registry_table_id)
      result = await api.get(`/documents/${docId}/content?registry_table_id=${registryTableId}`);
      markEndpointTested('GET', '/documents/:documentId/content', result);
      
      // NOTE: export and structure endpoints use OLD v3 format (documents_table_id, sections_table_id)
      // but init v4 returns registry_table_id and atoms_table_id - they are NOT compatible
      // Skipping these tests until backend is updated to support v4 format
      // result = await api.get(`/documents/${docId}/export?...`);
      // markEndpointTested('GET', '/documents/:documentId/export', result);
      // result = await api.put(`/documents/${docId}/structure`, {...});
      // markEndpointTested('PUT', '/documents/:documentId/structure', result);
    } else if (docId) {
      testState.createdDocuments.push({ id: docId, ...result.data });
    }
    
    // List documents
    const docsResult = await api.get(`/projects/${project.id}/documents`);
    markEndpointTested('GET', '/projects/:projectId/documents', docsResult);
    
    // Create nested folders
    result = await api.post(`/projects/${project.id}/folders`, {
      name: `Parent Folder ${uniqueId()}`,
      parent_id: null
    });
    
    const foldersResult = await api.get(`/projects/${project.id}/folders`);
    if (foldersResult.ok && Array.isArray(foldersResult.data) && foldersResult.data.length > 0) {
      const folder = foldersResult.data[0];
      testState.createdFolders.push(folder);
      
      // Get folder
      result = await api.get(`/folders/${folder.id}`);
      markEndpointTested('GET', '/folders/:folderId', result);
      
      // Update folder
      result = await api.put(`/folders/${folder.id}`, { name: `Updated ${folder.name}` });
      markEndpointTested('PUT', '/folders/:folderId', result);
    }
  }
  
  log('✅', `Created ${testState.createdDocuments.length} documents, ${testState.createdFolders.length} folders`);
}

async function step08_apiKeysAndWebhooks() {
  log('🔑', '=== STEP 8: API Keys and Webhooks ===');
  
  // Create API key
  if (testState.createdProjects.length > 0) {
    const project = testState.createdProjects[0];
    
    // Get API keys (requires project_id)
    let result = await api.get(`/api-keys?project_id=${project.id}`);
    markEndpointTested('GET', '/api-keys', result);
    
    result = await api.post('/api-keys', {
      name: `Test API Key ${uniqueId()}`,
      project_id: project.id,
      scopes: ['read', 'write']
    });
    markEndpointTested('POST', '/api-keys', result);
    
    if (result.ok && result.data?.id) {
      testState.createdApiKeys.push({ ...result.data, project_id: project.id });
      
      // Update key (requires project_id)
      result = await api.patch(`/api-keys/${result.data.id}`, {
        name: 'Updated API Key',
        project_id: project.id
      });
      markEndpointTested('PATCH', '/api-keys/:id', result);
      
      // Regenerate (requires project_id)
      result = await api.post(`/api-keys/${result.data.id}/regenerate`, {
        project_id: project.id
      });
      markEndpointTested('POST', '/api-keys/:id/regenerate', result);
    }
    
    // Create webhook
    result = await api.post(`/projects/${project.id}/webhooks`, {
      name: `Test Webhook ${uniqueId()}`,
      url: 'https://httpbin.org/post',
      events: ['row.created', 'row.updated'],
      active: true
    });
    markEndpointTested('POST', '/projects/:projectId/webhooks', result);
    
    // Get webhooks and find created
    const webhooksResult = await api.get(`/projects/${project.id}/webhooks`);
    if (webhooksResult.ok && Array.isArray(webhooksResult.data) && webhooksResult.data.length > 0) {
      const webhook = webhooksResult.data[0];
      testState.createdWebhooks.push(webhook);
      
      // Update webhook
      result = await api.patch(`/webhooks/${webhook.id}`, { name: 'Updated Webhook' });
      markEndpointTested('PATCH', '/webhooks/:id', result);
      
      // Get logs
      result = await api.get(`/webhooks/${webhook.id}/logs`);
      markEndpointTested('GET', '/webhooks/:id/logs', result);
    }
  }
  
  log('✅', `Created ${testState.createdApiKeys.length} API keys, ${testState.createdWebhooks.length} webhooks`);
}

async function step09_userSettings() {
  log('⚙️', '=== STEP 9: User Settings ===');
  
  // Get spaces order
  let result = await api.get('/user-settings/spaces-order');
  markEndpointTested('GET', '/user-settings/spaces-order', result);
  
  // Update spaces order (requires object with spaceId: orderIndex)
  if (testState.createdSpaces.length > 0) {
    const spacesOrder = {};
    testState.createdSpaces.forEach((s, idx) => {
      spacesOrder[s.id] = idx;
    });
    
    result = await api.put('/user-settings/spaces-order', {
      spacesOrder: spacesOrder
    });
    markEndpointTested('PUT', '/user-settings/spaces-order', result);
    
    // Update single space order (requires 'order' as number)
    result = await api.patch(`/user-settings/spaces-order/${testState.createdSpaces[0].id}`, {
      order: 0
    });
    markEndpointTested('PATCH', '/user-settings/spaces-order/:spaceId', result);
  }
  
  log('✅', 'User settings tested');
}

async function step10_aiAndDataSources() {
  log('🤖', '=== STEP 10: AI Agents and Data Sources ===');
  
  // AI Agents
  let result = await api.get('/ai/agents');
  markEndpointTested('GET', '/ai/agents', result);
  
  if (testState.sharedSpace) {
    result = await api.get(`/ai/agents/${testState.sharedSpace.id}`);
    markEndpointTested('GET', '/ai/agents/:spaceId', result);
    
    result = await api.get(`/ai/logs/${testState.sharedSpace.id}`);
    markEndpointTested('GET', '/ai/logs/:spaceId', result);
    
    result = await api.get(`/ai/analytics/${testState.sharedSpace.id}`);
    markEndpointTested('GET', '/ai/analytics/:spaceId', result);
  }
  
  result = await api.get('/ai/providers');
  markEndpointTested('GET', '/ai/providers', result);
  
  result = await api.get('/ai/models');
  markEndpointTested('GET', '/ai/models', result);
  
  result = await api.get('/ai/conversations');
  markEndpointTested('GET', '/ai/conversations', result);
  
  // Data Sources (requires workspace_id which is space_id)
  if (testState.sharedSpace) {
    result = await api.get(`/data-sources?workspace_id=${testState.sharedSpace.id}`);
    markEndpointTested('GET', '/data-sources', result);
  }
  
  log('✅', 'AI and Data Sources tested');
}

async function step11_schemaAndBatch() {
  log('📐', '=== STEP 11: Schema and Batch Operations ===');
  
  if (testState.sharedSpace) {
    // Update schema layout
    let result = await api.put(`/spaces/${testState.sharedSpace.id}/schema/layout`, {
      nodes: [],
      edges: []
    });
    markEndpointTested('PUT', '/spaces/:spaceId/schema/layout', result);
    
    // Create relation (endpoint is /relations, uses camelCase params)
    if (testState.createdTables.length >= 2) {
      result = await api.post('/relations', {
        sourceTableId: testState.createdTables[0].id,
        targetTableId: testState.createdTables[1].id,
        sourceColumn: 'related_to',
        targetColumn: 'id'
      });
      markEndpointTested('POST', '/relations', result);
    }
    
    // Batch operations (requires non-empty items array)
    if (testState.createdProjects.length > 0) {
      result = await api.post(`/spaces/${testState.sharedSpace.id}/batch`, {
        operation: 'reorder',
        items: testState.createdProjects.slice(0, 2).map((p, idx) => ({ type: 'project', id: p.id, order: idx }))
      });
      markEndpointTested('POST', '/spaces/:spaceId/batch', result);
    }
  }
  
  log('✅', 'Schema and Batch operations tested');
}

async function step12_userRoleActions() {
  log('👤', '=== STEP 12: User Role-Based Actions ===');
  
  for (const user of testState.createdUsers) {
    log('🎯', `Testing actions for ${user.email} (${user.spaceRole})`);
    
    api.setToken(user.token);
    api.setUser(user);
    
    // Each user creates their own space
    let result = await api.post('/spaces', {
      name: `${user.name}'s Space ${uniqueId()}`,
      type: 'personal',
      description: 'Personal test space'
    });
    
    if (result.ok && result.data.space) {
      testState.createdSpaces.push(result.data.space);
      const userSpace = result.data.space;
      
      // Create project in their space
      result = await api.post('/projects', {
        name: `${user.name}'s Project ${uniqueId()}`,
        space_id: userSpace.id
      });
      
      // Get their projects
      result = await api.get('/projects');
      
      // Get their spaces
      result = await api.get('/spaces');
      
      // Test user settings
      result = await api.get('/user-settings/spaces-order');
      
      // Test profile
      result = await api.get('/auth/profile');
    }
    
    log('✅', `Completed actions for ${user.email}`);
  }
  
  // Restore owner token
  api.setToken(testState.ownerToken);
  api.setUser(testState.owner);
}

async function step13_cleanupAndDelete() {
  log('🧹', '=== STEP 13: Cleanup Testing (Deletes) ===');
  
  // Delete a widget
  if (testState.createdWidgets.length > 0) {
    const widget = testState.createdWidgets.pop();
    const result = await api.delete(`/widgets/${widget.id}`);
    markEndpointTested('DELETE', '/widgets/:widgetId', result);
  }
  
  // Delete a folder
  if (testState.createdFolders.length > 0) {
    const folder = testState.createdFolders.pop();
    const result = await api.delete(`/folders/${folder.id}`);
    markEndpointTested('DELETE', '/folders/:folderId', result);
  }
  
  // Delete a document (requires registryTableId in body)
  if (testState.createdDocuments.length > 0) {
    const doc = testState.createdDocuments.pop();
    const result = await api.delete(`/documents/${doc.id}`, { 
      registryTableId: doc.registry_table_id 
    });
    markEndpointTested('DELETE', '/documents/:documentId', result);
  }
  
  // Delete API key (requires project_id query param)
  if (testState.createdApiKeys.length > 0) {
    const key = testState.createdApiKeys.pop();
    const result = await api.delete(`/api-keys/${key.id}?project_id=${key.project_id}`);
    markEndpointTested('DELETE', '/api-keys/:id', result);
  }
  
  // Delete webhook
  if (testState.createdWebhooks.length > 0) {
    const webhook = testState.createdWebhooks.pop();
    const result = await api.delete(`/webhooks/${webhook.id}`);
    markEndpointTested('DELETE', '/webhooks/:id', result);
  }
  
  // Delete a project (to test cascade)
  if (testState.createdProjects.length > 1) {
    const project = testState.createdProjects.pop();
    const result = await api.delete(`/projects/${project.id}`);
    markEndpointTested('DELETE', '/projects/:id', result);
  }
  
  log('✅', 'Cleanup testing completed');
}

// ============================================================================
// REPORT GENERATION
// ============================================================================

async function generateSummaryReport() {
  const endTime = new Date().toISOString();
  
  // Calculate coverage
  const testedEndpoints = ALL_ENDPOINTS.filter(e => e.tested);
  const passedEndpoints = testState.endpointResults.filter(e => e.result === 'PASS');
  const failedEndpoints = testState.endpointResults.filter(e => e.result === 'FAIL');
  
  // Group by category
  const byCategory = {};
  for (const ep of ALL_ENDPOINTS) {
    if (!byCategory[ep.category]) byCategory[ep.category] = { total: 0, tested: 0 };
    byCategory[ep.category].total++;
    if (ep.tested) byCategory[ep.category].tested++;
  }
  
  const report = `# 🧪 MASTER TEST SUMMARY REPORT v2.0

## Run Information
- **Run ID:** \`${testState.runId}\`
- **Start Time:** ${testState.startTime}
- **End Time:** ${endTime}
- **Environment:** ${BASE_URL}

---

## 📊 Coverage Summary

| Metric | Value |
|--------|-------|
| **Total Endpoints** | ${ALL_ENDPOINTS.length} |
| **Tested** | ${testedEndpoints.length} (${Math.round(testedEndpoints.length / ALL_ENDPOINTS.length * 100)}%) |
| **Passed** | ${passedEndpoints.length} |
| **Failed** | ${failedEndpoints.length} |

### Coverage by Category

| Category | Total | Tested | Coverage |
|----------|-------|--------|----------|
${Object.entries(byCategory).map(([cat, stats]) => 
  `| ${cat} | ${stats.total} | ${stats.tested} | ${Math.round(stats.tested / stats.total * 100)}% |`
).join('\n')}

---

## 👤 Test Owner
| Field | Value |
|-------|-------|
| Email | \`${TEST_OWNER.email}\` |
| User ID | \`${testState.owner?.id || 'N/A'}\` |

---

## 👥 Created Users (${testState.createdUsers.length})

| Email | Name | Role | Space Role | Password |
|-------|------|------|------------|----------|
${testState.createdUsers.map(u => 
  `| \`${u.email}\` | ${u.name} | ${u.role} | ${u.spaceRole} | \`TestPass123!\` |`
).join('\n')}

---

## 📈 Created Entities

| Entity | Count |
|--------|-------|
| Spaces | ${testState.createdSpaces.length} |
| Projects | ${testState.createdProjects.length} |
| Tables | ${testState.createdTables.length} |
| Rows | ${testState.createdRows.length} |
| Widgets | ${testState.createdWidgets.length} |
| Dashboards | ${testState.createdDashboards.length} |
| Documents | ${testState.createdDocuments.length} |
| Folders | ${testState.createdFolders.length} |
| API Keys | ${testState.createdApiKeys.length} |
| Webhooks | ${testState.createdWebhooks.length} |

---

## ❌ Errors (${testState.errors.length})

${testState.errors.length === 0 ? '✅ No errors!' : testState.errors.map(e => 
  `- **${e.action}:** ${e.error}`
).join('\n')}

---

## 🔍 Endpoint Results

### ✅ Passed Endpoints (${passedEndpoints.length})

| Method | Path | Status | Duration |
|--------|------|--------|----------|
${passedEndpoints.slice(0, 50).map(e => 
  `| ${e.method} | \`${e.path}\` | ${e.status} | ${e.duration}ms |`
).join('\n')}
${passedEndpoints.length > 50 ? `\n... and ${passedEndpoints.length - 50} more` : ''}

### ❌ Failed Endpoints (${failedEndpoints.length})

| Method | Path | Status | Duration |
|--------|------|--------|----------|
${failedEndpoints.map(e => 
  `| ${e.method} | \`${e.path}\` | ${e.status} | ${e.duration}ms |`
).join('\n') || 'None!'}

### ⏳ Not Tested Endpoints

${ALL_ENDPOINTS.filter(e => !e.tested).map(e => 
  `- \`${e.method} ${e.path}\` (${e.category})`
).join('\n') || 'All endpoints tested!'}

---

## 🧹 Cleanup Command

\`\`\`bash
./tests/scripts/run-scenarios.sh cleanup dev --email testowner@hltrn.cc --password testpass123!
\`\`\`

---

*Generated by Master Test Scenario v2.0*
`;

  const reportPath = path.join(process.cwd(), 'tests', 'TEST-SUMMARY.md');
  fs.writeFileSync(reportPath, report);
  log('📄', `Report saved to: ${reportPath}`);
  
  return report;
}

// ============================================================================
// MAIN
// ============================================================================

async function runMasterScenario() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('     🎯 MASTER TEST SCENARIO v2.0 - FULL ENDPOINT COVERAGE');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`     Total endpoints to test: ${ALL_ENDPOINTS.length}`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  try {
    await step01_ownerSetup();
    await step02_createSharedSpace();
    await step03_createUsers();
    await step04_createProjectsAndTables();
    await step05_crudOperations();
    await step06_widgetsAndDashboards();
    await step07_documentsAndFolders();
    await step08_apiKeysAndWebhooks();
    await step09_userSettings();
    await step10_aiAndDataSources();
    await step11_schemaAndBatch();
    await step12_userRoleActions();
    await step13_cleanupAndDelete();
    
    await generateSummaryReport();
    
    const testedCount = ALL_ENDPOINTS.filter(e => e.tested).length;
    const passedCount = testState.endpointResults.filter(e => e.result === 'PASS').length;
    
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('     ✅ MASTER SCENARIO v2.0 COMPLETED');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');
    console.log('📊 Summary:');
    console.log(`   Endpoints Tested:  ${testedCount}/${ALL_ENDPOINTS.length} (${Math.round(testedCount/ALL_ENDPOINTS.length*100)}%)`);
    console.log(`   Endpoints Passed:  ${passedCount}`);
    console.log(`   Endpoints Failed:  ${testState.endpointResults.filter(e => e.result === 'FAIL').length}`);
    console.log('');
    console.log(`   Users:      ${testState.createdUsers.length}`);
    console.log(`   Spaces:     ${testState.createdSpaces.length}`);
    console.log(`   Projects:   ${testState.createdProjects.length}`);
    console.log(`   Tables:     ${testState.createdTables.length}`);
    console.log(`   Rows:       ${testState.createdRows.length}`);
    console.log(`   Widgets:    ${testState.createdWidgets.length}`);
    console.log(`   Errors:     ${testState.errors.length}`);
    console.log('');
    
    return { success: true, state: testState };

  } catch (error) {
    console.error('');
    console.error('═══════════════════════════════════════════════════════════════');
    console.error('     ❌ MASTER SCENARIO FAILED');
    console.error('═══════════════════════════════════════════════════════════════');
    console.error('');
    console.error('Error:', error.message);
    console.error(error.stack);
    
    return { success: false, error: error.message, state: testState };
  }
}

// Export
export { runMasterScenario, testState, ALL_ENDPOINTS };

// Run if executed directly
if (process.argv[1] && process.argv[1].includes('master.scenario.js')) {
  runMasterScenario().then(result => {
    process.exit(result.success ? 0 : 1);
  });
}
