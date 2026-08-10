// ============================================================
// PES Core — Expression Engine
// ============================================================
// The BRIDGE between emotion and expression.
//
// Pipeline:
//   Event → TriggerEngine → EmotionState → ExpressionEngine → PlatformOutput
//
// This module:
//   1. Takes trigger results and generates expressions (body+voice+glyphs)
//   2. Manages expression queue with priorities
//   3. Handles cooldowns (no spam)
//   4. Detects combos (two quick events → special expression)
//   5. Scales intensity (same emotion, different volume)
//   6. Processes owner/group reactions → updates dialect + preferences
//   7. Runs passive ticks (spontaneous behavior when idle)
//   8. Returns platform-agnostic output
// ============================================================

/**
 * Priority levels for expression queue.
 * Higher = more urgent, bypasses queue.
 */
const PRIORITY = {
  CRITICAL: 100,   // rage, scream, dual_rage — always shows
  HIGH:      75,   // alerts, bugs, security
  NORMAL:    50,   // greetings, play, fetch
  LOW:       25,   // idle expressions, yawns
  AMBIENT:   10,   // background state (sleeping animation)
};

/**
 * Maps trigger names to SymbolComposer methods.
 * Default = express(). Special triggers use specialized methods.
 */
const TRIGGER_METHOD_MAP = {
  // Discovery triggers → expressDiscovery()
  bug_detected:      { method: 'expressDiscovery', args: ['bug'] },
  system_error:      { method: 'expressDiscovery', args: ['bug'] },
  anomaly_pattern:   { method: 'expressDiscovery', args: ['prediction'] },
  security_alert:    { method: 'expressDiscovery', args: ['security'] },
  performance_issue: { method: 'expressDiscovery', args: ['performance'] },
  file_discovered:   { method: 'expressDiscovery', args: ['file'] },
  pattern_found:     { method: 'expressDiscovery', args: ['pattern'] },

  // Fetch triggers → expressFetch()
  fetch_result:      { method: 'expressFetch', args: null }, // args from event.quality

  // Social triggers → expressSocial()
  another_pes_detected: { method: 'expressSocial', args: ['meet_pes'] },
  pes_rage_encounter:   { method: 'expressSocial', args: ['dual_rage'] },
  agent_calls_pes:      { method: 'expressSocial', args: ['agent_call'] },

  // Everything else → express() (default)
};

/**
 * Maps trigger names to priority levels.
 */
const TRIGGER_PRIORITY_MAP = {
  pes_rage_encounter:  PRIORITY.CRITICAL,
  anomaly_pattern:     PRIORITY.HIGH,
  bug_detected:        PRIORITY.HIGH,
  system_error:        PRIORITY.HIGH,
  security_alert:      PRIORITY.HIGH,
  owner_returned:      PRIORITY.NORMAL,
  owner_praise:        PRIORITY.NORMAL,
  owner_scold:         PRIORITY.NORMAL,
  owner_gives_task:    PRIORITY.NORMAL,
  fetch_result:        PRIORITY.NORMAL,
  another_pes_detected: PRIORITY.NORMAL,
  agent_calls_pes:     PRIORITY.NORMAL,
  owner_message:       PRIORITY.LOW,
  agent_active:        PRIORITY.LOW,
  owner_ignores:       PRIORITY.LOW,
  fed_good_data:       PRIORITY.LOW,
  fed_junk_data:       PRIORITY.LOW,
};

/**
 * Combo definitions: two triggers close together → special combined expression.
 * windowMs = max time between events for combo to fire.
 */
