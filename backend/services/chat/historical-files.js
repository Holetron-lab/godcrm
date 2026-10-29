import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, lstat, realpath, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform, Writable } from 'node:stream';
import path from 'node:path';
import { list } from 'tar';
import { z } from 'zod';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const fileSchema = z.object({url:z.string().startsWith('/uploads/'), archive_member:z.string().nullable(), size:z.number().int().nonnegative().nullable(), sha256:sha.nullable(), status:z.enum(['verified_pending_upload','missing'])}).passthrough();

export async function hashHistoricalFile(filename) {
  if (!(await lstat(filename)).isFile()) throw new Error('Not a regular file');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

export async function stageHistoricalFiles({archivePath, files:input, digest, uploadsRoot}) {
  sha.parse(digest);
  const files = z.array(fileSchema).parse(input);
  if (new Set(files.map(f => f.url)).size !== files.length) throw new Error('Duplicate file URL');
  if (!(await lstat(archivePath)).isFile()) throw new Error('Archive must be a regular file');
  const exact = files.filter(f => f.status === 'verified_pending_upload');
  for (const f of exact) {
    if (f.archive_member !== `files${f.url}` || !f.sha256 || f.size === null) throw new Error('Invalid exact-file manifest');
  }
  const members = new Map(exact.map(f => [f.archive_member, f]));
  const seen = new Set();
  // Validate EVERY header before extracting ANY entry. Never tar.extract().
  await list({file:archivePath, onReadEntry:e => {
    if (e.type !== 'File' || e.path.startsWith('/') || e.path.includes('\\') || e.path.split('/').some(p => !p || p === '..' || p === '.') || seen.has(e.path)) throw new Error('Unsafe archive member');
    seen.add(e.path);
    const f = members.get(e.path);
    if (f && f.size !== e.size) throw new Error('File size mismatch');
  }});
  if (exact.some(f => !seen.has(f.archive_member))) throw new Error('Manifest file absent from archive');
  let directory;
  if (uploadsRoot) {
    const root = await realpath(uploadsRoot);
    directory = path.join(root, 'historical-imports', digest);
    for (const dir of [path.join(root,'historical-imports'), directory]) {
      await mkdir(dir, {mode:0o700}).catch(err => {if (err.code !== 'EEXIST') throw err;});
      if (!(await lstat(dir)).isDirectory() || await realpath(dir) !== dir) throw new Error('Unsafe destination directory');
    }
  }
  const tasks = [];
  const output = [];
  await list({file:archivePath, noResume:true, onReadEntry:e => {
    const f = members.get(e.path);
    if (!f) { e.resume(); return; }
    const ext = path.extname(f.url).toLowerCase();
    const suffix = ['.mp4','.webm','.mp3','.wav','.ogg','.png','.jpg','.jpeg','.webp','.gif','.pdf','.txt','.zip'].includes(ext) ? ext : '.bin';
    const fileId = `history_${createHash('sha256').update(`${digest}:${f.url}`).digest('hex')}`;
    const name = `${fileId}${suffix}`;
    const destination = directory ? path.join(directory,name) : null;
    const hash = createHash('sha256');
    const task = (async () => {
      const exists = destination && await lstat(destination).catch(err => {if (err.code !== 'ENOENT') throw err;});
      if (exists && await hashHistoricalFile(destination) !== f.sha256) throw new Error('Destination collision');
      const partial = destination && !exists && `${destination}.partial`;
      const hashing = new Transform({transform(chunk, _encoding, callback) { hash.update(chunk); callback(null,chunk); }});
      if (partial) {
        // Interrupted attempts leave only a private, unregistered partial file.
        const old = await lstat(partial).catch(err => {if (err.code !== 'ENOENT') throw err;});
        if (old && !old.isFile()) throw new Error('Unsafe partial file');
        if (old) await rm(partial);
        await pipeline(e, hashing, createWriteStream(partial, {flags:'wx',mode:0o600}));
      } else {
        await pipeline(e, hashing, new Writable({write(_chunk, _encoding, callback) {callback();}}));
      }
      if (hash.digest('hex') !== f.sha256) throw new Error('File digest mismatch');
      if (destination) {
        if (!exists) await rename(partial,destination);
        if (await hashHistoricalFile(destination) !== f.sha256) throw new Error('Destination digest mismatch');
      }
      output.push({...f,id:fileId,path:destination,url:`/uploads/historical-imports/${digest}/${name}`,source_url:f.url});
    })();
    tasks.push(task);
    // Attach immediately; aggregate below still propagates rejection.
    task.catch(() => e.resume());
  }});
  await Promise.all(tasks);
  return {files:output.sort((a,b) => a.source_url.localeCompare(b.source_url)), missing:files.filter(f => f.status === 'missing').map(f => f.url)};
}
