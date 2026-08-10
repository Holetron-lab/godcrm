/**
 * Tickets Chains Routes
 * GET /tickets/chains/:chainId — Get chain progress
 * GET /tickets/agents/me/tasks — Get calling agent's pending tasks
 */

import ChainHandoffService from '../../../services/ChainHandoffService.js';
import { success, error, badRequest, notFound } from '../../../utils/response.js';
import { apiLogger } from '../../../utils/logger.js';
import { STATE_NAMES } from './shared.js';

export default function registerChainsRoutes(router) {
  /**
   * GET /tickets/chains/:chainId
   * Get chain progress and task list.
   */
  router.get('/tickets/chains/:chainId', async (req, res) => {
    try {
      const { chainId } = req.params;
      if (!chainId) {
        return badRequest(res, 'chainId is required');
      }

      const status = await ChainHandoffService.getChainStatus(chainId);

      if (status.status === 'not_found') {
        return notFound(res, `Chain '${chainId}'`);
      }

      return success(res, {
        chain_id: status.chain_id,
        status: status.status,
        progress_pct: status.progress.percent_complete,
        total: status.progress.total,
        completed: status.progress.completed,
        in_progress: status.progress.in_progress,
        review: status.progress.review,
        backlog: status.progress.backlog,
        current_step: status.current_step,
        next_step: status.next_step,
        tasks: status.tasks,
      });
    } catch (err) {
      apiLogger.error({ err, chainId: req.params.chainId }, 'Tickets: Chain status fetch failed');
      return error(res, 'CHAIN_STATUS_FAILED', err.message, 500);
    }
  });

  /**
   * GET /tickets/agents/me/tasks
   * Get calling agent's pending tasks (backlog + in_progress).
   */
  router.get('/tickets/agents/me/tasks', async (req, res) => {
    try {
      const agentId = req.user.id;
      const tasks = await ChainHandoffService.getAgentPendingTasks(agentId);

      return success(res, {
        agent_id: agentId,
        count: tasks.length,
        tasks: tasks.map(t => ({
          ...t,
          state_name: STATE_NAMES[t.state] || 'unknown',
        })),
      });
    } catch (err) {
      apiLogger.error({ err }, 'Tickets: Agent tasks fetch failed');
      return error(res, 'AGENT_TASKS_FAILED', err.message, 500);
    }
  });
}
