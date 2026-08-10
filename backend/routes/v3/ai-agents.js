/**
 * @swagger
 * tags:
 *   - name: AI
 *     description: AI Agents, vector search, and analytics
 */

/**
 * AI Agents API Routes — Thin Index
 * ADR-119: Monster file refactoring. All route handlers extracted to ai-agents/ modules.
 *
 * Endpoints for:
 * - AI agent CRUD and execution
 * - AI monitoring, analytics, and prompt processing
 * - Conversations management
 * - Enhanced chat (mentions, context, chunking)
 * - Vector embedding and search
 * - Voice transcription
 * - Agent jobs queue (async dispatch)
 * - Table setup and upgrades
 */

import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';

// Sub-routers
import agentCrudRouter from './ai-agents/agentCrudController.js';
import agentExecutionRouter from './ai-agents/agentExecutionController.js';
import agentChatRouter from './ai-agents/agentChatController.js';
import conversationsRouter from './ai-agents/conversationsController.js';
import enhancedChatRouter from './ai-agents/enhancedChatController.js';
import providersModelsRouter from './ai-agents/providersModelsController.js';
import analyticsRouter from './ai-agents/analyticsController.js';
import setupTablesRouter from './ai-agents/setupTablesController.js';
import vectorRouter from './ai-agents/vectorController.js';
import voiceTranscriptionRouter from './ai-agents/voiceTranscriptionController.js';
import upgradeTablesRouter from './ai-agents/adminUpgradeController.js';
import agentJobsRouter from './ai-agents/agentJobsController.js';
import autopilotDashboardRouter from './ai-agents/autopilotDashboardController.js';

// Side-effect: starts the periodic stuck-processing cleanup interval
import { startStuckProcessingCleanup } from './ai-agents/stuckProcessingCleanup.js';
startStuckProcessingCleanup();

const router = Router();

// All routes require authentication
router.use(authenticate);

// Mount sub-routers (all paths are relative, sub-routers define their own path prefixes)
router.use(agentCrudRouter);           // GET /agents, GET /agents/:spaceId, POST /agents/search, PUT /agents/:agentId
router.use(agentExecutionRouter);      // POST /run
router.use(agentChatRouter);           // POST /chat
router.use(conversationsRouter);       // GET/POST/PUT/DELETE /conversations[/:id]
router.use(enhancedChatRouter);        // POST /chat/send, /chat/:id/bind-task, etc.
router.use(providersModelsRouter);     // GET/PUT /providers, GET /providers/:id/models, POST /providers/:id/refresh-models, GET /models
router.use(analyticsRouter);           // POST /process-prompt, GET /logs/:id, GET /analytics/:id
router.use(setupTablesRouter);         // POST /setup-tables
router.use(vectorRouter);             // POST /vector/generate-cell, /vector/embed, /vector/search, /vector/batch, GET /vector/agents
router.use(voiceTranscriptionRouter); // GET /operators, POST /transcribe, GET/PATCH /spaces/:id/transcription
router.use(upgradeTablesRouter);      // POST /upgrade-agents-tables
router.use(agentJobsRouter);          // GET/POST /agents/jobs[/:id/...]
router.use(autopilotDashboardRouter); // GET /autopilot/dashboard, POST /autopilot/jobs/:id/cancel

export default router;
