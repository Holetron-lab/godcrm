import { describe, it, expect } from 'vitest';
import { parseForwardedMessage } from '../parseForwardedMessage';

describe('parseForwardedMessage', () => {
  describe('detection', () => {
    it('should return null for regular messages', () => {
      expect(parseForwardedMessage('Hello, world!')).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(parseForwardedMessage('')).toBeNull();
    });

    it('should return null for messages with partial prefix', () => {
      expect(parseForwardedMessage('--- Переслано ---')).toBeNull();
    });

    it('should detect forwarded message with timestamp', () => {
      const text =
        '--- Переслано от AgentAlpha (03.03.2026, 12:00:00) ---\nHello from forwarded\n--- конец пересланного сообщения ---';
      expect(parseForwardedMessage(text)).not.toBeNull();
    });

    it('should detect forwarded message without timestamp', () => {
      const text = '--- Переслано от assistant ---\nContent here\n--- конец пересланного сообщения ---';
      expect(parseForwardedMessage(text)).not.toBeNull();
    });

    it('should detect forwarded message without footer', () => {
      const text = '--- Переслано от AgentBeta (03.03.2026) ---\nContent here';
      expect(parseForwardedMessage(text)).not.toBeNull();
    });
  });

  describe('parsing', () => {
    it('should parse sender name correctly', () => {
      const text =
        '--- Переслано от AgentAlpha (03.03.2026, 12:00:00) ---\nHello from forwarded\n--- конец пересланного сообщения ---';
      const result = parseForwardedMessage(text);
      expect(result?.senderName).toBe('AgentAlpha');
    });

    it('should parse timestamp correctly', () => {
      const text =
        '--- Переслано от AgentAlpha (03.03.2026, 12:00:00) ---\nHello from forwarded\n--- конец пересланного сообщения ---';
      const result = parseForwardedMessage(text);
      expect(result?.timestamp).toBe('03.03.2026, 12:00:00');
    });

    it('should parse message content correctly', () => {
      const text =
        '--- Переслано от AgentAlpha (03.03.2026, 12:00:00) ---\nHello from forwarded\n--- конец пересланного сообщения ---';
      const result = parseForwardedMessage(text);
      expect(result?.content).toBe('Hello from forwarded');
    });

    it('should parse multiline content correctly', () => {
      const text =
        '--- Переслано от AgentAlpha (03.03.2026) ---\nLine one\nLine two\nLine three\n--- конец пересланного сообщения ---';
      const result = parseForwardedMessage(text);
      expect(result?.content).toBe('Line one\nLine two\nLine three');
    });

    it('should return null timestamp when none provided', () => {
      const text = '--- Переслано от assistant ---\nContent\n--- конец пересланного сообщения ---';
      const result = parseForwardedMessage(text);
      expect(result?.timestamp).toBeNull();
    });

    it('should handle sender name with spaces', () => {
      const text = '--- Переслано от My Agent Name (01.01.2025) ---\nContent\n--- конец пересланного сообщения ---';
      const result = parseForwardedMessage(text);
      expect(result?.senderName).toBe('My Agent Name');
    });
  });
});
