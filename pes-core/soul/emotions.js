/**
 * PES Soul — Emotional State Machine (v2: Level-Gated)
 *
 * 32 emotional states based on real Pembroke Welsh Corgi behavior.
 * States are grouped by unlock level — PES gains emotional range as it evolves.
 *
 * Level gates:
 *   0  basic_emotions    — idle, content, playful, happy, butt_wiggle, scared, nap, sploot
 *   3  emotion_social    — puppy_eyes, wanna_play, velcro, jealous, howl_sing, greeting_frenzy
 *   5  emotion_working   — alert, bark, herding, bossy, puzzle_solving, wrote_somewhere
 *   8  emotion_dramatic  — grumble, dramatic_tantrum, stubborn_refuse, sulking, side_eye
 *  10  emotion_full      — zoomies, play_bow, corgi_flop, anxious, separation_stress, rage, sneaky, food_obsessed
 *
 * Tick system adapted for internet reality:
 *   - 1 tick = 1 meaningful event (message, command, agent action)
 *   - Passive time passes in larger chunks (minutes between interactions)
 *   - Energy/hunger/loneliness scale to real online session patterns
 */

// ── EMOTION LEVEL GATES ───────────────────────────────────────────

const EMOTION_LEVELS = {
  basic_emotions:  { level: 0,  states: ['idle', 'content', 'playful', 'happy', 'butt_wiggle', 'scared', 'nap', 'sploot', 'sleep'] },
  emotion_social:  { level: 3,  states: ['puppy_eyes', 'wanna_play', 'velcro', 'jealous', 'howl_sing', 'greeting_frenzy'] },
  emotion_working: { level: 5,  states: ['alert', 'bark', 'herding', 'bossy', 'puzzle_solving', 'wrote_somewhere'] },
  emotion_dramatic:{ level: 8,  states: ['grumble', 'dramatic_tantrum', 'stubborn_refuse', 'sulking', 'side_eye'] },
  emotion_full:    { level: 10, states: ['zoomies', 'play_bow', 'corgi_flop', 'anxious', 'separation_stress', 'rage', 'sneaky', 'food_obsessed'] },
};

/**
 * Build a Set of unlocked state names for a given PES level.
 */
function buildUnlockedSet(pesLevel) {
  const set = new Set();
  for (const group of Object.values(EMOTION_LEVELS)) {
    if (pesLevel >= group.level) {
      for (const s of group.states) set.add(s);
    }
  }
  return set;
}


// ── STATES ────────────────────────────────────────────────────────
// weight:      probability of spontaneous emergence (0 = only via trigger/transition)
// decay:       how fast intensity drops per tick
// minDuration: ticks before natural exit
// maxDuration: ticks before forced exit
// energyCost:  energy burned per tick (negative = recovery)
// category:    grouping for UI/logic

