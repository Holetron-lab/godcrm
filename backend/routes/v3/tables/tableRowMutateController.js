/**
 * Table row update/delete controller
 * Handles: PUT /tables/:tableId/rows/:rowId,
 *          DELETE /tables/:tableId/rows/:rowId
 */
import express from 'express';
import bcrypt from 'bcrypt';
import { dbAll, dbGet, dbRun, sqlNow, safeJsonParse } from '../../../database/connection.js';
import { apiLogger } from '../../../utils/logger.js';
import { success, notFound, badRequest, forbidden, error } from '../../../utils/response.js';
import { resolveSelectValues } from '../../../services/SelectValueResolver.js';
import { coerceDataObject } from '../../../services/agent-tools/coerceDataInput.js';
import { checkTableAccess } from './helpers.js';
import { applyAtomVersioning, isAtomsV2Table, ATOMS_V2_TABLE_ID } from '../../../services/atoms-archive.js';
import { fireRowUpdateTriggers } from '../../../services/AutomationTriggerService.js';
import { emitRowMutationEvents } from '../../../services/tableMutationService.js';
import { onDocumentTableMutation, captureDocumentContext, onDocumentStatusTransition } from '../../../services/documents/SnapshotWriter.js';
import { onTicketStateTransition } from '../../../services/bdd/regressionWatcher.js';
import { checkCompletionGate, formatGateError, onCriterionChange, COMPLETION_GATE_DONE_STATE } from '../../../services/bdd/completionGate.js';
import { enforceVerificationGuards } from '../../../services/verification/guards.js';
import { validateVerificationSettingsAtom } from '../../../services/verification/applyOverrideValidator.js';
import { validateTicketRefAtom } from '../../../services/atoms/ticket-ref-serializer.js';
import { validateWidgetAtomRecursion } from '../../../services/atoms/widget-atom-recursion-guard.js';
import { getWidgetById } from '../../../services/WidgetService.js';
import { isBookingConflictError, findConflictingRowId } from '../../../lib/booking-constraint.js';
import { writeAudit } from '../../../services/audit/writeAudit.js';
import { computeRowDiff } from '../../../services/audit/rowDiff.js';

const router = express.Router();

/**
 * PUT /api/v3/tables/:tableId/rows/:rowId
 * Update a row in a table (supports external data sources)
 */
