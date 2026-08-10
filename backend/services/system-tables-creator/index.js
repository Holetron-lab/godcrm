// system-tables-creator/index.js
// Barrel export for SystemTablesCreator

export { createSystemTables, ensureCoreSystemTablesForSpace } from './space-setup.js';
export { createVariablesTable, createPasswordManagerTable, createDatabasesTable, createTicketsModuleTables } from './feature-tables.js';
