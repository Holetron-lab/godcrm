import { describe, it, expect } from 'vitest';
import { isAuthError, isAuthErrorBlock } from '../agent-job/auth-error.js';

describe('CLI auth error versus diagnostic response', () => {
  it.each([
    'Подтвердил обе причины на staging:\n\n- WebM отклоняется: работает старый backend.\n- Текст не распознаётся: Whisper возвращает `401 invalid_api_key`.\nНужно исправить ключ оператора.',
    'Нашёл причину: фильтр скрывает ответы, содержащие authentication_error.',
    'The log says "Failed to authenticate. API Error: 401 Invalid authentication credentials". Update the staging credential.',
    'Whisper reports OAuth token expired; this is not the running agent.',
    'Провайдер вернул {"error":{"type":"authentication_error"}}; проверьте настройки.',
  ])('preserves diagnostic text: %s', (text) => {
    expect(isAuthError(text)).toBe(false);
    expect(isAuthErrorBlock({ type: 'text', text })).toBe(false);
    expect(isAuthErrorBlock({ type: 'thinking', thinking: text })).toBe(false);
  });

  it.each([
    'Failed to authenticate. API Error: 401 Invalid authentication credentials',
    'Invalid authentication credentials',
    'authentication_error: OAuth token expired',
    'invalid_api_key',
    'OAuth token expired',
    'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"Invalid authentication credentials"}}',
    '{"type":"error","error":{"type":"authentication_error","message":"Invalid authentication credentials"}}',
  ])('still recognizes raw CLI failure: %s', (text) => {
    expect(isAuthError(`  ${text}\n`)).toBe(true);
    expect(isAuthErrorBlock({ type: 'text', text })).toBe(true);
  });
});
