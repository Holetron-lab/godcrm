// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { decodeText, validateSource } from '../sourceValidation.js';

const pdf = (text = 'body') => Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from(text)]);
const docx = Buffer.from('UEsDBBQAAAAAABCUeF3HHBc8CAAAAAgAAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbDxUeXBlcy8+UEsDBBQAAAAAABCUeF2C2RzVEAAAABAAAAALAAAAX3JlbHMvLnJlbHM8UmVsYXRpb25zaGlwcy8+UEsDBBQAAAAAABCUeF1fW9FMCwAAAAsAAAARAAAAd29yZC9kb2N1bWVudC54bWw8ZG9jdW1lbnQvPlBLAQIUAxQAAAAAABCUeF3HHBc8CAAAAAgAAAATAAAAAAAAAAAAAACAAQAAAABbQ29udGVudF9UeXBlc10ueG1sUEsBAhQDFAAAAAAAEJR4XYLZHNUQAAAAEAAAAAsAAAAAAAAAAAAAAIABOQAAAF9yZWxzLy5yZWxzUEsBAhQDFAAAAAAAEJR4XV9b0UwLAAAACwAAABEAAAAAAAAAAAAAAIABcgAAAHdvcmQvZG9jdW1lbnQueG1sUEsFBgAAAAADAAMAuQAAAKwAAAAAAA==', 'base64');

describe('document source validation', () => {
  it('validates PDF signatures and rejects encrypted files', async () => {
    await expect(validateSource(pdf(), 'a.pdf')).resolves.toMatchObject({ format: 'pdf' });
    await expect(validateSource(Buffer.from('not a pdf'), 'a.pdf')).rejects.toThrow('DOCUMENT_PDF_INVALID');
    await expect(validateSource(pdf('/Encrypt'), 'a.pdf')).rejects.toThrow('DOCUMENT_PDF_ENCRYPTED');
  });

  it('requires the expected OOXML entries in DOCX', async () => {
    await expect(validateSource(docx, 'a.docx')).resolves.toMatchObject({ format: 'docx' });
    await expect(validateSource(Buffer.from('PKnot-a-docx'), 'a.docx')).rejects.toThrow('DOCUMENT_DOCX_INVALID');
  });

  it('rejects unsupported extensions and binary text', async () => {
    await expect(validateSource(Buffer.from('hello'), 'a.doc')).rejects.toThrow('DOCUMENT_SOURCE_FORMAT_UNSUPPORTED');
    expect(() => decodeText(Buffer.from([0x61, 0, 0x62]))).toThrow('DOCUMENT_TEXT_BINARY');
    expect(() => decodeText(Buffer.from([0xff]))).toThrow('DOCUMENT_TEXT_UTF8_REQUIRED');
    expect(decodeText(Buffer.from([0xef, 0xbb, 0xbf, 0x61]))).toBe('a');
  });
});
