// Migration 017: Add MindWorkflow-specific fields to AI Operators table
// Adds integration_key, default_model, supported_models, mindworkflow_config columns

import { dbRun, dbGet, dbAll, isPostgres } from '../connection.js';

/**
 * Run migration to add MindWorkflow fields to AI Operators
 */
export async function runMigration() {
  console.log('📦 Running Migration 017: AI Operators MindWorkflow Fields...');
  
  try {
    if (isPostgres()) {
      // PostgreSQL version
      await runPostgresMigration();
    } else {
      // SQLite version
      await runSQLiteMigration();
    }

    console.log('✅ Migration 017 completed successfully!');
  } catch (error) {
    console.error('❌ Migration 017 failed:', error);
    throw error;
  }
}

/**
 * PostgreSQL migration
 */
async function runPostgresMigration() {
  // Find ALL AI Operators tables
  const aiOperatorsTables = await dbAll(
    "SELECT id FROM universal_tables WHERE name = 'AI Operators'"
  );
  
  if (!aiOperatorsTables || aiOperatorsTables.length === 0) {
    console.log('⚠️  AI Operators tables not found, skipping migration');
    return;
  }
  
  console.log(`Found ${aiOperatorsTables.length} AI Operators tables`);
  
  for (const table of aiOperatorsTables) {
    const tableId = table.id;
    console.log(`Processing AI Operators table ID: ${tableId}`);
    
    // Get current max order_index
    const maxOrderResult = await dbGet(
      'SELECT MAX(order_index) as max_order FROM table_columns WHERE table_id = $1',
      [tableId]
    );
    
    let nextOrder = (maxOrderResult?.max_order || 0) + 1;
    
    // Add MindWorkflow-specific columns
    const columnsToAdd = [
      {
        column_name: 'integration_key',
        display_name: 'Integration Key',
        type: 'text',
        config: JSON.stringify({ 
          icon: '🔑',
          placeholder: 'mindworkflow_api_key',
          description: 'Unique key for MindWorkflow integration'
        })
      },
      {
        column_name: 'default_model',
        display_name: 'Default Model',
        type: 'text',
        config: JSON.stringify({ 
          icon: '🤖',
          placeholder: 'gpt-4o-mini',
          description: 'Default AI model for this operator'
        })
      },
      {
        column_name: 'supported_models',
        display_name: 'Supported Models',
        type: 'long_text',
        config: JSON.stringify({ 
          icon: '📋',
          placeholder: '["gpt-4o-mini", "gpt-4o", "claude-3.5"]',
          description: 'JSON array of supported models'
        })
      },
      {
        column_name: 'mindworkflow_config',
        display_name: 'MindWorkflow Config',
        type: 'long_text',
        config: JSON.stringify({ 
          icon: '⚙️',
          placeholder: '{"endpoint": "https://api.example.com", "version": "v1"}',
          description: 'JSON configuration for MindWorkflow integration'
        })
      }
    ];
    
    for (const column of columnsToAdd) {
      // Check if column already exists
      const existingColumn = await dbGet(
        'SELECT id FROM table_columns WHERE table_id = $1 AND column_name = $2',
        [tableId, column.column_name]
      );
      
      if (existingColumn) {
        console.log(`⚠️  Table ${tableId}: Column ${column.column_name} already exists, skipping`);
        continue;
      }
      
      // Add the column
      await dbRun(`
        INSERT INTO table_columns (
          table_id, column_name, display_name, type, config, 
          width, is_required, order_index, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      `, [
        tableId,
        column.column_name,
        column.display_name,
        column.type,
        column.config,
        200, // width
        0,   // is_required
        nextOrder++
      ]);
      
      console.log(`✅ Table ${tableId}: Added column: ${column.column_name}`);
    }
  }
}

/**
 * SQLite migration
 */
async function runSQLiteMigration() {
  // Find ALL AI Operators tables
  const aiOperatorsTables = await dbAll(
    "SELECT id FROM universal_tables WHERE name = 'AI Operators'"
  );
  
  if (!aiOperatorsTables || aiOperatorsTables.length === 0) {
    console.log('⚠️  AI Operators tables not found, skipping migration');
    return;
  }
  
  console.log(`Found ${aiOperatorsTables.length} AI Operators tables`);
  
  for (const table of aiOperatorsTables) {
    const tableId = table.id;
    console.log(`Processing AI Operators table ID: ${tableId}`);
  
  // Get current max order_index
  const maxOrderResult = await dbGet(
    'SELECT MAX(order_index) as max_order FROM table_columns WHERE table_id = ?',
    [tableId]
  );
  
  let nextOrder = (maxOrderResult?.max_order || 0) + 1;
  
  // Add MindWorkflow-specific columns
  const columnsToAdd = [
    {
      column_name: 'integration_key',
      display_name: 'Integration Key',
      type: 'text',
      config: JSON.stringify({ 
        icon: '🔑',
        placeholder: 'mindworkflow_api_key',
        description: 'Unique key for MindWorkflow integration'
      })
    },
    {
      column_name: 'default_model',
      display_name: 'Default Model',
      type: 'text',
      config: JSON.stringify({ 
        icon: '🤖',
        placeholder: 'gpt-4o-mini',
        description: 'Default AI model for this operator'
      })
    },
    {
      column_name: 'supported_models',
      display_name: 'Supported Models',
      type: 'long_text',
      config: JSON.stringify({ 
        icon: '📋',
        placeholder: '["gpt-4o-mini", "gpt-4o", "claude-3.5"]',
        description: 'JSON array of supported models'
      })
    },
    {
      column_name: 'mindworkflow_config',
      display_name: 'MindWorkflow Config',
      type: 'long_text',
      config: JSON.stringify({ 
        icon: '⚙️',
        placeholder: '{"endpoint": "https://api.example.com", "version": "v1"}',
        description: 'JSON configuration for MindWorkflow integration'
      })
    }
  ];
  
  for (const column of columnsToAdd) {
    // Check if column already exists
    const existingColumn = await dbGet(
      'SELECT id FROM table_columns WHERE table_id = ? AND column_name = ?',
      [tableId, column.column_name]
    );
    
    if (existingColumn) {
      console.log(`⚠️  Column ${column.column_name} already exists, skipping`);
      continue;
    }
    
    // Add the column
    await dbRun(`
      INSERT INTO table_columns (
        table_id, column_name, display_name, type, config, 
        width, is_required, order_index, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `, [
      tableId,
      column.column_name,
      column.display_name,
      column.type,
      column.config,
      200, // width
      0,   // is_required
      nextOrder++
    ]);
    
    console.log(`✅ Added column: ${column.column_name}`);
  }
}

export default { runMigration };