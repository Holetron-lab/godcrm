import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepareContainerMounts } from '../qa/prepare-container-mounts.mjs';

const roots = [];
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'qa-mountpoints-'));
  roots.push(root);
  const modules = join(root, 'node_modules');
  mkdirSync(modules);
  return { root, modules };
};
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

describe('QA dependency preparation', () => {
  it('creates both mountpoints and preserves populated caches on repeated preparation', () => {
    const { modules } = fixture();
    prepareContainerMounts(modules);
    writeFileSync(join(modules, '.vite', 'sentinel'), 'preserve');
    prepareContainerMounts(modules);
    expect(statSync(join(modules, '.vite-temp')).isDirectory()).toBe(true);
    expect(readFileSync(join(modules, '.vite', 'sentinel'), 'utf8')).toBe('preserve');
  });

  it.each(['.vite', '.vite-temp'])('rejects symlink %s before writing either mountpoint', name => {
    const { root, modules } = fixture();
    const target = join(root, 'outside');
    mkdirSync(target);
    symlinkSync(target, join(modules, name));
    expect(() => prepareContainerMounts(modules)).toThrow(/Unsafe QA mountpoint/);
    expect(existsSync(join(modules, name === '.vite' ? '.vite-temp' : '.vite'))).toBe(false);
  });

  it('rejects shared dependency symlinks, files and absent installations', () => {
    const { root, modules } = fixture();
    const link = join(root, 'shared');
    symlinkSync(modules, link);
    expect(() => prepareContainerMounts(link)).toThrow(/real dependency directory/);
    expect(() => prepareContainerMounts(join(root, 'missing'))).toThrow();
    writeFileSync(join(modules, '.vite-temp'), 'preserve');
    expect(() => prepareContainerMounts(modules)).toThrow(/Unsafe QA mountpoint/);
    expect(existsSync(join(modules, '.vite'))).toBe(false);
  });

  it('runs the actual package postinstall hook in a clean installation fixture', () => {
    const { root, modules } = fixture();
    const manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
    expect(manifest.scripts.postinstall).toBe(manifest.scripts['qa:prepare']);
    mkdirSync(join(root, 'scripts', 'qa'), { recursive: true });
    writeFileSync(join(root, 'scripts', 'qa', 'prepare-container-mounts.mjs'),
      readFileSync(resolve('scripts/qa/prepare-container-mounts.mjs')));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ scripts: { postinstall: manifest.scripts.postinstall } }));
    const result = spawnSync('npm', ['run', 'postinstall', '--offline'], { cwd: root, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(statSync(join(modules, '.vite')).isDirectory()).toBe(true);
    expect(statSync(join(modules, '.vite-temp')).isDirectory()).toBe(true);
  });
});
