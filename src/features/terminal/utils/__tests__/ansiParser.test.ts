/**
 * ANSI Parser Tests - ADR-076
 */

import { describe, it, expect } from 'vitest';
import { parseAnsi, stripAnsi } from '../ansiParser';

describe('ansiParser', () => {
  describe('parseAnsi', () => {
    it('handles plain text', () => {
      const result = parseAnsi('hello world');
      expect(result).toEqual([{ text: 'hello world', className: '' }]);
    });

    it('handles empty string', () => {
      const result = parseAnsi('');
      expect(result).toEqual([{ text: '', className: '' }]);
    });

    it('parses red text', () => {
      const result = parseAnsi('\x1b[31mERROR\x1b[0m');
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('ERROR');
      expect(result[0].className).toContain('text-red-400');
    });

    it('parses green text', () => {
      const result = parseAnsi('\x1b[32mPASSED\x1b[0m');
      expect(result[0].className).toContain('text-green-400');
    });

    it('parses bold text', () => {
      const result = parseAnsi('\x1b[1mBOLD\x1b[0m');
      expect(result[0].className).toContain('font-bold');
    });

    it('parses combined bold + color', () => {
      const result = parseAnsi('\x1b[1;31mBOLD RED\x1b[0m');
      expect(result[0].className).toContain('font-bold');
      expect(result[0].className).toContain('text-red-400');
    });

    it('handles reset code', () => {
      const result = parseAnsi('\x1b[31mred\x1b[0m normal');
      expect(result).toHaveLength(2);
      expect(result[0].className).toContain('text-red-400');
      expect(result[1].className).toBe('');
    });

    it('handles mixed styled and plain text', () => {
      const result = parseAnsi('start \x1b[32mgreen\x1b[0m end');
      expect(result).toHaveLength(3);
      expect(result[0].text).toBe('start ');
      expect(result[1].text).toBe('green');
      expect(result[1].className).toContain('text-green-400');
      expect(result[2].text).toBe(' end');
    });

    it('filters out empty spans', () => {
      const result = parseAnsi('\x1b[31m\x1b[0m');
      expect(result).toHaveLength(0);
    });
  });

  describe('stripAnsi', () => {
    it('strips all escape codes', () => {
      expect(stripAnsi('\x1b[31mERROR\x1b[0m: fail')).toBe('ERROR: fail');
    });

    it('handles plain text', () => {
      expect(stripAnsi('hello')).toBe('hello');
    });

    it('strips cursor codes', () => {
      expect(stripAnsi('\x1b[2Jhello\x1b[H')).toBe('hello');
    });
  });
});
