// PES Status Controller — read-only status & emotional state

import { success, error } from '../../../utils/response.js';
import { apiLogger } from '../../../utils/logger.js';
import * as pesBridge from '../../../services/pes/bridge.js';

export default function registerStatusRoutes(router) {
  /**
   * GET /api/v3/pes/status
   * Full PES status for dashboard widget
   */
  router.get('/status', async (req, res) => {
    try {
      const status = pesBridge.getStatus();
      return success(res, status);
    } catch (err) {
      apiLogger.error({ err }, 'PES status error');
      return error(res, 'PES_ERROR', err.message, 500);
    }
  });

  /**
   * GET /api/v3/pes/emotions
   * Emotion state history (for timeline chart)
   */
  router.get('/emotions', async (req, res) => {
    try {
      const history = pesBridge.getEmotionHistory();
      const state = pesBridge.getState();
      return success(res, {
        current: state?.emotions ? {
          state: state.emotions.state,
          intensity: state.emotions.intensity,
          mood: state.emotions.mood,
          energy: state.emotions.energy,
        } : null,
        history,
      });
    } catch (err) {
      apiLogger.error({ err }, 'PES emotions error');
      return error(res, 'PES_ERROR', err.message, 500);
    }
  });

  /**
   * GET /api/v3/pes/traits
   * Trait values + White Fang progression history
   */
  router.get('/traits', async (req, res) => {
    try {
      const state = pesBridge.getState();
      const traitHistory = pesBridge.getTraitHistory();
      return success(res, {
        current: state?.emotions?.traits || {},
        criticalPeriodOver: state?.emotions?.criticalPeriodOver || false,
        history: traitHistory,
      });
    } catch (err) {
      apiLogger.error({ err }, 'PES traits error');
      return error(res, 'PES_ERROR', err.message, 500);
    }
  });

  /**
   * GET /api/v3/pes/config
   * PES configuration (sticker packs, settings)
   */
  router.get('/config', async (req, res) => {
    try {
      const config = pesBridge.getConfig();
      const stickerPacks = pesBridge.getStickerPacks();
      return success(res, { config, stickerPacks });
    } catch (err) {
      apiLogger.error({ err }, 'PES config error');
      return error(res, 'PES_ERROR', err.message, 500);
    }
  });
}
