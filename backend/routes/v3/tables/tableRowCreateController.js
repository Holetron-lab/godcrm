/**
 * Table row create controller
 * Handles: POST /tables/:tableId/rows
 */
import express from 'express';
import bcrypt from 'bcrypt';
import { dbAll, dbGet, dbRun, toBool, sqlNow } from '../../../database/connection.js';
import { generateBaseId } from '../../../utils/baseId.js';
import { generatePersonalKey, encryptPersonalKey } from '../../../services/AuthService.js';
import { apiLogger } from '../../../utils/logger.js';
import { isMysqlSource, openMysqlConnection } from '../../../services/data-source/mysql.js';
import { success, created, notFound, badRequest, forbidden, conflict, error } from '../../../utils/response.js';
import { fireRowCreateTriggers } from '../../../services/AutomationTriggerService.js';
import { notifyRowChange } from '../../../services/realtime/rowEvents.js';
import { onDocumentTableMutation } from '../../../services/documents/SnapshotWriter.js';
import { onCriterionChange as onBddCriterionChange } from '../../../services/bdd/completionGate.js';
import { resolveSelectValues } from '../../../services/SelectValueResolver.js';
import { guardRowKeys, unknownKeysMessage } from '../../../services/row-schema-guard.js';
import { normalizeTypedCells, NORMALIZED_CELL_TYPES } from '../../../services/cellNormalizers.js';
import { coerceDataObject } from '../../../services/agent-tools/coerceDataInput.js';
import { checkTableAccess, requireTableWriteAccess } from './helpers.js';
import { validateVerificationSettingsAtom } from '../../../services/verification/applyOverrideValidator.js';
import { validateTicketRefAtom } from '../../../services/atoms/ticket-ref-serializer.js';
import { validateWidgetAtomRecursion } from '../../../services/atoms/widget-atom-recursion-guard.js';
import { ATOMS_V2_TABLE_ID } from '../../../services/atoms-archive.js';
import { getWidgetById } from '../../../services/WidgetService.js';
import { isBookingConflictError, findConflictingRowId } from '../../../lib/booking-constraint.js';
import { writeAudit } from '../../../services/audit/writeAudit.js';
import secretsVault from '../../../services/secrets/SecretsVault.js';
import {
  SECRETS_SYNC_TARGET, validateKey, requireSecretsTableOwner, normalizeSecretRowData,
} from '../../../services/secrets/secretsSystemTable.js';

const router = express.Router();

/**
 * POST /api/v3/tables/:tableId/rows
 * Create a new row in a table (supports external data sources)
 */
