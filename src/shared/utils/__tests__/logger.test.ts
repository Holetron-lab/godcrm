// LOG-001: Frontend Logger Tests — ADR-031
// TDD: Test FIRST, then implementation

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Will be created after tests fail (RED → GREEN)
import { logger, createLogger, type LogLevel } from '../logger';

describe('Frontend Logger — ADR-031', () => {
  let consoleSpy: {
    log: ReturnType<typeof vi.spyOn>;
    info: ReturnType<typeof vi.spyOn>;
    warn: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
  };

  beforeEach(() => {
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Given LOG_LEVEL = debug (development)', () => {
    const devLogger = createLogger('debug');

    it('When logger.debug() called, then logs with [DEBUG] prefix', () => {
      devLogger.debug('test message');
      expect(consoleSpy.log).toHaveBeenCalledWith('[DEBUG]', 'test message');
    });

    it('When logger.info() called, then logs with [INFO] prefix', () => {
      devLogger.info('info message');
      expect(consoleSpy.info).toHaveBeenCalledWith('[INFO]', 'info message');
    });

    it('When logger.warn() called, then logs with [WARN] prefix', () => {
      devLogger.warn('warning message');
      expect(consoleSpy.warn).toHaveBeenCalledWith('[WARN]', 'warning message');
    });

    it('When logger.error() called, then logs with [ERROR] prefix', () => {
      devLogger.error('error message');
      expect(consoleSpy.error).toHaveBeenCalledWith('[ERROR]', 'error message');
    });

    it('When logger called with multiple args, then passes all args', () => {
      devLogger.debug('context:', { foo: 'bar' }, 123);
      expect(consoleSpy.log).toHaveBeenCalledWith('[DEBUG]', 'context:', { foo: 'bar' }, 123);
    });
  });

  describe('Given LOG_LEVEL = error (production)', () => {
    const prodLogger = createLogger('error');

    it('When logger.debug() called, then does NOT log', () => {
      prodLogger.debug('should not appear');
      expect(consoleSpy.log).not.toHaveBeenCalled();
    });

    it('When logger.info() called, then does NOT log', () => {
      prodLogger.info('should not appear');
      expect(consoleSpy.info).not.toHaveBeenCalled();
    });

    it('When logger.warn() called, then does NOT log', () => {
      prodLogger.warn('should not appear');
      expect(consoleSpy.warn).not.toHaveBeenCalled();
    });

    it('When logger.error() called, then ALWAYS logs', () => {
      prodLogger.error('critical error');
      expect(consoleSpy.error).toHaveBeenCalledWith('[ERROR]', 'critical error');
    });
  });

  describe('Given LOG_LEVEL = warn', () => {
    const warnLogger = createLogger('warn');

    it('When logger.debug() called, then does NOT log', () => {
      warnLogger.debug('should not appear');
      expect(consoleSpy.log).not.toHaveBeenCalled();
    });

    it('When logger.info() called, then does NOT log', () => {
      warnLogger.info('should not appear');
      expect(consoleSpy.info).not.toHaveBeenCalled();
    });

    it('When logger.warn() called, then logs', () => {
      warnLogger.warn('warning');
      expect(consoleSpy.warn).toHaveBeenCalledWith('[WARN]', 'warning');
    });

    it('When logger.error() called, then logs', () => {
      warnLogger.error('error');
      expect(consoleSpy.error).toHaveBeenCalledWith('[ERROR]', 'error');
    });
  });

  describe('Given LOG_LEVEL = silent', () => {
    const silentLogger = createLogger('silent');

    it('When any log method called, then nothing is logged', () => {
      silentLogger.debug('silent');
      silentLogger.info('silent');
      silentLogger.warn('silent');
      silentLogger.error('silent');

      expect(consoleSpy.log).not.toHaveBeenCalled();
      expect(consoleSpy.info).not.toHaveBeenCalled();
      expect(consoleSpy.warn).not.toHaveBeenCalled();
      expect(consoleSpy.error).not.toHaveBeenCalled();
    });
  });

  describe('Default logger export', () => {
    it('should be defined and have all methods', () => {
      expect(logger).toBeDefined();
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
    });
  });
});
