import { describe, expect, it } from 'vitest';
import { parseMarkdownToDocumentV4, sectionsToImportFormat } from './parseMarkdownToDocumentV4';

describe('markdown document item types', () => {
  it('emits reference text items under headings, preserving their content', () => {
    const parsed = parseMarkdownToDocumentV4('# Guide\n\n## Overview\n\nBody text');
    const text = parsed.sections.find(section => section.level === 'text');
    expect(text).toMatchObject({ type: 'reference', content: 'Body text' });
    expect(sectionsToImportFormat(parsed.sections).find(section => section.level === 'text')).toMatchObject({ type: 'reference', content: 'Body text' });
  });

  it('preserves HTTP metadata on endpoint headings', () => {
    const parsed = parseMarkdownToDocumentV4('## GET /tickets\n\nList tickets');
    expect(parsed.sections.find(section => section.level === 'h2')).toMatchObject({ type: 'endpoint', http_method: 'GET', http_path: '/tickets' });
  });
});