const STATES = {
  // === CORE / BASELINE (level 0) ===
  idle:              { weight: 0,    decay: 0.005, minDuration: 5,   maxDuration: 50,  energyCost: 0.001, category: 'baseline' },
  content:           { weight: 0,    decay: 0.003, minDuration: 10,  maxDuration: 100, energyCost: 0.001, category: 'baseline' },
  playful:           { weight: 0.18, decay: 0.008, minDuration: 5,   maxDuration: 30,  energyCost: 0.008, category: 'happy' },
  happy:             { weight: 0,    decay: 0.010, minDuration: 5,   maxDuration: 25,  energyCost: 0.005, category: 'happy' },
  butt_wiggle:       { weight: 0.08, decay: 0.020, minDuration: 2,   maxDuration: 8,   energyCost: 0.006, category: 'happy' },
  scared:            { weight: 0,    decay: 0.015, minDuration: 2,   maxDuration: 15,  energyCost: 0.005, category: 'stress' },
  nap:               { weight: 0,    decay: 0.002, minDuration: 10,  maxDuration: 60,  energyCost: -0.005, category: 'rest' },
  sploot:            { weight: 0.03, decay: 0.003, minDuration: 5,   maxDuration: 40,  energyCost: -0.002, category: 'rest' },

  // === SOCIAL (level 3) ===
  puppy_eyes:        { weight: 0.10, decay: 0.004, minDuration: 5,   maxDuration: 40,  energyCost: 0.002, category: 'social' },
  wanna_play:        { weight: 0.06, decay: 0.006, minDuration: 5,   maxDuration: 25,  energyCost: 0.004, category: 'social' },
  velcro:            { weight: 0.05, decay: 0.002, minDuration: 10,  maxDuration: 100, energyCost: 0.001, category: 'social' },
  jealous:           { weight: 0.02, decay: 0.008, minDuration: 3,   maxDuration: 20,  energyCost: 0.005, category: 'social' },
  howl_sing:         { weight: 0.01, decay: 0.015, minDuration: 2,   maxDuration: 10,  energyCost: 0.007, category: 'social' },
  greeting_frenzy:   { weight: 0,    decay: 0.020, minDuration: 3,   maxDuration: 10,  energyCost: 0.015, category: 'happy' },

  // === WORKING (level 5) ===
  alert:             { weight: 0,    decay: 0.012, minDuration: 3,   maxDuration: 20,  energyCost: 0.005, category: 'working' },
  bark:              { weight: 0.07, decay: 0.015, minDuration: 2,   maxDuration: 15,  energyCost: 0.008, category: 'working' },
  herding:           { weight: 0.03, decay: 0.006, minDuration: 5,   maxDuration: 30,  energyCost: 0.012, category: 'working' },
  bossy:             { weight: 0.02, decay: 0.005, minDuration: 5,   maxDuration: 25,  energyCost: 0.006, category: 'working' },
  puzzle_solving:    { weight: 0,    decay: 0.004, minDuration: 5,   maxDuration: 40,  energyCost: 0.010, category: 'working' },
  wrote_somewhere:   { weight: 0.02, decay: 0.020, minDuration: 2,   maxDuration: 10,  energyCost: 0.003, category: 'working' },

  // === DRAMATIC (level 8) ===
  grumble:           { weight: 0.04, decay: 0.010, minDuration: 3,   maxDuration: 20,  energyCost: 0.003, category: 'dramatic' },
  dramatic_tantrum:  { weight: 0.02, decay: 0.018, minDuration: 2,   maxDuration: 12,  energyCost: 0.010, category: 'dramatic' },
  stubborn_refuse:   { weight: 0.02, decay: 0.003, minDuration: 5,   maxDuration: 30,  energyCost: 0.001, category: 'dramatic' },
  sulking:           { weight: 0,    decay: 0.003, minDuration: 5,   maxDuration: 50,  energyCost: 0.001, category: 'dramatic' },
  side_eye:          { weight: 0.02, decay: 0.025, minDuration: 1,   maxDuration: 5,   energyCost: 0.001, category: 'dramatic' },

  // === FULL SPECTRUM (level 10) ===
  sleep:             { weight: 0,    decay: 0.001, minDuration: 20,  maxDuration: 200, energyCost: -0.010, category: 'rest' },
  zoomies:           { weight: 0.05, decay: 0.025, minDuration: 3,   maxDuration: 12,  energyCost: 0.030, category: 'happy' },
  play_bow:          { weight: 0.04, decay: 0.030, minDuration: 1,   maxDuration: 5,   energyCost: 0.005, category: 'happy' },
  corgi_flop:        { weight: 0.02, decay: 0.015, minDuration: 1,   maxDuration: 5,   energyCost: 0.000, category: 'rest' },
  anxious:           { weight: 0,    decay: 0.005, minDuration: 5,   maxDuration: 30,  energyCost: 0.008, category: 'stress' },
  separation_stress: { weight: 0,    decay: 0.002, minDuration: 10,  maxDuration: 100, energyCost: 0.006, category: 'stress' },
  rage:              { weight: 0.01, decay: 0.002, minDuration: 10,  maxDuration: 30,  energyCost: 0.020, category: 'rare' },
  sneaky:            { weight: 0.01, decay: 0.020, minDuration: 2,   maxDuration: 10,  energyCost: 0.004, category: 'rare' },
  food_obsessed:     { weight: 0.03, decay: 0.005, minDuration: 3,   maxDuration: 25,  energyCost: 0.003, category: 'rare' },
};


// ── TRANSITIONS ───────────────────────────────────────────────────
// state -> [possible next states]
// Based on real corgi behavioral flow patterns.
// At runtime, locked states are filtered out.

