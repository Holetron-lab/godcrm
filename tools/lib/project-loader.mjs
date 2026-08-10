// project-loader.mjs -- ts-morph Project loader with scope support
//
// Loads the GOD CRM codebase for semantic analysis.
// Supports three scopes:
//   - client: src/**/*.ts, src/**/*.tsx (React frontend)
//   - server: backend/**/*.js, backend/**/*.mjs (Express backend)
//   - all:    both client + server (default)
//
// Usage:
//   import { loadProject, getSourceFiles } from './lib/project-loader.mjs';
//   const project = await loadProject('all');
//   const files = getSourceFiles(project);

import { Project } from 'ts-morph';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Root of business-crm project */
const PROJECT_ROOT = resolve(__dirname, '../..');

/** Cached project instances by scope */
const cache = new Map();

/**
 * Scope definitions — which files to include for each scope
 */
const SCOPES = {
  client: {
    tsConfigFilePath: resolve(PROJECT_ROOT, 'tsconfig.tools.json'),
    include: ['src/**/*.ts', 'src/**/*.tsx'],
    exclude: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/node_modules/**'],
    description: 'Frontend React/TypeScript (src/)',
  },
  server: {
    tsConfigFilePath: resolve(PROJECT_ROOT, 'tsconfig.tools.json'),
    include: [
      'backend/services/**/*.js',
      'backend/routes/**/*.js',
      'backend/middleware/**/*.js',
      'backend/utils/**/*.js',
      'backend/database/**/*.js',
      'backend/widgets/**/*.js',
      'backend/validation/**/*.js',
      'backend/worker/**/*.js',
    ],
    exclude: ['**/node_modules/**', '**/__tests__/**', '**/tests/**'],
    description: 'Backend Express/JavaScript (backend/ core)',
  },
  all: {
    tsConfigFilePath: resolve(PROJECT_ROOT, 'tsconfig.tools.json'),
    include: [
      'src/**/*.ts', 'src/**/*.tsx',
      'backend/services/**/*.js',
      'backend/routes/**/*.js',
      'backend/middleware/**/*.js',
      'backend/utils/**/*.js',
    ],
    exclude: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/node_modules/**', '**/__tests__/**'],
    description: 'Full project (src/ + backend/ core)',
  },
};

/**
 * Load a ts-morph Project for the given scope.
 * Results are cached — subsequent calls with same scope return cached instance.
 *
 * @param {string} scope - 'client' | 'server' | 'all'
 * @param {object} options
 * @param {boolean} options.fresh - Force reload, ignoring cache
 * @returns {Project}
 */
export function loadProject(scope = 'all', options = {}) {
  const { fresh = false } = options;

  if (!SCOPES[scope]) {
    const valid = Object.keys(SCOPES).join(', ');
    throw new Error(`Unknown scope "${scope}". Valid scopes: ${valid}`);
  }

  if (!fresh && cache.has(scope)) {
    return cache.get(scope);
  }

  const scopeConfig = SCOPES[scope];
  const tsConfigPath = scopeConfig.tsConfigFilePath;

  if (!existsSync(tsConfigPath)) {
    throw new Error(`tsconfig not found: ${tsConfigPath}\nRun from project root: /home/dev2/prod/business-crm`);
  }

  const project = new Project({
    tsConfigFilePath: tsConfigPath,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: scope === 'server',
    compilerOptions: {
      allowJs: true,
      checkJs: false, // checkJs causes OOM on 700+ backend JS files
      noEmit: true,
    },
  });

  // Add files based on scope
  for (const pattern of scopeConfig.include) {
    project.addSourceFilesAtPaths(resolve(PROJECT_ROOT, pattern));
  }

  cache.set(scope, project);
  return project;
}

/**
 * Get all source files from a loaded project.
 *
 * @param {Project} project
 * @returns {import('ts-morph').SourceFile[]}
 */
export function getSourceFiles(project) {
  return project.getSourceFiles();
}

/**
 * Get a specific source file by path (absolute or relative to project root).
 *
 * @param {Project} project
 * @param {string} filePath
 * @returns {import('ts-morph').SourceFile | undefined}
 */
export function getSourceFile(project, filePath) {
  const absPath = filePath.startsWith('/') ? filePath : resolve(PROJECT_ROOT, filePath);
  return project.getSourceFile(absPath);
}

/**
 * Clear the project cache.
 */
export function clearCache() {
  cache.clear();
}

/**
 * Get project root path.
 * @returns {string}
 */
export function getProjectRoot() {
  return PROJECT_ROOT;
}

/**
 * Get available scopes and their descriptions.
 * @returns {Record<string, {description: string, include: string[]}>}
 */
export function getScopes() {
  return Object.fromEntries(
    Object.entries(SCOPES).map(([key, val]) => [key, {
      description: val.description,
      include: val.include,
    }])
  );
}
