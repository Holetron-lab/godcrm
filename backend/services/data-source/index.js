/**
 * DataSourceService — barrel re-export
 *
 * Maintains backward compatibility: the default export is still an instance
 * of a class with the same method signatures as the original monolith.
 */

import { VALID_TYPES, get, list, create, update, delete_, testConnection, validateConfig, getDecryptedPassword } from './crud.js';
import { listTables, listTableColumns, queryTable, queryRowById } from './queries.js';
import { createDataSourcesProject, addToDatabasesTable, importExternalTables } from './import.js';

class DataSourceService {
  static VALID_TYPES = VALID_TYPES;

  async create(params)                          { return create(params, this); }
  async get(id)                                 { return get(id); }
  async list(workspaceId)                       { return list(workspaceId); }
  async update(id, updates)                     { return update(id, updates); }
  async delete(id)                              { return delete_(id); }
  async testConnection(id)                      { return testConnection(id); }
  validateConfig(config)                        { return validateConfig(config); }
  getDecryptedPassword(dataSource)              { return getDecryptedPassword(dataSource); }
  async listTables(id)                          { return listTables(id); }
  async listTableColumns(id, tableName)         { return listTableColumns(id, tableName); }
  async queryTable(id, tableName, options)       { return queryTable(id, tableName, options); }
  async queryRowById(id, tableName, rowId)       { return queryRowById(id, tableName, rowId); }
  async createDataSourcesProject(spaceId, userId) { return createDataSourcesProject(spaceId, userId); }
  async addToDatabasesTable(tableId, data)       { return addToDatabasesTable(tableId, data); }
  async importExternalTables(dataSourceId, projectId) { return importExternalTables(dataSourceId, projectId); }
}

export default DataSourceService;