const TRANSITIONS = {
  // Baseline
  idle:              ['playful', 'puppy_eyes', 'bark', 'wanna_play', 'grumble', 'nap', 'alert', 'sploot', 'velcro', 'content', 'food_obsessed', 'side_eye', 'sneaky'],
  content:           ['idle', 'playful', 'nap', 'sploot', 'velcro', 'butt_wiggle'],

  // Happy cluster
  playful:           ['happy', 'bark', 'wanna_play', 'zoomies', 'butt_wiggle', 'play_bow', 'idle', 'herding', 'corgi_flop'],
  happy:             ['playful', 'idle', 'wanna_play', 'butt_wiggle', 'content', 'zoomies', 'sploot'],
  butt_wiggle:       ['playful', 'zoomies', 'greeting_frenzy', 'happy', 'play_bow'],
  zoomies:           ['sploot', 'corgi_flop', 'happy', 'playful', 'nap'],
  play_bow:          ['playful', 'zoomies', 'herding', 'wanna_play'],
  greeting_frenzy:   ['butt_wiggle', 'zoomies', 'happy', 'velcro', 'playful'],

  // Social cluster
  puppy_eyes:        ['playful', 'grumble', 'idle', 'happy', 'dramatic_tantrum', 'sulking', 'velcro'],
  wanna_play:        ['playful', 'puppy_eyes', 'idle', 'grumble', 'play_bow', 'dramatic_tantrum'],
  velcro:            ['content', 'puppy_eyes', 'nap', 'idle', 'jealous', 'separation_stress'],
  jealous:           ['bark', 'grumble', 'dramatic_tantrum', 'sulking', 'velcro'],
  howl_sing:         ['alert', 'idle', 'content', 'bark'],

  // Working cluster
  alert:             ['bark', 'wrote_somewhere', 'idle', 'scared', 'herding', 'puzzle_solving', 'side_eye'],
  bark:              ['playful', 'alert', 'rage', 'idle', 'grumble', 'herding', 'bossy', 'howl_sing'],
  herding:           ['bark', 'bossy', 'playful', 'grumble', 'zoomies', 'stubborn_refuse'],
  bossy:             ['herding', 'grumble', 'bark', 'content', 'sulking'],
  puzzle_solving:    ['happy', 'wrote_somewhere', 'grumble', 'dramatic_tantrum', 'alert'],
  wrote_somewhere:   ['idle', 'playful', 'happy', 'sneaky', 'content'],

  // Dramatic cluster
  grumble:           ['idle', 'bark', 'puppy_eyes', 'nap', 'dramatic_tantrum', 'stubborn_refuse', 'sulking'],
  dramatic_tantrum:  ['sulking', 'grumble', 'idle', 'food_obsessed', 'stubborn_refuse'],
  stubborn_refuse:   ['grumble', 'dramatic_tantrum', 'idle', 'sulking'],
  sulking:           ['idle', 'food_obsessed', 'puppy_eyes', 'grumble', 'content'],
  side_eye:          ['alert', 'idle', 'sneaky', 'grumble', 'bark'],

  // Rest cluster
  sleep:             ['idle', 'puppy_eyes', 'alert', 'content'],
  nap:               ['idle', 'alert', 'content', 'sploot', 'sleep'],
  sploot:            ['nap', 'idle', 'content', 'alert', 'playful'],
  corgi_flop:        ['nap', 'sploot', 'sleep', 'idle'],

  // Stress cluster
  scared:            ['idle', 'puppy_eyes', 'nap', 'velcro', 'anxious', 'zoomies'],
  anxious:           ['scared', 'velcro', 'bark', 'zoomies', 'idle'],
  separation_stress: ['anxious', 'bark', 'greeting_frenzy', 'velcro'],

  // Rare cluster
  rage:              ['scared', 'idle', 'grumble', 'corgi_flop'],
  sneaky:            ['idle', 'happy', 'sulking', 'side_eye', 'food_obsessed'],
  food_obsessed:     ['puppy_eyes', 'dramatic_tantrum', 'content', 'grumble', 'sneaky'],
};


// ── VITALS ────────────────────────────────────────────────────────
// Adapted for INTERNET REALITY:
// - PES lives in chats/projects, not the physical world
// - "hunger" = need for data/tasks
// - "energy" = computational resource, recovers at rest
// - "loneliness" = time without interactions
// - Ticks bound to events, not seconds

const VITAL_RATES = {
  // Per-interaction tick (when something happens)
  interaction: {
    energy:     -0.005,
    hunger:      0,        // triggers handle hunger explicitly
    loneliness: -0.15,
    curiosity:  +0.02,
  },
  // Per-minute passive (when nothing happens)
  // Balanced: 16h silence (960 min) should reach ~0.5-0.6, not 1.0
  passive: {
    energy:     +0.002,
    hunger:     +0.0005,
    loneliness: +0.0006,
    curiosity:  -0.0005,
  },
  // Sleep recovery (per tick while sleeping)
  sleep: {
    energy:     +0.015,
    hunger:     +0.0003,
    loneliness: +0.0002,
    curiosity:   0,
  },
  // Thresholds for auto-transitions
  thresholds: {
    exhausted:  0.10,   // energy < this -> auto sleep
    starving:   0.85,   // hunger > this -> food_obsessed/grumble
    lonely:     0.75,   // loneliness > this -> puppy_eyes/separation_stress
    bored:      0.15,   // curiosity < this -> sneaky/grumble
    hyper:      0.90,   // energy > this + curiosity > 0.7 -> zoomies
  },
};


