import { savePrivateFile } from './fileStorage.js';
import { MARKDOWN_LIMIT } from './sourceValidation.js';

const IMAGE_TYPES = {
  'image/png': { extension: '.png', signature: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
  'image/jpeg': { extension: '.jpg', signature: Buffer.from([0xff, 0xd8, 0xff]) },
  'image/gif': { extension: '.gif', signature: Buffer.from('GIF8') },
  'image/webp': { extension: '.webp', signature: Buffer.from('RIFF') },
};

function validImage(bytes, mimeType) {
  const signature = IMAGE_TYPES[mimeType].signature;
  if (!bytes.subarray(0, signature.length).equals(signature)) return false;
  return mimeType !== 'image/webp' || bytes.subarray(8, 12).toString('ascii') === 'WEBP';
}

export async function materializeEmbeddedImages(markdown, scope, saveFile = savePrivateFile) {
  if (typeof markdown !== 'string') throw new Error('DOCLING_RESPONSE_INVALID');
  const assets = [];
  const parts = [];
  let cursor = 0;
  let decodedTotal = 0;
  while (cursor < markdown.length) {
    const start = markdown.indexOf('data:image/', cursor);
    if (start === -1) break;
    const end = markdown.indexOf(')', start);
    const comma = markdown.indexOf(',', start);
    if (end === -1 || comma === -1 || comma > end) throw new Error('DOCUMENT_ASSET_INVALID');
    const mimeType = markdown.slice(start + 5, comma).replace(/;base64$/, '');
    if (!IMAGE_TYPES[mimeType] || markdown.slice(start + 5, comma) !== `${mimeType};base64`) {
      throw new Error('DOCUMENT_ASSET_TYPE_UNSUPPORTED');
    }
    const encoded = markdown.slice(comma + 1, end).trim();
    if (encoded.length > Math.ceil((10 * 1024 * 1024) / 3) * 4 + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
      throw new Error('DOCUMENT_ASSET_SIZE_LIMIT');
    }
    const bytes = Buffer.from(encoded, 'base64');
    if (!bytes.length || bytes.length > 10 * 1024 * 1024 || !validImage(bytes, mimeType)) throw new Error('DOCUMENT_ASSET_INVALID');
    decodedTotal += bytes.length;
    if (decodedTotal > 100 * 1024 * 1024 || assets.length >= 100) throw new Error('DOCUMENT_ASSET_TOTAL_LIMIT');
    const saved = await saveFile({
      bytes,
      name: `document-image-${assets.length + 1}${IMAGE_TYPES[mimeType].extension}`,
      mimeType,
      spaceId: scope.spaceId,
      projectId: scope.projectId,
      userId: scope.userId,
    });
    assets.push({ url: saved.url, mime_type: mimeType });
    parts.push(markdown.slice(cursor, start), saved.url);
    cursor = end;
  }
  parts.push(markdown.slice(cursor));
  const result = parts.join('');
  if (result.length > MARKDOWN_LIMIT) throw new Error('DOCUMENT_MARKDOWN_LIMIT');
  return { markdown: result, assets };
}
