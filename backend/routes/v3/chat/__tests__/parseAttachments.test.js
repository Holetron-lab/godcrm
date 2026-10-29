// parseAttachments — the read/write boundary for messages.attachments.
//
// Regression for the crm.hltrn.cc chat crash (2026-09-25): rows written by an
// older client carry `{ url, mime_type, original_name }` and no `type`, and the
// SPA dies on `att.type.startsWith(...)` while rendering the conversation.

import { describe, it, expect } from 'vitest';
import { parseAttachments } from '../parseAttachments.js';

describe('parseAttachments', () => {
  it('keeps well-formed attachments untouched', () => {
    const atts = [
      { id: 'f1', name: 'a.png', type: 'image/png', size: 10, url: '/uploads/a.png' },
      { type: 'row_reference', name: 'Row', size: 0, rowReference: { table_id: 1, row_id: 2 } },
    ];
    expect(parseAttachments(JSON.stringify(atts))).toEqual(atts);
    expect(parseAttachments(atts)).toEqual(atts);
  });

  it('derives type/name for the legacy {url, mime_type, original_name} shape', () => {
    const legacy = '[{"url":"/uploads/spaces/35/x.png","mime_type":"image/png","original_name":"reference_1.png"}]';
    expect(parseAttachments(legacy)).toEqual([
      { url: '/uploads/spaces/35/x.png', mime_type: 'image/png', original_name: 'reference_1.png', type: 'image/png', name: 'reference_1.png' },
    ]);
  });

  it('falls back to "file" when neither type nor mime_type is usable', () => {
    expect(parseAttachments([{ url: '/u/x.bin' }, { type: '', name: '' }])).toEqual([
      { url: '/u/x.bin', type: 'file', name: 'file' },
      { type: 'file', name: 'file' },
    ]);
  });

  it('returns [] for null, malformed JSON, non-arrays and drops non-object entries', () => {
    expect(parseAttachments(null)).toEqual([]);
    expect(parseAttachments(undefined)).toEqual([]);
    expect(parseAttachments('not json')).toEqual([]);
    expect(parseAttachments('{"type":"file"}')).toEqual([]);
    expect(parseAttachments(['/u/x.png', null, 7, [], { type: 'file', name: 'ok' }])).toEqual([{ type: 'file', name: 'ok' }]);
  });
});
