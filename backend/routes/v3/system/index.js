// API v3: System Routes — thin router that imports all controllers

import express from 'express';
import settingsController from './settingsController.js';
import onboardingOpenApiController from './onboardingOpenApiController.js';
import backupDbController from './backupDbController.js';

const router = express.Router();

// 1. Rate limits, system info, settings, SMTP
router.use(settingsController);

// 2. Quick start, onboarding, OpenAPI spec
router.use(onboardingOpenApiController);

// 3. Backup management + DB monitoring
router.use(backupDbController);

export default router;
