// @vitest-environment node
import { it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { create } from 'tar';
import { stageHistoricalFiles } from '../historical-files.js';

it('verifies exact binaries, resumes safely, rejects tampering and never substitutes missing files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'historical-files-'));
  try {
    await mkdir(path.join(root, 'files/uploads'), {recursive:true});
    await writeFile(path.join(root, 'files/uploads/test.mp4'), 'video');
    await create({file:path.join(root, 'files.tar'), cwd:root}, ['files/uploads/test.mp4']);
    const sha256 = createHash('sha256').update('video').digest('hex');
    const map = [{url:'/uploads/test.mp4',archive_member:'files/uploads/test.mp4',size:5,sha256,status:'verified_pending_upload'}, {url:'/uploads/missing.mp4',archive_member:null,size:null,sha256:null,status:'missing'}];
    const options = {archivePath:path.join(root,'files.tar'), files:map, digest:'a'.repeat(64)};
    const dry = await stageHistoricalFiles(options);
    expect(dry.files).toHaveLength(1); expect(dry.missing).toEqual(['/uploads/missing.mp4']);
    const staged = await stageHistoricalFiles({...options, uploadsRoot:root});
    expect(await readFile(staged.files[0].path,'utf8')).toBe('video');
    expect((await stageHistoricalFiles({...options, uploadsRoot:root})).files).toEqual(staged.files);
    await writeFile(staged.files[0].path,'wrong');
    await expect(stageHistoricalFiles({...options,uploadsRoot:root})).rejects.toThrow();
    await expect(stageHistoricalFiles({...options,files:[{...map[0],sha256:'0'.repeat(64)}]})).rejects.toThrow();
  } finally { await rm(root,{recursive:true,force:true}); }
});
