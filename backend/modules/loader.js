/**
 * Autonomous-module registry — MODULE-CONTRACT v1 (ADR-165-P, registry row 199894).
 *
 * Core must NEVER name a module. Instead of a static `import simRoutesV3` +
 * `app.use(... simRoutesV3)` in server.js, core scans `backend/modules/<id>/
 * module.manifest.yaml` and wires each PRESENT module's backend contributions by
 * DATA (dynamic import), not by hard-coded paths. Remove a module's dirs and its
 * manifest → the scan simply returns less; core needs ZERO edits and still boots.
 * That absence-tolerance IS the contract's invariant (delete module → build/boot/
 * tsc green, no core edit).
 *
 * This is the *boot-time plugin registry*. It is unrelated to the CRM-facing
 * `routes/v3/modules.js` feature (installable in-app widget modules) — different
 * layer, similar word.
 *
 * Manifest paths are REPO-ROOT-relative (same convention as `owns_dirs`), so the
 * single manifest is the one source of truth for loaders, .gitignore and
 * `git rm --cached` alike.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// loader.js lives at <repo>/backend/modules/loader.js
export const MODULES_DIR = __dirname;
export const REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Read every present module manifest. Returns `[{ id, dir, manifest }]`.
 * Never throws: a missing modules dir yields `[]`; a malformed manifest disables
 * only ITS module (one warn line), never the whole app.
 */
export function readModuleManifests() {
  let entries;
  try {
    entries = fs.readdirSync(MODULES_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const manifestPath = path.join(MODULES_DIR, ent.name, 'module.manifest.yaml');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = yaml.load(fs.readFileSync(manifestPath, 'utf8')) || {};
      out.push({ id: manifest.id || ent.name, dir: path.join(MODULES_DIR, ent.name), manifest });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[modules] skipping "${ent.name}": manifest parse failed — ${err.message}`);
    }
  }
  return out;
}

/**
 * Absolute migration directories contributed by present modules — fed into knex's
 * `migrations.directory` array so module schema travels WITH the module. Absent
 * module → not in the list → core migration set is untouched.
 */
export function moduleMigrationDirs() {
  const dirs = [];
  for (const { manifest } of readModuleManifests()) {
    const rel = manifest?.backend?.migrations;
    if (!rel) continue;
    const abs = path.resolve(REPO_ROOT, rel);
    if (fs.existsSync(abs)) dirs.push(abs);
  }
  return dirs;
}

/**
 * Preset-data fragments contributed by present modules — the backend half of
 * seam #3 (ADR-165-P). Mirrors the frontend's `import.meta.glob('presets.
 * fragment.json')` runtime-merge: each present module's `frontend.preset_fragment`
 * JSON is read and shallow-merged into one `{ [preset_key]: presetConfig }` map,
 * shaped exactly like a `shared/widget-presets.json` entry so the caller's existing
 * transform loop handles it unchanged. Absent module → no fragment → `{}`, and the
 * preset simply isn't known to core (that absence IS the contract's invariant).
 *
 * A missing/malformed fragment disables only ITS preset (one warn line), never the
 * whole registry — same fault-isolation as the manifest scan itself.
 */
export function modulePresetFragments() {
  const merged = {};
  for (const { id, manifest } of readModuleManifests()) {
    const rel = manifest?.frontend?.preset_fragment;
    if (!rel) continue;
    const abs = path.resolve(REPO_ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    try {
      Object.assign(merged, JSON.parse(fs.readFileSync(abs, 'utf8')));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[modules] ${id}: preset fragment "${rel}" ignored — ${err.message}`);
    }
  }
  return merged;
}

/**
 * Dynamically mount each present module's backend routes onto `app`.
 *
 * @param {import('express').Express} app
 * @param {import('express').RequestHandler} auth  core `authenticate` middleware;
 *        a route with `auth: false` mounts public.
 * @param {{ info?: Function, warn?: Function }} [log]  pino/console-compatible.
 *
 * A failed module import is logged and skipped — one broken module must never
 * take down core or its siblings.
 */
export async function mountModuleRoutes(app, auth, log = console) {
  for (const { id, manifest } of readModuleManifests()) {
    const routes = manifest?.backend?.routes;
    if (!Array.isArray(routes)) continue;
    for (const route of routes) {
      const mount = route?.mount || '/api/v3';
      const rel = route?.router;
      if (!rel) continue;
      const abs = path.resolve(REPO_ROOT, rel);
      try {
        const mod = await import(pathToFileURL(abs).href);
        const router = mod.default;
        if (typeof router !== 'function') {
          log.warn?.(`[modules] ${id}: "${rel}" has no default-export router — skipped`);
          continue;
        }
        const mw = route.auth === false ? [] : [auth];
        app.use(mount, ...mw, router);
        log.info?.(`[modules] mounted "${id}" → ${mount} (${rel})`);
      } catch (err) {
        log.warn?.(`[modules] ${id}: failed to mount "${rel}" — ${err.message}`);
      }
    }
  }
}
