import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { aiChat } from '../modules/aiChat';

function flatten(value: object, prefix = 'aiChat'): Record<string, string> {
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) =>
    typeof item === 'string' ? [[`${prefix}.${key}`, item]] : Object.entries(flatten(item, `${prefix}.${key}`))));
}
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(file);
    return /\.tsx?$/.test(file) && !/\.test\./.test(file) ? [file] : [];
  });
}

describe('chat translation catalog', () => {
  const en = flatten(aiChat.en);
  const ru = flatten(aiChat.ru);
  it('has matching nonempty English and Russian keys and interpolation parameters', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ru).sort());
    for (const key of Object.keys(en)) {
      expect(en[key].trim(), key).not.toBe('');
      expect(ru[key].trim(), key).not.toBe('');
      expect(en[key], key).not.toMatch(/[А-Яа-яЁё]/);
      const params = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
      expect(params(en[key]), key).toEqual(params(ru[key]));
    }
  });
  it('resolves every literal chat translation key used by chat and MarkdownPreview', () => {
    const files = [...sourceFiles('src/features/ai-chat'), 'src/shared/components/MarkdownPreview.tsx'];
    for (const file of files) {
      for (const match of readFileSync(file, 'utf8').matchAll(/['"](aiChat\.(?:ui|contacts)\.[\w.]+)['"]/g)) {
        expect(en[match[1]], `${file}: ${match[1]}`).toBeDefined();
      }
    }
  });
});
