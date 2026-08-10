#!/usr/bin/env node

/**
 * code-intel.mjs — Semantic Code Intelligence CLI for AI Agents
 *
 * Single entry point for all code analysis commands.
 * Built on ts-morph (TypeScript Compiler API).
 *
 * Usage:
 *   node tools/code-intel.mjs <command> [args] [options]
 *
 * Commands:
 *   refs <symbol>         Find all references to a symbol
 *   type-info <file>      Show module structure (exports, imports, declarations)
 *   structure <file>      File outline with line numbers
 *   errors [path]         TypeScript compilation errors
 *   exports <file>        All exports with types
 *   implementors <iface>  Find all implementations of an interface
 *   call-graph <fn>       Call graph for a function
 *   deps <file>           Import dependency tree
 *
 * Options:
 *   --json                Output as JSON (for programmatic use)
 *   --quiet               Only summary counts
 *   --project <scope>     client | server | all (default: all)
 *   --help, -h            Show help
 *
 * Exit codes:
 *   0 = success with results
 *   1 = error
 *   2 = success but no results found
 *
 * Examples:
 *   node tools/code-intel.mjs refs createRow
 *   node tools/code-intel.mjs type-info src/shared/utils/apiClient.ts
 *   node tools/code-intel.mjs errors --project client --json
 *   node tools/code-intel.mjs refs createRow | grep service
 *   node tools/code-intel.mjs exports src/features/auth/ | wc -l
 */

import { loadProject, getSourceFiles, getSourceFile, getProjectRoot, getScopes } from './lib/project-loader.mjs';
import { resolve, relative } from 'path';

// ── Argument Parsing ──────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    command: null,
    args: [],
    json: false,
    quiet: false,
    project: 'all',
    help: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--quiet' || arg === '-q') {
      options.quiet = true;
    } else if (arg === '--project' || arg === '-p') {
      i++;
      options.project = args[i] || 'all';
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg.startsWith('--')) {
      // Unknown option — ignore
    } else if (!options.command) {
      options.command = arg;
    } else {
      options.args.push(arg);
    }
    i++;
  }

  return options;
}

// ── Output Formatting ─────────────────────────────────────────────

/**
 * Format and print results.
 * @param {Array<Record<string, any>>} rows - Array of result objects
 * @param {object} meta - { command, query, count, duration_ms }
 * @param {object} options - { json, quiet }
 */
