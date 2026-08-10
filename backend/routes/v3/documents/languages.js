// Documents v4: Language management — add-language, migrate-to-content-en
import express from 'express';
import {
  dbAll, dbGet, dbRun, safeJsonParse, apiLogger,
  success, error, badRequest,
  requireEditorAccess,
} from './_helpers.js';

const router = express.Router();

/** POST /api/v3/projects/:projectId/documents/add-language */
router.post('/projects/:projectId/documents/add-language', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { language_code, language_name, folder_path = 'databases/documents/' } = req.body;
    if (!(await requireEditorAccess(req, res, projectId))) return;
    if (!language_code) return badRequest(res, 'language_code is required (e.g., "de", "fr", "es")');

    const docTables = await dbAll(
      `SELECT id, name FROM universal_tables WHERE project_id = ? AND folder_path LIKE ? AND name LIKE 'doc_%'`,
      [projectId, `%${folder_path}%`]
    );

    let updatedTables = 0;
    for (const table of docTables) {
      const existingCols = await dbAll(
        `SELECT column_name FROM table_columns WHERE table_id = ? AND column_name IN (?, ?)`,
        [table.id, `title_${language_code}`, `content_${language_code}`]
      );
      if (existingCols.length < 2) {
        const maxOrder = await dbGet(
          `SELECT MAX(order_index) as max_order FROM table_columns WHERE table_id = ?`,
          [table.id]
        );
        let nextOrder = (maxOrder?.max_order || 0) + 1;

        if (!existingCols.find(c => c.column_name === `title_${language_code}`)) {
          await dbRun(
            `INSERT INTO table_columns (table_id, column_name, display_name, type, order_index, is_visible, config)
             VALUES (?, ?, ?, 'text', ?, 1, ?)`,
            [table.id, `title_${language_code}`, `Заголовок (${language_name || language_code})`, nextOrder++, JSON.stringify({ translation: true })]
          );
        }
        if (!existingCols.find(c => c.column_name === `content_${language_code}`)) {
          await dbRun(
            `INSERT INTO table_columns (table_id, column_name, display_name, type, order_index, is_visible, config)
             VALUES (?, ?, ?, 'text', ?, 1, ?)`,
            [table.id, `content_${language_code}`, `Контент (${language_name || language_code})`, nextOrder, JSON.stringify({ translation: true })]
          );
        }
        updatedTables++;
      }
    }

    apiLogger.info(`[Documents v4] Added language ${language_code} to ${updatedTables} tables`);
    success(res, { language_code, updated_tables: updatedTables, total_tables: docTables.length });
  } catch (err) {
    apiLogger.error({ err }, 'POST /projects/:projectId/documents/add-language error:', err);
    error(res, 'ADD_LANGUAGE_ERROR', err.message, 500);
  }
});

/** POST /api/v3/projects/:projectId/documents/migrate-to-content-en */
router.post('/projects/:projectId/documents/migrate-to-content-en', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { folder_path = 'databases/documents/' } = req.body;
    if (!(await requireEditorAccess(req, res, projectId))) return;

    const docTables = await dbAll(
      `SELECT id, name FROM universal_tables WHERE project_id = ? AND folder_path LIKE ? AND name LIKE 'doc_%'`,
      [projectId, `%${folder_path}%`]
    );

    let migratedTables = 0;
    let migratedRows = 0;

    for (const table of docTables) {
      const contentCol = await dbGet(
        `SELECT id FROM table_columns WHERE table_id = ? AND column_name = 'content'`, [table.id]
      );
      const contentEnCol = await dbGet(
        `SELECT id FROM table_columns WHERE table_id = ? AND column_name = 'content_en'`, [table.id]
      );

      if (contentCol && !contentEnCol) {
        await dbRun(
          `UPDATE table_columns SET column_name = 'content_en', display_name = 'Content (EN)',
           config = ? WHERE table_id = ? AND column_name = 'content'`,
          [JSON.stringify({ is_default_language: true }), table.id]
        );
        migratedTables++;
      } else if (!contentEnCol) {
        const maxOrder = await dbGet(
          `SELECT MAX(order_index) as max_order FROM table_columns WHERE table_id = ?`, [table.id]
        );
        await dbRun(
          `INSERT INTO table_columns (table_id, column_name, display_name, type, order_index, is_visible, config)
           VALUES (?, 'content_en', 'Content (EN)', 'text', ?, 1, ?)`,
          [table.id, (maxOrder?.max_order || 0) + 1, JSON.stringify({ is_default_language: true })]
        );
        migratedTables++;
      }

      const rows = await dbAll(`SELECT id, data FROM table_rows WHERE table_id = ?`, [table.id]);
      for (const row of rows) {
        try {
          const data = safeJsonParse(row.data, {});
          if (data.content && !data.content_en) {
            data.content_en = data.content;
            delete data.content;
            await dbRun(`UPDATE table_rows SET data = ? WHERE id = ?`, [JSON.stringify(data), row.id]);
            migratedRows++;
          }
        } catch (e) {
          apiLogger.warn(`Failed to migrate row ${row.id}:`, e.message);
        }
      }
    }

    apiLogger.info(`[Documents v4] Migrated ${migratedTables} tables, ${migratedRows} rows to content_en`);
    success(res, { migrated_tables: migratedTables, migrated_rows: migratedRows, total_tables: docTables.length });
  } catch (err) {
    apiLogger.error({ err }, 'POST /projects/:projectId/documents/migrate-to-content-en error:', err);
    error(res, 'MIGRATION_ERROR', err.message, 500);
  }
});

export default router;
