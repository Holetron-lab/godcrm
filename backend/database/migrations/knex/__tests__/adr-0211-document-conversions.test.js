// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { down, up } from '../117_adr_0211_document_conversions.js';

describe('ADR-0211 document conversion migration', () => {
  it('creates the durable job model and required indexes', async () => {
    const raw = vi.fn().mockResolvedValue({});
    const knex = { client: { config: { client: 'pg' } }, raw };

    await up(knex);

    expect(raw.mock.calls[0][0]).toContain('CREATE TABLE IF NOT EXISTS document_conversion_jobs');
    expect(raw.mock.calls[0][0]).toContain('result_markdown TEXT');
    expect(raw.mock.calls[0][0]).toContain('import_request JSONB');
    expect(raw.mock.calls.map(([sql]) => sql).join('\n')).toContain('idx_document_conversion_requester');
    expect(raw.mock.calls.map(([sql]) => sql).join('\n')).toContain('idx_document_conversion_space_status');

    await down(knex);
    expect(raw.mock.calls.at(-1)[0]).toContain('DROP TABLE IF EXISTS document_conversion_jobs');
  });
});
