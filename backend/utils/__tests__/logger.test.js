// backend/utils/__tests__/logger.test.js
// LOG-001: Pino Logger Tests - ADR-015
import { describe, it, expect } from 'vitest';

describe('Logger', () => {
  it('should export logger with required methods', async () => {
    const { logger } = await import('../logger.js');
    
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.trace).toBe('function');
    expect(typeof logger.fatal).toBe('function');
  });

  it('should have child loggers for modules', async () => {
    const { dbLogger, authLogger, apiLogger, webhookLogger, fileLogger } = await import('../logger.js');
    
    expect(dbLogger).toBeDefined();
    expect(typeof dbLogger.info).toBe('function');
    
    expect(authLogger).toBeDefined();
    expect(typeof authLogger.info).toBe('function');
    
    expect(apiLogger).toBeDefined();
    expect(typeof apiLogger.info).toBe('function');
    
    expect(webhookLogger).toBeDefined();
    expect(typeof webhookLogger.info).toBe('function');
    
    expect(fileLogger).toBeDefined();
    expect(typeof fileLogger.info).toBe('function');
  });

  it('should export request logger middleware', async () => {
    const { requestLogger } = await import('../logger.js');
    
    expect(typeof requestLogger).toBe('function');
    // Express middleware signature: (req, res, next)
    expect(requestLogger.length).toBe(3);
  });

  it('should create child logger with context', async () => {
    const { logger } = await import('../logger.js');
    
    const childLogger = logger.child({ module: 'test', requestId: '123' });
    
    expect(childLogger).toBeDefined();
    expect(typeof childLogger.info).toBe('function');
  });

  it('should handle various log levels', async () => {
    const { logger } = await import('../logger.js');
    
    // These should not throw
    expect(() => logger.trace('trace message')).not.toThrow();
    expect(() => logger.debug('debug message')).not.toThrow();
    expect(() => logger.info('info message')).not.toThrow();
    expect(() => logger.warn('warn message')).not.toThrow();
    expect(() => logger.error('error message')).not.toThrow();
  });

  it('should support object logging', async () => {
    const { logger } = await import('../logger.js');
    
    expect(() => logger.info({ userId: 1, action: 'test' }, 'User action')).not.toThrow();
    expect(() => logger.error({ err: new Error('test error') }, 'Error occurred')).not.toThrow();
  });
});
