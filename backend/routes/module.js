import express from 'express';
import { dbAll } from '../database/init.js';
import { authenticate } from '../middleware/auth.js';
import { success, error } from '../utils/response.js';

const router = express.Router();

// Get all modules
router.get('/', authenticate, async (req, res) => {
  try {
    const modules = await dbAll('SELECT * FROM modules WHERE is_active = 1 ORDER BY id');
    return success(res, modules);
  } catch (err) {
    return error(res, err.message);
  }
});

export default router;