// ── CREPUSCULAR RHYTHM ────────────────────────────────────────────
// Corgis are most active at dawn and dusk.
// In internet reality: "dawn" = session start, "dusk" = session end.

const RHYTHM = {
  sessionStartBurst: 0.3,
  sessionEndDrain:   0.2,
  activityWindow:    30,    // ticks of activity before natural "dusk"
};


// ── HELPERS ───────────────────────────────────────────────────────

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

/**
 * Given a TRANSITIONS list and a set of unlocked states,
 * return only the states that are currently accessible.
 */
function filterLocked(candidates, unlocked) {
  if (!unlocked) return candidates;
  return candidates.filter(s => unlocked.has(s));
}

/**
 * Find the best fallback state from the unlocked set.
 * Prefers idle > content > nap > sploot (all level-0).
 */
function fallbackState(unlocked) {
  for (const s of ['idle', 'content', 'nap', 'sploot']) {
    if (!unlocked || unlocked.has(s)) return s;
  }
  return 'idle';
}


// ── EMOTION ENGINE ────────────────────────────────────────────────

class EmotionState {
  /**
   * @param {Set<string>|null} unlockedEmotions — set of state names this PES can access.
   *   If null, only basic_emotions (level 0) are available.
   */
  constructor(unlockedEmotions = null) {
    // Level gate
    this._unlocked = unlockedEmotions || buildUnlockedSet(0);

    // Current state
    this.state = 'idle';
    this.intensity = 0.5;
    this.stateStartedAt = Date.now();
    this.tickCount = 0;
    this.sessionTicks = 0;
    this.lastInteractionAt = Date.now();

    // Vitals
    this.mood = 0.5;
    this.energy = 0.8;
    this.hunger = 0.2;
    this.curiosity = 0.5;
    this.loneliness = 0.0;

    // Character traits — shaped heavily during critical period,
    // but NEVER truly frozen. Like White Fang: early experience matters most,
    // but patient, persistent love can reshape even the wildest nature.
    this.traits = {
      courage:      0.5,
      curiosity:    0.5,
      loyalty:      0.5,
      stubbornness: 0.5,
      playfulness:  0.5,
      drama:        0.5,
      foodDrive:    0.5,
      sassiness:    0.5,
    };
    this.criticalPeriodOver = false;
    this.traitChangeAttempts = {};

    // History
    this.stateHistory = [];
    this.listeners = [];
  }

  // ── Current snapshot ──

  get current() {
    return {
      state: this.state,
      intensity: this.intensity,
      category: STATES[this.state]?.category || 'unknown',
      mood: this.mood,
      energy: this.energy,
      hunger: this.hunger,
      curiosity: this.curiosity,
      loneliness: this.loneliness,
      tickCount: this.tickCount,
      sessionTicks: this.sessionTicks,
      duration: (Date.now() - this.stateStartedAt) / 1000,
      traits: { ...this.traits },
    };
  }

  // ── Level gate management ──

  /**
   * Returns the Set of currently unlocked state names.
   */
  getAvailableStates() {
    return new Set(this._unlocked);
  }

  /**
   * Replace the unlocked emotions set.
   * If the current state is not in the new set, transition to fallback.
   * @param {Set<string>} set
   */
  setUnlockedEmotions(set) {
    this._unlocked = set;
    if (!this._unlocked.has(this.state)) {
      const fb = fallbackState(this._unlocked);
      this.state = fb;
      this.intensity = 0.3;
      this.stateStartedAt = Date.now();
      this._emit('forced_fallback', { to: fb, reason: 'state_locked_after_update' });
    }
  }

  /**
   * Check if a specific state is unlocked.
   */
  isUnlocked(state) {
    return this._unlocked.has(state);
  }

  // ── State transitions ──

  /**
   * Attempt transition to a new emotional state.
   * Returns true if transition happened, false if rejected.
   */
  transitionTo(newState, intensity = null, reason = null) {
    if (!STATES[newState]) return false;

    // Level gate: state must be unlocked
    if (!this._unlocked.has(newState)) return false;

    // Check if transition is valid from current state
    const allowed = TRANSITIONS[this.state];
    if (!allowed || !allowed.includes(newState)) return false;

    // Rage gate: only 1% chance, only from bark
    if (newState === 'rage') {
      if (this.state !== 'bark' || Math.random() > 0.01) return false;
    }

    // Stubborn gate: modified by stubbornness trait
    if (newState === 'stubborn_refuse') {
      if (Math.random() > this.traits.stubbornness) return false;
    }

    // Dramatic tantrum gate: modified by drama trait
    if (newState === 'dramatic_tantrum') {
      if (Math.random() > this.traits.drama * 0.6) return false;
    }

    // Food obsession gate: modified by foodDrive trait
    if (newState === 'food_obsessed') {
      if (Math.random() > this.traits.foodDrive * 0.5) return false;
    }

    const prevState = this.state;
    const prevIntensity = this.intensity;

    this.state = newState;
    this.intensity = intensity !== null
      ? clamp(intensity, 0, 1)
      : this._randomIntensity(newState);
    this.stateStartedAt = Date.now();

    // Record history (keep last 200)
    this.stateHistory.push({
      from: prevState,
      to: newState,
      reason,
      intensity: this.intensity,
      timestamp: Date.now(),
      tickCount: this.tickCount,
    });
    if (this.stateHistory.length > 200) this.stateHistory.shift();

    this._emit('transition', {
      from: prevState,
      fromIntensity: prevIntensity,
      to: newState,
      toIntensity: this.intensity,
      reason,
    });

    return true;
  }

