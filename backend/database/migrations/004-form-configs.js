// Migration: Create system_form_configs table
// Stores JSON configuration for edit/add row forms per table

export async function up(db) {
  console.log('📦 Migration 004: Creating system_form_configs table...');

  await db.run(`
    CREATE TABLE IF NOT EXISTS system_form_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_id INTEGER NOT NULL,
      form_type TEXT NOT NULL DEFAULT 'edit',
      name TEXT,
      config TEXT NOT NULL DEFAULT '{}',
      is_default INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      
      FOREIGN KEY (table_id) REFERENCES tables(id) ON DELETE CASCADE,
      UNIQUE(table_id, form_type, is_default)
    )
  `);

  // Index for fast lookup by table_id
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_form_configs_table 
    ON system_form_configs(table_id, form_type)
  `);

  console.log('✅ Created system_form_configs table');
  
  // Config JSON structure:
  // {
  //   "version": 1,
  //   "layout": "grid" | "columns" | "tabs",
  //   "columns": 2,  // Number of columns in grid layout
  //   "fields": [
  //     {
  //       "id": "column_id",
  //       "columnId": "123",
  //       "label": "Custom Label",  // Override column displayName
  //       "placeholder": "Enter value...",
  //       "helpText": "Description for users",
  //       "width": "full" | "half" | "third" | "quarter",
  //       "row": 0,  // Grid row position
  //       "col": 0,  // Grid column position
  //       "hidden": false,
  //       "readonly": false,
  //       "required": false,
  //       "defaultValue": null,
  //       "validation": {
  //         "min": null,
  //         "max": null,
  //         "pattern": null,
  //         "message": null
  //       },
  //       "conditions": [  // Show/hide based on other fields
  //         { "field": "status", "operator": "equals", "value": "active" }
  //       ]
  //     }
  //   ],
  //   "sections": [  // Optional grouping
  //     {
  //       "id": "section_1",
  //       "title": "Basic Info",
  //       "collapsed": false,
  //       "fields": ["field_id_1", "field_id_2"]
  //     }
  //   ],
  //   "tabs": [  // For tab layout
  //     {
  //       "id": "tab_1", 
  //       "title": "General",
  //       "icon": "📋",
  //       "sections": ["section_1"]
  //     }
  //   ]
  // }
  
  console.log('✅ Migration 004 completed');
}

export async function down(db) {
  console.log('⏮️ Rollback: Dropping system_form_configs table...');
  
  await db.run('DROP INDEX IF EXISTS idx_form_configs_table');
  await db.run('DROP TABLE IF EXISTS system_form_configs');
  
  console.log('✅ Rollback 004 completed');
}
