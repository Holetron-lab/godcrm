// @vitest-environment node
/**
 * Regression guard for ADR-0016: agent-generated images/3D models MUST be
 * registered in the `files` table, otherwise uploadsFileGuard 404s every
 * generated asset even though the bytes are on disk.
 *
 * Bug history: downloadAndSaveImage / downloadAndSave3DModel wrote to disk
 * and returned a URL but never inserted a `files` row → every avatar/image an
 * agent produced was unreachable. This test pins the INSERT (with public
 * visibility) so the regression cannot return silently.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const dbRun = vi.fn().mockResolvedValue({});

vi.mock('../../../database/connection.js', () => ({
  dbGet: vi.fn().mockResolvedValue(null),
  dbRun,
  sqlNow: () => 'NOW()',
}));

// Avoid touching the real filesystem.
vi.mock('fs', () => {
  const fakeFs = {
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    statSync: vi.fn().mockReturnValue({ size: 1234 }),
  };
  return { default: fakeFs, ...fakeFs };
});

const { downloadAndSaveImage, downloadAndSave3DModel, REPLICATE_MODELS } = await import('../image-tools.js');

describe('agent image registration (ADR-0016)', () => {
  beforeEach(() => dbRun.mockClear());

  it('inserts a public files row when saving a generated image', async () => {
    // data: URI keeps it offline — no network fetch.
    const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const result = await downloadAndSaveImage(`data:image/png;base64,${pngBase64}`, 44);

    expect(dbRun).toHaveBeenCalledTimes(1);
    const [sql, params] = dbRun.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO files/i);
    // Column order: id, name, original_name, mime_type, size, path, url,
    //               <'local'>, space_id, uploaded_by, <'public'>, ...
    expect(params[0]).toBe(result.file_id);          // id
    expect(params[3]).toBe('image/png');             // mime_type
    expect(params[6]).toBe(result.url);              // url == relative /uploads/...
    expect(params[6]).toMatch(/^\/uploads\/spaces\/44\//);
    // 'local' and 'public' are SQL literals, not bound params, so space_id is
    // params[7] and uploaded_by is params[8].
    expect(params[7]).toBe(44);                      // space_id (numeric, not 'plugin')
    expect(params[8]).toBeNull();                    // uploaded_by (agent upload)
    expect(sql).toMatch(/'public'/);
  });

  it("maps the 'plugin' space sentinel to a null space_id", async () => {
    const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    await downloadAndSaveImage(`data:image/png;base64,${pngBase64}`, 'plugin');
    const [, params] = dbRun.mock.calls[0];
    expect(params[7]).toBeNull(); // space_id sentinel → null
  });

  it('registers generated 3D models too', async () => {
    // 3D path fetches over HTTP — stub fetch to return bytes.
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    const result = await downloadAndSave3DModel('https://example.com/mesh.glb', 44, 'glb');
    expect(dbRun).toHaveBeenCalledTimes(1);
    const [sql, params] = dbRun.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO files/i);
    expect(params[3]).toBe('model/gltf-binary'); // mime_type
    expect(params[6]).toBe(result.url);
    expect(sql).toMatch(/'public'/);
  });
});

/**
 * Regression guard: pure text-to-image (no source image) must NOT seed a null
 * image field. Bug history: every edit-capable model unconditionally built
 * `image: imageUrl` / `[imageUrl]` (+ `aspect_ratio: 'match_input_image'`), so
 * with no source image Replicate received `null` / `[null]` and returned 422 —
 * blocking avatar generation across flux-2-pro, seedream-*, ideogram, etc.
 */
describe('replicate buildInput — text-to-image omits null image (422 guard)', () => {
  const PROMPT = 'a red stamp that reads НЕ СОГЛАСОВАНО';

  it('never emits a null/[null] image field when imageUrl is absent', () => {
    for (const [key, model] of Object.entries(REPLICATE_MODELS)) {
      const input = model.buildInput(PROMPT, null, null, 1);
      // No image-bearing key may carry a null or [null] value. Omitting the
      // key entirely (undefined) is the desired outcome — only an explicit
      // null / [null] is the 422-triggering bug. (toContain throws on
      // undefined, so guard the array checks behind a presence test.)
      expect(input.image, `${key}.image`).not.toBeNull();
      expect(input.input_image, `${key}.input_image`).not.toBeNull();
      for (const arrKey of ['image_input', 'input_images']) {
        if (input[arrKey] !== undefined) {
          expect(input[arrKey], `${key}.${arrKey}`).not.toContain(null);
        }
      }
      // Aspect ratio can't reference a non-existent input image.
      expect(input.aspect_ratio, `${key}.aspect_ratio`).not.toBe('match_input_image');
      expect(input.prompt).toBe(PROMPT);
    }
  });

  it('still wires the source image through when one IS provided', () => {
    const src = 'https://crm.hltrn.cc/uploads/spaces/44/src.png';
    expect(REPLICATE_MODELS['flux-2-pro'].buildInput(PROMPT, src).input_images).toContain(src);
    expect(REPLICATE_MODELS['seedream-4.5'].buildInput(PROMPT, src).image_input).toContain(src);
    expect(REPLICATE_MODELS['ideogram-v3-balanced'].buildInput(PROMPT, src).image).toBe(src);
    expect(REPLICATE_MODELS['flux-kontext-pro'].buildInput(PROMPT, src).input_image).toBe(src);
  });
});
