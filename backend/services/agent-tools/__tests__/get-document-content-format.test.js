// @vitest-environment node
/**
 * get_document_content — response-size controls.
 *
 * A 90-atom document returned ~144K chars because `atoms` duplicates the
 * rendered `markdown`; the MCP tool-result limit clipped it. Pins:
 *  - default call is unchanged (atoms + markdown, no range metadata)
 *  - format: 'markdown' drops the heavy `atoms` / `widget_atoms` payload
 *  - offset / max_chars slice the markdown and report where to resume
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const dbAll = vi.fn();
const dbGet = vi.fn();
const dbRun = vi.fn();
const isPostgres = vi.fn(() => true);
const sqlNow = vi.fn(() => 'NOW()');

vi.mock('../../../database/connection.js', () => ({
  dbAll: (...args) => dbAll(...args),
  dbGet: (...args) => dbGet(...args),
  dbRun: (...args) => dbRun(...args),
  isPostgres: (...args) => isPostgres(...args),
  sqlNow: (...args) => sqlNow(...args),
}));

vi.mock('../../../utils/logger.js', () => {
  const mkLogger = () => ({
    error: () => {}, info: () => {}, warn: () => {}, debug: () => {},
    child: () => mkLogger(),
  });
  return { aiLogger: mkLogger(), apiLogger: mkLogger(), dbLogger: mkLogger(), default: mkLogger() };
});

const { documentToolHandlers } = await import('../document-tools.js');
const { PROJECT_TOOLS } = await import('../tool-definitions/project.js');

const ATOM_ROWS = [
  { id: 1, data: { level: 'h1', content_en: 'Title', order: 10 } },
  { id: 2, data: { level: 'text', content_en: 'A'.repeat(50), order: 20 } },
  { id: 3, data: { level: 'text', content_en: 'B'.repeat(50), order: 30 } },
];
const FULL_MD = `# Title\n\n${'A'.repeat(50)}\n\n${'B'.repeat(50)}`; // 111 chars

const call = (extra = {}) =>
  documentToolHandlers.get_document_content({ widget_id: 218, document_id: 42, ...extra });

beforeEach(() => {
  dbAll.mockReset().mockResolvedValue(ATOM_ROWS);
  dbGet.mockReset()
    .mockResolvedValueOnce({ id: 218, config: { registry_table_id: 2197 } }) // widget
    .mockResolvedValueOnce({ project_id: 1, folder_path: 'databases/documents/' }) // registry table
    .mockResolvedValueOnce({ id: 42, data: { name: 'Doc', table_id: 100257 } }); // registry row
  isPostgres.mockReset().mockReturnValue(true);
});

describe('get_document_content — default shape is unchanged', () => {
  it('returns atoms + full markdown without range metadata', async () => {
    const out = await call();
    expect(out.markdown).toBe(FULL_MD);
    expect(out.atoms).toHaveLength(3);
    expect(out.atom_count).toBe(3);
    expect(out).toHaveProperty('widget_atoms');
    expect(out).not.toHaveProperty('markdown_total_chars');
    expect(out).not.toHaveProperty('next_offset');
  });
});

describe('get_document_content — format: "markdown"', () => {
  it('drops atoms and widget_atoms, keeps document meta + markdown', async () => {
    const out = await call({ format: 'markdown' });
    expect(out.markdown).toBe(FULL_MD);
    expect(out.document).toMatchObject({ id: 42, name: 'Doc' });
    expect(out.atom_count).toBe(3);
    expect(out.table_id).toBe(100257);
    expect(out).not.toHaveProperty('atoms');
    expect(out).not.toHaveProperty('widget_atoms');
  });
});

describe('get_document_content — offset / max_chars', () => {
  it('returns the first chunk and where to resume', async () => {
    const out = await call({ format: 'markdown', max_chars: 40 });
    expect(out.markdown).toBe(FULL_MD.slice(0, 40));
    expect(out.markdown_total_chars).toBe(FULL_MD.length);
    expect(out.next_offset).toBe(40);
  });

  it('resumes from offset and signals the end with next_offset: null', async () => {
    const out = await call({ format: 'markdown', offset: 40, max_chars: 100 });
    expect(out.markdown).toBe(FULL_MD.slice(40));
    expect(out.next_offset).toBeNull();
  });

  it('offset alone returns the tail without a cap', async () => {
    const out = await call({ offset: 100 });
    expect(out.markdown).toBe(FULL_MD.slice(100));
    expect(out.markdown_total_chars).toBe(FULL_MD.length);
    expect(out.next_offset).toBeNull();
  });

  it('offset past the end yields an empty chunk, not an error', async () => {
    const out = await call({ offset: 10_000 });
    expect(out.markdown).toBe('');
    expect(out.next_offset).toBeNull();
  });

  it('slices in full format too (atoms stay intact)', async () => {
    const out = await call({ max_chars: 10 });
    expect(out.markdown).toBe(FULL_MD.slice(0, 10));
    expect(out.atoms).toHaveLength(3);
  });
});

describe('tool schema advertises the new parameters', () => {
  it('get_document_content has format / offset / max_chars', () => {
    const def = PROJECT_TOOLS.find((t) => t.function.name === 'get_document_content');
    const props = def.function.parameters.properties;
    expect(props.format?.enum).toEqual(['full', 'markdown']);
    expect(props.offset?.type).toBe('number');
    expect(props.max_chars?.type).toBe('number');
    expect(def.function.parameters.required).toEqual(['widget_id', 'document_id']);
  });
});