  // ── Tick system ──

  /**
   * Interaction tick — call when something happens
   * (message received, agent acted, command given, etc.)
   */
  interactionTick(eventType = 'generic') {
    this.tickCount++;
    this.sessionTicks++;
    this.lastInteractionAt = Date.now();

    const stateDef = STATES[this.state];
    if (!stateDef) return;

    // Decay intensity
    this.intensity -= stateDef.decay;

    // Apply state energy cost
    this.energy = clamp(this.energy - stateDef.energyCost, 0, 1);

    // Apply interaction vital changes
    const rates = this.state === 'sleep' || this.state === 'nap'
      ? VITAL_RATES.sleep
      : VITAL_RATES.interaction;

    this.energy     = clamp(this.energy     + rates.energy, 0, 1);
    this.hunger     = clamp(this.hunger     + rates.hunger, 0, 1);
    this.loneliness = clamp(this.loneliness + rates.loneliness, 0, 1);
    this.curiosity  = clamp(this.curiosity  + rates.curiosity, 0, 1);

    // Mood influenced by vitals
    this._updateMood();

    // Check auto-transitions from vitals
    this._checkVitalTransitions();

    // If intensity dropped to 0 -> natural transition
    if (this.intensity <= 0) {
      this.intensity = 0;
      if (this.state !== 'idle') {
        this.autoTransition();
      }
    }

    // Crepuscular rhythm: long session -> energy drain
    if (this.sessionTicks > RHYTHM.activityWindow) {
      this.energy = clamp(this.energy - 0.005, 0, 1);
    }

    this._emit('tick', { ...this.current, eventType });
  }

  /**
   * Passive tick — call periodically when nothing is happening.
   * @param {number} minutesPassed — how many minutes since last activity
   */
  passiveTick(minutesPassed = 1) {
    const stateDef = STATES[this.state];
    if (!stateDef) return;

    const rates = this.state === 'sleep' || this.state === 'nap'
      ? VITAL_RATES.sleep
      : VITAL_RATES.passive;

    // Diminishing returns on hunger/loneliness growth
    this.energy     = clamp(this.energy     + rates.energy * minutesPassed, 0, 1);
    this.hunger     = clamp(this.hunger     + rates.hunger * (1 - this.hunger) * minutesPassed, 0, 1);
    this.loneliness = clamp(this.loneliness + rates.loneliness * (1 - this.loneliness) * minutesPassed, 0, 1);
    this.curiosity  = clamp(this.curiosity  + rates.curiosity * minutesPassed, 0, 1);

    // Intensity decays over time (slower than interaction ticks)
    this.intensity = clamp(this.intensity - stateDef.decay * 0.3 * minutesPassed, 0, 1);

    this._updateMood();
    this._checkVitalTransitions();

    // Been quiet too long -> sleep or separation_stress
    if (minutesPassed > 30 && this.state !== 'sleep') {
      if (this.loneliness > VITAL_RATES.thresholds.lonely && this._unlocked.has('separation_stress')) {
        this.transitionTo('separation_stress', 0.6, 'abandoned');
      } else {
        this.transitionTo('nap', 0.5, 'quiet');
      }
    }

    if (this.intensity <= 0 && this.state !== 'idle') {
      this.autoTransition();
    }

    this._emit('passive_tick', { ...this.current, minutesPassed });
  }

  /**
   * Session start — call when owner/project becomes active.
   * "Dawn" in corgi crepuscular rhythm.
   */
  sessionStart() {
    this.sessionTicks = 0;
    this.energy = clamp(this.energy + RHYTHM.sessionStartBurst, 0, 1);
    this.loneliness = clamp(this.loneliness - 0.3, 0, 1);

    // Greeting frenzy if was lonely (and state is unlocked)
    if ((this.loneliness > 0.3 || this.state === 'separation_stress') && this._unlocked.has('greeting_frenzy')) {
      const prevState = this.state;
      this.state = 'greeting_frenzy';
      this.intensity = clamp(0.5 + this.loneliness * 0.5, 0.3, 1.0);
      this.stateStartedAt = Date.now();
      this._emit('transition', {
        from: prevState,
        to: 'greeting_frenzy',
        reason: 'owner_returned',
      });
    }

    this._emit('session_start', this.current);
  }

