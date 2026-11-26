// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../database/connection.js', () => ({
  dbGet: vi.fn(),
  dbRun: vi.fn(),
  isPostgres: () => true,
  sqlNow: () => 'NOW()',
}));

vi.mock('../../../utils/logger.js', () => ({
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { createCanonicalDocument } = await import('../createDocument.js');

const binding = { project_id: 7, registry_table_id: 2197, folder_path: 'databases/documents/', titleCol: 'name' };
let queries;

beforeEach(() => {
  queries = [];
});

function transaction() {
  return {
    get: vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ max_order: 11 }),
    run: vi.fn((sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('INSERT INTO table_rows') && params[0] === 2197) return { lastInsertRowid: 123 };
      if (sql.includes('INSERT INTO universal_tables')) return { lastInsertRowid: 456 };
      return { changes: 1 };
    }),
  };
}

describe('canonical document language', () => {
  it('creates content_ru and writes Russian atoms there inside the supplied transaction', async () => {
    const trx = transaction();
    const result = await createCanonicalDocument({
      widget_id: 218, title: 'Русский документ', content: '# Заголовок\n\n## Раздел\n\nТекст', language: 'ru', binding,
    }, 42, trx);

    expect(result.document_id).toBe(123);
    expect(queries.some(({ sql, params }) => sql.includes('INSERT INTO table_columns') && params[1] === 'content_ru')).toBe(true);
    const atom = queries.filter(({ sql }) => sql.includes('INSERT INTO table_rows')).at(-1).params[2];
    expect(JSON.parse(atom)).toHaveProperty('content_ru');
    expect(JSON.parse(atom)).not.toHaveProperty('content_en');
  });

  it('keeps the existing English default', async () => {
    const trx = transaction();
    trx.get = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    await createCanonicalDocument({ widget_id: 218, title: 'English', content: '# Title\n\n## Section\n\nText', binding }, 42, trx);

    expect(queries.some(({ params }) => params[1] === 'content_ru')).toBe(false);
    const atom = queries.filter(({ sql }) => sql.includes('INSERT INTO table_rows')).at(-1).params[2];
    expect(JSON.parse(atom)).toHaveProperty('content_en');
  });
});
