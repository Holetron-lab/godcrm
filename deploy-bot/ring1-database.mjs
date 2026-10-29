// Self-contained program sent through the existing SSH transport. No credentials
// leave B; migrations use the same guarded pool that attests the actual server.
export function assertDatabaseIdentity(actual, expected) {
  if (actual.database !== 'godcrm_prod' || actual.recovery !== false ||
      !/^[0-9]+$/.test(actual.systemIdentifier || '') ||
      !actual.serverAddress || actual.serverAddress.includes('/') || !Number.isInteger(actual.serverPort) ||
      !/^[a-f0-9]{64}$/.test(actual.machineIdSha256 || '')) {
    throw Error('Invalid master B database identity');
  }
  if (expected) for (const key of ['database', 'systemIdentifier', 'serverAddress', 'serverPort', 'machineIdSha256']) {
    if (actual[key] !== expected[key]) throw Error(`Master B identity mismatch: ${key}`);
  }
  return actual;
}

export async function databaseProgram(options) {
  const { tree, knexfile, envFile, expected, action, dumpPath } = options;
  const fs = await import('node:fs');
  const os = await import('node:os');
  const crypto = await import('node:crypto');
  const { createRequire } = await import('node:module');
  const { pathToFileURL } = await import('node:url');
  const { spawnSync } = await import('node:child_process');
  if (!Object.values(os.networkInterfaces()).flat().some(a => a?.address === '<RING1_IP>')) {
    throw Error('Database operation requires the master B host');
  }
  if (!['identity', 'dump', 'status', 'latest'].includes(action)) throw Error('Unknown database action');
  if (action !== 'identity' && !expected) throw Error('Pinned database identity required');
  const require = createRequire(`${tree}/package.json`);
  // Do not inherit a bot/shell connection override. Load ONLY the selected B env.
  for (const key of Object.keys(process.env)) if (/^(POSTGRES_|PG)/.test(key)) delete process.env[key];
  const parsed = require('dotenv').parse(fs.readFileSync(envFile));
  for (const [key, value] of Object.entries(parsed)) if (key.startsWith('POSTGRES_')) process.env[key] = value;
  process.env.NODE_ENV = 'production';
  const configuration = (await import(pathToFileURL(`${tree}/${knexfile}`).href)).default.production;
  const connection = configuration.connection;
  if (configuration.client !== 'pg' || !connection || typeof connection !== 'object' ||
      connection.database !== 'godcrm_prod' || connection.connectionString) throw Error('Unsupported master B connection');
  const machineIdSha256 = crypto.createHash('sha256').update(fs.readFileSync('/etc/machine-id')).digest('hex');
  const sql = `SELECT current_database() AS database, system_identifier::text AS "systemIdentifier",
    host(inet_server_addr()) AS "serverAddress", inet_server_port() AS "serverPort",
    pg_is_in_recovery() AS recovery FROM pg_control_system()`;
  let identity;
  const db = require('knex')({ ...configuration, pool: { min: 0, max: 1,
    afterCreate(client, done) {
      client.query(sql, (error, result) => {
        try {
          if (error) throw error;
          identity = assertDatabaseIdentity({ ...result.rows[0], machineIdSha256 }, expected);
          done(null, client);
        } catch (failure) { done(failure, client); }
      });
    } } });
  try {
    await db.raw('SELECT 1'); // Guard executes before a connection enters the pool.
    process.stdout.write(JSON.stringify({ databaseIdentity: identity }) + '\n');
    if (action === 'dump') {
      if (!dumpPath) throw Error('Dump path required');
      // Use the observed address, not a hostname that may resolve elsewhere.
      const ssl = connection.ssl;
      const result = spawnSync('pg_dump', ['-h', identity.serverAddress, '-p', String(identity.serverPort),
        '-U', connection.user, '-d', identity.database, '-Fc', '-f', dumpPath], {
        env: { ...process.env, PGPASSWORD: connection.password,
          PGSSLMODE: ssl === false ? 'disable' : ssl?.rejectUnauthorized === false ? 'require' : 'verify-full' },
        stdio: 'inherit',
      });
      if (result.error || result.status !== 0) throw Error('Master B dump failed');
    } else if (action === 'status') {
      const [completed, pending] = await db.migrate.list();
      process.stdout.write(JSON.stringify({ completed, pending }) + '\n');
    } else if (action === 'latest') {
      process.stdout.write(JSON.stringify({ migrated: await db.migrate.latest() }) + '\n');
    }
  } finally { await db.destroy(); }
}

export function databaseCommand(options) {
  const quote = value => "'" + String(value).replace(/'/g, "'\\''") + "'";
  const script = `${assertDatabaseIdentity.toString()}\n${databaseProgram.toString()}\nawait databaseProgram(${JSON.stringify(options)});`;
  // The action label remains visible in sanitized command records.
  return `RING1_DB_ACTION=${options.action} node --input-type=module -e ${quote(script)}`;
}