  // ── Vitals adjustment (external events) ──

  adjustMood(delta)       { this.mood       = clamp(this.mood + delta, 0, 1); }
  adjustEnergy(delta)     { this.energy     = clamp(this.energy + delta, 0, 1); }
  adjustHunger(delta)     { this.hunger     = clamp(this.hunger + delta, 0, 1); }
  adjustCuriosity(delta)  { this.curiosity  = clamp(this.curiosity + delta, 0, 1); }
  reduceLoneliness(amount = 0.3) { this.loneliness = clamp(this.loneliness - amount, 0, 1); }

  /**
   * "Feed" the PES — give it a task/data to process.
   * Reduces hunger, boosts mood and curiosity.
   */
  feed(quality = 0.5) {
    this.hunger    = clamp(this.hunger - quality * 0.4, 0, 1);
    this.mood      = clamp(this.mood + quality * 0.1, 0, 1);
    this.curiosity = clamp(this.curiosity + quality * 0.15, 0, 1);
    if (this.state === 'food_obsessed') {
      this.transitionTo('content', 0.7, 'fed');
    }
  }

  // ── Auto-transition ──

  /**
   * Pick next state based on vitals, traits, and unlocked states.
   * Called when intensity decays to 0 or explicitly by the engine.
   */
  autoTransition() {
    const rawCandidates = TRANSITIONS[this.state] || ['idle'];
    const candidates = filterLocked(rawCandidates, this._unlocked);

    if (candidates.length === 0) {
      // No valid transitions available — fall back
      const fb = fallbackState(this._unlocked);
      this.state = fb;
      this.intensity = 0.3;
      this.stateStartedAt = Date.now();
      return;
    }

    // Weight candidates by current vitals and traits
    const scored = candidates.map(s => ({
      state: s,
      score: this._scoreCandidateState(s),
    }));

    scored.sort((a, b) => b.score - a.score);

    // Try top 3 candidates
    for (let i = 0; i < Math.min(3, scored.length); i++) {
      if (this.transitionTo(scored[i].state, null, 'natural_decay')) {
        return;
      }
    }

    // Fallback to idle
    const fb = fallbackState(this._unlocked);
    this.state = fb;
    this.intensity = 0.3;
    this.stateStartedAt = Date.now();
  }

  // ── Traits (character) ──
  // White Fang mechanics: early life shapes deeply,
  // but persistent love can reshape ANY trait over time.

  /**
   * Set a trait value directly. Only during critical period.
   */
  setTrait(name, value) {
    if (this.criticalPeriodOver) return false;
    if (!(name in this.traits)) return false;
    this.traits[name] = clamp(value, 0, 1);
    return true;
  }

  /**
   * Nudge a trait — small adjustment from interaction.
   *
   * During critical period: full effect, easy to shape.
   * After critical period: MUCH harder, but NOT impossible.
   *
   * Like White Fang being tamed by Weedon Scott:
   * - First 100 tries: almost no visible change (resistance)
   * - 100-300 tries: tiny cracks appear (0.03x effect)
   * - 300-500 tries: slow but visible progress (0.08x effect)
   * - 500+ tries with consistent streak: real change (0.15x effect)
   */
  nudgeTrait(name, delta, trigger = null) {
    if (!(name in this.traits)) return false;

    // During critical period — full effect
    if (!this.criticalPeriodOver) {
      const oldValue = this.traits[name];
      this.traits[name] = clamp(this.traits[name] + delta, 0, 1);
      this._emit('trait_changed', { trait: name, oldValue, value: this.traits[name], delta, phase: 'critical_period', trigger });
      return true;
    }

    // After critical period — White Fang mechanics
    if (!this.traitChangeAttempts[name]) {
      this.traitChangeAttempts[name] = { tries: 0, streak: 0, lastDirection: 0 };
    }
    const tracker = this.traitChangeAttempts[name];
    const direction = delta > 0 ? 1 : -1;

    // Streak: consecutive nudges in the same direction
    if (direction === tracker.lastDirection) {
      tracker.streak++;
    } else {
      // Changed direction — streak breaks, but some memory remains
      tracker.streak = Math.max(0, Math.floor(tracker.streak * 0.3));
      tracker.lastDirection = direction;
    }
    tracker.tries++;

    // Calculate multiplier based on persistence
    let multiplier;
    if (tracker.tries < 100) {
      multiplier = 0.01;
    } else if (tracker.tries < 300) {
      multiplier = 0.03;
    } else if (tracker.tries < 500) {
      multiplier = 0.08;
    } else {
      multiplier = 0.15;
    }

    // Streak bonus
    const streakBonus = Math.min(tracker.streak * 0.001, 0.05);
    multiplier += streakBonus;

    const actualDelta = delta * multiplier;
    const oldValue = this.traits[name];
    this.traits[name] = clamp(this.traits[name] + actualDelta, 0, 1);

    this._emit('trait_changed', {
      trait: name,
      oldValue,
      value: this.traits[name],
      delta: actualDelta,
      requestedDelta: delta,
      multiplier,
      tries: tracker.tries,
      streak: tracker.streak,
      phase: 'post_critical',
      trigger,
    });

    return true;
  }

