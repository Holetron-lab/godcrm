/**
 * Error Page Routes - DOOM 404 Integration
 * Serves the interactive DOOM game as 404 error page
 */

import fs from 'node:fs';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

const distDoomPath = path.resolve(__dirname, '../../../dist/doom/index.html');
const localDoomPath = path.join(__dirname, 'doom404.html');

const resolveDoomPage = () => (fs.existsSync(distDoomPath) ? distDoomPath : localDoomPath);

/**
 * GET /error/404
 * Serves DOOM-themed 404 page
 * @route GET /error/404
 * @returns {html} Interactive DOOM game
 */
router.get('/404', (req, res) => {
    try {
        const doomPagePath = resolveDoomPage();
        res.sendFile(doomPagePath);
    } catch (error) {
        logger.error({ err: error }, 'Error serving 404 page');
        res.status(500).send('Error loading 404 page');
    }
});

/**
 * Fallback 404 handler - Redirects to DOOM page
 * Should be mounted AFTER all other routes
 */
router.use((req, res) => {
    // For API requests, return JSON
    if (req.path.startsWith('/api')) {
        return res.status(404).json({
            status: 'error',
            message: 'Not found',
            code: 'NOT_FOUND',
            path: req.path
        });
    }

    // For page requests, serve DOOM
    try {
        const doomPagePath = resolveDoomPage();
        res.status(404).sendFile(doomPagePath);
    } catch (error) {
        logger.error({ err: error }, 'Error serving 404 page');
        res.status(500).send('<h1>404 Not Found</h1><p>Error loading error page</p>');
    }
});

export default router;