const COMBOS = [
  {
    name: 'triumphant_solve',
    first: 'bug_detected',
    second: 'bug_solved',
    windowMs: 60_000,
    expression: {
      meaning: 'combo_triumphant_solve',
      bodyPrefer: ['butt_wiggle_turbo', 'bunny_hop', 'spin'],
      voicePrefer: ['bark_excitement', 'roo_roo', 'scream'],
      glyphKeys: ['paw', 'arrow', 'bug', 'arrow', 'check', 'star', 'star'],
    },
    priority: PRIORITY.HIGH,
  },
  {
    name: 'ecstatic_greeting',
    first: 'owner_returned',
    second: 'owner_praise',
    windowMs: 30_000,
    expression: {
      meaning: 'combo_ecstatic_greeting',
      bodyPrefer: ['butt_wiggle_turbo', 'spin', 'bunny_hop'],
      voicePrefer: ['scream', 'roo_roo', 'bark_excitement'],
      glyphKeys: ['paw', 'heart', 'heart', 'heart', 'exclaim', 'exclaim'],
    },
    priority: PRIORITY.HIGH,
  },
  {
    name: 'double_scold',
    first: 'owner_scold',
    second: 'owner_scold',
    windowMs: 10_000,
    expression: {
      meaning: 'combo_double_scold',
      bodyPrefer: ['ears_flat', 'belly_up', 'hide_behind'],
      voicePrefer: ['whine', 'yip', 'sigh'],
      glyphKeys: ['sad', 'sad', 'dots', 'dots', 'dots'],
    },
    priority: PRIORITY.NORMAL,
  },
  {
    name: 'proud_fetch',
    first: 'fetch_result',
    second: 'owner_praise',
    windowMs: 30_000,
    expression: {
      meaning: 'combo_proud_fetch',
      bodyPrefer: ['butt_wiggle_turbo', 'butt_wiggle_fast', 'nose_nudge'],
      voicePrefer: ['roo_roo', 'bark_excitement', 'bark_play'],
      glyphKeys: ['paw', 'ball', 'arrow', 'gift', 'star', 'heart'],
    },
    priority: PRIORITY.HIGH,
  },
  {
    name: 'system_panic',
    first: 'system_error',
    second: 'system_error',
    windowMs: 60_000,
    expression: {
      meaning: 'combo_system_panic',
      bodyPrefer: ['ears_forward', 'low_crouch'],
      voicePrefer: ['bark_alert', 'howl', 'scream'],
      glyphKeys: ['fire', 'fire', 'bolt', 'bolt', 'exclaim', 'exclaim', 'exclaim'],
    },
    priority: PRIORITY.CRITICAL,
  },
];

/**
 * Cooldown config.
 */
const COOLDOWN = {
  sameStateSuppressAfter: 3,    // suppress after N same expressions in a row
  sameStateDecayFactor: 0.5,    // multiply intensity by this when suppressed
  maxSuppressed: 5,             // fully suppress after this many
  neverSuppressStates: new Set([
    'rage', 'scared', 'separation_stress', 'greeting_frenzy',
  ]),
  recentWindowMs: 60_000,       // look at expressions within this window
};


// ── EXPRESSION RESULT ─────────────────────────────────────────────

/**
 * What ExpressionEngine returns. Platform-agnostic.
 * Platform adapters (Telegram, Web, etc.) will consume this.
 */
