// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { materializeEmbeddedImages } from '../assets.js';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const scope = { spaceId: 11, projectId: 7, userId: 42 };

describe('embedded document assets', () => {
  it('stores images privately and replaces every data URI', async () => {
    const saveFile = vi.fn().mockResolvedValue({ url: '/uploads/spaces/11/file_asset.png' });
    const result = await materializeEmbeddedImages(`# Doc\n\n![x](data:image/png;base64,${png.toString('base64')})`, scope, saveFile);

    expect(result.markdown).toBe('# Doc\n\n![x](/uploads/spaces/11/file_asset.png)');
    expect(result.assets).toEqual([{ url: '/uploads/spaces/11/file_asset.png', mime_type: 'image/png' }]);
    expect(saveFile).toHaveBeenCalledWith(expect.objectContaining({ spaceId: 11, projectId: 7, userId: 42 }));
    expect(result.markdown).not.toContain('data:image/');
  });

  it('rejects malformed image payloads', async () => {
    await expect(materializeEmbeddedImages('![x](data:image/png;base64,YmFk)', scope, vi.fn())).rejects.toThrow('DOCUMENT_ASSET_INVALID');
  });
});
