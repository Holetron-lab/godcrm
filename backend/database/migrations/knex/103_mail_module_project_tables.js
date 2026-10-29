// Mail is a read-only projection: relocate its registry entry, never copy messages.
// Keep this backfill self-contained so future service changes cannot alter it.
export async function up(knex) {
  const projects = await knex('widgets as w').join('dashboards as d', 'd.id', 'w.dashboard_id')
    .join('projects as p', 'p.id', 'd.project_id').where('w.preset_name', 'mail')
    .distinct('p.id', 'p.space_id').orderBy('p.space_id').orderBy('p.id');
  for (const project of projects) {
    await knex('spaces').where('id', project.space_id).forUpdate().first();
    if (await knex('universal_tables').where({ project_id: project.id, sync_target: 'mail_messages' }).first()) continue;
    const legacy = await knex('universal_tables as t').join('projects as p', 'p.id', 't.project_id')
      .where({ 'p.space_id': project.space_id, 'p.type': 'system_data', 't.sync_target': 'mail_messages' })
      .whereNotExists(knex('widgets as w').join('dashboards as d', 'd.id', 'w.dashboard_id')
        .select('w.id').whereRaw('d.project_id = p.id').where('w.preset_name', 'mail'))
      .select('t.id').orderBy('t.id').first();
    if (legacy) {
      await knex('universal_tables').where('id', legacy.id).update({ project_id: project.id });
      continue;
    }
    const [table] = await knex('universal_tables').insert({ project_id: project.id, name: 'Mail',
      description: 'Email messages (read-only)', icon: '📬', is_system: 1, sync_target: 'mail_messages' }).returning('id');
    const columns = [
      ['id', 'ID', 'number'], ['folder', 'Folder', 'text'], ['from_name', 'From Name', 'text'],
      ['from_address', 'From', 'email'], ['subject', 'Subject', 'text'], ['preview', 'Preview', 'text'],
      ['date', 'Date', 'datetime'], ['is_read', 'Read', 'checkbox'], ['starred', 'Starred', 'checkbox'],
      ['ticket_id', 'Ticket', 'number'], ['linked_table_id', 'Linked Table', 'number'], ['linked_row_id', 'Linked Row', 'number'],
    ];
    await knex('table_columns').insert(columns.map(([column_name, display_name, type], order_index) => ({
      table_id: table.id, column_name, display_name, type, config: null, order_index,
      is_required: 0, is_system: column_name === 'id' ? 1 : 0,
    })));
  }
}

export async function down() {
  // Registry IDs may already be referenced by chat attachments. Retain them and
  // their project placement on code rollback; the old read path supports both.
}
