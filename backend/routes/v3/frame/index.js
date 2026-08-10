/**
 * Frame Routes — Brilliant Frame Smart Glasses Integration
 *
 * POST /noa — Receive audio/image from Frame glasses, return AI response.
 * POST /tts-optimize — Optimize text for voice reading via AI agent.
 *
 * @see https://docs.brilliant.xyz/frame/
 */

import { Router } from 'express';
import noaController from './noaController.js';

const router = Router();

// All Frame endpoints (noa, tts-optimize, multer error handler)
router.use(noaController);

export default router;
