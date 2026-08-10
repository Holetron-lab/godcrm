// API v3: Files Routes - File upload, download, management
/**
 * @swagger
 * components:
 *   schemas:
 *     File:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         file_id:
 *           type: string
 *         original_name:
 *           type: string
 *         mime_type:
 *           type: string
 *         size:
 *           type: integer
 *         space_id:
 *           type: integer
 *         url:
 *           type: string
 */
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { dbAll, dbGet, dbRun } from '../../database/connection.js';
import { fileLogger } from '../../utils/logger.js';
import { success, created, notFound, badRequest, forbidden, error } from '../../utils/response.js';

const router = express.Router();

/**
 * SEC-1: Check if user has access to space (owner or admin)
 */
async function checkSpaceAccess(spaceId, userId, userRole) {
  if (!spaceId) return { allowed: true }; // Files without space are accessible
  
  const space = await dbGet('SELECT * FROM spaces WHERE id = ?', [spaceId]);
  
  if (!space) {
    return { allowed: false, error: 'Space not found', status: 404 };
  }
  
  const isOwner = space.owner_id === userId;
  const isAdmin = userRole === 'admin' || userRole === 'owner';
  
  if (!isOwner && !isAdmin) {
    return { allowed: false, error: 'Access denied to this space', status: 403 };
  }
  
  return { allowed: true, space };
}

// Base upload path
const UPLOAD_BASE_PATH = process.env.UPLOAD_PATH || '/var/lib/business-crm-data/uploads';
// ADR-098 / Bug fix: Use relative URLs for uploads to avoid domain mismatch (devcrm vs crm).
// The browser will resolve relative URLs against the current origin automatically.
// For absolute URLs needed by backend/AI agents, we read BASE_URL → APP_URL → fallback.
const BASE_URL = process.env.BASE_URL || process.env.APP_URL || 'https://crm.hltrn.cc';

// Ensure upload directories exist
const ensureDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

// Generate unique file ID
const generateFileId = () => {
  return `file_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
};

// Configure multer storage - use temp storage first
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Use temp folder first, will move to correct folder after parsing body
    const tempPath = path.join(UPLOAD_BASE_PATH, '.temp');
    ensureDir(tempPath);
    cb(null, tempPath);
  },
  filename: (req, file, cb) => {
    const fileId = generateFileId();
    const ext = path.extname(file.originalname);
    const safeName = `${fileId}${ext}`;
    req.generatedFileId = fileId;
    req.generatedFileName = safeName;
    cb(null, safeName);
  }
});

// File filter - allow common file types
// SEC-3: Removed image/svg+xml and text/html to prevent XSS attacks
const fileFilter = (req, file, cb) => {
  const allowedMimes = [
    // Images (NO SVG - XSS risk)
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    // Documents
    'application/pdf', 
    'application/msword', 
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // Text (NO HTML - XSS risk)
    'text/plain', 'text/csv', 'text/markdown',
    // Archives
    'application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed',
    // Mobile apps
    'application/vnd.android.package-archive', 'application/octet-stream',
    // Code (text/css and text/javascript are safe as they're served as downloads)
    'application/json', 'application/xml', 'text/javascript', 'text/css',
    // 3D models
    'model/stl', 'application/sla', 'application/vnd.ms-pki.stl',
    'model/gltf-binary', 'model/gltf+json', 'application/octet-stream',
    'model/obj', 'model/fbx'
  ];
  
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${file.mimetype} is not allowed`), false);
  }
};

// Multer upload middleware
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max (temporarily raised for APK upload)
    files: 10 // Max 10 files at once
  }
});

/**
 * POST /api/v3/files/upload
 * Upload single or multiple files
 * @swagger
 * /api/v3/files/upload:
 *   post:
 *     summary: Upload files
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               files:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *               spaceId:
 *                 type: integer
 *     responses:
 *       201:
 *         description: Files uploaded
 */
// ADR-0016 §Phase 5: visibility enum mirrors fileGuard.VALID_VISIBILITY.
// Kept as a literal so the upload route doesn't import the middleware.
const UPLOAD_VISIBILITY_VALUES = ['private', 'internal', 'public'];

