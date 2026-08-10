/**
 * Dashboard & Widget tool definitions.
 */

export const DASHBOARD_TOOLS = [
  // === DASHBOARD TOOLS ===
  {
    type: 'function',
    function: {
      name: 'create_dashboard',
      description: 'Create a new dashboard for a project or space (exactly one parent — pass project_id OR space_id, not both)',
      parameters: {
        type: 'object',
        properties: {
          project_id: {
            type: 'number',
            description: 'Project ID (mutually exclusive with space_id)'
          },
          space_id: {
            type: 'number',
            description: 'Space ID (mutually exclusive with project_id) — use this for admin/system dashboards'
          },
          name: {
            type: 'string',
            description: 'Dashboard name'
          },
          description: {
            type: 'string',
            description: 'Dashboard description'
          }
        },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_dashboard_widgets',
      description: 'Get all widgets on a dashboard',
      parameters: {
        type: 'object',
        properties: {
          dashboard_id: {
            type: 'number',
            description: 'Dashboard ID'
          }
        },
        required: ['dashboard_id']
      }
    }
  },

  // === WIDGET TOOLS ===
  {
    type: 'function',
    function: {
      name: 'create_widget',
      description: 'Create a new widget on a dashboard',
      parameters: {
        type: 'object',
        properties: {
          dashboard_id: {
            type: 'number',
            description: 'Dashboard ID where widget will be placed'
          },
          title: {
            type: 'string',
            description: 'Widget title'
          },
          widget_type: {
            type: 'string',
            enum: ['preset', 'custom'],
            description: 'Widget type'
          },
          preset_type: {
            type: 'string',
            enum: ['stat-card', 'chart-bar', 'chart-line', 'chart-pie', 'table-mini', 'recent-items', 'progress'],
            description: 'Type of preset widget'
          },
          config: {
            type: 'object',
            description: 'Widget configuration including table_id, columns to display, etc.'
          },
          position: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              w: { type: 'number' },
              h: { type: 'number' }
            }
          }
        },
        required: ['dashboard_id', 'title', 'widget_type']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_widget',
      description: 'Update a dashboard widget — title, config, or position.',
      parameters: {
        type: 'object',
        properties: {
          widget_id: { type: 'number', description: 'ID of the widget to update' },
          title: { type: 'string', description: 'New widget title' },
          config: { type: 'object', description: 'New widget configuration' },
          position: {
            type: 'object',
            properties: {
              x: { type: 'number' }, y: { type: 'number' },
              w: { type: 'number' }, h: { type: 'number' }
            },
            description: 'New position/size'
          }
        },
        required: ['widget_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_widget',
      description: 'Delete a widget from a dashboard.',
      parameters: {
        type: 'object',
        properties: {
          widget_id: { type: 'number', description: 'ID of the widget to delete' }
        },
        required: ['widget_id']
      }
    }
  }
];
