import { pathToFileURL } from 'node:url';
import { safeJsonParse, sqlNow, withTransactionAsync } from '../database/connection.js';
import { provisionModuleTables } from '../services/ModuleTableProvisioner.js';
import { NAMED_PACK_BLUEPRINTS } from '../services/module-blueprint/namedPackBlueprints.js';
import { remapRelationConfig, relationTargetId } from '../services/module-blueprint/columnMapping.js';
import { persistColumnType } from '../services/ColumnService.js';
import { clearTicketOccurrencesCache } from '../services/ticket-occurrences/reconcile.js';

function eventTableDefinition(ticketsTableId, statesTableId) {
  const pack = NAMED_PACK_BLUEPRINTS.find((blueprint) => blueprint.key === 'kanban_pack');
  const definition = pack.tables.find((table) => table.key === 'ticket_events');
  return {
    ...definition,
    columns: definition.columns.map((column) => {
      if (column.column_name === 'ticket_id') {
        return { ...column, config: remapRelationConfig(column.config, ticketsTableId) };
      }
      if (column.column_name === 'state') {
        return { ...column, config: remapRelationConfig(column.config, statesTableId) };
      }
      return column;
    }),
  };
}

function boundToTickets(config, ticketsTableId) {
  return [config.table_id, config.tableId, config.kanban?.tableId, config.calendar?.tableId]
    .some((value) => Number(value) === ticketsTableId);
}

export async function setupTicketOccurrences(ticketsTableId) {
  const id = Number(ticketsTableId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('ticketsTableId must be a positive integer');

  const result = await withTransactionAsync(async (trx) => {
    const tickets = await trx.get('SELECT id, project_id, name FROM universal_tables WHERE id = ?', [id]);
    if (!tickets) throw new Error(`Tickets table ${id} not found`);

    const stateColumn = await trx.get(
      "SELECT config FROM table_columns WHERE table_id = ? AND column_name = 'state'",
      [id],
    );
    const statesTableId = Number(relationTargetId(stateColumn?.config));
    if (!statesTableId) throw new Error(`Tickets table ${id} has no state relation target`);

    await provisionModuleTables(tickets.project_id, {
      key: 'ticket_occurrences_ticket_columns',
      tables: [{
        key: 'tickets',
        name: tickets.name,
        columns: [
          { column_name: 'repeat', display_name: 'Repeat', type: 'time' },
          { column_name: 'duration', display_name: 'Duration', type: 'number', config: { min: 1, suffix: ' min' } },
        ],
      }],
    }, { trx, reconcile: true });

    const scheduled = await trx.get(
      "SELECT id, type FROM table_columns WHERE table_id = ? AND column_name = 'scheduled_date'",
      [id],
    );
    if (scheduled && scheduled.type !== 'datetime') {
      await trx.run('UPDATE table_columns SET type = ? WHERE id = ?', [persistColumnType('datetime'), scheduled.id]);
    }

    const mapping = await provisionModuleTables(tickets.project_id, {
      key: 'ticket_occurrences',
      tables: [eventTableDefinition(id, statesTableId)],
    }, { trx, reconcile: true });
    const eventsTableId = mapping.ticket_events.table_id;

    const widgets = await trx.all(
      `SELECT w.id, w.preset_name, w.config
       FROM widgets w
       JOIN dashboards d ON d.id = w.dashboard_id
       WHERE d.project_id = ?`,
      [tickets.project_id],
    );
    for (const widget of widgets) {
      const section = widget.preset_name === 'kanban_board'
        ? 'kanban'
        : widget.preset_name === 'calendar_widget' ? 'calendar' : null;
      if (!section) continue;
      const config = safeJsonParse(widget.config, {}) || {};
      if (!boundToTickets(config, id)) continue;
      if (Number(config[section]?.eventsTableId) === eventsTableId) continue;
      const next = {
        ...config,
        [section]: { ...(config[section] || {}), eventsTableId },
      };
      await trx.run(`UPDATE widgets SET config = ?, updated_at = ${sqlNow()} WHERE id = ?`, [JSON.stringify(next), widget.id]);
    }

    return { ticketsTableId: id, eventsTableId, statesTableId };
  });

  clearTicketOccurrencesCache();
  return result;
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, '').split('=');
    return [key, value];
  }));
  const result = await setupTicketOccurrences(args['tickets-table-id']);
  console.log(`ticket_events ready: tickets=${result.ticketsTableId}, events=${result.eventsTableId}, states=${result.statesTableId}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(() => process.exit(0)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
