/**
 * ADR-036: Swagger/OpenAPI Configuration
 * Auto-generate API documentation from JSDoc annotations in routes
 * 
 * @see /docs/architecture/ADR-036-API-SOURCE-OF-TRUTH.md
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * swagger-jsdoc configuration
 * Scans routes/v3/*.js for @swagger annotations
 */
export const swaggerOptions = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'GOD CRM API v3',
      version: '0.003.001',
      description: 'Auto-generated from source code. GOD CRM — Universal Workspace Management System.',
      contact: {
        name: 'API Support',
        url: 'https://crm.hltrn.cc'
      },
      license: {
        name: 'Private',
        url: 'https://crm.hltrn.cc'
      }
    },
    servers: [
      {
        url: '/api/v3',
        description: 'API v3'
      }
    ],
    tags: [
      { name: 'Auth', description: 'Authentication and authorization' },
      { name: 'Spaces', description: 'Workspaces management' },
      { name: 'Projects', description: 'Projects within spaces' },
      { name: 'Tables', description: 'Tables (data containers)' },
      { name: 'Columns', description: 'Table columns/fields' },
      { name: 'Rows', description: 'Table rows (data records)' },
      { name: 'AI', description: 'AI Agents and vector search' },
      { name: 'Chat', description: 'Chat and messaging' },
      { name: 'Documents', description: 'Documents module' },
      { name: 'Files', description: 'File uploads and management' },
      { name: 'DataSources', description: 'External database connections' },
      { name: 'Webhooks', description: 'Webhook integrations' },
      { name: 'System', description: 'System configuration' },
      { name: 'UserSettings', description: 'User preferences' }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT token obtained from /auth/login'
        }
      },
      schemas: {
        // Standard API Response
        ApiResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              description: 'Whether the request was successful'
            },
            data: {
              type: 'object',
              description: 'Response payload'
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
              description: 'Response timestamp'
            }
          },
          required: ['success']
        },
        
        // Error Response
        Error: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false
            },
            error: {
              type: 'object',
              properties: {
                code: {
                  type: 'string',
                  description: 'Error code'
                },
                message: {
                  type: 'string',
                  description: 'Human-readable error message'
                }
              }
            },
            timestamp: {
              type: 'string',
              format: 'date-time'
            }
          }
        },
        
        // Space Schema
        Space: {
          type: 'object',
          properties: {
            id: {
              type: 'integer',
              description: 'Unique space ID'
            },
            name: {
              type: 'string',
              description: 'Space name'
            },
            slug: {
              type: 'string',
              description: 'URL-friendly slug'
            },
            description: {
              type: 'string',
              nullable: true
            },
            icon: {
              type: 'string',
              nullable: true
            },
            type: {
              type: 'string',
              enum: ['personal', 'business', 'ai', 'custom'],
              description: 'Space type'
            },
            owner_id: {
              type: 'integer',
              description: 'Owner user ID'
            },
            access_control: {
              type: 'string',
              enum: ['roles', 'members'],
              default: 'roles'
            },
            created_at: {
              type: 'string',
              format: 'date-time'
            },
            updated_at: {
              type: 'string',
              format: 'date-time'
            }
          },
          required: ['id', 'name', 'type', 'owner_id']
        },
        
        // Table Schema
        Table: {
          type: 'object',
          properties: {
            id: {
              type: 'integer',
              description: 'Unique table ID'
            },
            project_id: {
              type: 'integer',
              description: 'Parent project ID'
            },
            name: {
              type: 'string',
              description: 'Table name'
            },
            slug: {
              type: 'string',
              description: 'URL-friendly slug'
            },
            description: {
              type: 'string',
              nullable: true
            },
            icon: {
              type: 'string',
              nullable: true
            },
            created_at: {
              type: 'string',
              format: 'date-time'
            },
            updated_at: {
              type: 'string',
              format: 'date-time'
            }
          },
          required: ['id', 'project_id', 'name']
        },
        
        // User Schema (minimal)
        User: {
          type: 'object',
          properties: {
            id: {
              type: 'integer'
            },
            email: {
              type: 'string',
              format: 'email'
            },
            name: {
              type: 'string'
            },
            role: {
              type: 'string',
              enum: ['admin', 'user', 'viewer']
            },
            avatar: {
              type: 'string',
              nullable: true
            }
          },
          required: ['id', 'email', 'name', 'role']
        },
        
        // AI Agent Schema
        AIAgent: {
          type: 'object',
          properties: {
            id: {
              type: 'integer'
            },
            name: {
              type: 'string'
            },
            system_prompt: {
              type: 'string'
            },
            model: {
              type: 'string',
              example: 'gpt-4o'
            },
            tools: {
              type: 'array',
              items: {
                type: 'object'
              }
            }
          }
        }
      }
    },
    security: [{ bearerAuth: [] }]
  },
  apis: [
    path.join(__dirname, 'routes/v3/*.js')
  ]
};