router.post('/tables/:tableId/rows', requireTableWriteAccess, async (req, res) => {
  try {
    const { tableId } = req.params;
    let { data } = req.body;

    try { data = coerceDataObject(data, 'data') || {}; }
    catch (e) { return badRequest(res, e.message); }

    if (req.user?.projectId) {
      const access = await checkTableAccess(tableId, req.user);
      if (!access.allowed) {
        return forbidden(res, access.error);
      }
    }

    apiLogger.debug({ tableId, data }, 'POST row request');

    const table = await dbGet(`
      SELECT data_source_id, source_table_name, source_id_column, is_system, sync_target, project_id
      FROM universal_tables
      WHERE id = ?
    `, [tableId]);

    if (!table) {
      return notFound(res, 'Table');
    }

    // Handle system tables (users, projects, etc.)
    if (table.is_system && table.sync_target) {
      // ADR-0012 Phase 8.2 — Widgets is a read-only template registry.
      // Creation goes through POST /api/v3/widgets which sets owner correctly.
      if (table.sync_target === 'widgets') {
        return forbidden(res, 'Creating widgets via system table is not supported. Use POST /api/v3/widgets.');
      }

      // ADR-0040 §space-secrets — a grid row becomes an encrypted vault entry
      // scoped to the table's space. Owner-only; plaintext never echoes back.
      if (table.sync_target === SECRETS_SYNC_TARGET) {
        const scope = await requireSecretsTableOwner(table, req.user);
        if (scope.error) return forbidden(res, scope.error);

        const { key, value, description } = normalizeSecretRowData(tableId, data);
        const keyCheck = validateKey(key);
        if (!keyCheck.ok) return badRequest(res, keyCheck.error);
        if (typeof value !== 'string' || value.length === 0) {
          return badRequest(res, 'value must be a non-empty string');
        }
        const existing = await dbGet('SELECT id FROM _secrets WHERE space_id = ? AND key = ?', [scope.spaceId, keyCheck.value]);
        if (existing) return conflict(res, `Secret "${keyCheck.value}" already exists — edit it instead`);

        try {
          await secretsVault.putSecret(keyCheck.value, value, {
            actor: req.user.id, spaceId: scope.spaceId, description: description ?? null,
          });
        } catch (err) {
          if (err?.code === 'VAULT_NOT_CONFIGURED') return error(res, 'VAULT_NOT_CONFIGURED', err.message, 503);
          throw err;
        }
        const row = await dbGet('SELECT id FROM _secrets WHERE space_id = ? AND key = ?', [scope.spaceId, keyCheck.value]);
        void writeAudit(req, {
          action: 'secret.create', entity_type: 'secret', entity_id: keyCheck.value,
          details: { space_id: scope.spaceId, table_id: Number(tableId), description: description ?? null },
        });
        return created(res, { id: `secret-${row.id}` }, 'Secret created');
      }

      if (table.sync_target === 'users') {
        const columns = await dbAll(`
          SELECT id, column_name FROM table_columns WHERE table_id = ?
        `, [tableId]);

        const idToName = {};
        const nameToId = {};
        columns.forEach(col => {
          idToName[col.id] = col.column_name;
          nameToId[col.column_name] = col.id;
        });

        const normalizedData = {};
        const dataEntries = Object.entries(data || {});

        // First pass: column NAMES
        dataEntries.forEach(([key, value]) => {
          if (nameToId[key]) {
            normalizedData[key] = value;
          }
        });

        // Second pass: column IDs (override)
        dataEntries.forEach(([key, value]) => {
          if (idToName[key]) {
            const columnName = idToName[key];
            normalizedData[columnName] = value;
          }
        });

        apiLogger.debug({ normalizedData }, 'POST users normalizedData');

        const { email, name, role, password_hash } = normalizedData;

        if (!email || !name) {
          return badRequest(res, 'Email and name are required');
        }

        let hashedPassword = null;
        if (password_hash && password_hash !== '••••••••') {
          hashedPassword = await bcrypt.hash(password_hash, 10);
        } else {
          return badRequest(res, 'Password is required for new users');
        }

        const personalKey = generatePersonalKey();
        const encryption_key_encrypted = encryptPersonalKey(personalKey);

        const result = await dbRun(`
          INSERT INTO users (email, name, role, password_hash, encryption_key_encrypted, email_verified, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})
        `, [email, name, role || 'user', hashedPassword, encryption_key_encrypted, toBool(false)]);

        return created(res, { id: result.lastInsertRowid || result.lastID }, 'User created successfully');
      }

      return forbidden(res, `Creating rows in ${table.sync_target} table is not yet supported`);
    }

    // If external table, insert into MySQL
    if (table.data_source_id && table.source_table_name) {
      const DataSourceService = (await import('../../../services/DataSourceService.js')).default;
      const dataSourceService = new DataSourceService();
      const dataSource = await dataSourceService.get(table.data_source_id);

      if (isMysqlSource(dataSource)) {
        const connection = await openMysqlConnection(dataSource);

        try {
          const fields = Object.keys(data);
          const values = Object.values(data);
          const placeholders = fields.map(() => '?').join(', ');
          const fieldNames = fields.map(f => `\`${f}\``).join(', ');

          const [result] = await connection.execute(
            `INSERT INTO \`${table.source_table_name}\` (${fieldNames}) VALUES (${placeholders})`,
            values
          );

          await connection.end();

          return created(res, { id: result.insertId }, 'Row created successfully');
        } catch (mysqlError) {
          await connection.end();
          throw mysqlError;
        }
      }
    }

    // 2026-04-27: silent floor on `order` for doc-content tables (`doc_*`).
    // Frontend regression let `order` become fractional (.5) which broke
    // `ORDER BY (data->>'order')::integer` in document content fetch.
    // Never throw — priority is "document doesn't break".
    if (data && data.order != null && Number.isFinite(Number(data.order))) {
      const tableName = await dbGet(`SELECT name FROM universal_tables WHERE id = ?`, [tableId]);
      if (tableName?.name && tableName.name.startsWith('doc_')) {
        data.order = Math.floor(Number(data.order));
      }
    }

    // QA-20816-01 — keys the schema does not declare are rejected, not stored.
    const keyGuard = await guardRowKeys(tableId, data);
    if (keyGuard.unknown.length > 0) {
      return error(res, 'UNKNOWN_COLUMN', unknownKeysMessage(keyGuard.unknown), 400, { unknown_fields: keyGuard.unknown });
    }
    data = keyGuard.data;

    // Local table - insert into table_rows
    let { resolvedData: validatedData, errors: selectErrors } = await resolveSelectValues(tableId, data);
    if (selectErrors.length > 0) {
      apiLogger.warn({ selectErrors }, 'Select column validation errors on create');
      return badRequest(res, `Invalid select values: ${selectErrors.join('; ')}`);
    }

    // ADR-0035 S1.4 / ADR-0035-A: geo_point + address cells are normalized before the INSERT.
    const typedColumns = await dbAll(
      `SELECT id, column_name, type FROM table_columns WHERE table_id = ? AND type IN (${NORMALIZED_CELL_TYPES.map(() => '?').join(', ')})`,
      [tableId, ...NORMALIZED_CELL_TYPES]
    );
    const geoCheck = normalizeTypedCells(typedColumns, validatedData);
    if (!geoCheck.ok) {
      return error(res, geoCheck.code, geoCheck.message, geoCheck.status, geoCheck.meta);
    }
    validatedData = geoCheck.data;

    // ADR-0011 Phase E2: tighten-only validation for verification_settings
    // override atoms (atoms_v2 only). No-op for unrelated tables/atoms.
    const overrideCheck = await validateVerificationSettingsAtom({
      tableId: parseInt(tableId),
      data: validatedData,
    });
    if (!overrideCheck.ok) {
      apiLogger.warn({ tableId, field: overrideCheck.field, error: overrideCheck.error },
        'verification_settings override rejected (CREATE)');
      return error(res, 'VERIFICATION_OVERRIDE_REJECTED', overrideCheck.error, overrideCheck.status || 400);
    }

    // ADR-0012 §Phase 5: validate ticket_ref atoms and hydrate snapshot when
    // mode != 'live'. No-op for unrelated tables/atoms.
    const ticketRefCheck = await validateTicketRefAtom({
      tableId: parseInt(tableId),
      data: validatedData,
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
      apiLogger.warn({ tableId, field: ticketRefCheck.field, error: ticketRefCheck.error },
        'ticket_ref atom rejected (CREATE)');
      return error(res, ticketRefCheck.code || 'TICKET_REF_INVALID', ticketRefCheck.error, ticketRefCheck.status || 400);
    }
    validatedData = ticketRefCheck.data;

    // ADR-0005 §C-12: block one-level recursive `documents` widget embedding.
    // No-op for non-atoms_v2 tables and for atoms that don't carry both
    // `widget_ref` + `document_id`.
    const recursionCheck = await validateWidgetAtomRecursion({
      tableId: parseInt(tableId),
      data: validatedData,
      atomsV2TableId: ATOMS_V2_TABLE_ID,
      loadWidget: getWidgetById,
      loadDocumentRegistryId: async (documentId) => {
        // Find the registry table that contains a row with id=documentId AND
        // has a documents-widget pointing at it. Falls through to the row's
        // own table_id when it lives in any universal_tables row.
        const row = await dbGet(
          `SELECT table_id FROM table_rows WHERE id = ?`,
          [documentId]
        );
        return row && Number.isInteger(Number(row.table_id)) ? Number(row.table_id) : null;
      },
    });
    if (!recursionCheck.ok) {
      apiLogger.warn(
        { tableId, widget_id: recursionCheck.widget_id, document_id: recursionCheck.document_id },
        'recursive_document_embedding atom rejected (CREATE)'
      );
      return res.status(recursionCheck.status || 400).json({
        success: false,
        error: recursionCheck.code,
        message: recursionCheck.error,
        widget_id: recursionCheck.widget_id,
        document_id: recursionCheck.document_id,
      });
    }

    const base_id = generateBaseId();
    const userId = req.user?.id || null;

    const result = await dbRun(`
      INSERT INTO table_rows (table_id, base_id, data, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ${sqlNow()}, ${sqlNow()})
    `, [tableId, base_id, JSON.stringify(validatedData), userId]);

    const newRowId = result.lastInsertRowid;
    void notifyRowChange({ tableId, rowId: newRowId, action: 'created', source: 'api' });
    fireRowCreateTriggers(parseInt(tableId), newRowId, validatedData).catch(err => {
      apiLogger.warn({ err, tableId, rowId: newRowId }, 'Row create trigger failed (non-blocking)');
    });

    // ADR-0003 C-12: schedule a debounced FS snapshot if this row belongs to
    // a documents_registry or document_content table (atom add → markdown
    // changed). Fire-and-forget.
    onDocumentTableMutation(parseInt(tableId), newRowId, 'update');

    // ADR-0002 §8 Phase 3 (G6) — recompute Tickets.criteria_progress when a
    // new bdd_criteria row was just inserted with a ticket_id. Fire-and-forget.
    if (Number(tableId) === 7256) {
      Promise.resolve().then(() => onBddCriterionChange(null, validatedData)).catch(() => {});
    }

    // ADR-0066 P1 — fire-and-forget audit of the row create. Never awaited.
    void writeAudit(req, {
      action: 'row.create',
      entity_type: 'table_row',
      entity_id: newRowId,
      details: { table_id: Number(tableId), new_data: validatedData },
    });

    const newRow = await dbGet(
      `SELECT id, table_id, base_id, data, created_by, created_at, updated_at FROM table_rows WHERE id = ?`,
      [newRowId]
    );
    created(res, newRow || { id: newRowId, base_id, data: validatedData, created_by: userId }, 'Row created successfully');
  } catch (err) {
    apiLogger.error({ err }, 'POST /tables/:tableId/rows error');

    // ADR-0034 §7 — booking-constraint exclusion violation → 409 with
    // conflicting_row_id so optimistic UI can rollback + toast.
    if (isBookingConflictError(err)) {
      try {
        const conflicting_row_id = await findConflictingRowId({
          table_id: req.params.tableId,
          data: req.body?.data || {},
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

    let userMessage = err.message;
    let errorCode = 'ROW_CREATE_FAILED';
    let statusCode = 500;

    // PostgreSQL unique violation
    if (err.code === '23505') {
      statusCode = 400;
      errorCode = 'UNIQUE_CONSTRAINT_VIOLATION';
      const match = err.detail?.match(/Key \((\w+)\)=/);
      const fieldName = match ? match[1] : 'поле';
      const fieldLabels = {
        email: 'Email',
        name: 'Имя',
        id: 'ID'
      };
      const displayName = fieldLabels[fieldName] || fieldName;
      userMessage = `${displayName} должен быть уникальным. Это значение уже используется.`;
    } else if (err.code === '23502') {
      // PostgreSQL not-null violation
      statusCode = 400;
      errorCode = 'REQUIRED_FIELD_MISSING';
      userMessage = 'Не заполнены обязательные поля';
    }

    error(res, errorCode, userMessage, statusCode);
  }
});

export default router;
