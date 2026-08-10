/**
 * monitoring/ingestion.js
 * Event ingestion and run lifecycle management for MonitoringService
 */

import { dbRun } from '../../database/connection.js';
import { aiLogger } from '../../utils/logger.js';

/**
 * Process incoming events from Lunary SDK
 * @param {Array} events - Array of events from SDK
 * @returns {Object} Processing result
 */
export async function ingestEvents(events) {
  if (!Array.isArray(events)) {
    return { success: false, error: 'Events must be an array' };
  }

  const results = {
    processed: 0,
    errors: [],
    runs: []
  };

  for (const event of events) {
    try {
      await processEvent(event);
      results.processed++;
      if (event.runId) {
        results.runs.push(event.runId);
      }
    } catch (error) {
      results.errors.push({
        event: event.runId || 'unknown',
        error: error.message
      });
    }
  }

  return {
    success: results.errors.length === 0,
    ...results
  };
}

/**
 * Process a single event
 * @param {Object} event - Event object from SDK
 */
async function processEvent(event) {
  const {
    type,
    event: eventName,
    runId,
    parentRunId,
    timestamp,
    userId,
    userProps,
    input,
    output,
    tokensUsage,
    name,
    error,
    tags,
    metadata,
    params,
    templateId,
    runtime,
    // Feedback-specific
    feedback,
    overwrite,
    // Log-specific
    message
  } = event;

  // Store raw event
  await dbRun(`
    INSERT INTO monitoring_events (run_id, event_type, event_name, timestamp, data)
    VALUES (?, ?, ?, ?, ?)
  `, [
    runId || `evt_${Date.now()}`,
    type || 'unknown',
    eventName || 'custom',
    timestamp || Date.now(),
    JSON.stringify(event)
  ]);

  // Handle feedback events separately
  if (eventName === 'feedback' && runId) {
    return handleFeedback(runId, feedback, overwrite);
  }

  // Handle log events
  if (type === 'log') {
    return handleLogEvent(event);
  }

  // Handle run lifecycle events
  if (!runId) return;

  switch (eventName) {
    case 'start':
      await createRun({
        id: runId,
        parentRunId,
        type,
        name,
        input,
        userId,
        userProps,
        tags,
        metadata,
        params,
        templateId,
        runtime
      });
      break;

    case 'end':
      await updateRun(runId, {
        status: 'success',
        output,
        tokensUsage,
        endedAt: timestamp
      });
      break;

    case 'error':
      await updateRun(runId, {
        status: 'error',
        error,
        endedAt: timestamp
      });
      break;
  }
}

/**
 * Create a new run record
 */
async function createRun(data) {
  const {
    id,
    parentRunId,
    type,
    name,
    input,
    userId,
    userProps,
    tags,
    metadata,
    params,
    templateId,
    runtime
  } = data;

  await dbRun(`
    INSERT INTO monitoring_runs (
      id, parent_run_id, type, name, input, user_id, user_props,
      tags, metadata, params, template_id, runtime, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running')
  `, [
    id,
    parentRunId || null,
    type,
    name || null,
    typeof input === 'string' ? input : JSON.stringify(input),
    userId || null,
    userProps ? JSON.stringify(userProps) : null,
    tags ? JSON.stringify(tags) : null,
    metadata ? JSON.stringify(metadata) : null,
    params ? JSON.stringify(params) : null,
    templateId || null,
    runtime || null
  ]);
}

/**
 * Update an existing run
 */
async function updateRun(runId, data) {
  const {
    status,
    output,
    tokensUsage,
    error,
    endedAt
  } = data;

  const updates = [];
  const values = [];

  if (status) {
    updates.push('status = ?');
    values.push(status);
  }

  if (output !== undefined) {
    updates.push('output = ?');
    values.push(typeof output === 'string' ? output : JSON.stringify(output));
  }

  if (tokensUsage) {
    updates.push('tokens_prompt = ?');
    values.push(tokensUsage.prompt || 0);
    updates.push('tokens_completion = ?');
    values.push(tokensUsage.completion || 0);

    // Calculate approximate cost (GPT-4 pricing as default)
    const cost = (tokensUsage.prompt || 0) * 0.00003 + (tokensUsage.completion || 0) * 0.00006;
    updates.push('cost = ?');
    values.push(cost);
  }

  if (error) {
    updates.push('error = ?');
    values.push(typeof error === 'string' ? error : JSON.stringify(error));
  }

  if (endedAt) {
    // Convert milliseconds timestamp to ISO string
    const endDate = new Date(endedAt).toISOString();
    updates.push('ended_at = ?');
    values.push(endDate);
  }

  if (updates.length === 0) return;

  values.push(runId);

  await dbRun(`
    UPDATE monitoring_runs
    SET ${updates.join(', ')}
    WHERE id = ?
  `, values);
}

/**
 * Handle feedback event
 */
export async function handleFeedback(runId, feedback, overwrite = false) {
  if (!feedback || typeof feedback !== 'object') return;

  if (overwrite) {
    await dbRun(`DELETE FROM monitoring_feedback WHERE run_id = ?`, [runId]);
  }

  await dbRun(`
    INSERT INTO monitoring_feedback (run_id, score, thumbs, comment, data)
    VALUES (?, ?, ?, ?, ?)
  `, [
    runId,
    feedback.score || null,
    feedback.thumbs || feedback.thumb || null,
    feedback.comment || null,
    JSON.stringify(feedback)
  ]);
}

/**
 * Handle log event
 */
function handleLogEvent(event) {
  // Log events are already stored in monitoring_events
  // Additional processing can be added here
  if (event.event === 'error') {
    aiLogger.error({ message: event.message, extra: event.extra }, 'Monitoring: Error logged');
  }
}