router.post('/files/upload', upload.array('files', 10), async (req, res) => {
  try {
    const { projectId, tableId, rowId, columnId, description } = req.body;
    const spaceId = req.body.spaceId || req.body.space_id || req.query.spaceId || req.query.space_id || null;
    const userId = req.user?.id || null;

    // ADR-0016 §Phase 5: accept visibility from body or query. Default is
    // 'internal' so chat attachments, agent generations and document attaches
    // render in <img> for any logged-in user. Column-bound uploads are
    // unaffected because fileGuard reads column.config.visibility first.
    // Callers pass visibility:'private' (system snapshots) or 'public'
    // explicitly when they want a different policy.
    const rawVisibility = req.body.visibility || req.query.visibility || null;
    if (rawVisibility && !UPLOAD_VISIBILITY_VALUES.includes(rawVisibility)) {
      return badRequest(
        res,
        `Invalid visibility "${rawVisibility}". Must be one of: ${UPLOAD_VISIBILITY_VALUES.join(', ')}`
      );
    }
    const visibility = rawVisibility || 'internal';

    fileLogger.debug({ spaceId, projectId, userId, visibility }, 'Upload request received');

    if (!req.files || req.files.length === 0) {
      return badRequest(res, 'No files uploaded');
    }
    
    const uploadedFiles = [];
    
    for (const file of req.files) {
      const fileId = generateFileId();
      
      // Determine target folder
      let targetFolder = 'general';
      if (spaceId) {
        targetFolder = `spaces/${spaceId}`;
      } else if (projectId) {
        targetFolder = `projects/${projectId}`;
      }
      
      // Create target directory
      const targetDir = path.join(UPLOAD_BASE_PATH, targetFolder);
      ensureDir(targetDir);
      
      // Move file from temp to target
      const targetPath = path.join(targetDir, file.filename);
      fs.renameSync(file.path, targetPath);
      
      const relativePath = `${targetFolder}/${file.filename}`;
      // Bug fix: Use relative URL so it works regardless of domain (devcrm vs crm).
      // Frontend resolves against current origin; backend can prepend BASE_URL when needed.
      const fileUrl = `/uploads/${relativePath}`;
      
      fileLogger.debug({ targetPath, fileUrl }, 'File saved');
      
      // Save to database
      await dbRun(`
        INSERT INTO files (
          id, name, original_name, mime_type, size, path, url,
          storage_provider_id, space_id, project_id, table_id, row_id, column_id,
          uploaded_by, description, visibility, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `, [
        fileId,
        file.filename,
        file.originalname,
        file.mimetype,
        file.size,
        targetPath,
        fileUrl,
        'local',
        spaceId || null,
        projectId || null,
        tableId || null,
        rowId || null,
        columnId || null,
        userId,
        description || null,
        visibility
      ]);
      
      uploadedFiles.push({
        id: fileId,
        name: file.filename,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        url: fileUrl,
        spaceId: spaceId || null,
        projectId: projectId || null
      });
    }
    
    fileLogger.info({ count: uploadedFiles.length, userId }, 'Files uploaded');
    
    success(res, uploadedFiles.length === 1 ? uploadedFiles[0] : uploadedFiles);
  } catch (err) {
    fileLogger.error({ err }, 'Upload failed');
    error(res, 'UPLOAD_FAILED', err.message, 500);
  }
});

/**
 * GET /api/v3/files
 * List files with filters
 * @swagger
 * /api/v3/files:
 *   get:
 *     summary: List files
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: spaceId
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of files
 */
