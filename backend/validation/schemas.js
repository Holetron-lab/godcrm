// backend/validation/schemas.js
// SEC-030: Zod Validation Schemas - ADR-015
// Created: 2026-01-08

import { z } from 'zod';

// ============================================================
// Common validators
// ============================================================

/**
 * Safe string that rejects XSS and common injection patterns
 */
const safeString = z.string()
  .min(1)
  .max(1000)
  .refine(val => !/<script|javascript:|on\w+=/i.test(val), {
    message: 'Potentially unsafe content detected'
  });

/**
 * Safe description - longer string with XSS protection
 */
const safeDescription = z.string()
  .max(1000)
  .refine(val => !/<script|javascript:|on\w+=/i.test(val), {
    message: 'Potentially unsafe content detected'
  })
  .optional();

/**
 * Safe name for entities (spaces, tables, projects, etc.)
 * Rejects HTML tags and special SQL characters
 */
const safeName = z.string()
  .min(1, 'Name is required')
  .max(255, 'Name too long')
  .regex(/^[^<>'";&]+$/, 'Name contains invalid characters');

/**
 * Safe email that rejects SQL injection patterns
 */
const safeEmail = z.string()
  .email('Invalid email format')
  .max(255)
  .refine(val => !/'|"|;|--/.test(val), {
    message: 'Email contains invalid characters'
  });

// ============================================================
// Auth schemas
// ============================================================

export const loginSchema = z.object({
  email: safeEmail,
  password: z.string().min(8, 'Password must be at least 8 characters').max(128)
});

export const registerSchema = z.object({
  email: safeEmail,
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(128)
    .regex(/[A-Z]/, 'Password must contain uppercase letter')
    .regex(/[a-z]/, 'Password must contain lowercase letter')
    .regex(/[0-9]/, 'Password must contain number'),
  name: safeName
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1)
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(8),
  newPassword: z.string()
    .min(8)
    .max(128)
    .regex(/[A-Z]/, 'Password must contain uppercase letter')
    .regex(/[a-z]/, 'Password must contain lowercase letter')
    .regex(/[0-9]/, 'Password must contain number')
});

// ============================================================
// Space/Project schemas
// ============================================================

export const createSpaceSchema = z.object({
  name: safeName,
  description: safeDescription,
  icon: z.string().max(10).optional(),
  type: z.enum(['business', 'personal', 'admin', 'ai'])
});

export const updateSpaceSchema = createSpaceSchema.partial();

export const createProjectSchema = z.object({
  name: safeName,
  description: safeDescription,
  icon: z.string().max(10).optional(),
  spaceId: z.number().int().positive().optional(),
  type: z.string().max(50)
});

export const updateProjectSchema = createProjectSchema.partial();

// ============================================================
// Table schemas
// ============================================================

const columnTypeEnum = z.enum([
  'text', 'number', 'date', 'datetime', 'checkbox',
  'select', 'multiselect', 'relation', 'file',
  'email', 'phone', 'url', 'rating', 'currency',
  'formula', 'rollup', 'json', 'markdown'
]);

const columnSchema = z.object({
  name: safeName,
  displayName: safeName.optional(),
  type: columnTypeEnum,
  isRequired: z.boolean().optional(),
  isVisible: z.boolean().optional(),
  orderIndex: z.number().int().min(0).optional(),
  config: z.record(z.unknown()).optional()
});

export const createColumnSchema = columnSchema;

export const createTableSchema = z.object({
  name: safeName,
  description: safeDescription,
  icon: z.string().max(10).optional(),
  projectId: z.number().int().positive(),
  columns: z.array(columnSchema).optional()
});

export const updateTableSchema = z.object({
  name: safeName.optional(),
  description: safeDescription,
  icon: z.string().max(10).optional()
});

// ============================================================
// Row schemas
// ============================================================

export const createRowSchema = z.object({
  data: z.record(z.unknown())
});

export const updateRowSchema = z.object({
  data: z.record(z.unknown())
});

export const batchCreateRowsSchema = z.object({
  rows: z.array(z.object({
    data: z.record(z.unknown())
  })).min(1).max(1000)
});

export const batchUpdateRowsSchema = z.object({
  updates: z.array(z.object({
    id: z.number().int().positive(),
    data: z.record(z.unknown())
  })).min(1).max(1000)
});

export const batchDeleteRowsSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(1000)
});

