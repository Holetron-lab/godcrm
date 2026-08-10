import knex from 'knex';
import fs from 'fs';
import DatabaseTypeDetector from './DatabaseTypeDetector.js';
import { dbLogger } from '../utils/logger.js';

/**
 * Direct Database Connector
 * Manages direct connections to MySQL, PostgreSQL, and SQLite databases
 */
class DirectDatabaseConnector {
  constructor() {
    this.connections = new Map(); // businessId -> knex instance
  }

  /**
   * Create direct connection to database
   * @param {string} businessId - Unique business identifier
   * @param {object} config - Database configuration
   * @returns {Promise<object>} Knex instance
   */
  async connect(businessId, config) {
    // Validate config
    DatabaseTypeDetector.validate(config);

    const knexConfig = {
      client: config.type,
      connection: {}
    };

    // SQLite configuration
    if (config.type === 'better-sqlite3') {
      // Check file exists
      if (!fs.existsSync(config.filename)) {
        throw new Error(`SQLite database file not found: ${config.filename}`);
      }

      // Check read permissions
      try {
        fs.accessSync(config.filename, fs.constants.R_OK);
      } catch (error) {
        throw new Error(`No read permission for: ${config.filename}`);
      }

      knexConfig.connection = {
        filename: config.filename
      };
      knexConfig.useNullAsDefault = true;
    }
    // MySQL configuration
    else if (config.type === 'mysql2') {
      knexConfig.connection = {
        host: config.host || 'localhost',
        port: config.port || 3306,
        database: config.database,
        user: config.user,
        password: config.password,
        charset: 'utf8mb4'
      };
      knexConfig.pool = {
        min: 2,
        max: 10,
        acquireTimeoutMillis: 30000
      };
    }
    // PostgreSQL configuration
    else if (config.type === 'pg') {
      knexConfig.connection = {
        host: config.host || 'localhost',
        port: config.port || 5432,
        database: config.database,
        user: config.user,
        password: config.password
      };
      knexConfig.pool = {
        min: 2,
        max: 10
      };
    }
    else {
      throw new Error(`Unsupported database type: ${config.type}`);
    }

    // Create Knex instance
    const db = knex(knexConfig);

    // Test connection
    try {
      await db.raw('SELECT 1');
      this.connections.set(businessId, db);
      dbLogger.info({ type: config.type, businessId }, 'DirectDB: Connected to database');
      return db;
    } catch (error) {
      dbLogger.error({ err: error }, 'DirectDB: Connection failed');
      await db.destroy(); // Cleanup
      throw new Error(`Connection failed: ${error.message}`);
    }
  }

  /**
   * Auto-connect: detect database type and connect
   * @param {string} businessId
   * @param {string} pathOrHost - File path or connection string
   * @param {object} credentials - Optional { database, user, password }
   */
  async autoConnect(businessId, pathOrHost, credentials = {}) {
    const detected = DatabaseTypeDetector.detect(pathOrHost);
    
    const config = {
      type: detected.type,
      ...detected.config,
      ...credentials
    };

    return await this.connect(businessId, config);
  }

  /**
   * Get active connection
   */
  getConnection(businessId) {
    const connection = this.connections.get(businessId);
    if (!connection) {
      throw new Error(`No active connection for business: ${businessId}`);
    }
    return connection;
  }

  /**
   * Check if connection exists
   */
  hasConnection(businessId) {
    return this.connections.has(businessId);
  }

  /**
   * Disconnect and cleanup
   */
  async disconnect(businessId) {
    const db = this.connections.get(businessId);
    if (db) {
      await db.destroy();
      this.connections.delete(businessId);
      dbLogger.info({ businessId }, 'DirectDB: Disconnected');
      return true;
    }
    return false;
  }

