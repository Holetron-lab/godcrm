// backend/routes/v3/telegram/index.js
// Telegram Bot routes — assembled from sub-modules
// ADR-098: Agent orchestration via Telegram
//
// Sub-modules:
//   shared.js       — Shared imports, constants, BREAK_ACTIVITIES, spinFortuneWheel
//   userRegistry.js — Multi-user file-backed registry
//   sessions.js     — Session state, DB restore, conversation CRUD
//   agentBridge.js  — CRM message sending, agent HTTP trigger, polling
//   commands.js     — Bot commands: /start, /help, /status, /newchat, /chats, admin commands
//   lifePipeline.js — Life Pipeline commands: /sprint, /today, /done, /weight, /mood
//   weeklyFortuna.js — Weekly summary (/week) and Fortune Wheel (/fortuna)
//   webhook.js      — POST /webhook handler (delegates to commands)
//   setup.js        — GET /setup, GET /info
//   channelOps.js   — Channel post/stats/schedule

import { Router } from 'express';
import registerWebhook from './webhook.js';
import registerSetup from './setup.js';
import registerChannelOps from './channelOps.js';

const router = Router();

// Register all route groups
registerWebhook(router);
registerSetup(router);
registerChannelOps(router);

export default router;
