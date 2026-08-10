import fs from 'fs';
import path from 'path';

/**
 * Database Type Detector
 * Automatically detects database type from connection string or file path
 * Supports: MySQL, PostgreSQL, SQLite
 */
class DatabaseTypeDetector {
  /**
   * Detect database type from connection string or path
   * @param {string} connectionString - File path or connection string
   * @returns {object} { type, config }
   */
  static detect(connectionString) {
    if (!connectionString || typeof connectionString !== 'string') {
      throw new Error('Connection string is required');
    }

    // SQLite: file with .db, .sqlite, .sqlite3 extension
    if (this.isSQLitePath(connectionString)) {
      return {
        type: 'better-sqlite3',
        config: {
          filename: connectionString
        }
      };
    }

    // MySQL: starts with mysql:// or contains :3306
    if (this.isMySQLConnection(connectionString)) {
      const parsed = this.parseConnectionString(connectionString);
      return {
        type: 'mysql2',
        config: {
          host: parsed.host || 'localhost',
          port: parsed.port || 3306,
          database: parsed.database,
          user: parsed.user,
          password: parsed.password
        }
      };
    }

    // PostgreSQL: starts with postgresql:// or contains :5432
    if (this.isPostgreSQLConnection(connectionString)) {
      const parsed = this.parseConnectionString(connectionString);
      return {
        type: 'pg',
        config: {
          host: parsed.host || 'localhost',
          port: parsed.port || 5432,
          database: parsed.database,
          user: parsed.user,
          password: parsed.password
        }
      };
    }

    throw new Error(`Unable to detect database type from: ${connectionString}`);
  }

  /**
   * Check if connection string is SQLite file path
   */
  static isSQLitePath(str) {
    // Check extension
    const ext = path.extname(str).toLowerCase();
    if (['.db', '.sqlite', '.sqlite3'].includes(ext)) {
      return true;
    }

    // Check if file exists
    try {
      if (fs.existsSync(str)) {
        return true;
      }
    } catch (error) {
      // File doesn't exist or no permissions
    }

    return false;
  }

  /**
   * Check if connection string is MySQL
   */
  static isMySQLConnection(str) {
    // Format: mysql://user:pass@host:port/database
    if (str.startsWith('mysql://')) {
      return true;
    }

    // Format: host:3306
    if (str.includes(':3306')) {
      return true;
    }

    return false;
  }

  /**
   * Check if connection string is PostgreSQL
   */
  static isPostgreSQLConnection(str) {
    // Format: postgresql://user:pass@host:port/database
    if (str.startsWith('postgresql://') || str.startsWith('postgres://')) {
      return true;
    }

    // Format: host:5432
    if (str.includes(':5432')) {
      return true;
    }

    return false;
  }

  /**
   * Parse connection string into components
   * Supports formats:
   * - mysql://user:pass@host:port/database
   * - postgresql://user:pass@host:port/database
   * - host:port
   * - host
   */
  static parseConnectionString(str) {
    // URL format: protocol://user:pass@host:port/database
    const urlPattern = /^(mysql|postgresql|postgres):\/\/([^:]+):([^@]+)@([^:/]+):?(\d+)?\/(.+)$/;
    const match = str.match(urlPattern);

    if (match) {
      return {
        type: match[1],
        user: match[2],
        password: match[3],
        host: match[4],
        port: match[5] ? parseInt(match[5]) : null,
        database: match[6]
      };
    }

    // Simple format: host:port
    const simplePattern = /^([^:]+):?(\d+)?$/;
    const simpleMatch = str.match(simplePattern);

    if (simpleMatch) {
      return {
        host: simpleMatch[1],
        port: simpleMatch[2] ? parseInt(simpleMatch[2]) : null
      };
    }

    // Just hostname
    return { host: str };
  }

  /**
   * Validate database configuration
   */
  static validate(config) {
    if (!config || !config.type) {
      throw new Error('Database type is required');
    }

    // SQLite validation
    if (config.type === 'better-sqlite3') {
      if (!config.filename) {
        throw new Error('SQLite filename is required');
      }
      if (!fs.existsSync(config.filename)) {
        throw new Error(`SQLite database file not found: ${config.filename}`);
      }
    }

    // MySQL/PostgreSQL validation
    if (config.type === 'mysql2' || config.type === 'pg') {
      if (!config.database) {
        throw new Error('Database name is required');
      }
      if (!config.user) {
        throw new Error('Database user is required');
      }
    }

    return true;
  }
}

export default DatabaseTypeDetector;