  /**
   * Disconnect all connections
   */
  async disconnectAll() {
    const promises = [];
    for (const [businessId, db] of this.connections.entries()) {
      promises.push(db.destroy());
    }
    await Promise.all(promises);
    this.connections.clear();
    dbLogger.info('DirectDB: All connections closed');
  }

  /**
   * Test connection without persisting
   */
  async testConnection(config) {
    try {
      const testId = `test_${Date.now()}`;
      await this.connect(testId, config);
      
      const db = this.getConnection(testId);
      
      // Get database version
      let version = 'unknown';
      if (config.type === 'mysql2') {
        const result = await db.raw('SELECT VERSION() as version');
        version = result[0][0].version;
      } else if (config.type === 'pg') {
        const result = await db.raw('SELECT version()');
        version = result.rows[0].version.split(' ')[0] + ' ' + result.rows[0].version.split(' ')[1];
      } else if (config.type === 'better-sqlite3') {
        const result = await db.raw('SELECT sqlite_version() as version');
        version = 'SQLite ' + result[0].version;
      }
      
      await this.disconnect(testId);
      
      return { 
        success: true, 
        message: 'Database connection successful',
        version: version,
        type: config.type
      };
    } catch (error) {
      return { 
        success: false, 
        message: error.message,
        code: error.code
      };
    }
  }

  /**
   * Get database information
   */
  async getDatabaseInfo(businessId) {
    const db = this.getConnection(businessId);
    const config = db.client.config;
    
    const info = {
      type: config.client,
      connected: true
    };

    if (config.client === 'better-sqlite3') {
      info.file = config.connection.filename;
    } else {
      info.host = config.connection.host;
      info.port = config.connection.port;
      info.database = config.connection.database;
      info.user = config.connection.user;
    }

    return info;
  }

  /**
   * Execute raw query
   */
  async query(businessId, sql, params = []) {
    const db = this.getConnection(businessId);
    try {
      const result = await db.raw(sql, params);
      return result;
    } catch (error) {
      dbLogger.error({ err: error, businessId }, 'DirectDB: Query failed');
      throw error;
    }
  }

  /**
   * Get all tables in database
   */
  async getTables(businessId) {
    const db = this.getConnection(businessId);
    const config = db.client.config;

    let tables = [];

    if (config.client === 'mysql2') {
      const result = await db.raw('SHOW TABLES');
      tables = result[0].map(row => Object.values(row)[0]);
    } else if (config.client === 'pg') {
      const result = await db.raw(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
      `);
      tables = result.rows.map(row => row.table_name);
    } else if (config.client === 'better-sqlite3') {
      const result = await db.raw(`
        SELECT name 
        FROM sqlite_master 
        WHERE type='table' 
        AND name NOT LIKE 'sqlite_%'
      `);
      tables = result.map(row => row.name);
    }

    return tables;
  }

  /**
   * Get table schema
   */
  async getTableSchema(businessId, tableName) {
    const db = this.getConnection(businessId);
    const config = db.client.config;

    let columns = [];

    if (config.client === 'mysql2') {
      const result = await db.raw(`DESCRIBE ${tableName}`);
      columns = result[0].map(col => ({
        name: col.Field,
        type: col.Type,
        nullable: col.Null === 'YES',
        key: col.Key,
        default: col.Default
      }));
    } else if (config.client === 'pg') {
      const result = await db.raw(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = ?
      `, [tableName]);
      columns = result.rows.map(col => ({
        name: col.column_name,
        type: col.data_type,
        nullable: col.is_nullable === 'YES',
        default: col.column_default
      }));
    } else if (config.client === 'better-sqlite3') {
      const result = await db.raw(`PRAGMA table_info(${tableName})`);
      columns = result.map(col => ({
        name: col.name,
        type: col.type,
        nullable: col.notnull === 0,
        key: col.pk ? 'PRI' : '',
        default: col.dflt_value
      }));
    }

    return columns;
  }
}

// Singleton instance
const connector = new DirectDatabaseConnector();

export default connector;
