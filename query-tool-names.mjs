import pg from 'pg';

const pool = new pg.Pool({
  user: 'godcrm',
  host: 'localhost',
  database: 'godcrm_prod',
  password: 'strong_password_here',
  port: 5432
});

async function run() {
  const ids = [22310, 22312, 22313, 22314, 22315, 22317, 22321];
  const result = await pool.query(
    `SELECT id, data->>'name' as tool_name FROM table_rows WHERE id = ANY($1::int[])`,
    [ids]
  );
  console.log('Tool Names for IDs:');
  console.table(result.rows);
  await pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });
