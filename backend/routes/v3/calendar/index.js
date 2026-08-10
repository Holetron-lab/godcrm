// API v3: Calendar Routes — thin router that imports all controllers

import express from 'express';
import connectionController from './connectionController.js';
import eventsController from './eventsController.js';
import syncController from './syncController.js';
import ticketLinkController from './ticketLinkController.js';

const router = express.Router();

// 1. Connection/auth + calendars listing
router.use(connectionController);

// 2. Events CRUD
router.use(eventsController);

// 3. Sync operations + sync rules + auto-sync
router.use(syncController);

// 4. Ticket <-> Calendar event linking
router.use(ticketLinkController);

export default router;
