const normalize = (value) => String(value ?? '').trim().toLowerCase().replace(/[\s_]+/g, '');

function parsedConfig(config) {
  if (!config) return {};
  if (typeof config === 'object') return config;
  try {
    return JSON.parse(config) || {};
  } catch {
    return {};
  }
}

function optionParts(option) {
  if (typeof option === 'string' || typeof option === 'number') {
    return { label: String(option), value: option };
  }
  return {
    label: String(option?.label ?? option?.value ?? ''),
    value: option?.value ?? option?.label,
  };
}

function findOption(options, value) {
  const candidate = optionParts(value);
  const needles = [candidate.label, String(candidate.value)].map((part) => part.trim().toLowerCase());
  return options.find((option) => {
    const { label, value: optionValue } = optionParts(option);
    const targets = [label, String(optionValue)].map((part) => part.trim().toLowerCase());
    return needles.some((needle) => targets.includes(needle));
  });
}

function compatible(targetType, sourceType) {
  if (targetType === sourceType) return true;
  if (targetType === 'text') return true;
  if (targetType === 'number') return sourceType === 'number';
  if (targetType === 'select') return sourceType === 'select' || sourceType === 'text';
  if (targetType === 'date' || targetType === 'user' || targetType === 'relation') {
    return sourceType === targetType;
  }
  return false;
}

export function relationTargetId(config) {
  const parsed = parsedConfig(config);
  const relation = parsed.relation && typeof parsed.relation === 'object' ? parsed.relation : {};
  return relation.tableId ?? relation.table_id ?? relation.relatedTableId ?? parsed.relatedTableId ?? null;
}

export function remapRelationConfig(config, tableId) {
  const parsed = parsedConfig(config);
  const current = parsed.relation && typeof parsed.relation === 'object' ? parsed.relation : {};
  const relation = { ...current, tableId };
  if ('table_id' in current) relation.table_id = tableId;
  if ('relatedTableId' in current) relation.relatedTableId = tableId;
  const remapped = { ...parsed, relation };
  if ('relatedTableId' in parsed) remapped.relatedTableId = tableId;
  return remapped;
}

export function mergeSelectOptions(config, additions) {
  const options = [...(Array.isArray(config.options) ? config.options : [])];
  for (const value of additions) {
    if (!findOption(options, value)) options.push(value);
  }
  return { ...config, options };
}

