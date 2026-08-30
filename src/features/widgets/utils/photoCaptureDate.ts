/**
 * Capture date of an uploaded photo, read from its own EXIF.
 *
 * The upload filename (`file_<epoch-ms>_<hex>.jpg`) only tells us when the file
 * landed on the server — a shot taken in July and uploaded in August would be
 * mislabelled by a month. The real answer lives in the JPEG's EXIF
 * `DateTimeOriginal`, so we read the head of the file and parse it in place.
 *
 * Reading is bounded: EXIF sits in the APP1 segment right after SOI, so the
 * first 256 KB always contain it. We ask for a byte range and, if the server
 * ignores the header, stop pulling the stream once that budget is spent —
 * a 4 MB photo never travels twice.
 */

const HEAD_BYTES = 256 * 1024;

/** EXIF stores dates as `YYYY:MM:DD HH:MM:SS`, in local time, no zone. */
const EXIF_DATE = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;

const TAG_EXIF_IFD = 0x8769;
const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_DATETIME_DIGITIZED = 0x9004;
const TAG_DATETIME = 0x0132;

const cache = new Map<string, Promise<Date | null>>();

const parseExifDate = (raw: string): Date | null => {
  const m = EXIF_DATE.exec(raw.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Read an ASCII value out of an IFD entry (inline when ≤ 4 bytes, else at an offset). */
const readAscii = (
  view: DataView,
  tiff: number,
  entry: number,
  little: boolean,
  count: number
): string => {
  const inline = count <= 4;
  const start = inline ? entry + 8 : tiff + view.getUint32(entry + 8, little);
  const end = start + count;
  if (start < 0 || end > view.byteLength) return '';
  let out = '';
  for (let i = start; i < end; i += 1) {
    const code = view.getUint8(i);
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out;
};

/**
 * Walk one IFD. Returns the first date tag found, or — when the IFD carries an
 * EXIF sub-IFD pointer — recurses into it first, since `DateTimeOriginal` there
 * is more precise than IFD0's `DateTime` (which cameras rewrite on edit).
 */
const scanIfd = (view: DataView, tiff: number, ifd: number, little: boolean, depth = 0): string => {
  if (depth > 2 || ifd + 2 > view.byteLength) return '';
  const count = view.getUint16(ifd, little);
  let fallback = '';
  let subIfd = 0;

  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > view.byteLength) break;
    const tag = view.getUint16(entry, little);
    const values = view.getUint32(entry + 4, little);

    if (tag === TAG_EXIF_IFD) {
      subIfd = tiff + view.getUint32(entry + 8, little);
    } else if (tag === TAG_DATETIME_ORIGINAL) {
      return readAscii(view, tiff, entry, little, values);
    } else if (tag === TAG_DATETIME_DIGITIZED || tag === TAG_DATETIME) {
      fallback = fallback || readAscii(view, tiff, entry, little, values);
    }
  }

  if (subIfd) {
    const nested = scanIfd(view, tiff, subIfd, little, depth + 1);
    if (nested) return nested;
  }
  return fallback;
};

/** Locate the APP1/Exif segment in a JPEG head and parse its date tags. */
const extractExifDate = (buffer: ArrayBuffer): Date | null => {
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null; // not a JPEG

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) {
      offset += 1; // resync on padding between segments
      continue;
    }
    const marker = view.getUint8(offset + 1);
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xda) break; // start of scan — no metadata past here
    const size = view.getUint16(offset + 2);
    if (size < 2) break;

    if (marker === 0xe1 && offset + 10 <= view.byteLength) {
      const tiff = offset + 10; // skip marker(2) + size(2) + "Exif\0\0"(6)
      if (tiff + 8 <= view.byteLength) {
        const byteOrder = view.getUint16(tiff);
        const little = byteOrder === 0x4949;
        if (little || byteOrder === 0x4d4d) {
          const ifd0 = tiff + view.getUint32(tiff + 4, little);
          const raw = scanIfd(view, tiff, ifd0, little);
          if (raw) return parseExifDate(raw);
        }
      }
    }
    offset += 2 + size;
  }
  return null;
};

/** Fetch at most `HEAD_BYTES` of a file, honouring Range when the server does. */
const fetchHead = async (url: string): Promise<ArrayBuffer | null> => {
  const response = await fetch(url, { headers: { Range: `bytes=0-${HEAD_BYTES - 1}` } });
  if (!response.ok) return null;
  if (response.status === 206 || !response.body) return response.arrayBuffer();

  // Range ignored: pull only what we need, then drop the rest of the stream.
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < HEAD_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
  const head = new Uint8Array(total);
  let at = 0;
  chunks.forEach((chunk) => {
    head.set(chunk, at);
    at += chunk.length;
  });
  return head.buffer;
};

/**
 * When the photo was taken. `null` when the file carries no EXIF date
 * (screenshots, messenger-stripped images, non-JPEG) — callers fall back to the
 * upload timestamp. Results are cached per URL for the page's lifetime.
 */
export const readPhotoCaptureDate = (url: string): Promise<Date | null> => {
  const cached = cache.get(url);
  if (cached) return cached;

  const pending = fetchHead(url)
    .then((buffer) => (buffer ? extractExifDate(buffer) : null))
    .catch(() => null);

  cache.set(url, pending);
  return pending;
};
