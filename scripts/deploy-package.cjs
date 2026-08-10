#!/usr/bin/env node
/**
 * GOD CRM — Package Deployer
 *
 * Deploys modular table packages to any CRM space via API.
 *
 * Usage:
 *   node scripts/deploy-package.js --space <space_id> --project <project_name> --modules <module1,module2,...>
 *   node scripts/deploy-package.js --space 37 --project "System Data" --preset standard
 *   node scripts/deploy-package.js --space 37 --project "System Data" --modules ai-core,project-mgmt
 *   node scripts/deploy-package.js --space 37 --project "System Data" --preset full --dry-run
 *
 * Options:
 *   --space       Target space ID (required)
 *   --project     Target project name — will find or create (required)
 *   --modules     Comma-separated module names to deploy
 *   --preset      Use a preset: minimal, standard, full, personal
 *   --dry-run     Show what would be created without making API calls
 *   --seed        Also seed data from source tables
 *   --api-url     Override API base URL (default: https://crm.hltrn.cc/api/v3)
 *   --api-key     Override API key (default: from env or hardcoded)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// ── Config ──
const PACKAGES_DIR = path.resolve(__dirname, '../packages');
const DEFAULT_API_URL = process.env.GODCRM_API_URL || 'https://crm.hltrn.cc/api/v3';
const DEFAULT_API_KEY = process.env.GODCRM_API_KEY || '';

// ── CLI Args ──
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
}
const hasFlag = (name) => args.includes(`--${name}`);

const SPACE_ID = getArg('space');
const PROJECT_NAME = getArg('project');
const MODULES_ARG = getArg('modules');
const PRESET = getArg('preset');
const DRY_RUN = hasFlag('dry-run');
const SEED = hasFlag('seed');
const API_URL = getArg('api-url') || DEFAULT_API_URL;
const API_KEY = getArg('api-key') || DEFAULT_API_KEY;

if (!SPACE_ID || !PROJECT_NAME) {
  console.error('Usage: node deploy-package.js --space <id> --project <name> [--modules m1,m2 | --preset name] [--dry-run] [--seed]');
  process.exit(1);
}

// ── Load manifest ──
const manifest = JSON.parse(fs.readFileSync(path.join(PACKAGES_DIR, 'manifest.json'), 'utf-8'));

// Determine which modules to deploy
let moduleNames;
if (MODULES_ARG) {
  moduleNames = MODULES_ARG.split(',').map(s => s.trim());
} else if (PRESET) {
  moduleNames = manifest.presets[PRESET];
  if (!moduleNames) {
    console.error(`Unknown preset: ${PRESET}. Available: ${Object.keys(manifest.presets).join(', ')}`);
    process.exit(1);
  }
} else {
  moduleNames = manifest.presets.standard;
  console.log('No modules or preset specified, using "standard" preset');
}

// Sort by deploy_order
const orderedModules = manifest.deploy_order.filter(m => moduleNames.includes(m));
console.log(`\n🚀 Deploying modules: ${orderedModules.join(', ')} to space ${SPACE_ID} / project "${PROJECT_NAME}"`);
if (DRY_RUN) console.log('📋 DRY RUN — no API calls will be made\n');

// ── HTTP helper ──
function apiRequest(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${API_URL}${endpoint}`);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      rejectUnauthorized: false,
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(`API ${res.statusCode}: ${JSON.stringify(json)}`));
          } else {
            resolve(json);
          }
        } catch {
          reject(new Error(`Non-JSON response (${res.statusCode}): ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ── Resolve table refs to real IDs ──
const tableRefMap = {}; // ref -> created table ID

async function findOrCreateProject(spaceId, projectName) {
  console.log(`📂 Finding project "${projectName}" in space ${spaceId}...`);

  if (DRY_RUN) {
    console.log(`   [DRY] Would find/create project "${projectName}"`);
    return 999;
  }

  const space = await apiRequest('GET', `/spaces/${spaceId}`);
  const projects = space.projects || [];
  const existing = projects.find(p => p.name === projectName);

  if (existing) {
    console.log(`   Found existing project: ID ${existing.id}`);
    return existing.id;
  }

  console.log(`   Creating new project "${projectName}"...`);
  const result = await apiRequest('POST', `/spaces/${spaceId}/projects`, { name: projectName });
  console.log(`   Created project: ID ${result.id}`);
  return result.id;
}

async function createTable(projectId, tableDef) {
  console.log(`  📊 Creating table "${tableDef.name}"...`);

  if (DRY_RUN) {
    const fakeId = 9000 + Object.keys(tableRefMap).length;
    tableRefMap[tableDef.ref] = fakeId;
    console.log(`     [DRY] Would create table "${tableDef.name}" with ${tableDef.columns.length} columns`);
    for (const col of tableDef.columns) {
      console.log(`     [DRY]   - ${col.column_name} (${col.type})`);
    }
    return fakeId;
  }

  // Create the table
  const table = await apiRequest('POST', `/projects/${projectId}/tables`, {
    name: tableDef.name,
    icon: tableDef.icon || null,
    description: tableDef.description || null,
  });

  const tableId = table.id;
  tableRefMap[tableDef.ref] = tableId;
  console.log(`     Created: ID ${tableId}`);

  // Add columns
  for (const col of tableDef.columns) {
    const colPayload = {
      column_name: col.column_name,
      display_name: col.display_name,
      type: col.type,
    };

    // Resolve relation tableRef -> real table ID
    if (col.config) {
      const config = JSON.parse(JSON.stringify(col.config));
      if (config.relation && config.relation.tableRef) {
        const resolvedId = tableRefMap[config.relation.tableRef];
        if (resolvedId) {
          config.relation.tableId = String(resolvedId);
          delete config.relation.tableRef;
        } else {
          console.warn(`     ⚠️  Unresolved tableRef: ${config.relation.tableRef} — column ${col.column_name}`);
        }
      }
      colPayload.config = config;
    }

    try {
      await apiRequest('POST', `/tables/${tableId}/columns`, colPayload);
      console.log(`     + ${col.column_name} (${col.type})`);
    } catch (err) {
      console.error(`     ❌ Column ${col.column_name}: ${err.message}`);
    }
  }

  // Seed data if defined inline
  if (tableDef.seed_data && Array.isArray(tableDef.seed_data)) {
    console.log(`     🌱 Seeding ${tableDef.seed_data.length} rows...`);
    for (const row of tableDef.seed_data) {
      try {
        await apiRequest('POST', `/tables/${tableId}/rows`, row);
      } catch (err) {
        console.error(`     ❌ Seed row: ${err.message}`);
      }
    }
  }

  return tableId;
}

async function seedFromSource(sourceTableId, targetTableId, options = {}) {
  console.log(`     🌱 Copying data from source table ${sourceTableId}...`);

  if (DRY_RUN) {
    console.log(`     [DRY] Would copy rows from table ${sourceTableId} to ${targetTableId}`);
    return;
  }

  let offset = 0;
  const limit = 100;
  let totalCopied = 0;

  while (true) {
    const response = await apiRequest('GET', `/tables/${sourceTableId}/rows?limit=${limit}&offset=${offset}`);
    const rows = response.rows || response.data || response || [];

    if (!Array.isArray(rows) || rows.length === 0) break;

    for (const row of rows) {
      // Remove system fields
      const { id, created_at, updated_at, _row_number, ...data } = row;
      try {
        await apiRequest('POST', `/tables/${targetTableId}/rows`, data);
        totalCopied++;
      } catch (err) {
        console.error(`     ❌ Copy row: ${err.message}`);
      }
    }

    offset += limit;
    if (rows.length < limit) break;
  }

  console.log(`     ✅ Copied ${totalCopied} rows`);
}

// ── Main deploy logic ──
async function deploy() {
  const startTime = Date.now();
  const projectId = await findOrCreateProject(parseInt(SPACE_ID), PROJECT_NAME);

  const report = {
    space_id: parseInt(SPACE_ID),
    project: PROJECT_NAME,
    project_id: projectId,
    modules_deployed: [],
    tables_created: [],
    errors: [],
  };

  for (const moduleName of orderedModules) {
    console.log(`\n📦 Module: ${moduleName}`);

    const modulePath = path.join(PACKAGES_DIR, moduleName, 'module.json');
    if (!fs.existsSync(modulePath)) {
      console.error(`   ❌ Module file not found: ${modulePath}`);
      report.errors.push({ module: moduleName, error: 'module.json not found' });
      continue;
    }

    const mod = JSON.parse(fs.readFileSync(modulePath, 'utf-8'));

    // Check dependencies
    for (const dep of (mod.dependencies || [])) {
      if (!orderedModules.includes(dep) && !report.modules_deployed.includes(dep)) {
        console.warn(`   ⚠️  Missing dependency: ${dep}`);
      }
    }

    // Create tables in dependency order
    const tables = mod.tables || [];
    const created = new Set();
    const pending = [...tables];
    let maxAttempts = tables.length * 2;

    while (pending.length > 0 && maxAttempts-- > 0) {
      const table = pending.shift();
      const deps = table.depends_on || [];
      const unmet = deps.filter(d => !created.has(d) && !tableRefMap[d]);

      if (unmet.length > 0) {
        pending.push(table); // retry later
        continue;
      }

      try {
        const tableId = await createTable(projectId, table);
        created.add(table.ref);
        report.tables_created.push({
          ref: table.ref,
          name: table.name,
          id: tableId,
          module: moduleName,
          columns: table.columns.length,
        });

        // Seed from source if requested
        if (SEED && table.seed_data && table.seed_data.copy_from_source) {
          await seedFromSource(table.source_id, tableId);
        }
        if (SEED && mod.seed_data && mod.seed_data[table.ref] && mod.seed_data[table.ref].copy_from_source) {
          await seedFromSource(table.source_id, tableId);
        }
      } catch (err) {
        console.error(`   ❌ Table "${table.name}": ${err.message}`);
        report.errors.push({ module: moduleName, table: table.name, error: err.message });
      }
    }

    report.modules_deployed.push(moduleName);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n' + '═'.repeat(60));
  console.log('📋 DEPLOYMENT REPORT');
  console.log('═'.repeat(60));
  console.log(`Space:    ${SPACE_ID}`);
  console.log(`Project:  ${PROJECT_NAME} (ID: ${projectId})`);
  console.log(`Modules:  ${report.modules_deployed.join(', ')}`);
  console.log(`Tables:   ${report.tables_created.length} created`);
  console.log(`Errors:   ${report.errors.length}`);
  console.log(`Time:     ${elapsed}s`);
  console.log(`Mode:     ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log('');

  if (report.tables_created.length > 0) {
    console.log('Created tables:');
    for (const t of report.tables_created) {
      console.log(`  ${t.module}/${t.ref} → "${t.name}" (ID: ${t.id}, ${t.columns} cols)`);
    }
  }

  if (report.errors.length > 0) {
    console.log('\nErrors:');
    for (const e of report.errors) {
      console.log(`  ❌ ${e.module}${e.table ? '/' + e.table : ''}: ${e.error}`);
    }
  }

  // Save report
  const reportPath = path.join(PACKAGES_DIR, `deploy-report-${SPACE_ID}-${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n📄 Report saved: ${reportPath}`);
}

deploy().catch(err => {
  console.error('\n💥 Fatal error:', err.message);
  process.exit(1);
});
