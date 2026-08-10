import { logger, apiLogger } from '../utils/logger.js';
import express from 'express';
import { dbRun, dbGet, dbAll } from '../database/init.js';
import { authenticate } from '../middleware/auth.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import { success, error, badRequest, notFound } from '../utils/response.js';

const router = express.Router();

// Get all services
router.get('/', authenticate, async (req, res) => {
  try {
    const { businessId } = req.query;
    
    let query = `
      SELECT s.*, e.name as assigned_name, b.name as business_name
      FROM services s
      LEFT JOIN employees e ON s.assigned_to = e.id
      JOIN businesses b ON s.business_id = b.id
      WHERE b.owner_id = ?
    `;
    
    const params = [req.user.id];
    
    if (businessId) {
      query += ' AND s.business_id = ?';
      params.push(businessId);
    }
    
    query += ' ORDER BY s.created_at DESC';
    
    const services = await dbAll(query, params);
    
    // Decrypt sensitive data
    const decrypted = services.map(s => ({
      ...s,
      login: s.login_encrypted ? decrypt(s.login_encrypted) : null,
      password: s.password_encrypted ? decrypt(s.password_encrypted) : null,
      api_key: s.api_key_encrypted ? decrypt(s.api_key_encrypted) : null,
      notes: s.notes_encrypted ? decrypt(s.notes_encrypted) : null
    }));
    
    success(res, decrypted);
  } catch (err) {
    error(res, err.message);
  }
});

// Create service
router.post('/', authenticate, async (req, res) => {
  try {
    const { businessId, name, description, url, type, status, price, login, password, apiKey, notes, assignedTo } = req.body;
    
    logger.info('📝 Create service request:', { businessId, name, status, hasLogin: !!login, hasPassword: !!password });
    
    if (!businessId || !name) {
      return badRequest(res, 'Business ID and name are required');
    }
    
    const result = await dbRun(`
      INSERT INTO services (
        business_id, name, description, url, type, status, price,
        login_encrypted, password_encrypted, api_key_encrypted, notes_encrypted, assigned_to
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      businessId, 
      name, 
      description || '', 
      url || '', 
      type || 'other', 
      status || 'active', 
      price || null,
      encrypt(login || ''), 
      encrypt(password || ''), 
      encrypt(apiKey || ''), 
      encrypt(notes || ''), 
      assignedTo || null
    ]);

    logger.info('✅ Service created:', result.lastInsertRowid);
    success(res, { id: result.lastInsertRowid });
  } catch (err) {
    logger.error('❌ Create service error:', err);
    error(res, err.message);
  }
});

// Update service (partial update support)
router.put('/:id', authenticate, async (req, res) => {
  try {
    // Get current service data
    const service = await dbGet('SELECT * FROM services WHERE id = ?', [req.params.id]);
    if (!service) {
      return notFound(res, 'Service not found');
    }

    // Extract fields from request - allow partial updates
    const updates = {};
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.description !== undefined) updates.description = req.body.description;
    if (req.body.url !== undefined) updates.url = req.body.url;
    if (req.body.type !== undefined) updates.type = req.body.type;
    if (req.body.status !== undefined) updates.status = req.body.status;
    if (req.body.price !== undefined) updates.price = req.body.price;
    if (req.body.assignedTo !== undefined) updates.assigned_to = req.body.assignedTo;
    
    // Handle encrypted fields
    if (req.body.login !== undefined) updates.login_encrypted = encrypt(req.body.login || '');
    if (req.body.password !== undefined) updates.password_encrypted = encrypt(req.body.password || '');
    if (req.body.apiKey !== undefined) updates.api_key_encrypted = encrypt(req.body.apiKey || '');
    if (req.body.notes !== undefined) updates.notes_encrypted = encrypt(req.body.notes || '');

    // Build dynamic UPDATE query
    const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = Object.values(updates);
    
    if (setClause.length > 0) {
      await dbRun(`
        UPDATE services SET ${setClause}, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [...values, req.params.id]);
    }

    success(res);
  } catch (err) {
    logger.error('Update service error:', err);
    error(res, err.message);
  }
});

// Delete service
router.delete('/:id', authenticate, async (req, res) => {
  try {
    await dbRun('DELETE FROM services WHERE id = ?', [req.params.id]);
    success(res);
  } catch (err) {
    error(res, err.message);
  }
});

export default router;
