// LOG-001: Frontend Logger — ADR-031
// Unified logging with configurable levels
// Created: 2026-01-22

/**
 * Log levels from most verbose to least
 * debug(0) < info(1) < warn(2) < error(3) < silent(4)
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

/**
 * Logger interface matching backend Pino API subset
 */
export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

/**
 * Create a logger with specified minimum log level
 * Messages below this level will be silently ignored
 * 
 * @param minLevel - Minimum level to log (default: from env or 'debug' in dev, 'error' in prod)
 * @returns Logger instance with debug/info/warn/error methods
 * 
 * @example
 * const logger = createLogger('warn');
 * logger.debug('ignored'); // Not logged
 * logger.warn('shown');    // Logged
 */
export function createLogger(minLevel: LogLevel): Logger {
  const minLevelNum = LOG_LEVELS[minLevel];

  const shouldLog = (level: LogLevel): boolean => {
    return LOG_LEVELS[level] >= minLevelNum;
  };

  return {
    debug: (...args: unknown[]) => {
      if (shouldLog('debug')) {
        console.log('[DEBUG]', ...args);
      }
    },
    info: (...args: unknown[]) => {
      if (shouldLog('info')) {
        console.info('[INFO]', ...args);
      }
    },
    warn: (...args: unknown[]) => {
      if (shouldLog('warn')) {
        console.warn('[WARN]', ...args);
      }
    },
    error: (...args: unknown[]) => {
      if (shouldLog('error')) {
        console.error('[ERROR]', ...args);
      }
    },
  };
}

/**
 * Determine default log level from environment
 * - VITE_LOG_LEVEL env variable takes priority
 * - Production defaults to 'error' (only errors shown)
 * - Development defaults to 'debug' (everything shown)
 */
function getDefaultLogLevel(): LogLevel {
  // Check for explicit env variable
  const envLevel = import.meta.env.VITE_LOG_LEVEL as LogLevel | undefined;
  if (envLevel && envLevel in LOG_LEVELS) {
    return envLevel;
  }

  // Production: only errors, Development: everything
  return import.meta.env.PROD ? 'error' : 'debug';
}

/**
 * Default logger instance
 * Uses environment-based log level
 * 
 * @example
 * import { logger } from '@/shared/utils/logger';
 * 
 * logger.debug('Debugging info:', data);  // Only in dev
 * logger.info('User logged in:', userId); // Only in dev
 * logger.warn('Deprecated API used');     // In dev, if LOG_LEVEL <= warn
 * logger.error('Critical failure:', err); // Always (unless silent)
 */
export const logger: Logger = createLogger(getDefaultLogLevel());

// Re-export for convenience
export default logger;