router.put('/tables/:tableId/rows/:rowId', async (req, res) => {
  try {
    const { tableId, rowId } = req.params;
    let { data } = req.body;

    try { data = coerceDataObject(data, 'data') || {}; }
    catch (e) { return badRequest(res, e.message); }

    if (req.user?.projectId) {
      const access = await checkTableAccess(tableId, req.user);
      if (!access.allowed) {
        return forbidden(res, access.error);
      }
    }

    apiLogger.debug({ rowId }, 'UPDATE received rowId');
    apiLogger.debug({ dataKeys: Object.keys(data || {}) }, 'UPDATE received data keys');

    const table = await dbGet(`
      SELECT data_source_id, source_table_name, source_id_column
      FROM universal_tables
      WHERE id = ?
    `, [tableId]);

    if (!table) {
      return notFound(res, 'Table');
    }

    // If external table, update in data source
    if (table.data_source_id && table.source_table_name) {
      const DataSourceService = (await import('../../../services/DataSourceService.js')).default;
      const dataSourceService = new DataSourceService();
      const dataSource = await dataSourceService.get(table.data_source_id);

      // Handle INTERNAL data source (local database tables like users)
      if (dataSource.type === 'internal') {
        apiLogger.debug({ tableName: table.source_table_name }, 'Internal UPDATE table');

        let realRowId = rowId;
        if (rowId.startsWith('int_')) {
          const parts = rowId.split('_');
          realRowId = parts[parts.length - 1];
        } else if (rowId.startsWith('user-')) {
          realRowId = rowId.replace('user-', '');
        }
        apiLogger.debug({ realRowId }, 'Internal UPDATE real row ID');

        const schemaColumns = await dbAll(`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_name = $1
        `, [table.source_table_name]);
        const validColumnNames = new Set(schemaColumns.map(c => c.column_name));

        const tableColumns = await dbAll(`
          SELECT id, column_name
          FROM table_columns
          WHERE table_id = ?
        `, [tableId]);

        const columnIdToName = {};
        for (const col of tableColumns) {
          columnIdToName[col.id] = col.column_name;
          columnIdToName[String(col.id)] = col.column_name;
        }

        apiLogger.debug({ columnIdToName }, 'Internal UPDATE column map');
        apiLogger.debug({ dataKeys: Object.keys(data) }, 'Internal UPDATE data keys');

        const updateData = {};
        for (const [key, value] of Object.entries(data)) {
          const columnName = columnIdToName[key] || columnIdToName[String(key)] || key;

          if (validColumnNames.has(columnName)) {
            if (columnName === 'password_hash' && value && value !== '••••••••' && !value.startsWith('$2')) {
              updateData[columnName] = await bcrypt.hash(value, 10);
              apiLogger.debug({ columnName }, 'Hashed password for column');
            } else if (columnName === 'password_hash' && (value === '••••••••' || !value)) {
              apiLogger.debug('Skipping masked/empty password');
            } else {
              updateData[columnName] = value;
            }
          } else {
            apiLogger.debug({ key, columnName }, 'Skipping invalid column');
          }
        }

        apiLogger.debug({ updateDataKeys: Object.keys(updateData) }, 'Internal UPDATE data keys');

        if (Object.keys(updateData).length === 0) {
          return success(res, null, 'No changes to update');
        }

        const idColumn = table.source_id_column || 'id';
        const updates = Object.keys(updateData)
          .filter(key => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key))
          .map(key => `"${key}" = ?`)
          .join(', ');
        const values = [...Object.values(updateData), realRowId];

        if (!updates) {
          return badRequest(res, 'No valid columns to update');
        }

        const sql = `UPDATE "${table.source_table_name}" SET ${updates}, updated_at = ${sqlNow()} WHERE "${idColumn}" = ?`;
        apiLogger.debug({ sql }, 'Internal UPDATE SQL');

        await dbRun(sql, values);

        return success(res, null, 'Row updated successfully');
      }

      if (dataSource.type === 'local_mysql') {
        let realRowId = rowId;
        if (rowId.startsWith('ext_')) {
          const parts = rowId.split('_');
          realRowId = parts[parts.length - 1];
        }
        apiLogger.debug({ realRowId }, 'External UPDATE real MySQL row ID');
        const mysql = await import('mysql2/promise');
        const connection = await mysql.createConnection({
          host: dataSource.db_host,
          port: dataSource.db_port,
          database: dataSource.db_name,
          user: dataSource.db_username,
          password: ''
        });

        try {
          const columns = await dbAll(`
            SELECT id, column_name
            FROM table_columns
            WHERE table_id = ? AND is_from_source = 1
          `, [tableId]);

          const columnIdToName = {};
          const validColumnNames = new Set();
          for (const col of columns) {
            columnIdToName[col.id] = col.column_name;
            columnIdToName[String(col.id)] = col.column_name;
            validColumnNames.add(col.column_name);
          }

          apiLogger.debug({ count: columns.length }, 'External UPDATE source columns count');
          apiLogger.debug({ sample: Array.from(validColumnNames).slice(0, 10) }, 'External UPDATE valid column names sample');

          const mappedData = {};
          const skippedKeys = [];
          for (const [key, value] of Object.entries(data)) {
            const columnName = columnIdToName[key] || columnIdToName[String(key)];
            if (columnName) {
              mappedData[columnName] = value;
            } else if (validColumnNames.has(key)) {
              mappedData[key] = value;
            } else {
              skippedKeys.push(key);
            }
          }

          apiLogger.debug({ skippedKeys }, 'External UPDATE skipped keys (virtual columns)');
          apiLogger.debug({ mappedDataKeys: Object.keys(mappedData) }, 'External UPDATE mapped data keys');

          // Handle virtual columns - save to local table_rows
          if (skippedKeys.length > 0) {
            const virtualData = {};
            for (const key of skippedKeys) {
              virtualData[key] = data[key];
            }

            const existingRow = await dbGet(
              'SELECT id, data FROM table_rows WHERE table_id = ? AND base_id = ?',
              [tableId, rowId]
            );

            if (existingRow) {
              const existingData = safeJsonParse(existingRow.data) || {};
              const mergedData = { ...existingData, ...virtualData };
              await dbRun(
                `UPDATE table_rows SET data = ?, updated_at = ${sqlNow()} WHERE id = ?`,
                [JSON.stringify(mergedData), existingRow.id]
              );
              apiLogger.debug({ virtualDataKeys: Object.keys(virtualData) }, 'Updated virtual columns in table_rows');
            } else {
              await dbRun(
                `INSERT INTO table_rows (table_id, base_id, data, created_at, updated_at) VALUES (?, ?, ?, ${sqlNow()}, ${sqlNow()})`,
                [tableId, rowId, JSON.stringify(virtualData)]
              );
              apiLogger.debug({ virtualDataKeys: Object.keys(virtualData) }, 'Created new table_rows entry for virtual columns');
            }
          }

          if (Object.keys(mappedData).length === 0) {
            await connection.end();
            return success(res, null, 'Virtual columns updated successfully');
          }

          const idColumn = table.source_id_column || 'id';
          const validEntries = Object.entries(mappedData)
            .filter(([key]) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key));

          if (validEntries.length === 0) {
            await connection.end();
            return badRequest(res, 'No valid columns to update');
          }

          const updates = validEntries
            .map(([key]) => `\`${key}\` = ?`)
            .join(', ');
          const values = [...validEntries.map(([, val]) => val), realRowId];

          apiLogger.debug({ sql: `UPDATE \`${table.source_table_name}\` SET ${updates} WHERE \`${idColumn}\` = ?` }, 'External UPDATE SQL');
          apiLogger.debug({ realRowId }, 'External UPDATE realRowId');

          const [result] = await connection.execute(
            `UPDATE \`${table.source_table_name}\` SET ${updates} WHERE \`${idColumn}\` = ?`,
            values
          );

          await connection.end();

          return success(res, null, 'Row updated successfully');
        } catch (mysqlError) {
          await connection.end();
          throw mysqlError;
        }
      }
    }

    // Local table - update in table_rows
    const isNumericId = /^\d+$/.test(String(rowId));

    let existingRow;
    if (isNumericId) {
      existingRow = await dbGet(`
        SELECT id, data FROM table_rows WHERE id = ? AND table_id = ?
      `, [rowId, tableId]);
    } else {
      existingRow = await dbGet(`
        SELECT id, data FROM table_rows WHERE base_id = ? AND table_id = ?
      `, [rowId, tableId]);
    }

    if (!existingRow) {
      return notFound(res, 'Row');
    }

    const actualRowId = existingRow.id;

    // Map column_id keys to column_name keys (frontend may send either)
    const tableColumns = await dbAll(`
      SELECT id, column_name FROM table_columns WHERE table_id = ?
    `, [tableId]);

    const columnIdToName = {};
    const columnNames = new Set();
    for (const col of tableColumns) {
      columnIdToName[col.id] = col.column_name;
      columnIdToName[String(col.id)] = col.column_name;
      columnNames.add(col.column_name);
    }

    const normalizedData = {};
    for (const [key, value] of Object.entries(data)) {
      if (columnIdToName[key]) {
        // Key is a column ID — map to column name
        normalizedData[columnIdToName[key]] = value;
      } else {
        // Key is already a column name (or unknown) — keep as-is
        normalizedData[key] = value;
      }
    }

    // 2026-04-27: silent floor on `order` for doc-content tables (`doc_*`).
    // Frontend regression let `order` become fractional (.5) which broke
    // `ORDER BY (data->>'order')::integer` in document content fetch.
    // Never throw — priority is "document doesn't break".
    if (normalizedData.order != null && Number.isFinite(Number(normalizedData.order))) {
      const tableInfo = await dbGet(`SELECT name FROM universal_tables WHERE id = ?`, [tableId]);
      if (tableInfo?.name && tableInfo.name.startsWith('doc_')) {
        normalizedData.order = Math.floor(Number(normalizedData.order));
      }
    }

    apiLogger.debug({ originalKeys: Object.keys(data), normalizedKeys: Object.keys(normalizedData) }, 'UPDATE local table key normalization');

    const { resolvedData: validatedData, errors: selectErrors } = await resolveSelectValues(tableId, normalizedData);
    if (selectErrors.length > 0) {
      apiLogger.warn({ selectErrors }, 'Select column validation errors — auto-resolved what we could');
      return badRequest(res, `Invalid select values: ${selectErrors.join('; ')}`);
    }

    const existingData = safeJsonParse(existingRow.data) || {};

    // ADR-0002 §8 Phase 3 (G4) — completion gate on Tickets (table 1708).
    // If this PUT transitions state → done and any Must criterion is not yet
    // verified, reject with 409 BEFORE any other mutation. No-op for non-1708
    // tables and for transitions that do not target `done`.
    const TICKETS_TABLE_ID_FOR_GATE = 1708;
    if (Number(tableId) === TICKETS_TABLE_ID_FOR_GATE) {
      const incomingState = Number(normalizedData.state);
      const previousState = Number(existingData.state);
      if (
        Number.isFinite(incomingState) &&
        incomingState === COMPLETION_GATE_DONE_STATE &&
        previousState !== COMPLETION_GATE_DONE_STATE
      ) {
        try {
          const gate = await checkCompletionGate(actualRowId);
          if (!gate.ok) {
            apiLogger.info(
              { ticket_id: actualRowId, must_total: gate.must_total, must_verified: gate.must_verified, blocker_count: gate.blockers.length },
              'ADR-0002 G4: completion gate blocked done transition (table_rows path)'
            );
            const body = formatGateError(gate);
            return error(
              res,
              body.code,
              `Cannot transition to 'done' — ${gate.blockers.length} of ${gate.must_total} must-criteria are not verified`,
              409,
              { must_total: body.must_total, must_verified: body.must_verified, failed: body.failed }
            );
          }
        } catch (gateErr) {
          apiLogger.warn({ err: gateErr.message, ticket_id: actualRowId }, 'completion gate query failed (table_rows path), allowing transition');
        }
      }
    }

    // ADR-0011 Phase B: verification-column guards (C-4 guard-violation, C-6
    // status lock, immutability of verification cells via PUT). Runs on every
    // local-table update; becomes a no-op when no verification columns exist.
    const guardResult = await enforceVerificationGuards({
      tableId: parseInt(tableId),
      existingData,
      incomingData: validatedData,
      userId: req.user?.userId || req.user?.id || null,
    });
    if (!guardResult.ok) {
      apiLogger.warn({ tableId, rowId: actualRowId, code: guardResult.code, meta: guardResult.meta }, 'Verification guard rejected row update');
      return error(res, guardResult.code, guardResult.message, guardResult.status, guardResult.meta || null);
    }

    let mergedData = { ...existingData, ...validatedData, ...guardResult.cellOverrides };
    apiLogger.debug('Merging existing data with new data');
    apiLogger.debug({ existingKeys: Object.keys(existingData) }, 'Existing keys');
    apiLogger.debug({ newKeys: Object.keys(validatedData) }, 'New keys');
    apiLogger.debug({ mergedKeys: Object.keys(mergedData) }, 'Merged keys');

    // ADR-0011 Phase E2: tighten-only validation for verification_settings
    // override atoms (atoms_v2 only). No-op for unrelated tables/atoms.
    const overrideCheck = await validateVerificationSettingsAtom({
      tableId: parseInt(tableId),
      data: mergedData,
    });
    if (!overrideCheck.ok) {
      apiLogger.warn({ tableId, rowId: actualRowId, field: overrideCheck.field, error: overrideCheck.error },
        'verification_settings override rejected (UPDATE)');
      return error(res, 'VERIFICATION_OVERRIDE_REJECTED', overrideCheck.error, overrideCheck.status || 400);
    }

    // ADR-0012 §Phase 5: validate ticket_ref atoms and hydrate snapshot when
    // mode != 'live'. No-op for unrelated tables/atoms.
    const ticketRefCheck = await validateTicketRefAtom({
      tableId: parseInt(tableId),
      data: mergedData,
      atomsV2TableId: ATOMS_V2_TABLE_ID,
      loadWidget: getWidgetById,
      loadTicket: async (ticketsTableId, ticketId) => {
        return dbGet(
          `SELECT id, base_id, table_id, data, created_at, updated_at
             FROM table_rows
            WHERE id = ? AND table_id = ?`,
          [ticketId, ticketsTableId]
        );
      },
    });
    if (!ticketRefCheck.ok) {
      apiLogger.warn({ tableId, rowId: actualRowId, field: ticketRefCheck.field, error: ticketRefCheck.error },
        'ticket_ref atom rejected (UPDATE)');
      return error(res, ticketRefCheck.code || 'TICKET_REF_INVALID', ticketRefCheck.error, ticketRefCheck.status || 400);
    }
    mergedData = ticketRefCheck.data;

    // ADR-0005 §C-12: block one-level recursive `documents` widget embedding.
    // No-op for non-atoms_v2 tables and for atoms that don't carry both
    // `widget_ref` + `document_id`.
    const recursionCheck = await validateWidgetAtomRecursion({
      tableId: parseInt(tableId),
      data: mergedData,
      atomsV2TableId: ATOMS_V2_TABLE_ID,
      loadWidget: getWidgetById,
      loadDocumentRegistryId: async (documentId) => {
        const row = await dbGet(
          `SELECT table_id FROM table_rows WHERE id = ?`,
          [documentId]
        );
        return row && Number.isInteger(Number(row.table_id)) ? Number(row.table_id) : null;
      },
    });
    if (!recursionCheck.ok) {
      apiLogger.warn(
        { tableId, rowId: actualRowId, widget_id: recursionCheck.widget_id, document_id: recursionCheck.document_id },
        'recursive_document_embedding atom rejected (UPDATE)'
      );
      return res.status(recursionCheck.status || 400).json({
        success: false,
        error: recursionCheck.code,
        message: recursionCheck.error,
        widget_id: recursionCheck.widget_id,
        document_id: recursionCheck.document_id,
      });
    }

    // ADR-0001 Wave 1: app-level versioning hook for atoms_v2 (table 3574).
    // Snapshots the OLD row into atoms_archive and bumps `version`.
    if (isAtomsV2Table(tableId)) {
      try {
        mergedData = await applyAtomVersioning({
          table_id: tableId,
          row_id: actualRowId,
          newData: mergedData,
          oldRow: { id: actualRowId, data: existingData },
          changedByUser: req.user?.userId || req.user?.id || null,
          changeReason: req.body?.change_reason || null,
        });
      } catch (hookErr) {
        apiLogger.warn({ err: hookErr }, 'atoms_v2 versioning hook failed — UPDATE proceeds');
      }
    }

    await dbRun(`
      UPDATE table_rows
      SET data = ?, updated_at = ${sqlNow()}
      WHERE id = ? AND table_id = ?
    `, [JSON.stringify(mergedData), actualRowId, tableId]);

    // ADR-0025 A.2: fire row_update automations (e.g. archive → hidden=true).
    // Watch-field gating in fireRowUpdateTriggers prevents action loops.
    fireRowUpdateTriggers(parseInt(tableId), actualRowId, mergedData, existingData).catch(err => {
      apiLogger.warn({ err, tableId, rowId: actualRowId }, 'Row update trigger failed (non-blocking)');
    });

    // ADR-0031 §A: row-mutation event log. Diffs old/new and posts system
    // messages into the row's attached chat. Gated by ROW_MUTATION_LOG_ENABLED_SPACES
    // env var (off by default; P3 flips on for space 11). Fire-and-forget.
    emitRowMutationEvents({
      tableId: parseInt(tableId),
      rowId: actualRowId,
      oldData: existingData,
      newData: mergedData,
      actor: {
        id: req.user?.userId || req.user?.id || null,
        name: req.user?.name || req.user?.username || null,
      },
      ctx: { suppress_mutation_log: req.context?.suppress_mutation_log === true },
    }).catch(() => {});

    // ADR-0003 C-12: schedule a debounced FS snapshot if this row belongs to
    // a documents_registry or document_content table. Fire-and-forget.
    onDocumentTableMutation(parseInt(tableId), actualRowId, 'update');

    // ADR-0003 C-14: detect status → published transition on registry rows
    // and write a canonical `_published.md` snapshot. Fire-and-forget.
    onDocumentStatusTransition(parseInt(tableId), actualRowId, existingData, mergedData);

    // ADR-0003 C-3: detect ticket state `done → non-done` and regress any
    // verified BDD criteria linked to the reopened ticket. Fire-and-forget.
    onTicketStateTransition(parseInt(tableId), actualRowId, existingData, mergedData);

    // ADR-0002 §8 Phase 3 (G6) — recompute Tickets.criteria_progress when a
    // bdd_criteria row was just mutated. Two cases handled:
    //   - bdd_criteria row update: recompute progress for the old AND new
    //     ticket_id (handles re-binding) and for status/priority flips.
    //   - Tickets row update: progress field stays in sync because we only
    //     change it via this very recompute path; nothing to do here.
    if (Number(tableId) === 7256) {
      // Fire-and-forget — we never want a progress recompute to fail the row write.
      Promise.resolve().then(() => onCriterionChange(existingData, mergedData)).catch(() => {});
    }

    // ADR-0066 P1 — audit the row update with a per-column diff (only
    // changed keys, before/after). No-op when nothing actually changed.
    const auditDiff = computeRowDiff(existingData, mergedData);
    if (auditDiff) {
      void writeAudit(req, {
        action: 'row.update',
        entity_type: 'table_row',
        entity_id: actualRowId,
        details: { table_id: Number(tableId), ...auditDiff },
      });
    }

    success(res, null, 'Row updated successfully');
  } catch (err) {
    apiLogger.error({ err }, 'PUT /tables/:tableId/rows/:rowId error');

    // ADR-0034 §7 — booking-constraint exclusion violation → 409 with
    // conflicting_row_id (excluding self).
    if (isBookingConflictError(err)) {
      try {
        const { tableId, rowId } = req.params;
        let selfId = /^\d+$/.test(String(rowId)) ? Number(rowId) : null;
        if (selfId == null) {
          const r = await dbGet(`SELECT id FROM table_rows WHERE base_id = ? AND table_id = ?`, [rowId, tableId]);
          if (r) selfId = Number(r.id);
        }
        const conflicting_row_id = await findConflictingRowId({
          table_id: tableId,
          data: req.body?.data || {},
          exclude_row_id: selfId,
        });
        return res.status(409).json({
          success: false,
          error: 'slot_taken',
          message: 'Slot already taken — refresh',
          conflicting_row_id,
        });
      } catch (lookupErr) {
        apiLogger.warn({ err: lookupErr }, 'booking-constraint conflict lookup failed; returning 409 without row id');
        return res.status(409).json({
          success: false,
          error: 'slot_taken',
          message: 'Slot already taken — refresh',
          conflicting_row_id: null,
        });
      }
    }

    error(res, 'ROW_UPDATE_FAILED', err.message, 500);
  }
});

