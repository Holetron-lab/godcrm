import { keySignature, parseData, seedModuleRows } from '../ModuleTableProvisioner.js';

function plannedTable(plannedTables, key) {
  return plannedTables.find((table) => table.key === key);
}

function effectiveColumnName(planned, moduleColumn) {
  const mapping = planned?.columns?.find((column) => column.module_column === moduleColumn);
  if (!mapping) return moduleColumn;
  if (mapping.target === null) return null;
  return mapping.target === '__new' ? moduleColumn : mapping.target;
}

function targetIncluded(target, plannedTables, mapping) {
  if (mapping) return Boolean(mapping[target]?.table_id);
  const planned = plannedTable(plannedTables, target);
  return Boolean(planned && !['skip', 'requires'].includes(planned.action));
}

function relationColumns(group, tableSpecs, plannedTables) {
  const spec = tableSpecs.find((table) => table.key === group.table);
  const planned = plannedTable(plannedTables, group.table);
  return (spec?.columns || [])
    .filter((column) => column.type === 'relation' && column.target)
    .map((column) => ({
      ...column,
      sourceName: effectiveColumnName(planned, column.column_name),
    }))
    .filter((column) => column.sourceName);
}

function naturalKeySignature(value, key) {
  if (Array.isArray(value)) {
    if (value.length !== key.length) return null;
    return keySignature(Object.fromEntries(key.map((column, index) => [column, value[index]])), key);
  }
  if (value && typeof value === 'object') return keySignature(value, key);
  if (key.length === 1) return keySignature({ [key[0]]: value }, key);
  return null;
}

function dependencies(group, groups, tableSpecs, plannedTables, mapping) {
  return relationColumns(group, tableSpecs, plannedTables)
    .map((column) => column.target)
    .filter((target, index, targets) => targets.indexOf(target) === index)
    .filter((target) => target !== group.table
      && targetIncluded(target, plannedTables, mapping)
      && groups.some((candidate) => candidate.table === target));
}

function orderSeedGroups(groups, tableSpecs, plannedTables, mapping) {
  const remaining = [...groups];
  const ordered = [];
  const seeded = new Set();
  while (remaining.length > 0) {
    const index = remaining.findIndex((group) =>
      dependencies(group, groups, tableSpecs, plannedTables, mapping).every((target) => seeded.has(target))
    );
    if (index < 0) return [...ordered, ...remaining];
    const [next] = remaining.splice(index, 1);
    ordered.push(next);
    seeded.add(next.table);
  }
  return ordered;
}

export function seedGroupsHaveRelations(groups, tableSpecs) {
  const seededTables = new Set(groups.map((group) => group.table));
  return tableSpecs.some((table) => seededTables.has(table.key)
    && (table.columns || []).some((column) => column.type === 'relation' && column.target));
}

export async function resolveRelationSeedGroup(group, {
  tableSpecs,
  plannedTables,
  tableIds = null,
  mapping = null,
  all,
  candidateGroups = [],
  includeCandidates = false,
}) {
  const relations = relationColumns(group, tableSpecs, plannedTables);
  if (relations.length === 0) return { group, warnings: [], dropped: 0 };

  const rows = (group.rows || []).map((row) => ({ ...row }));
  const warnings = [];
  const droppedColumns = new Set();
  let dropped = 0;

  for (const relation of relations) {
    if (!rows.some((row) => relation.sourceName in row)) continue;
    const target = relation.target;
    const targetGroup = candidateGroups.find((candidate) => candidate.table === target);
    let reason = null;
    if (!targetIncluded(target, plannedTables, mapping)) {
      reason = `target table "${target}" is not installed or connected by this module`;
    } else if (!targetGroup?.key?.length) {
      reason = `target table "${target}" has no declared natural key`;
    }

    let targetIndex = null;
    if (!reason) {
      const targetId = mapping?.[target]?.table_id ?? tableIds?.[target] ?? null;
      const existing = targetId
        ? await all('SELECT id, data FROM table_rows WHERE table_id = ? ORDER BY id', [targetId])
        : [];
      targetIndex = new Map();
      for (const row of existing) {
        const data = parseData(row.data);
        const signature = keySignature(data, targetGroup.key);
        if (!targetIndex.has(signature)) targetIndex.set(signature, row.id);
      }
      if (includeCandidates) {
        for (const row of targetGroup.rows || []) {
          const signature = keySignature(row, targetGroup.key);
          if (!targetIndex.has(signature)) targetIndex.set(signature, null);
        }
      }
    }

    let unresolved = 0;
    for (const row of rows) {
      if (!(relation.sourceName in row)) continue;
      if (reason) {
        delete row[relation.sourceName];
        unresolved += 1;
        continue;
      }
      const signature = naturalKeySignature(row[relation.sourceName], targetGroup.key);
      if (signature !== null && targetIndex.has(signature)) {
        const targetId = targetIndex.get(signature);
        if (targetId !== null) row[relation.sourceName] = targetId;
      } else {
        delete row[relation.sourceName];
        unresolved += 1;
      }
    }
    if (unresolved > 0) {
      dropped += unresolved;
      droppedColumns.add(relation.sourceName);
      warnings.push(
        `Relation seed column "${relation.sourceName}" in table "${group.table}" dropped for ${unresolved} row(s): ` +
        (reason || `no row in target table "${target}" matches its natural key`),
      );
    }
  }

  const disabledKeys = group.key.filter((key) => droppedColumns.has(key));
  if (disabledKeys.length > 0) {
    warnings.push(`Seed disabled for table "${group.table}": relation natural key column(s) unresolved: ${disabledKeys.join(', ')}`);
    return { group: null, warnings, dropped };
  }
  return { group: { ...group, rows }, warnings, dropped };
}

export async function seedModuleRelationGroups({
  blueprint,
  groups,
  mapping,
  tableSpecs,
  plannedTables,
  userId,
  trx,
}) {
  const ordered = orderSeedGroups(groups, tableSpecs, plannedTables, mapping);
  const counts = {};
  for (const group of ordered) {
    const resolved = await resolveRelationSeedGroup(group, {
      tableSpecs,
      plannedTables,
      mapping,
      all: (sql, params) => trx.all(sql, params),
      candidateGroups: groups,
    });
    if (!resolved.group) {
      counts[group.table] = { seeded: 0, reused: 0 };
      continue;
    }
    Object.assign(counts, await seedModuleRows(
      mapping,
      { ...blueprint, seed: [resolved.group] },
      { userId, trx },
    ));
  }
  return counts;
}
