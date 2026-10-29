import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { parseAttachmentUrls, resolveAttachmentUrl } from '../attachmentValue';
import { ImageCell } from '../ImageCell';
import { LanguageProvider } from '@/shared/i18n/LanguageContext';

// External MySQL JSON column shape (Laravel media array) as mysql2 hands it to the API
const externalImages = [
  { path: 'level/products/second-ab04.jpeg', order: 1 },
  { main: true, path: 'level/products/main-520d.jpg', order: 0 },
];

describe('parseAttachmentUrls', () => {
  it('keeps the native comma-separated string contract', () => {
    expect(parseAttachmentUrls('/uploads/a.png, /uploads/b.png,')).toEqual(['/uploads/a.png', '/uploads/b.png']);
    expect(parseAttachmentUrls('')).toEqual([]);
    expect(parseAttachmentUrls(null)).toEqual([]);
    expect(parseAttachmentUrls(undefined)).toEqual([]);
  });

  it('reads arrays of objects, main image first then by order', () => {
    expect(parseAttachmentUrls(externalImages)).toEqual([
      'level/products/main-520d.jpg',
      'level/products/second-ab04.jpeg',
    ]);
  });

  it('reads the same array when it arrives as a JSON string', () => {
    expect(parseAttachmentUrls(JSON.stringify(externalImages))).toEqual([
      'level/products/main-520d.jpg',
      'level/products/second-ab04.jpeg',
    ]);
  });

  it('accepts arrays of strings, single objects and url/src keys', () => {
    expect(parseAttachmentUrls(['a.png', 'b.png'])).toEqual(['a.png', 'b.png']);
    expect(parseAttachmentUrls({ url: 'https://cdn/x.png' })).toEqual(['https://cdn/x.png']);
    expect(parseAttachmentUrls([{ src: 'c.png' }, { nope: 1 }])).toEqual(['c.png']);
  });

  it('never yields "[object Object]"', () => {
    expect(parseAttachmentUrls([{}])).toEqual([]);
    expect(parseAttachmentUrls([])).toEqual([]);
  });
});

describe('resolveAttachmentUrl', () => {
  it('preserves space file URLs regardless of external prefix and suffix settings', () => {
    const url = '/uploads/spaces/11/file_test.png';
    expect(resolveAttachmentUrl(url, { prefix: '/uploads/', suffix: '?size=small' })).toBe(url);
    expect(resolveAttachmentUrl(url, { prefix: 'https://external.example/' })).toBe(url);
  });

  it('prefixes relative paths and leaves absolute URLs alone', () => {
    const fileConfig = { prefix: 'https://sixtynine.ru/storage/uploads/' };
    expect(resolveAttachmentUrl('level/x.jpg', fileConfig)).toBe('https://sixtynine.ru/storage/uploads/level/x.jpg');
    expect(resolveAttachmentUrl('https://cdn/x.jpg', fileConfig)).toBe('https://cdn/x.jpg');
    expect(resolveAttachmentUrl('//cdn/x.jpg', fileConfig)).toBe('//cdn/x.jpg');
  });

  it('resolves {{column}} placeholders from the row', () => {
    expect(resolveAttachmentUrl('x.jpg', { prefix: 'https://h/{{alias}}/' }, { alias: 'ring' })).toBe('https://h/ring/x.jpg');
  });
});

describe('ImageCell with external JSON values', () => {
  it('renders one <img> per entry with the configured prefix', () => {
    render(
      <ImageCell
        value={externalImages}
        readOnly
        config={{ file: { prefix: 'https://sixtynine.ru/storage/uploads/' } }}
      />, { wrapper: LanguageProvider }
    );
    const imgs = screen.getAllByRole('img');
    expect(imgs.map((img) => img.getAttribute('src'))).toEqual([
      'https://sixtynine.ru/storage/uploads/level/products/main-520d.jpg',
      'https://sixtynine.ru/storage/uploads/level/products/second-ab04.jpeg',
    ]);
  });

  it('shows the raw JSON in raw mode instead of [object Object]', () => {
    render(<ImageCell value={[{ path: 'a.png' }]} rawMode />, { wrapper: LanguageProvider });
    expect(screen.getByText('[{"path":"a.png"}]')).toBeTruthy();
  });
});
