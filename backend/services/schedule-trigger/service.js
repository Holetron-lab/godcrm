// schedule-trigger/service.js — Main ScheduleTriggerService class
import { dbAll } from '../../database/connection.js';
import { apiLogger } from '../../utils/logger.js';
import { generateMorningBriefing, generateEveningCheckin } from '../BriefingService.js';
import { matchesCron } from './cron.js';
import { findAutomationTablesForSpace, logAutomationExecution, updateAutomationRunStats } from './logging.js';
import {
  LOG_PREFIX,
  executeFortuneWheel,
  executeWebhook,
  executeCreateRow,
  executeNotification,
  executeUpdateField,
  executeDevReport,
  executeRadarPush,
  executeRadarMyTake,
  executeRadarIngest,
} from './action-executors.js';
import {
  executeAgentHealthCheck,
  executeDoraMetrics,
  executeFailureAlerting,
} from './pipeline-executors.js';

class ScheduleTriggerService {
  constructor() {
    /** @type {Array<Object>} Loaded schedule automations with parsed configs */
    this.schedules = [];

    /** @type {ReturnType<typeof setInterval>|null} */
    this.checkInterval = null;

    /** @type {boolean} Guard against overlapping tick executions */
    this.isRunning = false;

    /**
     * Track the last minute each automation fired to prevent duplicate
     * executions within the same cron minute (caused by setTimeout + setInterval race).
     * Key: automation rowId, Value: "YYYY-MM-DD HH:MM" string
     * @type {Map<number, string>}
     */
    this.lastFiredMinute = new Map();
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Initialise the service: load schedule automations and start the
   * once-per-minute check loop.
   */
  async init() {
    try {
      await this.loadScheduleAutomations();
      apiLogger.info(
        { count: this.schedules.length },
        `${LOG_PREFIX} Loaded ${this.schedules.length} schedule automation(s)`
      );

      // Check once per minute
      this.checkInterval = setInterval(() => {
        this.tick().catch(err => {
          apiLogger.error({ err }, `${LOG_PREFIX} Tick error`);
        });
      }, 60 * 1000);

      // Reload automations from DB every 5 minutes (pick up new/changed/deleted automations)
      this.reloadInterval = setInterval(() => {
        this.reload().catch(err => {
          apiLogger.error({ err }, `${LOG_PREFIX} Auto-reload error`);
        });
      }, 5 * 60 * 1000);

      // Run a first check 10 seconds after startup so we don't miss the
      // current minute window (server may start mid-minute).
      setTimeout(() => {
        this.tick().catch(err => {
          apiLogger.error({ err }, `${LOG_PREFIX} Initial tick error`);
        });
      }, 10 * 1000);
    } catch (err) {
      apiLogger.error({ err }, `${LOG_PREFIX} Failed to initialise ScheduleTriggerService`);
    }
  }

  /**
   * Stop the check loop and clean up.
   */
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    if (this.reloadInterval) {
      clearInterval(this.reloadInterval);
      this.reloadInterval = null;
    }
    apiLogger.info(`${LOG_PREFIX} Scheduler stopped`);
  }

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  /**
   * Load all active schedule automations from every space.
   */
  async loadScheduleAutomations() {
    this.schedules = [];

    try {
      // Find all spaces
      const spaces = await dbAll('SELECT id, name FROM spaces', []);

      for (const space of spaces) {
        const tables = await findAutomationTablesForSpace(space.id);
        if (!tables) continue;

        const rows = await dbAll(
          'SELECT id, data FROM table_rows WHERE table_id = ? ORDER BY created_at DESC',
          [tables.automationsTableId]
        );

        for (const row of rows) {
          try {
            const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
            if (!data) continue;

            // Filter: only schedule triggers that are active
            if (data.trigger_type !== 'schedule') continue;
            if (data.is_active === false || data.is_active === 0) continue;

            // Parse nested JSON strings (trigger_config / action_config)
            const triggerConfig = typeof data.trigger_config === 'string'
              ? JSON.parse(data.trigger_config || '{}')
              : (data.trigger_config || {});

            const actionConfig = typeof data.action_config === 'string'
              ? JSON.parse(data.action_config || '{}')
              : (data.action_config || {});

            const cronExpression = triggerConfig.cron || triggerConfig.cron_expression || triggerConfig.schedule;
            if (!cronExpression) {
              apiLogger.warn(
                { automationId: row.id, name: data.name },
                `${LOG_PREFIX} Schedule automation has no cron expression — skipping`
              );
              continue;
            }

            this.schedules.push({
              rowId: row.id,
              spaceId: space.id,
              logsTableId: tables.logsTableId,
              name: data.name || `Automation #${row.id}`,
              cronExpression,
              action_type: data.action_type,
              action_config: actionConfig,
              trigger_config: triggerConfig,
              table_id: data.table_id || null,
              // Keep the full data object for run-stats updates
              _data: data
            });
          } catch (parseErr) {
            apiLogger.warn(
              { err: parseErr, rowId: row.id },
              `${LOG_PREFIX} Failed to parse automation row`
            );
          }
        }
      }
    } catch (err) {
      apiLogger.error({ err }, `${LOG_PREFIX} Failed to load schedule automations`);
    }
  }

  // -------------------------------------------------------------------------
  // Tick — runs every minute
  // -------------------------------------------------------------------------

