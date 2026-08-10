// ============================================================
// CRM Bridge for PES — Polls CRM events and triggers PES
// ============================================================
// This module runs inside PES process and polls crm-events.json
// When events are found, it triggers PES emotional responses
// ============================================================

import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVENTS_FILE = join(__dirname, '../pes-data/crm-events.json');

// CRM event type → PES trigger mapping
const EVENT_MAPPING = {
  ticket_created:      { trigger: 'agent_active',    mood: -0.02, energy: +0.05, curiosity: +0.1 },
  ticket_resolved:     { trigger: 'owner_praise',    mood: +0.1,  energy: +0.05, curiosity: 0 },
  agent_completed:     { trigger: 'command_learned',  mood: +0.05, energy: +0.02, curiosity: +0.05 },
  agent_failed:        { trigger: 'bug_detected',     mood: -0.05, energy: -0.03, curiosity: +0.1 },
  deployment_success:  { trigger: 'owner_praise',     mood: +0.15, energy: +0.1,  curiosity: 0 },
  deployment_failed:   { trigger: 'bug_detected',     mood: -0.1,  energy: -0.05, curiosity: +0.15 },
  user_login:          { trigger: 'owner_returned',   mood: +0.1,  energy: +0.1,  curiosity: +0.05 },
  user_logout:         { trigger: 'owner_left',       mood: -0.05, energy: -0.02, curiosity: -0.05 },
  error_spike:         { trigger: 'anomaly_pattern',  mood: -0.1,  energy: +0.1,  curiosity: +0.2 },
  custom:              { trigger: 'owner_message',    mood: 0,     energy: 0,     curiosity: +0.05 },
};

export class CrmBridge {
  /**
   * @param {import('../core/pes.js').default} pes — PES instance
   * @param {Object} opts
   * @param {number} [opts.pollInterval=10000] — ms between polls
   * @param {Function} [opts.onEvent] — callback when event processed
   */
  constructor(pes, opts = {}) {
    this.pes = pes;
    this.pollInterval = opts.pollInterval || 10_000;
    this.onEvent = opts.onEvent || null;
    this._timer = null;
    this._running = false;
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._poll(); // immediate first poll
    this._timer = setInterval(() => this._poll(), this.pollInterval);
    console.log(`[CRM-BRIDGE] Started polling CRM events every ${this.pollInterval}ms`);
  }

  stop() {
    this._running = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    console.log('[CRM-BRIDGE] Stopped');
  }

  _poll() {
    try {
      if (!existsSync(EVENTS_FILE)) return;

      const raw = readFileSync(EVENTS_FILE, 'utf8');
      const events = JSON.parse(raw);
      const pending = events.filter(e => !e.consumed);

      if (pending.length === 0) return;

      const consumedIds = [];

      for (const event of pending) {
        try {
          this._processEvent(event);
          consumedIds.push(event.id);
        } catch (err) {
          console.error(`[CRM-BRIDGE] Error processing event ${event.id}:`, err.message);
        }
      }

      // Mark consumed
      if (consumedIds.length > 0) {
        for (const e of events) {
          if (consumedIds.includes(e.id)) e.consumed = true;
        }
        const tmp = EVENTS_FILE + '.tmp';
        writeFileSync(tmp, JSON.stringify(events, null, 2));
        renameSync(tmp, EVENTS_FILE);
        console.log(`[CRM-BRIDGE] Processed ${consumedIds.length} CRM events`);
      }
    } catch (err) {
      console.error('[CRM-BRIDGE] Event poll error:', err.message);
    }
  }

  _processEvent(event) {
    const mapping = EVENT_MAPPING[event.type];
    if (!mapping) {
      console.log(`[CRM-BRIDGE] Unknown event type: ${event.type}`);
      return;
    }

    // Trigger PES event
    if (this.pes && this.pes.event) {
      const pesEvent = {
        type: mapping.trigger,
        source: 'crm',
        detail: event.data,
        timestamp: event.timestamp,
        vitalAdjustments: {
          mood: mapping.mood,
          energy: mapping.energy,
          curiosity: mapping.curiosity,
        },
      };

      this.pes.event(pesEvent);

      console.log(
        `[CRM-BRIDGE] ${event.type} → PES trigger:${mapping.trigger}`,
        `(mood:${mapping.mood > 0 ? '+' : ''}${mapping.mood}, energy:${mapping.energy > 0 ? '+' : ''}${mapping.energy})`
      );
    }

    if (this.onEvent) {
      this.onEvent(event, mapping);
    }
  }
}

export default CrmBridge;
