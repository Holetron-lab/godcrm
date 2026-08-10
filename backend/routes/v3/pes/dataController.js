// PES Data Controller — read-only access to PES memory & history

import { success, error } from '../../../utils/response.js';
import { apiLogger } from '../../../utils/logger.js';
import * as pesBridge from '../../../services/pes/bridge.js';

export default function registerDataRoutes(router) {
  /**
   * GET /api/v3/pes/xp
   * XP log (how PES earned experience)
   */
  router.get('/xp', async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const log = pesBridge.getXpLog(limit);
      return success(res, log);
    } catch (err) {
      apiLogger.error({ err }, 'PES XP log error');
      return error(res, 'PES_ERROR', err.message, 500);
    }
  });

  /**
   * GET /api/v3/pes/commands
   * Learned commands
   */
  router.get('/commands', async (req, res) => {
    try {
      const commands = pesBridge.getCommands();
      return success(res, commands);
    } catch (err) {
      apiLogger.error({ err }, 'PES commands error');
      return error(res, 'PES_ERROR', err.message, 500);
    }
  });

  /**
   * GET /api/v3/pes/relationships
   * Who PES knows and how it feels about them
   */
  router.get('/relationships', async (req, res) => {
    try {
      const relationships = pesBridge.getRelationships();
      return success(res, relationships);
    } catch (err) {
      apiLogger.error({ err }, 'PES relationships error');
      return error(res, 'PES_ERROR', err.message, 500);
    }
  });

  /**
   * GET /api/v3/pes/preferences
   * Learned behavior preferences
   */
  router.get('/preferences', async (req, res) => {
    try {
      const prefs = pesBridge.getPreferences();
      return success(res, prefs);
    } catch (err) {
      apiLogger.error({ err }, 'PES preferences error');
      return error(res, 'PES_ERROR', err.message, 500);
    }
  });

  /**
   * GET /api/v3/pes/fetches
   * Things PES brought back (fetch log)
   */
  router.get('/fetches', async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 30, 100);
      const fetches = pesBridge.getFetchLog(limit);
      return success(res, fetches);
    } catch (err) {
      apiLogger.error({ err }, 'PES fetches error');
      return error(res, 'PES_ERROR', err.message, 500);
    }
  });

  /**
   * GET /api/v3/pes/letters
   * Milestone letters, farewell letters
   */
  router.get('/letters', async (req, res) => {
    try {
      const letters = pesBridge.getLetters();
      return success(res, letters);
    } catch (err) {
      apiLogger.error({ err }, 'PES letters error');
      return error(res, 'PES_ERROR', err.message, 500);
    }
  });

  /**
   * GET /api/v3/pes/reactions
   * How owner reacted to PES (reaction memory)
   */
  router.get('/reactions', async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const reactions = pesBridge.getReactionMemory(limit);
      return success(res, reactions);
    } catch (err) {
      apiLogger.error({ err }, 'PES reactions error');
      return error(res, 'PES_ERROR', err.message, 500);
    }
  });

  /**
   * GET /api/v3/pes/timeline
   * Interaction timeline for charts (grouped by day)
   */
  router.get('/timeline', async (req, res) => {
    try {
      const days = Math.min(parseInt(req.query.days) || 7, 90);
      const timeline = pesBridge.getInteractionTimeline(days);
      return success(res, timeline);
    } catch (err) {
      apiLogger.error({ err }, 'PES timeline error');
      return error(res, 'PES_ERROR', err.message, 500);
    }
  });

  /**
   * GET /api/v3/pes/stickers
   * Sticker packs + learned sticker stats
   */
  router.get('/stickers', async (req, res) => {
    try {
      const packs = pesBridge.getStickerPacks();
      const stats = pesBridge.getLearnedStickerStats();
      return success(res, { packs, learnedByPack: stats });
    } catch (err) {
      apiLogger.error({ err }, 'PES stickers error');
      return error(res, 'PES_ERROR', err.message, 500);
    }
  });
}