/**
 * DELETE /api/v3/tables/:tableId/rows/:rowId
 * Delete a row from a table (supports external data sources)
 */
router.delete('/tables/:tableId/rows/:rowId', async (req, res) => {
  try {
    const { tableId, rowId: rawRowId } = req.params;

    let rowId = rawRowId;
    if (typeof rawRowId === 'string' && rawRowId.includes('-')) {
      const parts = rawRowId.split('-');
      const lastPart = parts[parts.length - 1];
      if (/^\d+$/.test(lastPart)) {
        rowId = lastPart;
      }
    }

    // Frontend may send the public `base_id` (e.g. "VGMSMF1A"); resolve it to
    // the numeric primary key so downstream INT-typed queries don't blow up.
    if (!/^\d+$/.test(String(rowId))) {
      const r = await dbGet(
        `SELECT id FROM table_rows WHERE base_id = ? AND table_id = ?`,
        [rowId, tableId]
      );
      if (!r) {
        return notFound(res, 'Row');
      }
      rowId = String(r.id);
    }

    if (req.user?.projectId) {
      const access = await checkTableAccess(tableId, req.user);
      if (!access.allowed) {
        return forbidden(res, access.error);
      }
    }

    const table = await dbGet(`
      SELECT data_source_id, source_table_name, source_id_column, is_system, sync_target
      FROM universal_tables
      WHERE id = ?
    `, [tableId]);

    if (!table) {
      return notFound(res, 'Table');
    }

    // ADR-0012 Phase 8.2 — Widgets is a read-only template registry.
    // Deletion goes through the dedicated /api/v3/widgets/:id endpoint
    // which has the proper atom_refs guard (see WidgetService.deleteWidget).
    if (table.is_system && table.sync_target === 'widgets') {
      return forbidden(res, 'Deleting widgets via system table is not supported. Use DELETE /api/v3/widgets/:id.');
    }

    if (table.data_source_id && table.source_table_name) {
      const DataSourceService = (await import('../../../services/DataSourceService.js')).default;
      const dataSourceService = new DataSourceService();
      const dataSource = await dataSourceService.get(table.data_source_id);

      // Handle INTERNAL data source (system tables backed by real Postgres tables
      // like `users`). Without this branch, DELETE silently no-ops because it
      // falls through to `DELETE FROM table_rows` which never matches.
      if (dataSource.type === 'internal') {
        let realRowId = rowId;
        if (typeof rowId === 'string') {
          if (rowId.startsWith('int_')) {
            const parts = rowId.split('_');
            realRowId = parts[parts.length - 1];
          } else if (rowId.startsWith('user-')) {
            realRowId = rowId.replace('user-', '');
          }
        }

        const idColumn = table.source_id_column || 'id';
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(idColumn) ||
            !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table.source_table_name)) {
          return badRequest(res, 'Invalid table configuration');
        }

        // Users table: soft-delete to preserve FK references (audit_log,
        // agent_jobs, terminal_*, wa_*, tool_approval_rules ссылаются на
        // users.id без ON DELETE CASCADE — hard DELETE упадёт). Email
        // освобождается, чтобы можно было зарегистрироваться заново.
        if (table.sync_target === 'users') {
          const existing = await dbGet(
            `SELECT id, status, email FROM "${table.source_table_name}" WHERE "${idColumn}" = ?`,
            [realRowId]
          );
          if (!existing) {
            return notFound(res, 'User');
          }
          if (existing.status === 'deleted') {
            return success(res, null, 'User already deleted');
          }

          const tombstone = `deleted_${existing.id}_${Date.now()}@deleted.local`;
          await dbRun(
            `UPDATE "${table.source_table_name}"
             SET status = 'deleted',
                 email = ?,
                 password_hash = 'DELETED',
                 email_verified = 0,
                 updated_at = ${sqlNow()}
             WHERE "${idColumn}" = ?`,
            [tombstone, realRowId]
          );

          void writeAudit(req, {
            action: 'user.soft_delete',
            entity_type: 'user',
            entity_id: realRowId,
            details: {
              table_id: Number(tableId),
              source_table: table.source_table_name,
              freed_email: existing.email,
              tombstone_email: tombstone,
            },
          });

          return success(res, null, 'User soft-deleted (email released)');
        }

        // Non-users internal tables: hard delete; FK violations bubble up as 500.
        await dbRun(
          `DELETE FROM "${table.source_table_name}" WHERE "${idColumn}" = ?`,
          [realRowId]
        );

        void writeAudit(req, {
          action: 'row.delete',
          entity_type: 'table_row',
          entity_id: realRowId,
          details: { table_id: Number(tableId), source_table: table.source_table_name },
        });

        return success(res, null, 'Row deleted successfully');
      }

      if (dataSource.type === 'local_mysql') {
        const mysql = await import('mysql2/promise');
        const connection = await mysql.createConnection({
          host: dataSource.db_host,
          port: dataSource.db_port,
          database: dataSource.db_name,
          user: dataSource.db_username,
          password: ''
        });

        try {
          const idColumn = table.source_id_column || 'id';
          if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(idColumn) ||
              !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table.source_table_name)) {
            await connection.end();
            return badRequest(res, 'Invalid table configuration');
          }
          const [result] = await connection.execute(
            `DELETE FROM \`${table.source_table_name}\` WHERE \`${idColumn}\` = ?`,
            [rowId]
          );

          await connection.end();

          return success(res, null, 'Row deleted successfully');
        } catch (mysqlError) {
          await connection.end();
          throw mysqlError;
        }
      }
    }

    // ADR-0003 C-12/C-13: capture doc context BEFORE deletion (once the row
    // is gone we can't resolve slug/title).
    const preCapturedDocCtx = await captureDocumentContext(parseInt(tableId), parseInt(rowId));

    // ADR-0002 §8 Phase 3 (G6) — capture pre-delete bdd_criteria data so we
    // can recompute criteria_progress for the previously-linked ticket after
    // the row is gone. No-op for non-7256 tables.
    let preCapturedCriterionData = null;
    if (Number(tableId) === 7256) {
      const critRow = await dbGet(
        `SELECT data FROM table_rows WHERE id = ? AND table_id = ?`,
        [rowId, tableId]
      );
      if (critRow) {
        preCapturedCriterionData = (typeof critRow.data === 'string')
          ? safeJsonParse(critRow.data, {})
          : (critRow.data || {});
      }
    }

    // ADR-0066 P1 — capture pre-delete row data so we can store it in the
    // audit row. Done BEFORE the DELETE so we don't lose the payload.
    const preDeletedRow = await dbGet(
      `SELECT data FROM table_rows WHERE id = ? AND table_id = ?`,
      [rowId, tableId]
    );
    const preDeletedData = preDeletedRow
      ? (typeof preDeletedRow.data === 'string'
          ? safeJsonParse(preDeletedRow.data, {})
          : (preDeletedRow.data || {}))
      : null;

    // Local table - delete from table_rows
    await dbRun(`
      DELETE FROM table_rows
      WHERE id = ? AND table_id = ?
    `, [rowId, tableId]);

    // ADR-0066 P1 — fire-and-forget audit of the row delete.
    void writeAudit(req, {
      action: 'row.delete',
      entity_type: 'table_row',
      entity_id: rowId,
      details: { table_id: Number(tableId), deleted_data: preDeletedData },
    });

    // Fire snapshot trigger with pre-captured ctx (row is gone from DB now)
    if (preCapturedDocCtx) {
      onDocumentTableMutation(parseInt(tableId), parseInt(rowId), 'delete', preCapturedDocCtx);
    }

    // ADR-0002 §8 Phase 3 (G6) — recompute progress on the previously-linked
    // ticket (must_total drops by 1 if it was a Must row).
    if (preCapturedCriterionData) {
      Promise.resolve().then(() => onCriterionChange(preCapturedCriterionData, null)).catch(() => {});
    }

    success(res, null, 'Row deleted successfully');
  } catch (err) {
    apiLogger.error({ err }, 'DELETE /tables/:tableId/rows/:rowId error');
    error(res, 'ROW_DELETE_FAILED', err.message, 500);
  }
});

export default router;
