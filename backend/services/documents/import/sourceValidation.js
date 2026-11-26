import path from 'node:path';
import yauzl from 'yauzl';
import { TextDecoder } from 'node:util';

export const SOURCE_LIMIT = 25 * 1024 * 1024;
export const MARKDOWN_LIMIT = 2_000_000;

const FORMATS = {
  pdf: { extensions: ['.pdf'], mime: 'application/pdf' },
  docx: { extensions: ['.docx'], mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  md: { extensions: ['.md', '.markdown'], mime: 'text/markdown' },
  txt: { extensions: ['.txt'], mime: 'text/plain' },
};

function inspectDocx(bytes) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, autoClose: true, decodeStrings: true }, (error, zip) => {
      if (error || !zip) return reject(new Error('DOCUMENT_DOCX_INVALID'));
      const entries = new Set();
      let encrypted = false;
      let tooManyEntries = false;
      zip.on('entry', (entry) => {
        if (entries.size >= 1000) {
          tooManyEntries = true;
          zip.close();
          return;
        }
        entries.add(entry.fileName);
        if (entry.fileName === 'EncryptionInfo' || entry.fileName === 'EncryptedPackage') encrypted = true;
        zip.readEntry();
      });
      zip.on('end', () => {
        if (tooManyEntries) return resolve('invalid');
        if (encrypted) return resolve('encrypted');
        resolve(entries.has('[Content_Types].xml') && entries.has('word/document.xml') && entries.has('_rels/.rels') ? 'valid' : 'invalid');
      });
      zip.on('error', () => reject(new Error('DOCUMENT_DOCX_INVALID')));
      zip.readEntry();
    });
  });
}

export async function validateSource(bytes, name) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > SOURCE_LIMIT) throw new Error('DOCUMENT_SOURCE_SIZE_LIMIT');
  const extension = path.extname(name || '').toLowerCase();
  const format = Object.keys(FORMATS).find((key) => FORMATS[key].extensions.includes(extension));
  if (!format) throw new Error('DOCUMENT_SOURCE_FORMAT_UNSUPPORTED');
  if (format === 'pdf') {
    if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('DOCUMENT_PDF_INVALID');
    if (bytes.includes(Buffer.from('/Encrypt'))) throw new Error('DOCUMENT_PDF_ENCRYPTED');
  }
  if (format === 'docx') {
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error('DOCUMENT_DOCX_INVALID');
    const result = await inspectDocx(bytes);
    if (result === 'encrypted') throw new Error('DOCUMENT_DOCX_ENCRYPTED');
    if (result !== 'valid') throw new Error('DOCUMENT_DOCX_INVALID');
  }
  return { format, mimeType: FORMATS[format].mime };
}

export function decodeText(bytes) {
  if (bytes.includes(0)) throw new Error('DOCUMENT_TEXT_BINARY');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    throw new Error('DOCUMENT_TEXT_UTF8_REQUIRED');
  }
}
