// Run by the dependency installer, before node_modules is shared read-only.
import { lstatSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function prepareContainerMounts(modules = resolve('node_modules')) {
  const root = lstatSync(modules);
  if (!root.isDirectory() || root.isSymbolicLink()) {
    throw new Error('QA preparation requires the real dependency directory, not a symlink');
  }
  const paths = ['.vite', '.vite-temp'].map(name => join(modules, name));
  // Validate both first: never follow links or replace existing files/caches.
  for (const path of paths) {
    let stat;
    try { stat = lstatSync(path); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) {
      throw new Error(`Unsafe QA mountpoint: ${path}`);
    }
  }
  for (const path of paths) {
    try { mkdirSync(path, { mode: 0o755 }); } catch (error) {
      // EEXIST is expected on repeated installs; validate it, including races.
      if (error.code !== 'EEXIST' || !lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) throw error;
    }
  }
  return paths;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 3) throw new Error('Usage: prepare-container-mounts.mjs [real-node_modules-path]');
    prepareContainerMounts(process.argv[2] ? resolve(process.argv[2]) : undefined);
    console.log('QA Vite mountpoints ready');
  } catch (error) {
    console.error(`QA preparation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
