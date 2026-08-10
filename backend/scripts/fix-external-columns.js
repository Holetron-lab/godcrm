#!/usr/bin/env node

/**
 * Fix external tables that don't have columns in table_columns
 * This script finds all external tables and creates missing columns
 */

import { dbAll, dbRun, dbGet } from '../database/connection.js';
import DataSourceService from '../services/DataSourceService.js';

const dataSourceService = new DataSourceService();

async function fixExternalColumns() {
  console.log('🔍 Finding external tables without columns...');
  
  // Get all external tables
  const externalTables = await dbAll(`
    SELECT id, name, data_source_id, source_table_name 
    FROM universal_tables 
    WHERE data_source_id IS NOT NULL AND source_table_name IS NOT NULL
  `);
  
  console.log(`Found ${externalTables.length} external tables`);
  
  for (const table of externalTables) {
    // Check if table has columns
    const existingColumns = await dbAll(`
      SELECT COUNT(*) as count FROM table_columns WHERE table_id = ?
    `, [table.id]);
    
    const columnCount = existingColumns[0].count;
    
    if (columnCount === 0) {
      console.log(`\n📋 Table "${table.name}" (ID: ${table.id}) has no columns - creating...`);
      
      try {
        // Get columns from external source
        const externalColumns = await dataSourceService.listTableColumns(
          table.data_source_id, 
          table.source_table_name
        );
        
        console.log(`   Found ${externalColumns.length} columns in external source`);
        
        // Create columns
        for (let i = 0; i < externalColumns.length; i++) {
          const col = externalColumns[i];
          
          // Map external type to internal type
          let internalType = 'text';
          if (col.type.includes('int') || col.type.includes('decimal') || col.type.includes('float')) {
            internalType = 'number';
          } else if (col.type.includes('date') || col.type.includes('time')) {
            internalType = 'date';
          } else if (col.type.includes('bool')) {
            internalType = 'checkbox';
          }
          
          await dbRun(`
            INSERT INTO table_columns (
              table_id,
              column_name,
              display_name,
              type,
              is_required,
              order_index,
              is_visible,
              config,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
          `, [
            table.id,
            col.name,
            col.name.toUpperCase(),
            internalType,
            0,
            i,
            1,
            JSON.stringify({})
          ]);
          
          console.log(`   ✅ Created column: ${col.name} (${internalType})`);
        }
        
        console.log(`   ✅ Successfully created ${externalColumns.length} columns for "${table.name}"`);
      } catch (error) {
        console.error(`   ❌ Error creating columns for "${table.name}":`, error.message);
      }
    } else {
      console.log(`✓ Table "${table.name}" already has ${columnCount} columns`);
    }
  }
  
  console.log('\n✅ Done!');
  process.exit(0);
}

fixExternalColumns().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});