// ============================================================
// Widget schemas
// ============================================================

export const createWidgetSchema = z.object({
  dashboardId: z.number().int().positive(),
  widgetType: z.enum(['preset', 'custom']),
  presetName: z.string().max(100).optional(),
  code: z.string().max(100000).optional(),
  title: safeName,
  description: z.string().max(500).optional(),
  icon: z.string().max(10).optional(),
  config: z.record(z.unknown()).optional(),
  position: z.object({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    w: z.number().int().min(1),
    h: z.number().int().min(1)
  }).optional()
});

export const updateWidgetSchema = createWidgetSchema.partial().omit({ dashboardId: true });

// ============================================================
// API Key schemas
// ============================================================

export const createApiKeySchema = z.object({
  name: safeName,
  scopes: z.array(z.string().max(50)).optional(),
  expiresAt: z.string().datetime().optional(),
  rateLimit: z.number().int().min(1).max(10000).optional()
});

// ============================================================
// File schemas
// ============================================================

export const createFolderSchema = z.object({
  name: safeName,
  parentId: z.number().int().positive().optional(),
  projectId: z.number().int().positive()
});

export const updateFolderSchema = z.object({
  name: safeName.optional(),
  parentId: z.number().int().positive().nullable().optional()
});

// ============================================================
// Dashboard schemas
// ============================================================

export const createDashboardSchema = z.object({
  name: safeName,
  description: safeDescription,
  projectId: z.number().int().positive(),
  layout: z.record(z.unknown()).optional()
});

export const updateDashboardSchema = createDashboardSchema.partial().omit({ projectId: true });

// ============================================================
// Chat schemas
// ============================================================

// Ticket #41154 / ADR-091: Unified conversation type enum
export const conversationTypeEnum = z.enum(['chat', 'task', 'row']);

export const createConversationSchema = z.object({
  title: z.string().max(200).optional(),
  type: conversationTypeEnum.default('chat'),
  participant_ids: z.array(z.number().int().positive()).optional(),
  space_id: z.number().int().positive().optional(),
  lab_id: z.string().max(255).optional().nullable(),
  settings: z.record(z.unknown()).optional(),
  bound_table_id: z.number().int().positive().optional().nullable(),
  bound_row_id: z.number().int().positive().optional().nullable(),
  sub_agents: z.array(z.union([
    z.number().int().positive(),
    z.object({
      row_id: z.number().int().positive(),
      response_mode: z.enum(['always', 'topic_only', 'mention_only']).optional()
    })
  ])).optional()
});

export const createMessageSchema = z.object({
  content: z.string().min(1).max(50000),
  threadId: z.number().int().positive()
});

export const createThreadSchema = z.object({
  title: safeName.optional(),
  participants: z.array(z.number().int().positive()).optional()
});

// ============================================================
// AI Conversation schemas (ADR-043)
// ============================================================

export const createAIConversationSchema = z.object({
  title: z.string().max(200).optional(),
  type: conversationTypeEnum.default('chat'),
  agentId: z.number().int().positive().optional(),
  agentName: z.string().max(100).optional(),
  spaceId: z.number().int().positive().optional(),
  labId: z.string().max(255).optional().nullable(),
  agentTableId: z.number().int().positive().optional().nullable()
});

export const aiRunSchema = z.object({
  message: z.string().min(1).max(100000),
  agentId: z.number().int().positive(),
  spaceId: z.number().int().positive().optional(),
  modelId: z.number().int().positive().optional(),
  conversationId: z.number().int().positive().optional(),
  systemPromptPrefix: z.string().max(10000).optional(),
  labId: z.string().max(255).optional().nullable(),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string()
  })).optional()
});

// ============================================================
// ID parameter schemas
// ============================================================

export const idParamSchema = z.object({
  id: z.string().regex(/^\d+$/).transform(Number)
});

export const tableIdParamSchema = z.object({
  tableId: z.string().regex(/^\d+$/).transform(Number)
});

// ============================================================
// Query parameter schemas
// ============================================================

export const paginationQuerySchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).optional().default('1'),
  limit: z.string().regex(/^\d+$/).transform(Number).optional().default('50'),
  sortBy: z.string().max(100).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional().default('asc')
});

export const searchQuerySchema = z.object({
  q: z.string().max(500).optional(),
  filter: z.string().max(2000).optional()
});
