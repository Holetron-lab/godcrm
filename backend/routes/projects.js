import { logger, apiLogger } from '../utils/logger.js';
import express from 'express';
import { dbRun, dbGet, dbAll } from '../database/init.js';
import { authenticate } from '../middleware/auth.js';
import { success, error, badRequest, notFound } from '../utils/response.js';

const router = express.Router();

// Get all projects
router.get('/', authenticate, async (req, res) => {
  try {
    const { businessId } = req.query;
    
    let query = `
      SELECT p.*, e.name as assigned_name, b.name as business_name
      FROM projects p
      LEFT JOIN employees e ON p.assigned_to = e.id
      JOIN businesses b ON p.business_id = b.id
      WHERE b.owner_id = ?
    `;
    
    const params = [req.user.id];
    
    if (businessId) {
      query += ' AND p.business_id = ?';
      params.push(businessId);
    }
    
    query += ' ORDER BY p.created_at DESC';
    
    const projects = await dbAll(query, params);
    
    success(res, projects);
  } catch (err) {
    logger.error('Get projects error:', err);
    error(res, err.message);
  }
});

// Get single project
router.get('/:id', authenticate, async (req, res) => {
  try {
    const project = await dbGet(`
      SELECT p.*, e.name as assigned_name, b.name as business_name
      FROM projects p
      LEFT JOIN employees e ON p.assigned_to = e.id
      JOIN businesses b ON p.business_id = b.id
      WHERE p.id = ? AND b.owner_id = ?
    `, [req.params.id, req.user.id]);
    
    if (!project) {
      return notFound(res, 'Project not found');
    }
    
    success(res, project);
  } catch (err) {
    logger.error('Get project error:', err);
    error(res, err.message);
  }
});

// Create project
router.post('/', authenticate, async (req, res) => {
  try {
    const { 
      businessId, 
      name, 
      description, 
      status, 
      priority, 
      startDate, 
      endDate, 
      budget, 
      clientName,
      assignedTo,
      progress,
      tags,
      notes
    } = req.body;
    
    logger.info('📝 Create project request:', { businessId, name, status, priority });
    
    if (!businessId || !name) {
      return badRequest(res, 'Business ID and name are required');
    }
    
    const result = await dbRun(`
      INSERT INTO projects (
        business_id, name, description, status, priority, 
        start_date, end_date, budget, client_name, assigned_to, 
        progress, tags, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      businessId, 
      name || 'New Project', 
      description || '', 
      status || 'planning', 
      priority || 'medium',
      startDate || null,
      endDate || null,
      budget || null,
      clientName || '',
      assignedTo || null,
      progress || 0,
      tags || '',
      notes || ''
    ]);

    logger.info('✅ Project created:', result.lastInsertRowid);
    success(res, { id: result.lastInsertRowid });
  } catch (err) {
    logger.error('❌ Create project error:', err);
    error(res, err.message);
  }
});

// Update project (partial update support)
router.put('/:id', authenticate, async (req, res) => {
  try {
    // Get current project
    const project = await dbGet('SELECT * FROM projects WHERE id = ?', [req.params.id]);
    if (!project) {
      return notFound(res, 'Project not found');
    }

    // Extract fields from request - allow partial updates
    const updates = {};
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.description !== undefined) updates.description = req.body.description;
    if (req.body.status !== undefined) updates.status = req.body.status;
    if (req.body.priority !== undefined) updates.priority = req.body.priority;
    if (req.body.startDate !== undefined) updates.start_date = req.body.startDate;
    if (req.body.endDate !== undefined) updates.end_date = req.body.endDate;
    if (req.body.budget !== undefined) updates.budget = req.body.budget;
    if (req.body.clientName !== undefined) updates.client_name = req.body.clientName;
    if (req.body.assignedTo !== undefined) updates.assigned_to = req.body.assignedTo;
    if (req.body.progress !== undefined) updates.progress = req.body.progress;
    if (req.body.tags !== undefined) updates.tags = req.body.tags;
    if (req.body.notes !== undefined) updates.notes = req.body.notes;

    // Build dynamic UPDATE query
    const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = Object.values(updates);
    
    if (setClause.length > 0) {
      await dbRun(`
        UPDATE projects SET ${setClause}, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [...values, req.params.id]);
    }

    success(res);
  } catch (err) {
    logger.error('Update project error:', err);
    error(res, err.message);
  }
});

// Delete project
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const project = await dbGet('SELECT * FROM projects WHERE id = ?', [req.params.id]);
    if (!project) {
      return notFound(res, 'Project not found');
    }

    await dbRun('DELETE FROM projects WHERE id = ?', [req.params.id]);
    success(res);
  } catch (err) {
    logger.error('Delete project error:', err);
    error(res, err.message);
  }
});

export default router;