class ExpressionResult {
  constructor({
    expression,       // PesExpression instance
    priority,         // PRIORITY constant
    triggerName,      // what caused this
    combo = null,     // combo name if combo fired
    suppressed = false,
    shouldNotify = false,
    emotionSnapshot,  // current emotion state
    platformHints = {},
  }) {
    this.expression = expression;
    this.priority = priority;
    this.triggerName = triggerName;
    this.combo = combo;
    this.suppressed = suppressed;
    this.shouldNotify = shouldNotify;
    this.emotionSnapshot = emotionSnapshot;
    this.platformHints = platformHints;
    this.timestamp = Date.now();
    this.id = `er_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  toJSON() {
    return {
      id: this.id,
      expression: this.expression ? this.expression.toJSON() : null,
      priority: this.priority,
      triggerName: this.triggerName,
      combo: this.combo,
      suppressed: this.suppressed,
      shouldNotify: this.shouldNotify,
      emotionSnapshot: this.emotionSnapshot,
      platformHints: this.platformHints,
      timestamp: this.timestamp,
    };
  }
}


// ── EXPRESSION ENGINE ─────────────────────────────────────────────

class ExpressionEngine {
  /**
   * @param {Object} opts
   * @param {EmotionState}   opts.emotionState   — PES emotion FSM
   * @param {TriggerEngine}  opts.triggerEngine   — trigger processor
   * @param {SymbolComposer} opts.symbolComposer  — symbol/body/voice composer
   * @param {MemoryStore}    opts.memoryStore     — persistence (or null for no persistence)
   */
  constructor({ emotionState, triggerEngine, symbolComposer, memoryStore = null }) {
    this.emotions = emotionState;
    this.triggers = triggerEngine;
    this.symbols = symbolComposer;
    this.store = memoryStore;

    // State
    this.level = 0;           // PES level (0-100)
    this.domain = null;       // project domain: 'fintech', 'devops', 'content', etc.
    this.silentMode = false;  // suppress voice channel

    // Queue
    this.queue = [];          // sorted by priority (highest first)
    this.maxQueue = 20;

    // Cooldown tracking
    this.recentExpressions = [];  // last N expression results

    // Combo tracking
    this.recentTriggers = [];     // { triggerName, timestamp }

    // Feedback: maps expressionId → expression data (for linking reactions)
    this.pendingFeedback = new Map();  // expressionId → ExpressionResult
    this.maxPendingFeedback = 100;

    // Listeners
    this.listeners = [];
  }

  // ══════════════════════════════════════════════════════════════════
  // MAIN PIPELINE
  // ══════════════════════════════════════════════════════════════════

  /**
   * Process an external event through the full pipeline:
   *   Event → Trigger → Emotion → Expression → Queue → Result
   *
   * @param {Object} event — { type: string, from?: string, quality?, ...data }
   * @returns {ExpressionResult|null}
   */
  processEvent(event) {
    // 1. Run through trigger engine
    const triggerResult = this.triggers.process(event);
    if (!triggerResult) return null;

    const { triggerName, reaction, intensity, xp, emotionSnapshot } = triggerResult;

    // 2. Check for combo
    const comboResult = this._checkCombo(triggerName);
    if (comboResult) {
      return this._buildComboExpression(comboResult, triggerResult);
    }

    // Record trigger for future combo detection
    this._recordTrigger(triggerName);

    // 3. Pick expression method and generate expression
    const expression = this._generateExpression(triggerName, event);
    if (!expression) return null;

    // 4. Apply intensity scaling
    this._applyIntensityScaling(expression);

    // 5. Check cooldown
    const cooldownResult = this._applyCooldown(expression);

    // 6. Determine priority
    const priority = TRIGGER_PRIORITY_MAP[triggerName] || PRIORITY.NORMAL;

    // 7. Determine notification
    const shouldNotify = priority >= PRIORITY.HIGH;

    // 8. Build platform hints
    const platformHints = this._buildPlatformHints(expression, triggerName, priority);

    // 9. Build result
    const result = new ExpressionResult({
      expression: cooldownResult.suppressed ? null : expression,
      priority,
      triggerName,
      suppressed: cooldownResult.suppressed,
      shouldNotify,
      emotionSnapshot,
      platformHints,
    });

    // 10. Add to queue (if not fully suppressed)
    if (!cooldownResult.suppressed) {
      this._enqueue(result);
    }

    // 11. Track for feedback
    if (!cooldownResult.suppressed) {
      this._trackForFeedback(result);
    }

    // 12. Record in recent expressions
    this._recordExpression(result);

    // 13. Persist interaction
    if (this.store && !cooldownResult.suppressed) {
      try {
        this.store.logInteraction({
          actor: event.from || 'system',
          action_type: triggerName,
          action_detail: JSON.stringify({
            reaction,
            expressionId: result.id,
            rendered: expression ? expression.render() : null,
          }),
          emotion_state: emotionSnapshot ? emotionSnapshot.state : null,
          emotion_intensity: emotionSnapshot ? emotionSnapshot.intensity : null,
        });
      } catch (_) { /* store failure shouldn't break expression */ }
    }

    // 14. Add XP if earned
    if (xp > 0 && this.store) {
      try {
        const xpReasonMap = {
          bug_detected: 'found_bug',
          bug_solved: 'solved_bug',
          anomaly_pattern: 'prediction',
          owner_praise: 'command',
          fetch_result: 'command',
        };
        const reason = xpReasonMap[triggerName] || 'command';
        this.store.addXP(xp, reason, triggerName);
      } catch (_) { /* non-critical */ }
    }

    // 15. Emit
    this._emit('expression', result);

    return result;
  }

  /**
   * Process a reaction from owner or group member.
   * Links the reaction to a specific expression and updates dialect + preferences.
   *
   * @param {string} expressionId — ID of the expression being reacted to
   * @param {Object} reaction — { from, type, value, speed_ms }
   *   from: 'owner' | 'group:username'
   *   type: 'emoji' | 'text' | 'action' | 'silence'
   *   value: '👍' | 'молодец!' | 'opened_file' | null
   *   speed_ms: milliseconds until reaction (null if silence)
   * @returns {Object|null} — updated preference, or null
   */
  processReaction(expressionId, reaction) {
    const pending = this.pendingFeedback.get(expressionId);
    if (!pending || !pending.expression) return null;

    const expr = pending.expression;
    const { from, type, value, speed_ms } = reaction;

    // 1. Calculate weight
    const weight = this._calculateReactionWeight(from, type, value, speed_ms);

    // 2. Determine if owner reacted positively
    const isOwner = from === 'owner';
    const isPositive = weight > 0;

    // 3. Reinforce dialect (body + voice preferences)
    if (isOwner && expr.bodyKey) {
      this.symbols.dialect.reinforce('body', expr.bodyKey, isPositive);
    }
    if (isOwner && expr.voiceKey) {
      this.symbols.dialect.reinforce('voice', expr.voiceKey, isPositive);
    }

    // 4. Extract pattern tags from expression
    const patternTags = this._extractPatternTags(pending);

    // 5. Log reaction to store
    if (this.store) {
      try {
        this.store.logReaction({
          pes_action: pending.triggerName,
          pes_expression: expr.render(),
          pes_context: expr.context || {},
          reactor: from,
          reaction_type: type,
          reaction_value: value,
          reaction_speed: speed_ms || null,
          weight,
          pattern_tags: patternTags,
        });

        // 6. Recalculate preference for primary pattern
        if (patternTags.length > 0) {
          const primaryPattern = `${pending.triggerName}:${patternTags[0]}`;
          this.store.recalculatePreference(primaryPattern);
        }
      } catch (_) { /* non-critical */ }
    }

    // 7. Remove from pending
    this.pendingFeedback.delete(expressionId);

    // 8. Emit
    const feedbackResult = { expressionId, weight, from, positive: isPositive, patternTags };
    this._emit('feedback', feedbackResult);

    return feedbackResult;
  }

  /**
   * Passive tick — call periodically when nothing is happening.
   * Generates spontaneous expressions based on emotional state.
   *
   * @param {number} minutesPassed — minutes since last activity
   * @returns {ExpressionResult|null}
   */
  tick(minutesPassed = 1) {
    // 1. Update emotion state
    this.emotions.passiveTick(minutesPassed);

    const state = this.emotions.current;

    // 2. Check for spontaneous expression triggers
    let expression = null;
    let triggerName = 'passive';
    let priority = PRIORITY.AMBIENT;

    // Loneliness → want attention
    if (state.loneliness > 0.6 && state.state !== 'sleep' && state.state !== 'nap') {
      expression = this.symbols.express(state.state, this.level, { passive: true, reason: 'lonely' });
      triggerName = 'passive_lonely';
      priority = PRIORITY.LOW;
    }
    // Low energy → sleepy expression
    else if (state.energy < 0.2 && state.state !== 'sleep') {
      expression = this.symbols.express('nap', this.level, { passive: true, reason: 'tired' });
      triggerName = 'passive_tired';
      priority = PRIORITY.AMBIENT;
    }
    // Hungry → begging
    else if (state.hunger > 0.7 && state.state !== 'sleep') {
      expression = this.symbols.express('food_obsessed', this.level, { passive: true, reason: 'hungry' });
      triggerName = 'passive_hungry';
      priority = PRIORITY.LOW;
    }
    // Dreaming (while asleep)
    else if ((state.state === 'sleep' || state.state === 'nap') && Math.random() < 0.1) {
      expression = this.symbols.express('sleep', this.level, { passive: true, reason: 'dreaming' });
      triggerName = 'passive_dream';
      priority = PRIORITY.AMBIENT;
    }

    if (!expression) return null;

    // Apply silent mode
    if (this.silentMode) {
      expression.voiceKey = null;
    }

    const result = new ExpressionResult({
      expression,
      priority,
      triggerName,
      emotionSnapshot: state,
      shouldNotify: priority >= PRIORITY.HIGH,
      platformHints: this._buildPlatformHints(expression, triggerName, priority),
    });

    this._enqueue(result);
    this._recordExpression(result);
    this._emit('expression', result);

    return result;
  }

  // ══════════════════════════════════════════════════════════════════
  // QUEUE
  // ══════════════════════════════════════════════════════════════════

  /**
   * Get next expression from queue (highest priority first).
   * Removes it from queue.
   * @returns {ExpressionResult|null}
   */
  dequeue() {
    if (this.queue.length === 0) return null;
    return this.queue.shift();
  }

  /**
   * Peek at next expression without removing.
   * @returns {ExpressionResult|null}
   */
  peek() {
    return this.queue.length > 0 ? this.queue[0] : null;
  }

  /**
   * How many expressions are queued.
   * @returns {number}
   */
  get queueSize() {
    return this.queue.length;
  }

  /**
   * Drain all queued expressions at once.
   * @returns {ExpressionResult[]}
   */
  drainQueue() {
    const items = [...this.queue];
    this.queue = [];
    return items;
  }

  // ══════════════════════════════════════════════════════════════════
  // MODES & SETTINGS
  // ══════════════════════════════════════════════════════════════════

  /**
   * Silent mode — suppress voice channel.
   * Owner said "тихо" → PES whispers only in symbols.
   */
  setSilentMode(on) {
    this.silentMode = !!on;
  }

  /**
   * Update PES level. Affects expression complexity and unlocks.
   */
  setLevel(level) {
    this.level = Math.max(0, Math.min(100, level));
    this.triggers.setLevel(this.level);
  }

  /**
   * Set project domain — affects which symbols PES uses more.
   * @param {string} domain — 'fintech', 'devops', 'content', 'ecommerce', 'gaming', etc.
   */
  setDomain(domain) {
    this.domain = domain;
  }

  /**
   * Get context symbols for current domain from learned preferences.
   * @returns {string[]} — array of glyph keys
   */
  getContextSymbols() {
    if (!this.store || !this.domain) return [];
    try {
      return this.store.getContextSymbols(this.domain);
    } catch (_) {
      return [];
    }
  }

  /**
   * Check if PES should do an action based on learned preferences.
   * @param {string} action — e.g. 'fetch:config_files', 'alert:metrics'
   * @returns {string} — 'prefer'|'increase'|'neutral'|'decrease'|'avoid'|'never'
   */
  shouldDo(action) {
    if (!this.store) return 'neutral';
    try {
      return this.store.shouldDo(action);
    } catch (_) {
      return 'neutral';
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // EVENTS
  // ══════════════════════════════════════════════════════════════════

  /**
   * Subscribe to engine events.
   * Events: 'expression', 'feedback', 'combo', 'suppressed'
   */
  on(event, fn) {
    this.listeners.push({ event, fn });
    return () => {
      this.listeners = this.listeners.filter(l => l.event !== event || l.fn !== fn);
    };
  }

  /**
   * Get the last N expression results (for UI/debugging).
   * @param {number} limit
   * @returns {ExpressionResult[]}
   */
  getRecentExpressions(limit = 10) {
    return this.recentExpressions.slice(-limit);
  }

  // ══════════════════════════════════════════════════════════════════
  // PRIVATE — Expression Generation
  // ══════════════════════════════════════════════════════════════════

  _generateExpression(triggerName, event) {
    const mapping = TRIGGER_METHOD_MAP[triggerName];
    const emotionState = this.emotions.current.state;
    const context = this._buildContext(event);

    let expression;

    if (mapping) {
      if (mapping.method === 'expressDiscovery') {
        const type = mapping.args[0];
        expression = this.symbols.expressDiscovery(type, this.level, context);
      }
      else if (mapping.method === 'expressFetch') {
        const quality = event.quality || 'maybe';
        expression = this.symbols.expressFetch(quality, this.level, context);
      }
      else if (mapping.method === 'expressSocial') {
        const socialEvent = mapping.args[0];
        expression = this.symbols.expressSocial(socialEvent, this.level, context);
      }
    }
    else {
      // Default: express current emotional state
      expression = this.symbols.express(emotionState, this.level, context);
    }

    // Apply silent mode
    if (this.silentMode && expression) {
      expression.voiceKey = null;
    }

    return expression;
  }

  _buildContext(event) {
    const ctx = {};
    if (event.file) ctx.file = event.file;
    if (event.line) ctx.line = event.line;
    if (event.agent) ctx.agent = event.agent;
    if (event.data) ctx.data = event.data;
    if (event.description) ctx.description = event.description;
    if (event.from) ctx.from = event.from;
    if (this.domain) ctx.domain = this.domain;
    return ctx;
  }

  // ══════════════════════════════════════════════════════════════════
  // PRIVATE — Intensity Scaling
  // ══════════════════════════════════════════════════════════════════

  /**
   * Scale expression based on current emotion intensity.
   * Low intensity → quieter body/voice. High → louder.
   */
  _applyIntensityScaling(expression) {
    const intensity = this.emotions.intensity || 0.5;

    // Low intensity: chance to downgrade body/voice
    if (intensity < 0.3) {
      // 60% chance to mute voice at low intensity
      if (Math.random() < 0.6) {
        expression.voiceKey = null;
      }
      // Trim glyphs to max 3 at low intensity
      if (expression.glyphKeys.length > 3) {
        expression.glyphKeys = expression.glyphKeys.slice(0, 3);
      }
    }
    // High intensity: could add emphasis glyphs
    else if (intensity > 0.8) {
      // Add exclamation if not already present
      const hasExclaim = expression.glyphKeys.includes('exclaim');
      if (!hasExclaim && Math.random() < 0.5) {
        expression.glyphKeys.push('exclaim');
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // PRIVATE — Cooldown
  // ══════════════════════════════════════════════════════════════════

  _applyCooldown(expression) {
    if (!expression) return { suppressed: false };

    const state = expression.meaning || '';

    // Never suppress critical states
    if (COOLDOWN.neverSuppressStates.has(state)) {
      return { suppressed: false };
    }

    // Count recent same-state expressions
    const now = Date.now();
    const recent = this.recentExpressions.filter(r =>
      r.expression &&
      r.expression.meaning === state &&
      (now - r.timestamp) < COOLDOWN.recentWindowMs
    );

    const sameCount = recent.length;

    if (sameCount >= COOLDOWN.maxSuppressed) {
      this._emit('suppressed', { state, count: sameCount });
      return { suppressed: true };
    }

    if (sameCount >= COOLDOWN.sameStateSuppressAfter) {
      // Decay intensity instead of full suppress
      if (expression.glyphKeys.length > 2) {
        expression.glyphKeys = expression.glyphKeys.slice(0, 2);
      }
      if (Math.random() < 0.5) {
        expression.voiceKey = null;
      }
      return { suppressed: false, decayed: true };
    }

    return { suppressed: false };
  }

  // ══════════════════════════════════════════════════════════════════
  // PRIVATE — Combos
  // ══════════════════════════════════════════════════════════════════

  _checkCombo(triggerName) {
    const now = Date.now();

    for (const combo of COMBOS) {
      if (combo.second !== triggerName) continue;

      // Look for the first trigger in recent history
      const firstTrigger = this.recentTriggers.find(t =>
        t.triggerName === combo.first &&
        (now - t.timestamp) < combo.windowMs
      );

      if (firstTrigger) {
        return combo;
      }
    }

    return null;
  }

  _buildComboExpression(combo, triggerResult) {
    const { emotionSnapshot } = triggerResult;

    // Use dialect to pick preferred body/voice
    const bodyKey = this.symbols.dialect.prefer('body', combo.expression.bodyPrefer);
    const voiceKey = this.silentMode ? null : this.symbols.dialect.prefer('voice', combo.expression.voicePrefer);

    const { PesExpression } = this._getPesExpressionClass();
    const expression = new PesExpression({
      bodyKey,
      voiceKey,
      glyphKeys: [...combo.expression.glyphKeys],
      meaning: combo.expression.meaning,
      context: { combo: combo.name },
      confidence: 0.95,
      level: this.level,
    });

    const result = new ExpressionResult({
      expression,
      priority: combo.priority,
      triggerName: triggerResult.triggerName,
      combo: combo.name,
      emotionSnapshot,
      shouldNotify: combo.priority >= PRIORITY.HIGH,
      platformHints: this._buildPlatformHints(expression, combo.name, combo.priority),
    });

    this._enqueue(result);
    this._recordExpression(result);
    this._recordTrigger(triggerResult.triggerName);
    this._trackForFeedback(result);

    this._emit('combo', { combo: combo.name, result });
    this._emit('expression', result);

    return result;
  }

  /**
   * Lazy accessor — avoid circular import.
   * PesExpression is imported by SymbolComposer, so we grab it from there.
   */
  _getPesExpressionClass() {
    // Import dynamically to avoid circular dependency
    // PesExpression is simple enough to construct directly
    return {
      PesExpression: class {
        constructor({ bodyKey, voiceKey, glyphKeys, meaning, context, confidence, level }) {
          this.bodyKey = bodyKey;
          this.voiceKey = voiceKey;
          this.glyphKeys = glyphKeys;
          this.meaning = meaning;
          this.context = context;
          this.confidence = confidence;
          this.level = level;
          this.timestamp = Date.now();
          this.id = `expr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        }
        renderBody() { return this.bodyKey; }
        renderVoice() { return this.voiceKey; }
        renderGlyphs() { return this.glyphKeys.join(''); }
        render() {
          return [this.bodyKey, this.voiceKey, this.glyphKeys.join('')].filter(Boolean).join(' ');
        }
        toJSON() {
          return {
            id: this.id, bodyKey: this.bodyKey, voiceKey: this.voiceKey,
            glyphKeys: this.glyphKeys, rendered: this.render(),
            meaning: this.meaning, context: this.context,
            confidence: this.confidence, level: this.level,
            timestamp: this.timestamp,
          };
        }
      }
    };
  }

  // ══════════════════════════════════════════════════════════════════
  // PRIVATE — Queue Management
  // ══════════════════════════════════════════════════════════════════

  _enqueue(result) {
    // Insert sorted by priority (highest first)
    let inserted = false;
    for (let i = 0; i < this.queue.length; i++) {
      if (result.priority > this.queue[i].priority) {
        this.queue.splice(i, 0, result);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      this.queue.push(result);
    }

    // Trim queue
    if (this.queue.length > this.maxQueue) {
      this.queue = this.queue.slice(0, this.maxQueue);
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // PRIVATE — Feedback / Reaction Weight
  // ══════════════════════════════════════════════════════════════════

  /**
   * Calculate reaction weight based on who reacted, how, and how fast.
   */
  _calculateReactionWeight(from, type, value, speed_ms) {
    // Base weights
    const isOwner = from === 'owner';

    let baseWeight = 0;

    if (type === 'emoji') {
      const positive = new Set(['👍', '❤️', '😂', '🔥', '👏', '💪', '🎉', '✅', '💯', '🙌']);
      const negative = new Set(['👎', '😡', '🤮', '💩', '❌', '🙄', '😤']);

      if (positive.has(value)) {
        baseWeight = isOwner ? 1.0 : 0.3;
      } else if (negative.has(value)) {
        baseWeight = isOwner ? -1.0 : -0.3;
      } else {
        baseWeight = isOwner ? 0.2 : 0.1; // neutral emoji = mild positive
      }
    }
    else if (type === 'text') {
      // Simple sentiment: check for known words
      const positiveWords = /молодец|хорош|класс|супер|отлично|good|great|nice|perfect|awesome|yes|да|ура/i;
      const negativeWords = /плохо|нет|стоп|не надо|хватит|bad|stop|no|wrong|ошибка/i;

      if (positiveWords.test(value)) {
        baseWeight = isOwner ? 0.8 : 0.2;
      } else if (negativeWords.test(value)) {
        baseWeight = isOwner ? -0.8 : -0.2;
      } else {
        baseWeight = isOwner ? 0.1 : 0.05; // neutral text = mild positive
      }
    }
    else if (type === 'action') {
      // Owner took action (opened file, clicked link) = confirmation
      baseWeight = isOwner ? 0.6 : 0.2;
    }
    else if (type === 'silence') {
      // Ignored = mild negative for owner, neutral for group
      baseWeight = isOwner ? -0.1 : 0.0;
    }

    // Speed multiplier
    let speedMultiplier = 1.0;
    if (speed_ms !== null && speed_ms !== undefined) {
      if (speed_ms < 30_000) speedMultiplier = 1.5;       // < 30s = fast
      else if (speed_ms > 300_000) speedMultiplier = 0.5;  // > 5min = slow
    }

    return Math.max(-2.0, Math.min(2.0, baseWeight * speedMultiplier));
  }

  _extractPatternTags(result) {
    const tags = [];
    const expr = result.expression;

    // From trigger name
    if (result.triggerName) tags.push(result.triggerName);

    // From expression meaning
    if (expr && expr.meaning) {
      const parts = expr.meaning.split('_');
      if (parts.length > 1) tags.push(parts.slice(1).join('_'));
    }

    // From context
    if (expr && expr.context) {
      if (expr.context.file) {
        // Extract file type
        const ext = expr.context.file.split('.').pop();
        if (ext) tags.push(`file_${ext}`);
      }
      if (expr.context.domain) tags.push(expr.context.domain);
    }

    return tags;
  }

  _trackForFeedback(result) {
    if (!result.expression) return;

    this.pendingFeedback.set(result.id, result);

    // Trim old entries
    if (this.pendingFeedback.size > this.maxPendingFeedback) {
      const keys = [...this.pendingFeedback.keys()];
      for (let i = 0; i < keys.length - this.maxPendingFeedback; i++) {
        this.pendingFeedback.delete(keys[i]);
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // PRIVATE — Platform Hints
  // ══════════════════════════════════════════════════════════════════

  /**
   * Build platform-specific hints for adapters.
   * Adapters (Telegram, Web) read these to decide sticker/animation/sound.
   */
  _buildPlatformHints(expression, triggerName, priority) {
    if (!expression) return {};

    const hints = {
      // Telegram adapter
      telegram: {
        sticker: this._suggestSticker(expression, triggerName),
        reaction: this._suggestTelegramReaction(expression),
        parseMode: 'MarkdownV2',
      },
      // Web adapter (CRM widget / tamagotchi)
      web: {
        animation: this._suggestAnimation(expression, triggerName),
        sound: this._suggestSound(expression),
        shake: priority >= PRIORITY.HIGH,
        glow: priority >= PRIORITY.CRITICAL,
      },
    };

    return hints;
  }

  _suggestSticker(expression, triggerName) {
    // Map emotion/trigger to sticker pack reference
    const stickerMap = {
      greeting_frenzy: 'corgi_hello',
      butt_wiggle:     'corgi_wiggle',
      zoomies:         'corgi_zoomies',
      rage:            'corgi_angry',
      sleep:           'corgi_sleep',
      nap:             'corgi_sleepy',
      puppy_eyes:      'corgi_sad',
      happy:           'corgi_happy',
      alert:           'corgi_alert',
      scared:          'corgi_scared',
      dramatic_tantrum:'corgi_drama',
      stubborn_refuse: 'corgi_stubborn',
      food_obsessed:   'corgi_hungry',
      sploot:          'corgi_sploot',
      herding:         'corgi_working',
      puzzle_solving:  'corgi_thinking',
    };

    const state = expression.meaning || '';
    return stickerMap[state] || stickerMap[expression.bodyKey] || 'corgi_default';
  }

  _suggestTelegramReaction(expression) {
    const reactionMap = {
      happy:           '❤️',
      butt_wiggle:     '🔥',
      zoomies:         '🎉',
      rage:            '😱',
      puppy_eyes:      '😢',
      alert:           '⚡',
      scared:          '😱',
      food_obsessed:   '🤤',
      greeting_frenzy: '❤️',
    };
    return reactionMap[expression.meaning] || null;
  }

  _suggestAnimation(expression, triggerName) {
    if (!expression) return 'idle';
    const animMap = {
      greeting_frenzy: 'spin',
      zoomies:         'run',
      butt_wiggle:     'wiggle',
      sleep:           'breathe',
      nap:             'breathe',
      alert:           'shake',
      rage:            'tremble',
      scared:          'tremble',
      dramatic_tantrum:'flop',
      sploot:          'flatten',
      herding:         'crouch',
      puzzle_solving:  'tilt_head',
    };
    return animMap[expression.meaning] || 'idle';
  }

  _suggestSound(expression) {
    if (!expression || !expression.voiceKey) return null;
    // Voice key maps directly to sound file
    return `${expression.voiceKey}.mp3`;
  }

  // ══════════════════════════════════════════════════════════════════
  // PRIVATE — Tracking
  // ══════════════════════════════════════════════════════════════════

  _recordTrigger(triggerName) {
    this.recentTriggers.push({ triggerName, timestamp: Date.now() });
    // Keep only last 60 seconds worth
    const cutoff = Date.now() - 120_000;
    this.recentTriggers = this.recentTriggers.filter(t => t.timestamp > cutoff);
  }

  _recordExpression(result) {
    this.recentExpressions.push(result);
    // Keep last 50
    if (this.recentExpressions.length > 50) {
      this.recentExpressions = this.recentExpressions.slice(-50);
    }
  }

  _emit(event, data) {
    for (const l of this.listeners) {
      if (l.event === event) {
        try { l.fn(data); } catch (_) { /* listener failure = ignored */ }
      }
    }
  }
}


// ── EXPORTS ─────────────────────────────────────────────────────────

export {
  ExpressionEngine,
  ExpressionResult,
  PRIORITY,
  TRIGGER_METHOD_MAP,
  TRIGGER_PRIORITY_MAP,
  COMBOS,
  COOLDOWN,
};