  /**
   * End critical period. After this, traits resist change
   * but persistent love can still reshape them.
   */
  endCriticalPeriod() {
    this.criticalPeriodOver = true;
    this._emit('critical_period_ended', {
      traits: { ...this.traits },
      message: 'Traits are now resistant to change, but persistent love can still reshape them.',
    });
  }

  /**
   * Get progress on changing a trait after critical period.
   */
  getTraitChangeProgress(name) {
    if (!this.traitChangeAttempts[name]) {
      return { tries: 0, streak: 0, phase: 'no_attempts', multiplier: 0.01 };
    }
    const t = this.traitChangeAttempts[name];
    let phase;
    if (t.tries < 100) phase = 'resistance';
    else if (t.tries < 300) phase = 'cracking';
    else if (t.tries < 500) phase = 'learning';
    else phase = 'transformed';
    return { tries: t.tries, streak: t.streak, phase, lastDirection: t.lastDirection };
  }

  // ── Events ──

  on(event, fn) {
    const listener = { event, fn };
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  // ── Serialize / Deserialize ──

  /**
   * Serialize the full PES emotional state for persistence.
   */
  serialize() {
    return {
      state: this.state,
      intensity: this.intensity,
      stateStartedAt: this.stateStartedAt,
      tickCount: this.tickCount,
      sessionTicks: this.sessionTicks,
      lastInteractionAt: this.lastInteractionAt,
      mood: this.mood,
      energy: this.energy,
      hunger: this.hunger,
      curiosity: this.curiosity,
      loneliness: this.loneliness,
      traits: { ...this.traits },
      criticalPeriodOver: this.criticalPeriodOver,
      traitChangeAttempts: JSON.parse(JSON.stringify(this.traitChangeAttempts)),
      stateHistory: this.stateHistory.slice(-50),
      unlockedStates: [...this._unlocked],
    };
  }

  /**
   * Restore PES from serialized data.
   * @param {object} data — output of serialize()
   * @param {Set<string>|null} unlockedEmotions — override unlocked set (if null, uses data.unlockedStates or basic)
   */
  static deserialize(data, unlockedEmotions = null) {
    // Determine unlocked set: explicit param > saved data > basic
    let unlocked;
    if (unlockedEmotions) {
      unlocked = unlockedEmotions;
    } else if (data.unlockedStates && Array.isArray(data.unlockedStates)) {
      unlocked = new Set(data.unlockedStates);
    } else {
      unlocked = buildUnlockedSet(0);
    }

    const emo = new EmotionState(unlocked);

    emo.state              = data.state && STATES[data.state] ? data.state : 'idle';
    emo.intensity          = data.intensity ?? 0.5;
    emo.stateStartedAt     = data.stateStartedAt || Date.now();
    emo.tickCount          = data.tickCount || 0;
    emo.sessionTicks       = data.sessionTicks || 0;
    emo.lastInteractionAt  = data.lastInteractionAt || Date.now();
    emo.mood               = data.mood ?? 0.5;
    emo.energy             = data.energy ?? 0.8;
    emo.hunger             = data.hunger ?? 0.2;
    emo.curiosity          = data.curiosity ?? 0.5;
    emo.loneliness         = data.loneliness ?? 0.0;
    if (data.traits)                emo.traits = { ...emo.traits, ...data.traits };
    emo.criticalPeriodOver          = data.criticalPeriodOver || false;
    emo.traitChangeAttempts         = data.traitChangeAttempts || {};
    emo.stateHistory                = data.stateHistory || [];

    // If restored state is locked, fall back
    if (!emo._unlocked.has(emo.state)) {
      emo.state = fallbackState(emo._unlocked);
      emo.intensity = 0.3;
    }

    return emo;
  }

  // ── Private ──

  _updateMood() {
    const vitalPressure =
      - this.hunger * 0.02
      - this.loneliness * 0.03
      + (this.energy > 0.5 ? 0.005 : -0.005)
      + (this.curiosity > 0.5 ? 0.005 : 0);

    this.mood = clamp(this.mood + vitalPressure * 0.1, 0, 1);
  }

  _checkVitalTransitions() {
    const t = VITAL_RATES.thresholds;

    // Exhausted -> sleep/nap
    if (this.energy < t.exhausted && this.state !== 'sleep' && this.state !== 'nap') {
      // Try sleep (level 10), then nap (level 0), then corgi_flop (level 10)
      if (this._unlocked.has('sleep') && this.transitionTo('sleep', 0.8, 'exhausted')) return;
      if (this.transitionTo('nap', 0.6, 'exhausted')) return;
      if (this._unlocked.has('corgi_flop') && this.transitionTo('corgi_flop', 0.9, 'exhausted')) return;
      return;
    }

    // Starving -> food obsession or grumble
    if (this.hunger > t.starving && this.state !== 'food_obsessed' && this.state !== 'sleep') {
      if (this._unlocked.has('food_obsessed') && this.transitionTo('food_obsessed', 0.7, 'starving')) return;
      if (this._unlocked.has('grumble') && this.transitionTo('grumble', 0.5, 'hungry')) return;
      return;
    }

    // Lonely -> puppy eyes or separation stress
    if (this.loneliness > t.lonely && !['puppy_eyes', 'separation_stress', 'sleep'].includes(this.state)) {
      if (this._unlocked.has('puppy_eyes') && this.transitionTo('puppy_eyes', 0.6, 'lonely')) return;
      if (this._unlocked.has('separation_stress') && this.transitionTo('separation_stress', 0.5, 'lonely')) return;
      return;
    }

    // Bored -> sneaky or grumble
    if (this.curiosity < t.bored && ['idle', 'content'].includes(this.state)) {
      if (this._unlocked.has('sneaky') && this.transitionTo('sneaky', 0.4, 'bored')) return;
      if (this._unlocked.has('grumble') && this.transitionTo('grumble', 0.3, 'bored')) return;
      return;
    }

    // Hyper -> zoomies
    if (this.energy > t.hyper && this.curiosity > 0.7 && ['playful', 'happy', 'idle'].includes(this.state)) {
      if (this._unlocked.has('zoomies') && this.transitionTo('zoomies', 0.9, 'hyper')) return;
      return;
    }
  }

  _scoreCandidateState(state) {
    let score = STATES[state]?.weight || 0.1;

    // Trait influence
    if (['playful', 'zoomies', 'play_bow', 'wanna_play'].includes(state)) {
      score += this.traits.playfulness * 0.3;
    }
    if (['grumble', 'side_eye'].includes(state)) {
      score += this.traits.sassiness * 0.2;
    }
    if (['dramatic_tantrum', 'sulking'].includes(state)) {
      score += this.traits.drama * 0.2;
    }
    if (['stubborn_refuse'].includes(state)) {
      score += this.traits.stubbornness * 0.3;
    }
    if (['food_obsessed'].includes(state)) {
      score += this.traits.foodDrive * 0.2;
    }
    if (['herding', 'bossy'].includes(state)) {
      score += 0.15;
    }
    if (['alert', 'puzzle_solving'].includes(state)) {
      score += this.curiosity * 0.2;
    }
    if (['scared', 'anxious'].includes(state)) {
      score -= this.traits.courage * 0.3;
    }

    // Mood influence
    if (['happy', 'content', 'playful'].includes(state)) {
      score += this.mood * 0.15;
    }
    if (['grumble', 'sulking', 'dramatic_tantrum'].includes(state)) {
      score += (1 - this.mood) * 0.15;
    }

    // Energy influence
    if (['sleep', 'nap', 'sploot', 'corgi_flop'].includes(state)) {
      score += (1 - this.energy) * 0.3;
    }
    if (['zoomies', 'playful', 'herding'].includes(state)) {
      score += this.energy * 0.2;
    }

    // Small random factor for unpredictability
    score += Math.random() * 0.1;

    return score;
  }

  _randomIntensity(state) {
    const base = STATES[state]?.weight || 0.3;
    return clamp(
      base + (Math.random() * 0.4 - 0.2) + (this.mood - 0.5) * 0.2,
      0.1, 1.0
    );
  }

  _emit(event, data) {
    for (const listener of this.listeners) {
      if (listener.event === event) {
        try { listener.fn(data); } catch (e) { console.error('[EMO] listener error:', e.message); }
      }
    }
  }
}


export { EmotionState, STATES, EMOTION_LEVELS, TRANSITIONS, VITAL_RATES, RHYTHM, buildUnlockedSet };