export function planColumnBindings({ table, declared, existing, manual = [], seedGroups = [], relationTargets = {} }) {
  const existingByName = new Map(existing.map((column) => [column.column_name, column]));
  const manualByModule = new Map(manual.map((binding) => [binding.module_column, binding]));
  const declaredNames = new Set(declared.map((column) => column.column_name));
  const conflicts = [];
  const usedTargets = new Map();
  const seedGroupsForOptions = seedGroups.filter(
    (group) => !group.key.some((key) => manualByModule.get(key)?.target === null)
  );

  for (const binding of manual) {
    if (!declaredNames.has(binding.module_column)) {
      conflicts.push({
        kind: 'UNKNOWN_COLUMN_BINDING', table, column: binding.module_column, blocking: true,
      });
    }
  }

  const columns = declared.map((source) => {
    const moduleColumn = source.column_name;
    const sourceType = source.type || 'text';
    const manualBinding = manualByModule.get(moduleColumn);
    let target = manualBinding?.target;
    let match = manualBinding ? 'manual' : 'new';

    if (!manualBinding) {
      const byName = existing.find((column) => normalize(column.column_name) === normalize(moduleColumn));
      const byDisplayName = byName ? null : existing.find(
        (column) => normalize(column.display_name || column.column_name) === normalize(moduleColumn)
      );
      const matched = byName || byDisplayName;
      target = matched ? matched.column_name : '__new';
      if (byName) match = 'column_name';
      if (byDisplayName) match = 'display_name';
    }

    const result = {
      module_column: moduleColumn,
      target,
      match,
      compat: 'ok',
      module_type: sourceType,
      target_type: target === '__new' ? sourceType : null,
    };

    if (target === null) {
      if (source.required) {
        conflicts.push({
          kind: 'REQUIRED_COLUMN_UNMAPPED', table, column: moduleColumn, blocking: true,
        });
      }
      return result;
    }

    if (target === '__new') {
      if (existingByName.has(moduleColumn)) {
        result.compat = 'conflict';
        result.reason = `column already exists: ${moduleColumn}`;
        conflicts.push({
          kind: 'COLUMN_TARGET_EXISTS', table, column: moduleColumn, target: moduleColumn, blocking: true,
        });
      }
      return result;
    }

    const live = existingByName.get(target);
    if (!live) {
      result.compat = 'conflict';
      result.reason = `target column not found: ${target}`;
      conflicts.push({
        kind: 'COLUMN_TARGET_NOT_FOUND', table, column: moduleColumn, target, blocking: true,
      });
      return result;
    }

    result.target_type = live.type || 'text';
    if (usedTargets.has(target)) {
      conflicts.push({
        kind: 'COLUMN_TARGET_DUPLICATE', table, column: moduleColumn, target,
        referenced_by: [usedTargets.get(target)], blocking: true,
      });
    } else {
      usedTargets.set(target, moduleColumn);
    }

    if (!compatible(result.target_type, sourceType)) {
      result.compat = 'conflict';
      result.reason = `${result.target_type} ← ${sourceType}`;
      conflicts.push({
        kind: 'column_type', table, column: moduleColumn, target,
        existing_type: result.target_type, declared_type: sourceType,
        reason: result.reason, blocking: true,
      });
      return result;
    }

    if (result.target_type === 'relation' && source.target) {
      const expectedTableId = relationTargets[source.target] ?? null;
      const actualTableId = relationTargetId(live.config);
      const matches = expectedTableId != null && actualTableId != null
        && Number(expectedTableId) === Number(actualTableId);
      if (!matches) {
        result.compat = 'conflict';
        result.reason = `relation_target: ${expectedTableId} ≠ ${actualTableId}`;
        conflicts.push({
          kind: 'relation_target', table, column: moduleColumn, target,
          expected_table_id: expectedTableId, actual_table_id: actualTableId,
          reason: result.reason, blocking: true,
        });
        return result;
      }
    }

    const config = parsedConfig(live.config);
    if (result.target_type === 'select') {
      const options = [...(Array.isArray(config.options) ? config.options : [])];
      const additions = [];
      const sourceConfig = parsedConfig(source.config);
      const declaredOptions = sourceType === 'select' && Array.isArray(sourceConfig.options)
        ? sourceConfig.options
        : [];
      const seedValues = seedGroupsForOptions.flatMap((group) =>
        (group.rows || []).map((row) => row[moduleColumn])
      );
      for (const value of [...declaredOptions, ...seedValues]) {
        if (value === null || value === undefined || value === '') continue;
        if (findOption(options, value)) continue;
        options.push(value);
        additions.push(value);
      }
      result.options_added = additions.length;
      result.options_to_add = additions;
    }

    return result;
  });

  return { columns, conflicts };
}

export function convertValue(value, type) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value;
  if (value.trim() === '') return null;

  switch (type) {
    case 'number': {
      const number = Number(value.replace(',', '.').replace(/\s/g, ''));
      return Number.isNaN(number) ? null : number;
    }
    case 'checkbox':
      return ['true', '1', 'yes', 'да'].includes(value.toLowerCase());
    case 'date':
    case 'datetime': {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? value : date.toISOString();
    }
    default:
      return value;
  }
}

export function remapSeedGroup(group, plannedTable, existingColumns = []) {
  if (plannedTable.action !== 'connect' || !Array.isArray(plannedTable.columns)) {
    return { group, disabled_reason: null, warning: null };
  }

  const mappings = new Map(plannedTable.columns.map((column) => [column.module_column, column]));
  const targetName = (moduleColumn) => {
    const target = mappings.get(moduleColumn)?.target;
    return target === '__new' || target === undefined ? moduleColumn : target;
  };
  const skippedKeys = group.key.filter((key) => mappings.get(key)?.target === null);
  if (skippedKeys.length > 0) {
    const disabledReason = `natural key column(s) skipped: ${skippedKeys.join(', ')}`;
    return {
      group: null,
      disabled_reason: disabledReason,
      warning: `Seed disabled for table "${group.table}": ${disabledReason}`,
    };
  }

  const existingByName = new Map(existingColumns.map((column) => [column.column_name, column]));
  const rows = (group.rows || []).map((row) => {
    const mapped = { ...row };
    for (const column of plannedTable.columns) delete mapped[column.module_column];
    for (const column of plannedTable.columns) {
      const source = column.module_column;
      if (!(source in row) || column.target === null) continue;

      const target = targetName(source);
      let value = convertValue(row[source], column.target_type || column.module_type);
      if (column.target_type === 'select') {
        const config = parsedConfig(existingByName.get(target)?.config);
        const options = [...(Array.isArray(config.options) ? config.options : []), ...(column.options_to_add || [])];
        const matched = findOption(options, value);
        if (matched) value = optionParts(matched).value;
      }
      mapped[target] = value;
    }
    return mapped;
  });

  return {
    group: { ...group, key: group.key.map(targetName), rows },
    disabled_reason: null,
    warning: null,
  };
}