  /**
   * Evaluate all loaded schedules against the current time and execute
   * any that match.
   */
  async tick() {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      const now = new Date();

      for (const schedule of this.schedules) {
        // Use timezone from trigger_config if available
        const tz = schedule.trigger_config?.timezone || null;
        if (matchesCron(schedule.cronExpression, now, tz)) {
          // Deduplicate: skip if this automation already fired in the current minute.
          // This prevents double execution caused by setTimeout + setInterval race
          // when PM2 restarts close to a cron boundary.
          const minuteKey = tz
            ? (() => {
                const fmt = (opt) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opt }).format(now);
                return `${fmt({ year: 'numeric', month: '2-digit', day: '2-digit' })} ${fmt({ hour: '2-digit', minute: '2-digit', hour12: false })}`;
              })()
            : `${now.getFullYear()}-${now.getMonth()}-${now.getDate()} ${now.getHours()}:${now.getMinutes()}`;

          if (this.lastFiredMinute.get(schedule.rowId) === minuteKey) {
            apiLogger.debug(
              { automationId: schedule.rowId, name: schedule.name, minuteKey },
              `${LOG_PREFIX} Skipping duplicate execution within same minute`
            );
            continue;
          }
          this.lastFiredMinute.set(schedule.rowId, minuteKey);

          apiLogger.info(
            { automationId: schedule.rowId, name: schedule.name, cron: schedule.cronExpression, timezone: tz },
            `${LOG_PREFIX} Cron matched — executing automation`
          );
          await this.executeScheduledAutomation(schedule, now);
        }
      }
    } catch (err) {
      apiLogger.error({ err }, `${LOG_PREFIX} Error during tick`);
    } finally {
      this.isRunning = false;
    }
  }

  // -------------------------------------------------------------------------
  // Execution
  // -------------------------------------------------------------------------

  /**
   * Execute a single scheduled automation and log the result.
   */
  async executeScheduledAutomation(schedule, firedAt) {
    const startTime = Date.now();
    let result;

    const contextData = {
      triggered_at: firedAt.toISOString(),
      trigger_type: 'schedule',
      cron: schedule.cronExpression,
      automation_name: schedule.name
    };

    try {
      switch (schedule.action_type) {
        case 'webhook':
        case 'n8n':
          result = await executeWebhook(schedule.action_config, contextData);
          break;

        case 'create_row':
          result = await executeCreateRow(schedule.action_config, contextData);
          break;

        case 'send_notification':
        case 'notification':
          result = await executeNotification(schedule.action_config, contextData);
          break;

        case 'briefing': {
          const briefingType = schedule.action_config.briefing_type || 'morning';
          if (briefingType === 'morning') {
            result = await generateMorningBriefing(schedule.action_config);
          } else if (briefingType === 'evening') {
            result = await generateEveningCheckin(schedule.action_config);
          } else {
            result = { success: false, error: `Unknown briefing type: ${briefingType}` };
          }
          break;
        }

        case 'update_field': {
          const targetTableId = schedule.action_config.table_id || schedule.table_id;
          const targetRowId = schedule.action_config.row_id;
          if (!targetRowId) {
            result = { success: false, error: 'update_field requires a row_id in action_config for schedule triggers' };
          } else {
            result = await executeUpdateField(targetTableId, targetRowId, schedule.action_config);
          }
          break;
        }

        case 'fortune_wheel': {
          result = await executeFortuneWheel(schedule.action_config, contextData);
          break;
        }

        case 'news_digest': {
          try {
            const { aggregateAndPublishNews } = await import('../ContentAggregatorService.js');
            result = await aggregateAndPublishNews(schedule.action_config || {});
          } catch (err) {
            result = { success: false, error: err.message };
          }
          break;
        }

        case 'agent_health_check':
          result = await executeAgentHealthCheck(schedule.action_config, contextData);
          break;

        case 'dora_metrics':
          result = await executeDoraMetrics(schedule.action_config, contextData);
          break;

        case 'failure_alerting':
          result = await executeFailureAlerting(schedule.action_config, contextData);
          break;

        case 'dev_report':
          result = await executeDevReport(schedule.action_config, contextData);
          break;

        case 'radar_push':
          result = await executeRadarPush(schedule.action_config, contextData);
          break;

        case 'radar_my_take':
          result = await executeRadarMyTake(schedule.action_config, contextData);
          break;

        case 'radar_ingest':
          result = await executeRadarIngest(schedule.action_config, contextData);
          break;

        default:
          result = { success: false, error: `Unsupported action type for schedule trigger: ${schedule.action_type}` };
      }
    } catch (err) {
      result = { success: false, error: err.message };
    }

    const durationMs = Date.now() - startTime;

    // Log execution
    await logAutomationExecution(schedule.logsTableId, {
      automationId: schedule.rowId,
      automationName: schedule.name,
      rowId: null,
      status: result.success ? 'success' : 'error',
      triggerData: contextData,
      resultData: result,
      errorMessage: result.error || null,
      durationMs
    });

    // Update run stats
    await updateAutomationRunStats(schedule.rowId, schedule._data);

    apiLogger.info(
      { automationId: schedule.rowId, name: schedule.name, success: result.success, durationMs },
      `${LOG_PREFIX} Scheduled automation executed`
    );
  }

  // -------------------------------------------------------------------------
  // Hot reload
  // -------------------------------------------------------------------------

  /**
   * Reload all schedule automations from the database.
   */
  async reload() {
    apiLogger.info(`${LOG_PREFIX} Reloading schedule automations`);
    await this.loadScheduleAutomations();
    apiLogger.info(
      { count: this.schedules.length },
      `${LOG_PREFIX} Reloaded ${this.schedules.length} schedule automation(s)`
    );
  }
}

export default ScheduleTriggerService;
