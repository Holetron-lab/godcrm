/**
 * @swagger
 * tags:
 *   - name: Spaces
 *     description: Workspace management
 */

// API v3: Spaces Routes
// Handles CRUD operations for Spaces
// ADR-030: Using response helpers for DRY

import { Router } from 'express';

import registerCrudRoutes from './crud.js';
import registerProvisioningRoutes from './provisioning.js';
import registerVariablesRoutes from './variables.js';
import registerVisibilityRoutes from './visibility.js';
import registerInvitationRoutes from './invitations.js';
import registerNotificationDefaultsRoutes from './notificationDefaults.js';

const router = Router();

registerCrudRoutes(router);
registerProvisioningRoutes(router);
registerVariablesRoutes(router);
registerVisibilityRoutes(router);
registerInvitationRoutes(router);
registerNotificationDefaultsRoutes(router);

export default router;
