// ============================================================
// PES API Routes — CRM ↔ PES Bridge
// ============================================================

import { Router } from 'express';
import registerStatusRoutes from './statusController.js';
import registerEventRoutes from './eventController.js';
import registerDataRoutes from './dataController.js';

const router = Router();
registerStatusRoutes(router);
registerEventRoutes(router);
registerDataRoutes(router);

export default router;
