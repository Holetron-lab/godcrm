// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { DoclingClient } from '../DoclingClient.js';

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('DoclingClient', () => {
  it('uses fixed conversion options and the API key header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ task_id: 'task-1', task_status: 'pending' }));
    const client = new DoclingClient({ baseUrl: 'http://docling:5001', apiKey: 'secret', fetchImpl });

    await client.submit({ bytes: Buffer.from('%PDF-'), name: 'a.pdf', mimeType: 'application/pdf', format: 'pdf', language: 'auto' });

    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://docling:5001/v1/convert/file/async');
    expect(options.headers['X-Api-Key']).toBe('secret');
    expect(options.body.getAll('from_formats')).toEqual(['pdf']);
    expect(options.body.getAll('to_formats')).toEqual(['md']);
    expect(options.body.getAll('ocr_lang')).toEqual(['en', 'ru']);
    expect(options.body.get('pipeline')).toBe('standard');
    expect(options.body.get('image_export_mode')).toBe('embedded');
  });

  it('rejects task id mismatch and malformed results', async () => {
    const client = new DoclingClient({
      baseUrl: 'http://docling:5001',
      apiKey: 'secret',
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({ task_id: 'other', task_status: 'success' })),
    });
    await expect(client.poll('expected')).rejects.toThrow();
  });

  it('parses the official document.md_content result', async () => {
    const client = new DoclingClient({
      baseUrl: 'http://docling:5001',
      apiKey: 'secret',
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({ document: { md_content: '# Title' }, status: 'partial_success', errors: [] })),
    });
    await expect(client.result('task-1')).resolves.toMatchObject({ status: 'partial_success', document: { md_content: '# Title' } });
  });
});