function output(rows, meta, options) {
  if (options.json) {
    const result = {
      command: meta.command,
      query: meta.query || null,
      count: rows.length,
      duration_ms: meta.duration_ms || 0,
      results: rows,
    };
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  if (options.quiet) {
    process.stdout.write(`${rows.length}\n`);
    return;
  }

  // TSV output — pipe-friendly
  if (rows.length === 0) {
    process.stderr.write(`No results found.\n`);
    return;
  }

  // Print header from first row keys
  const keys = Object.keys(rows[0]);
  process.stdout.write(keys.join('\t') + '\n');

  // Print rows
  for (const row of rows) {
    const values = keys.map(k => String(row[k] ?? ''));
    process.stdout.write(values.join('\t') + '\n');
  }
}

/**
 * Print error and exit.
 */
function exitError(message, code = 1) {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(code);
}

// ── Command Registry ──────────────────────────────────────────────

const COMMANDS = {
  refs: {
    description: 'Find all references to a symbol',
    usage: 'refs <symbol> [--project scope]',
    examples: [
      'refs createRow',
      'refs TableService --project server',
      'refs useAuth --project client | grep features',
    ],
    handler: cmdRefs,
  },
  'type-info': {
    description: 'Show module structure (exports, imports, declarations)',
    usage: 'type-info <file>',
    examples: [
      'type-info src/shared/utils/apiClient.ts',
      'type-info backend/services/tableService.js',
    ],
    handler: cmdTypeInfo,
  },
  structure: {
    description: 'File outline with line numbers',
    usage: 'structure <file>',
    examples: [
      'structure src/shared/utils/apiClient.ts',
      'structure backend/routes/v3/tables.js',
    ],
    handler: cmdStructure,
  },
  errors: {
    description: 'TypeScript/JavaScript compilation errors',
    usage: 'errors [path] [--project scope]',
    examples: [
      'errors',
      'errors src/features/auth/',
      'errors --project client --json',
    ],
    handler: cmdErrors,
  },
  exports: {
    description: 'All exports from a module with types',
    usage: 'exports <file>',
    examples: [
      'exports src/shared/utils/apiClient.ts',
      'exports backend/services/ | sort',
    ],
    handler: cmdExports,
  },
  implementors: {
    description: 'Find all implementations of an interface/type',
    usage: 'implementors <interface-name>',
    examples: [
      'implementors BaseWidget',
      'implementors RouteHandler --project server',
    ],
    handler: cmdImplementors,
  },
  'call-graph': {
    description: 'Show call graph for a function',
    usage: 'call-graph <function-name>',
    examples: [
      'call-graph createRow',
      'call-graph handleAuth --json',
    ],
    handler: cmdCallGraph,
  },
  deps: {
    description: 'Import dependency tree for a file',
    usage: 'deps <file> [--depth N]',
    examples: [
      'deps src/shared/utils/apiClient.ts',
      'deps backend/server.js --depth 2',
    ],
    handler: cmdDeps,
  },
};

// ── Command Implementations ───────────────────────────────────────

function cmdRefs(project, args, options) {
  const symbol = args[0];
  if (!symbol) exitError('Usage: refs <symbol>\nExample: refs createRow');

  const start = Date.now();
  const root = getProjectRoot();
  const results = [];

  for (const sourceFile of getSourceFiles(project)) {
    const filePath = relative(root, sourceFile.getFilePath());

    // Search all identifiers in the file
    sourceFile.forEachDescendant((node) => {
      if (node.getKindName() === 'Identifier' && node.getText() === symbol) {
        const line = node.getStartLineNumber();
        const col = node.getStartLinePos ? node.getStart() - node.getStartLinePos() : 0;
        const parent = node.getParent();
        const context = parent ? parent.getKindName() : 'unknown';

        results.push({
          file: filePath,
          line,
          col,
          context,
          text: parent ? parent.getText().substring(0, 120).replace(/\n/g, ' ') : '',
        });
      }
    });
  }

  const duration = Date.now() - start;
  output(results, { command: 'refs', query: symbol, duration_ms: duration }, options);
  return results.length === 0 ? 2 : 0;
}

function cmdTypeInfo(project, args, options) {
  const filePath = args[0];
  if (!filePath) exitError('Usage: type-info <file>\nExample: type-info src/shared/utils/apiClient.ts');

  const start = Date.now();
  const sourceFile = getSourceFile(project, filePath);
  if (!sourceFile) exitError(`File not found: ${filePath}`);

  const results = [];
  const root = getProjectRoot();
  const relPath = relative(root, sourceFile.getFilePath());

  // Imports
  for (const imp of sourceFile.getImportDeclarations()) {
    const moduleSpec = imp.getModuleSpecifierValue();
    const namedImports = imp.getNamedImports().map(n => n.getName());
    const defaultImport = imp.getDefaultImport()?.getText();

    results.push({
      kind: 'import',
      name: defaultImport || namedImports.join(', '),
      type: 'module',
      from: moduleSpec,
      line: imp.getStartLineNumber(),
    });
  }

  // Exports
  for (const [name, declarations] of sourceFile.getExportedDeclarations()) {
    for (const decl of declarations) {
      results.push({
        kind: 'export',
        name,
        type: decl.getKindName(),
        from: relPath,
        line: decl.getStartLineNumber(),
      });
    }
  }

  // Functions (non-exported)
  for (const fn of sourceFile.getFunctions()) {
    if (!fn.isExported()) {
      results.push({
        kind: 'function',
        name: fn.getName() || '<anonymous>',
        type: `(${fn.getParameters().map(p => p.getName()).join(', ')})`,
        from: relPath,
        line: fn.getStartLineNumber(),
      });
    }
  }

  // Interfaces
  for (const iface of sourceFile.getInterfaces()) {
    if (!iface.isExported()) {
      results.push({
        kind: 'interface',
        name: iface.getName(),
        type: `{${iface.getProperties().length} props}`,
        from: relPath,
        line: iface.getStartLineNumber(),
      });
    }
  }

  // Type aliases
  for (const ta of sourceFile.getTypeAliases()) {
    if (!ta.isExported()) {
      results.push({
        kind: 'type',
        name: ta.getName(),
        type: ta.getTypeNode()?.getText().substring(0, 80) || '?',
        from: relPath,
        line: ta.getStartLineNumber(),
      });
    }
  }

  const duration = Date.now() - start;
  output(results, { command: 'type-info', query: filePath, duration_ms: duration }, options);
  return results.length === 0 ? 2 : 0;
}

function cmdStructure(project, args, options) {
  const filePath = args[0];
  if (!filePath) exitError('Usage: structure <file>\nExample: structure src/shared/utils/apiClient.ts');

  const start = Date.now();
  const sourceFile = getSourceFile(project, filePath);
  if (!sourceFile) exitError(`File not found: ${filePath}`);

  const results = [];

  // Classes
  for (const cls of sourceFile.getClasses()) {
    results.push({
      kind: 'class',
      name: cls.getName() || '<anonymous>',
      line: cls.getStartLineNumber(),
      end_line: cls.getEndLineNumber(),
      exported: cls.isExported(),
    });
    for (const method of cls.getMethods()) {
      results.push({
        kind: '  method',
        name: `${cls.getName()}.${method.getName()}`,
        line: method.getStartLineNumber(),
        end_line: method.getEndLineNumber(),
        exported: false,
      });
    }
    for (const prop of cls.getProperties()) {
      results.push({
        kind: '  property',
        name: `${cls.getName()}.${prop.getName()}`,
        line: prop.getStartLineNumber(),
        end_line: prop.getStartLineNumber(),
        exported: false,
      });
    }
  }

  // Functions
  for (const fn of sourceFile.getFunctions()) {
    const params = fn.getParameters().map(p => p.getName()).join(', ');
    results.push({
      kind: 'function',
      name: `${fn.getName() || '<anonymous>'}(${params})`,
      line: fn.getStartLineNumber(),
      end_line: fn.getEndLineNumber(),
      exported: fn.isExported(),
    });
  }

  // Variable declarations (arrow functions, consts)
  for (const varStmt of sourceFile.getVariableStatements()) {
    for (const decl of varStmt.getDeclarations()) {
      const init = decl.getInitializer();
      const isArrowFn = init && init.getKindName() === 'ArrowFunction';
      results.push({
        kind: isArrowFn ? 'arrow-fn' : 'const',
        name: decl.getName(),
        line: decl.getStartLineNumber(),
        end_line: init ? init.getEndLineNumber() : decl.getStartLineNumber(),
        exported: varStmt.isExported(),
      });
    }
  }

  // Interfaces
  for (const iface of sourceFile.getInterfaces()) {
    results.push({
      kind: 'interface',
      name: iface.getName(),
      line: iface.getStartLineNumber(),
      end_line: iface.getEndLineNumber(),
      exported: iface.isExported(),
    });
  }

  // Type aliases
  for (const ta of sourceFile.getTypeAliases()) {
    results.push({
      kind: 'type',
      name: ta.getName(),
      line: ta.getStartLineNumber(),
      end_line: ta.getEndLineNumber(),
      exported: ta.isExported(),
    });
  }

  // Enums
  for (const en of sourceFile.getEnums()) {
    results.push({
      kind: 'enum',
      name: en.getName(),
      line: en.getStartLineNumber(),
      end_line: en.getEndLineNumber(),
      exported: en.isExported(),
    });
  }

  // Sort by line number
  results.sort((a, b) => a.line - b.line);

  const duration = Date.now() - start;
  output(results, { command: 'structure', query: filePath, duration_ms: duration }, options);
  return results.length === 0 ? 2 : 0;
}

function cmdErrors(project, args, options) {
  const filterPath = args[0] || null;
  const start = Date.now();
  const root = getProjectRoot();
  const results = [];

  const files = filterPath
    ? getSourceFiles(project).filter(f => relative(root, f.getFilePath()).startsWith(filterPath))
    : getSourceFiles(project);

  for (const sourceFile of files) {
    const diagnostics = sourceFile.getPreEmitDiagnostics();
    for (const diag of diagnostics) {
      const file = diag.getSourceFile();
      const filePath = file ? relative(root, file.getFilePath()) : '?';
      const line = diag.getLineNumber() || 0;

      results.push({
        file: filePath,
        line,
        severity: getSeverityText(diag.getCategory()),
        code: `TS${diag.getCode()}`,
        message: diag.getMessageText().toString().substring(0, 200).replace(/\n/g, ' '),
      });
    }
  }

  const duration = Date.now() - start;
  output(results, { command: 'errors', query: filterPath || 'all', duration_ms: duration }, options);
  return results.length === 0 ? 0 : 1; // errors = exit 1
}

function getSeverityText(category) {
  // ts.DiagnosticCategory: 0=Warning, 1=Error, 2=Suggestion, 3=Message
  switch (category) {
    case 0: return 'warning';
    case 1: return 'error';
    case 2: return 'suggestion';
    case 3: return 'message';
    default: return 'unknown';
  }
}

function cmdExports(project, args, options) {
  const filePath = args[0];
  if (!filePath) exitError('Usage: exports <file>\nExample: exports src/shared/utils/apiClient.ts');

  const start = Date.now();
  const root = getProjectRoot();
  const results = [];

  // If path is a directory, scan all files in it
  const files = filePath.endsWith('/')
    ? getSourceFiles(project).filter(f => relative(root, f.getFilePath()).startsWith(filePath))
    : [getSourceFile(project, filePath)].filter(Boolean);

  if (files.length === 0) exitError(`No files found: ${filePath}`);

  for (const sourceFile of files) {
    const relPath = relative(root, sourceFile.getFilePath());
    for (const [name, declarations] of sourceFile.getExportedDeclarations()) {
      for (const decl of declarations) {
        let typeText = '';
        try {
          typeText = decl.getType().getText(decl).substring(0, 100);
        } catch {
          typeText = decl.getKindName();
        }

        results.push({
          file: relPath,
          name,
          kind: decl.getKindName(),
          type: typeText,
          line: decl.getStartLineNumber(),
        });
      }
    }
  }

  const duration = Date.now() - start;
  output(results, { command: 'exports', query: filePath, duration_ms: duration }, options);
  return results.length === 0 ? 2 : 0;
}

function cmdImplementors(project, args, options) {
  const interfaceName = args[0];
  if (!interfaceName) exitError('Usage: implementors <interface-name>\nExample: implementors BaseWidget');

  const start = Date.now();
  const root = getProjectRoot();
  const results = [];

  // First, find the interface declaration
  let targetInterface = null;
  for (const sourceFile of getSourceFiles(project)) {
    const iface = sourceFile.getInterface(interfaceName);
    if (iface) {
      targetInterface = iface;
      break;
    }
    // Also check type aliases
    const typeAlias = sourceFile.getTypeAlias(interfaceName);
    if (typeAlias) {
      targetInterface = typeAlias;
      break;
    }
  }

  if (!targetInterface) {
    exitError(`Interface/type "${interfaceName}" not found`);
  }

  // Find all classes/types that implement/extend it
  for (const sourceFile of getSourceFiles(project)) {
    const relPath = relative(root, sourceFile.getFilePath());

    // Check classes
    for (const cls of sourceFile.getClasses()) {
      const impls = cls.getImplements();
      for (const impl of impls) {
        if (impl.getText().includes(interfaceName)) {
          results.push({
            file: relPath,
            name: cls.getName() || '<anonymous>',
            kind: 'class implements',
            line: cls.getStartLineNumber(),
          });
        }
      }

      // Check extends
      const baseClass = cls.getExtends();
      if (baseClass && baseClass.getText().includes(interfaceName)) {
        results.push({
          file: relPath,
          name: cls.getName() || '<anonymous>',
          kind: 'class extends',
          line: cls.getStartLineNumber(),
        });
      }
    }

    // Check interfaces that extend target
    for (const iface of sourceFile.getInterfaces()) {
      if (iface.getName() === interfaceName) continue;
      const exts = iface.getExtends();
      for (const ext of exts) {
        if (ext.getText().includes(interfaceName)) {
          results.push({
            file: relPath,
            name: iface.getName(),
            kind: 'interface extends',
            line: iface.getStartLineNumber(),
          });
        }
      }
    }
  }

  const duration = Date.now() - start;
  output(results, { command: 'implementors', query: interfaceName, duration_ms: duration }, options);
  return results.length === 0 ? 2 : 0;
}

function cmdCallGraph(project, args, options) {
  const functionName = args[0];
  if (!functionName) exitError('Usage: call-graph <function-name>\nExample: call-graph createRow');

  const start = Date.now();
  const root = getProjectRoot();
  const results = [];

  for (const sourceFile of getSourceFiles(project)) {
    const relPath = relative(root, sourceFile.getFilePath());

    sourceFile.forEachDescendant((node) => {
      // Find function/method declarations matching the name
      const kindName = node.getKindName();
      if (
        (kindName === 'FunctionDeclaration' || kindName === 'MethodDeclaration') &&
        node.getName && node.getName() === functionName
      ) {
        // Find all call expressions inside this function
        node.forEachDescendant((child) => {
          if (child.getKindName() === 'CallExpression') {
            const expr = child.getExpression();
            const calledName = expr.getText().substring(0, 80);

            results.push({
              from: `${relPath}:${functionName}`,
              calls: calledName,
              line: child.getStartLineNumber(),
              type: 'outgoing',
            });
          }
        });
      }
    });
  }

  // Also find who calls this function (incoming)
  for (const sourceFile of getSourceFiles(project)) {
    const relPath = relative(root, sourceFile.getFilePath());

    sourceFile.forEachDescendant((node) => {
      if (node.getKindName() === 'CallExpression') {
        const expr = node.getExpression();
        const text = expr.getText();
        // Match direct calls or method calls ending with the function name
        if (text === functionName || text.endsWith(`.${functionName}`)) {
          // Find enclosing function
          let parent = node.getParent();
          let enclosing = '<module>';
          while (parent) {
            const pk = parent.getKindName();
            if (pk === 'FunctionDeclaration' || pk === 'MethodDeclaration' || pk === 'ArrowFunction') {
              enclosing = parent.getName ? (parent.getName() || '<arrow>') : '<arrow>';
              break;
            }
            parent = parent.getParent();
          }

          results.push({
            from: `${relPath}:${enclosing}`,
            calls: functionName,
            line: node.getStartLineNumber(),
            type: 'incoming',
          });
        }
      }
    });
  }

  const duration = Date.now() - start;
  output(results, { command: 'call-graph', query: functionName, duration_ms: duration }, options);
  return results.length === 0 ? 2 : 0;
}

function cmdDeps(project, args, options) {
  const filePath = args[0];
  if (!filePath) exitError('Usage: deps <file>\nExample: deps src/shared/utils/apiClient.ts');

  const start = Date.now();
  const sourceFile = getSourceFile(project, filePath);
  if (!sourceFile) exitError(`File not found: ${filePath}`);

  const root = getProjectRoot();
  const results = [];
  const visited = new Set();

  function walk(sf, depth) {
    const relPath = relative(root, sf.getFilePath());
    if (visited.has(relPath)) return;
    visited.add(relPath);

    for (const imp of sf.getImportDeclarations()) {
      const moduleSpec = imp.getModuleSpecifierValue();
      const resolvedFile = imp.getModuleSpecifierSourceFile();
      const resolvedPath = resolvedFile ? relative(root, resolvedFile.getFilePath()) : moduleSpec;
      const isExternal = !resolvedFile || resolvedPath.startsWith('node_modules');

      results.push({
        file: relPath,
        imports: moduleSpec,
        resolved: isExternal ? `[external] ${moduleSpec}` : resolvedPath,
        depth,
        external: isExternal,
      });

      // Recurse into local deps (max depth 5)
      if (!isExternal && resolvedFile && depth < 5) {
        walk(resolvedFile, depth + 1);
      }
    }
  }

  walk(sourceFile, 0);

  const duration = Date.now() - start;
  output(results, { command: 'deps', query: filePath, duration_ms: duration }, options);
  return results.length === 0 ? 2 : 0;
}

// ── Help ──────────────────────────────────────────────────────────

function showHelp(command) {
  if (command && COMMANDS[command]) {
    const cmd = COMMANDS[command];
    process.stdout.write(`\n  ${command} — ${cmd.description}\n\n`);
    process.stdout.write(`  Usage: node tools/code-intel.mjs ${cmd.usage}\n\n`);
    process.stdout.write(`  Examples:\n`);
    for (const ex of cmd.examples) {
      process.stdout.write(`    node tools/code-intel.mjs ${ex}\n`);
    }
    process.stdout.write('\n');
    process.stdout.write(`  Options:\n`);
    process.stdout.write(`    --json              Output as JSON\n`);
    process.stdout.write(`    --quiet, -q         Only print count\n`);
    process.stdout.write(`    --project, -p       Scope: client | server | all (default: all)\n`);
    process.stdout.write('\n');
  } else {
    process.stdout.write(`
  code-intel — Semantic Code Intelligence for AI Agents
  Built on ts-morph (TypeScript Compiler API)

  Usage: node tools/code-intel.mjs <command> [args] [options]

  Commands:
`);
    for (const [name, cmd] of Object.entries(COMMANDS)) {
      process.stdout.write(`    ${name.padEnd(16)} ${cmd.description}\n`);
    }
    process.stdout.write(`
  Options:
    --json              Output as JSON (for programmatic use)
    --quiet, -q         Only print count
    --project, -p       Scope: client | server | all (default: all)
    --help, -h          Show help

  Exit codes:
    0 = success with results
    1 = error
    2 = no results found

  Examples:
    node tools/code-intel.mjs refs createRow
    node tools/code-intel.mjs refs createRow --json | jq '.results[].file'
    node tools/code-intel.mjs errors --project client
    node tools/code-intel.mjs structure src/app/App.tsx
    node tools/code-intel.mjs deps backend/server.js | grep -v external

`);
  }
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  const options = parseArgs(process.argv);

  // Help
  if (options.help || !options.command) {
    showHelp(options.command);
    process.exit(options.command ? 0 : 1);
  }

  // Validate command
  const cmd = COMMANDS[options.command];
  if (!cmd) {
    process.stderr.write(`Unknown command: ${options.command}\n`);
    process.stderr.write(`Run: node tools/code-intel.mjs --help\n`);
    process.exit(1);
  }

  // Load project
  const start = Date.now();
  let project;
  try {
    project = loadProject(options.project);
  } catch (err) {
    exitError(`Failed to load project (scope: ${options.project}): ${err.message}`);
  }

  const loadTime = Date.now() - start;
  if (!options.quiet && !options.json) {
    process.stderr.write(`Project loaded (${options.project}) in ${loadTime}ms — ${getSourceFiles(project).length} files\n`);
  }

  // Execute command
  const exitCode = cmd.handler(project, options.args, options);
  process.exit(exitCode || 0);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