router.get('/files', async (req, res) => {
  try {
    const { spaceId, projectId, tableId, rowId, page = 1, limit = 50 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const userId = req.user?.id;
    const userRole = req.user?.role;
    
    // SEC-1: Verify user has access to space
    if (spaceId) {
      const access = await checkSpaceAccess(spaceId, userId, userRole);
      if (!access.allowed) {
        return error(res, 'ACCESS_DENIED', access.error, access.status);
      }
    }
    
    let whereClause = '1=1';
    const params = [];
    
    if (spaceId) {
      whereClause += ' AND space_id = ?';
      params.push(spaceId);
    }
    if (projectId) {
      whereClause += ' AND project_id = ?';
      params.push(projectId);
    }
    if (tableId) {
      whereClause += ' AND table_id = ?';
      params.push(tableId);
    }
    if (rowId) {
      whereClause += ' AND row_id = ?';
      params.push(rowId);
    }
    
    const files = await dbAll(`
      SELECT 
        f.*,
        u.name as uploaded_by_name
      FROM files f
      LEFT JOIN users u ON f.uploaded_by = u.id
      WHERE ${whereClause}
      ORDER BY f.created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, Number(limit), offset]);
    
    const countResult = await dbGet(`
      SELECT COUNT(*) as total FROM files WHERE ${whereClause}
    `, params);
    
    success(res, {
      files,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: countResult?.total || 0,
        pages: Math.ceil((countResult?.total || 0) / Number(limit))
      }
    });
  } catch (err) {
    fileLogger.error({ err }, 'GET /files error');
    error(res, 'FILES_FETCH_FAILED', err.message, 500);
  }
});

/**
 * GET /api/v3/files/:fileId
 * Get single file info
 * @swagger
 * /api/v3/files/{fileId}:
 *   get:
 *     summary: Get file by ID
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: fileId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: File details
 *       404:
 *         description: File not found
 */
router.get('/files/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    const userId = req.user?.id;
    const userRole = req.user?.role;
    
    const file = await dbGet(`
      SELECT 
        f.*,
        u.name as uploaded_by_name
      FROM files f
      LEFT JOIN users u ON f.uploaded_by = u.id
      WHERE f.id = ?
    `, [fileId]);
    
    if (!file) {
      return notFound(res, 'File not found');
    }
    
    // SEC-1: Verify user has access to file's space
    if (file.space_id) {
      const access = await checkSpaceAccess(file.space_id, userId, userRole);
      if (!access.allowed) {
        return error(res, 'ACCESS_DENIED', access.error, access.status);
      }
    }
    
    success(res, file);
  } catch (err) {
    fileLogger.error({ err, fileId: req.params.fileId }, 'GET /files/:fileId error');
    error(res, 'FILE_FETCH_FAILED', err.message, 500);
  }
});

/**
 * DELETE /api/v3/files/:fileId
 * Delete a file
 * @swagger
 * /api/v3/files/{fileId}:
 *   delete:
 *     summary: Delete a file
 *     tags: [Files]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: fileId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: File deleted
 *       404:
 *         description: File not found
 */
router.delete('/files/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    const userId = req.user?.id;
    const userRole = req.user?.role;
    
    const file = await dbGet('SELECT * FROM files WHERE id = ?', [fileId]);
    
    if (!file) {
      return notFound(res, 'File');
    }
    
    // SEC-1: Verify user has access to file's space
    if (file.space_id) {
      const access = await checkSpaceAccess(file.space_id, userId, userRole);
      if (!access.allowed) {
        return error(res, 'ACCESS_DENIED', access.error, access.status);
      }
    }
    
    // Delete physical file
    if (file.path && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
    
    // Delete from database
    await dbRun('DELETE FROM files WHERE id = ?', [fileId]);
    
    fileLogger.info({ fileId, originalName: file.original_name }, 'File deleted');
    
    success(res, { message: 'File deleted successfully' });
  } catch (err) {
    fileLogger.error({ err, fileId: req.params.fileId }, 'DELETE /files/:fileId error');
    error(res, 'FILE_DELETE_FAILED', err.message, 500);
  }
});

/**
 * GET /api/v3/storage-providers
 * List all storage providers
 */
router.get('/storage-providers', async (req, res) => {
  try {
    const providers = await dbAll('SELECT * FROM storage_providers ORDER BY is_default DESC, name ASC');
    
    // Parse config JSON
    providers.forEach(p => {
      if (p.config && typeof p.config === 'string') {
        try {
          p.config = JSON.parse(p.config);
        } catch (e) {
          p.config = {};
        }
      }
    });
    
    success(res, providers);
  } catch (err) {
    fileLogger.error({ err }, 'GET /storage-providers error');
    error(res, 'PROVIDERS_FETCH_FAILED', err.message, 500);
  }
});

/**
 * POST /api/v3/storage-providers
 * Add new storage provider (S3, Google Drive, etc.)
 */
router.post('/storage-providers', async (req, res) => {
  try {
    const { id, name, type, config, isDefault } = req.body;
    
    if (!id || !name || !type) {
      return badRequest(res, 'id, name, and type are required');
    }
    
    // If setting as default, unset other defaults
    if (isDefault) {
      await dbRun('UPDATE storage_providers SET is_default = 0');
    }
    
    await dbRun(`
      INSERT INTO storage_providers (id, name, type, is_default, is_enabled, config, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, datetime('now'), datetime('now'))
    `, [id, name, type, isDefault ? 1 : 0, JSON.stringify(config || {})]);
    
    created(res, { id, name, type, message: 'Storage provider created successfully' });
  } catch (err) {
    fileLogger.error({ err }, 'POST /storage-providers error');
    error(res, 'PROVIDER_CREATE_FAILED', err.message, 500);
  }
});

/**
 * PUT /api/v3/storage-providers/:providerId
 * Update storage provider
 */
router.put('/storage-providers/:providerId', async (req, res) => {
  try {
    const { providerId } = req.params;
    const { name, config, isDefault, isEnabled } = req.body;
    
    const provider = await dbGet('SELECT * FROM storage_providers WHERE id = ?', [providerId]);
    
    if (!provider) {
      return notFound(res, 'Storage provider');
    }
    
    // If setting as default, unset other defaults
    if (isDefault) {
      await dbRun('UPDATE storage_providers SET is_default = 0');
    }
    
    await dbRun(`
      UPDATE storage_providers 
      SET name = ?, config = ?, is_default = ?, is_enabled = ?, updated_at = datetime('now')
      WHERE id = ?
    `, [
      name ?? provider.name,
      JSON.stringify(config ?? JSON.parse(provider.config || '{}')),
      isDefault !== undefined ? (isDefault ? 1 : 0) : provider.is_default,
      isEnabled !== undefined ? (isEnabled ? 1 : 0) : provider.is_enabled,
      providerId
    ]);
    
    success(res, { message: 'Storage provider updated successfully' });
  } catch (err) {
    fileLogger.error({ err, providerId: req.params.providerId }, 'PUT /storage-providers error');
    error(res, 'PROVIDER_UPDATE_FAILED', err.message, 500);
  }
});

/**
 * DELETE /api/v3/storage-providers/:providerId
 * Delete storage provider (except local)
 */
router.delete('/storage-providers/:providerId', async (req, res) => {
  try {
    const { providerId } = req.params;
    
    if (providerId === 'local') {
      return badRequest(res, 'Cannot delete local storage provider');
    }
    
    // Check if any files use this provider
    const filesCount = await dbGet(
      'SELECT COUNT(*) as count FROM files WHERE storage_provider_id = ?',
      [providerId]
    );
    
    if (filesCount?.count > 0) {
      return badRequest(res, `Cannot delete: ${filesCount.count} files are using this storage provider`);
    }
    
    await dbRun('DELETE FROM storage_providers WHERE id = ?', [providerId]);
    
    success(res, { message: 'Storage provider deleted successfully' });
  } catch (err) {
    fileLogger.error({ err, providerId: req.params.providerId }, 'DELETE /storage-providers error');
    error(res, 'PROVIDER_DELETE_FAILED', err.message, 500);
  }
});

// ─── Multer error handler ──────────────────────────────────────
// Bug fix: fileFilter errors are plain Error objects thrown via cb(new Error(...)).
// Without this handler they bubble to the global errorHandler which defaults to 500.
// We intercept them here and return 400 Bad Request instead.
router.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return badRequest(res, 'File too large. Maximum size: 100 MB.');
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return badRequest(res, 'Too many files. Maximum: 10 files at once.');
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return badRequest(res, 'Unexpected file field. Use "files".');
    }
    return badRequest(res, `Upload error: ${err.message}`);
  }
  // fileFilter custom errors (e.g. "File type X is not allowed")
  if (err?.message?.includes('is not allowed')) {
    return badRequest(res, err.message);
  }
  next(err);
});

export default router;
