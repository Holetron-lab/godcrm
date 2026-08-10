import express from 'express';
import { dbRun, dbGet, dbAll } from '../database/init.js';
import { authenticate } from '../middleware/auth.js';
import { success, error } from '../utils/response.js';

const router = express.Router();

// Get all businesses for user
router.get('/', authenticate, async (req, res) => {
  try {
    const businesses = await dbAll(`
      SELECT b.*, u.name as owner_name
      FROM businesses b
      JOIN users u ON b.owner_id = u.id
      WHERE b.owner_id = ? OR b.id IN (
        SELECT business_id FROM employee_businesses eb
        JOIN employees e ON eb.employee_id = e.id
        WHERE e.user_id = ?
      )
      ORDER BY b.created_at DESC
    `, [req.user.id, req.user.id]);

    success(res, businesses);
  } catch (err) {
    error(res, err.message);
  }
});

// Create business
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, description } = req.body;
    
    const result = await dbRun(
      'INSERT INTO businesses (name, description, owner_id) VALUES (?, ?, ?)',
      [name, description, req.user.id]
    );

    success(res, { id: result.lastInsertRowid });
  } catch (err) {
    error(res, err.message);
  }
});

// Update business
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { name, description, is_active } = req.body;
    
    await dbRun(
      'UPDATE businesses SET name = ?, description = ?, is_active = ? WHERE id = ? AND owner_id = ?',
      [name, description, is_active, req.params.id, req.user.id]
    );

    success(res, { updated: true });
  } catch (err) {
    error(res, err.message);
  }
});

// Delete business
router.delete('/:id', authenticate, async (req, res) => {
  try {
    await dbRun('DELETE FROM businesses WHERE id = ? AND owner_id = ?', [req.params.id, req.user.id]);
    success(res, { deleted: true });
  } catch (err) {
    error(res, err.message);
  }
});

export default router;
