// backend/routes/v3/telegramNikitron/index.js
// Thin router that imports all sub-modules and mounts them.
// Split from original telegramNikitron.js (1418 lines).

import { Router } from 'express';

import registerWebhookRoutes from './webhook.js';
import registerSetupRoutes from './setup.js';

const router = Router();

registerWebhookRoutes(router);
registerSetupRoutes(router);

export default router;
