import { tablesApi } from '@/features/tables/api/tablesApi';

/** Reuse the table's assignee column, including after a failed widget save. */
export async function ensureAssigneeColumn(tableId: string): Promise<string> {
  const { columns } = await tablesApi.getColumns(tableId);
  const existing = columns.find(column =>
    (/^(assignee(?:_\d+)?|assigned_to|assigned)$/.test(column.name)) &&
    ['user', 'person', 'text', 'select', 'multi-select', 'relation'].includes(column.type)
  );
  if (existing) return existing.name;

  let name = 'assignee';
  for (let suffix = 2; columns.some(column => column.name === name); suffix++) {
    name = `assignee_${suffix}`;
  }
  await tablesApi.createColumn(tableId, {
    name, displayName: 'Assignee', type: 'user',
    config: { person: { source: 'system', allowMultiple: true } },
  });
  return name;
}
