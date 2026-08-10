// PES Mini App Routes — public (no auth required)
// Mounted before auth middleware for Telegram WebApp access

import { Router } from 'express';
import registerAppRoutes from './appController.js';

const router = Router();
registerAppRoutes(router);

export default router;
