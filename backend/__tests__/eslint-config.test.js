/**
 * ESLint Backend Configuration Test
 * ADR-037: Validates that no-console rule is configured
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('ESLint Backend Configuration', () => {
  const configPath = path.resolve(__dirname, '../.eslintrc.cjs');

  describe('Given backend ESLint config', () => {
    it('When checking config file, then it should exist', () => {
      expect(fs.existsSync(configPath)).toBe(true);
    });

    it('When loading config, then it should have no-console rule', () => {
      // Clear require cache to get fresh config
      delete require.cache[require.resolve(configPath)];
      const config = require(configPath);
      
      expect(config.rules).toBeDefined();
      expect(config.rules['no-console']).toBeDefined();
    });

    it('When checking no-console rule, then it should be configured as warn', () => {
      delete require.cache[require.resolve(configPath)];
      const config = require(configPath);
      
      const noConsoleRule = config.rules['no-console'];
      // Rule can be ['warn', {...}] or 'warn'
      const severity = Array.isArray(noConsoleRule) ? noConsoleRule[0] : noConsoleRule;
      expect(severity).toBe('warn');
    });

    it('When checking no-console rule, then it should allow console.warn and console.error', () => {
      delete require.cache[require.resolve(configPath)];
      const config = require(configPath);
      
      const noConsoleRule = config.rules['no-console'];
      expect(Array.isArray(noConsoleRule)).toBe(true);
      expect(noConsoleRule[1].allow).toContain('warn');
      expect(noConsoleRule[1].allow).toContain('error');
    });

    it('When checking env, then it should be configured for Node.js', () => {
      delete require.cache[require.resolve(configPath)];
      const config = require(configPath);
      
      expect(config.env.node).toBe(true);
    });
  });
});
