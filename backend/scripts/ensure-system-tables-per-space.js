// Ensure per-space System Data tables (Projects, Tables, Files)
import { dbAll } from '../database/connection.js';
import { ensureCoreSystemTablesForSpace } from '../services/SystemTablesCreator.js';

async function main() {
  const spaces = await dbAll('SELECT id, name FROM spaces ORDER BY id');
  console.log(`Found ${spaces.length} spaces`);

  for (const space of spaces) {
    const result = await ensureCoreSystemTablesForSpace(space.id);
    if (result) {
      console.log(
        `[space ${space.id} - ${space.name}] System Data project ${result.systemProjectId} | Projects ${result.projectsTableId} | Tables ${result.tablesTableId} | Files ${result.filesTableId}`
      );
    } else {
      console.log(`[space ${space.id} - ${space.name}] skipped (no data)`);
    }
  }
}

main()
  .then(() => {
    console.log('Ensure system tables completed');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Failed to ensure system tables per space:', err);
    process.exit(1);
  });
