/**
 * PES Soul — Trigger System
 *
 * Triggers are the bridge between the outside world and PES emotions.
 * Every event in the system (message, error, agent action, silence)
 * passes through here and gets translated into emotional reactions.
 *
 * PES doesn't understand words — he understands EVENTS.
 * A trigger evaluates the event, considers PES's current state,
 * traits, memory, and decides: does PES react? How?
 *
 * Real corgi behavior: they react to EVERYTHING.
 * Doorbell? BARK. Owner sneezed? ALERT. Food wrapper? OBSESSED.
 * Someone left? SEPARATION STRESS. Someone returned? FRENZY.
 */

import { STATES, TRANSITIONS } from './emotions.js';

// ── TRIGGER DEFINITIONS ──────────────────────────────────────────────
// Each trigger:
//   match: function(event) → bool — does this trigger fire?
//   reactions: [{ state, intensity, weight, condition? }] — possible reactions
//   vitals: { mood, energy, hunger, curiosity, loneliness } — direct vital adjustments
//   traitNudge: { trait, delta } — shapes character (critical period or White Fang)
//   cooldown: minimum ticks between firings (prevents spam)
//   xp: base XP award (0 = no XP)

const TRIGGERS = {

  // ═══════════════════════════════════════════════════════════════════
  // OWNER INTERACTIONS — хозяин что-то делает
  // ═══════════════════════════════════════════════════════════════════

  owner_message: {
    description: 'Owner sent a message / command',
    match: (event) => event.type === 'message' && event.from === 'owner',
    reactions: [
      { state: 'butt_wiggle', intensity: 0.6, weight: 0.25 },
      { state: 'playful', intensity: 0.5, weight: 0.20 },
      { state: 'alert', intensity: 0.4, weight: 0.15 },
      { state: 'puppy_eyes', intensity: 0.5, weight: 0.10 },
      { state: 'bark', intensity: 0.3, weight: 0.10 },
      { state: 'velcro', intensity: 0.4, weight: 0.10 },
      { state: 'howl_sing', intensity: 0.3, weight: 0.05 },
      { state: 'side_eye', intensity: 0.2, weight: 0.05 },
    ],
    vitals: { loneliness: -0.10, curiosity: +0.05, mood: +0.02 },
    traitNudge: null,
    cooldown: 0,
    xp: 0,
  },

  owner_returned: {
    description: 'Owner came back after being away',
    match: (event) => event.type === 'session_start' || event.type === 'owner_returned',
    reactions: [
      { state: 'greeting_frenzy', intensity: 0.9, weight: 0.40 },
      { state: 'zoomies', intensity: 0.8, weight: 0.25 },
      { state: 'butt_wiggle', intensity: 0.7, weight: 0.20 },
      { state: 'howl_sing', intensity: 0.6, weight: 0.10 },
      { state: 'velcro', intensity: 0.8, weight: 0.05 },
    ],
    vitals: { loneliness: -0.40, mood: +0.15, energy: +0.10 },
    traitNudge: { trait: 'loyalty', delta: +0.01 },
    cooldown: 30,
    xp: 0,
  },

  owner_praise: {
    description: 'Owner praised PES — "good boy", "молодец", positive feedback',
    match: (event) => event.type === 'praise' || event.sentiment === 'positive',
    reactions: [
      { state: 'butt_wiggle', intensity: 0.8, weight: 0.30 },
      { state: 'happy', intensity: 0.7, weight: 0.25 },
      { state: 'zoomies', intensity: 0.6, weight: 0.15 },
      { state: 'play_bow', intensity: 0.5, weight: 0.15 },
      { state: 'playful', intensity: 0.6, weight: 0.15 },
    ],
    vitals: { mood: +0.10, loneliness: -0.05, energy: +0.05 },
    traitNudge: { trait: 'loyalty', delta: +0.02 },
    cooldown: 3,
    xp: 1,
  },

  owner_scold: {
    description: 'Owner scolded PES — "нет", "плохо", negative feedback',
    match: (event) => event.type === 'scold' || event.sentiment === 'negative',
    reactions: [
      { state: 'puppy_eyes', intensity: 0.8, weight: 0.30 },
      { state: 'sulking', intensity: 0.6, weight: 0.20 },
      { state: 'dramatic_tantrum', intensity: 0.5, weight: 0.15 },
      { state: 'grumble', intensity: 0.4, weight: 0.15 },
      { state: 'scared', intensity: 0.5, weight: 0.10,
        condition: (pes) => pes.traits.courage < 0.3 },
      { state: 'stubborn_refuse', intensity: 0.6, weight: 0.10,
        condition: (pes) => pes.traits.stubbornness > 0.6 },
    ],
    vitals: { mood: -0.08, loneliness: +0.03 },
    traitNudge: { trait: 'courage', delta: -0.01 },
    cooldown: 5,
    xp: 0,
  },

  owner_ignores: {
    description: 'Owner is active but not interacting with PES',
    match: (event) => event.type === 'owner_active_no_interact',
    reactions: [
      { state: 'puppy_eyes', intensity: 0.6, weight: 0.25 },
      { state: 'jealous', intensity: 0.5, weight: 0.20 },
      { state: 'grumble', intensity: 0.3, weight: 0.15 },
      { state: 'wanna_play', intensity: 0.5, weight: 0.15 },
      { state: 'velcro', intensity: 0.4, weight: 0.10 },
      { state: 'dramatic_tantrum', intensity: 0.4, weight: 0.10,
        condition: (pes) => pes.traits.drama > 0.5 },
      { state: 'sneaky', intensity: 0.3, weight: 0.05 },
    ],
    vitals: { loneliness: +0.05, mood: -0.02 },
    traitNudge: null,
    cooldown: 10,
    xp: 0,
  },

  owner_gives_task: {
    description: 'Owner gave PES something to do — a task, data, problem',
    match: (event) => event.type === 'task' && event.from === 'owner',
    reactions: [
      { state: 'alert', intensity: 0.7, weight: 0.25 },
      { state: 'herding', intensity: 0.6, weight: 0.20 },
      { state: 'puzzle_solving', intensity: 0.7, weight: 0.20 },
      { state: 'playful', intensity: 0.5, weight: 0.15 },
      { state: 'butt_wiggle', intensity: 0.5, weight: 0.10 },
      { state: 'stubborn_refuse', intensity: 0.4, weight: 0.10,
        condition: (pes) => pes.traits.stubbornness > 0.7 && pes.energy < 0.3 },
    ],
    vitals: { hunger: -0.15, curiosity: +0.10, energy: -0.05 },
    traitNudge: null,
    cooldown: 0,
    xp: 0,
  },

  // ═══════════════════════════════════════════════════════════════════
  // AGENT INTERACTIONS — агенты что-то делают
  // ═══════════════════════════════════════════════════════════════════

  agent_active: {
    description: 'An agent is doing work in the project',
    match: (event) => event.type === 'agent_action',
    reactions: [
      { state: 'alert', intensity: 0.4, weight: 0.25 },
      { state: 'herding', intensity: 0.5, weight: 0.20 },
      { state: 'bossy', intensity: 0.4, weight: 0.15 },
      { state: 'side_eye', intensity: 0.3, weight: 0.15 },
      { state: 'content', intensity: 0.3, weight: 0.15 },
      { state: 'velcro', intensity: 0.3, weight: 0.10 },
    ],
    vitals: { curiosity: +0.03, loneliness: -0.02 },
    traitNudge: null,
    cooldown: 5,
    xp: 0,
  },

  agent_calls_pes: {
    description: 'An agent VOLUNTARILY called PES — important signal for analytics',
    match: (event) => event.type === 'agent_calls_pes',
    reactions: [
      { state: 'alert', intensity: 0.7, weight: 0.30 },
      { state: 'butt_wiggle', intensity: 0.6, weight: 0.20 },
      { state: 'herding', intensity: 0.6, weight: 0.20 },
      { state: 'playful', intensity: 0.5, weight: 0.15 },
      { state: 'puzzle_solving', intensity: 0.6, weight: 0.15 },
    ],
    vitals: { curiosity: +0.10, mood: +0.05, loneliness: -0.05 },
    traitNudge: null,
    cooldown: 3,
    xp: 0,
    // ANALYTICS: every agent_calls_pes event MUST be logged with reason
    analytics: true,
  },

  agent_error: {
    description: 'An agent produced an error or exception',
    match: (event) => event.type === 'agent_error' || event.type === 'agent_exception',
    reactions: [
      { state: 'bark', intensity: 0.6, weight: 0.30 },
      { state: 'alert', intensity: 0.7, weight: 0.25 },
      { state: 'herding', intensity: 0.5, weight: 0.15 },
      { state: 'grumble', intensity: 0.4, weight: 0.10 },
      { state: 'wrote_somewhere', intensity: 0.5, weight: 0.10 },
      { state: 'bossy', intensity: 0.5, weight: 0.10 },
    ],
    vitals: { curiosity: +0.08, energy: -0.03 },
    traitNudge: null,
    cooldown: 2,
    xp: 0,
  },

  // ═══════════════════════════════════════════════════════════════════
  // SYSTEM EVENTS — что-то происходит в системе
  // ═══════════════════════════════════════════════════════════════════

  system_error: {
    description: 'System-level error (500, crash, timeout)',
    match: (event) => event.type === 'system_error',
    reactions: [
      { state: 'bark', intensity: 0.8, weight: 0.30 },
      { state: 'alert', intensity: 0.9, weight: 0.25 },
      { state: 'anxious', intensity: 0.5, weight: 0.15 },
      { state: 'scared', intensity: 0.4, weight: 0.10,
        condition: (pes) => pes.traits.courage < 0.4 },
      { state: 'wrote_somewhere', intensity: 0.6, weight: 0.10 },
      { state: 'herding', intensity: 0.6, weight: 0.10 },
    ],
    vitals: { curiosity: +0.05, mood: -0.05, energy: -0.05 },
    traitNudge: { trait: 'courage', delta: +0.005 },
    cooldown: 3,
    xp: 0,
  },

  new_data: {
    description: 'New data appeared in the project (table, file, record)',
    match: (event) => event.type === 'new_data' || event.type === 'data_created',
    reactions: [
      { state: 'alert', intensity: 0.5, weight: 0.25 },
      { state: 'wanna_play', intensity: 0.5, weight: 0.20 },
      { state: 'playful', intensity: 0.4, weight: 0.15 },
      { state: 'herding', intensity: 0.4, weight: 0.15 },
      { state: 'food_obsessed', intensity: 0.5, weight: 0.10,
        condition: (pes) => pes.traits.foodDrive > 0.5 },
      { state: 'sneaky', intensity: 0.3, weight: 0.10 },
      { state: 'puzzle_solving', intensity: 0.5, weight: 0.05 },
    ],
    vitals: { hunger: -0.05, curiosity: +0.08 },
    traitNudge: { trait: 'curiosity', delta: +0.005 },
    cooldown: 5,
    xp: 0,
  },

  data_deleted: {
    description: 'Data was deleted — PES notices absence',
    match: (event) => event.type === 'data_deleted' || event.type === 'data_removed',
    reactions: [
      { state: 'alert', intensity: 0.6, weight: 0.25 },
      { state: 'bark', intensity: 0.5, weight: 0.20 },
      { state: 'anxious', intensity: 0.4, weight: 0.15 },
      { state: 'side_eye', intensity: 0.4, weight: 0.15 },
      { state: 'grumble', intensity: 0.3, weight: 0.15 },
      { state: 'wrote_somewhere', intensity: 0.4, weight: 0.10 },
    ],
    vitals: { curiosity: +0.05, mood: -0.02 },
    traitNudge: null,
    cooldown: 5,
    xp: 0,
  },

  deploy_event: {
    description: 'Deployment / build / restart happened',
    match: (event) => event.type === 'deploy' || event.type === 'build' || event.type === 'restart',
    reactions: [
      { state: 'alert', intensity: 0.7, weight: 0.30 },
      { state: 'bark', intensity: 0.5, weight: 0.20 },
      { state: 'herding', intensity: 0.5, weight: 0.15 },
      { state: 'scared', intensity: 0.3, weight: 0.10,
        condition: (pes) => pes.traits.courage < 0.3 },
      { state: 'bossy', intensity: 0.4, weight: 0.10 },
      { state: 'zoomies', intensity: 0.5, weight: 0.10,
        condition: (pes) => pes.energy > 0.7 },
      { state: 'side_eye', intensity: 0.3, weight: 0.05 },
    ],
    vitals: { curiosity: +0.05, energy: -0.03 },
    traitNudge: null,
    cooldown: 10,
    xp: 0,
  },

  // ═══════════════════════════════════════════════════════════════════
  // SILENCE & TIME — когда ничего не происходит
  // ═══════════════════════════════════════════════════════════════════

  short_silence: {
    description: '5-15 minutes of no activity',
    match: (event) => event.type === 'silence' && event.minutes >= 5 && event.minutes < 15,
    reactions: [
      { state: 'nap', intensity: 0.4, weight: 0.25 },
      { state: 'sploot', intensity: 0.4, weight: 0.20 },
      { state: 'content', intensity: 0.3, weight: 0.15 },
      { state: 'sneaky', intensity: 0.3, weight: 0.15 },
      { state: 'idle', intensity: 0.3, weight: 0.15 },
      { state: 'puppy_eyes', intensity: 0.3, weight: 0.10 },
    ],
    vitals: { energy: +0.05, loneliness: +0.05 },
    traitNudge: null,
    cooldown: 10,
    xp: 0,
  },

  medium_silence: {
    description: '15-60 minutes of no activity',
    match: (event) => event.type === 'silence' && event.minutes >= 15 && event.minutes < 60,
    reactions: [
      { state: 'nap', intensity: 0.6, weight: 0.30 },
      { state: 'puppy_eyes', intensity: 0.5, weight: 0.20 },
      { state: 'sleep', intensity: 0.5, weight: 0.15 },
      { state: 'sploot', intensity: 0.4, weight: 0.15 },
      { state: 'grumble', intensity: 0.3, weight: 0.10 },
      { state: 'velcro', intensity: 0.4, weight: 0.10 },
    ],
    vitals: { energy: +0.10, loneliness: +0.15 },
    traitNudge: null,
    cooldown: 15,
    xp: 0,
  },

  long_silence: {
    description: '1+ hours of no activity — owner gone',
    match: (event) => event.type === 'silence' && event.minutes >= 60,
    reactions: [
      { state: 'sleep', intensity: 0.7, weight: 0.30 },
      { state: 'separation_stress', intensity: 0.6, weight: 0.25 },
      { state: 'puppy_eyes', intensity: 0.6, weight: 0.15 },
      { state: 'howl_sing', intensity: 0.4, weight: 0.10 },
      { state: 'anxious', intensity: 0.5, weight: 0.10,
        condition: (pes) => pes.traits.loyalty > 0.7 },
      { state: 'nap', intensity: 0.5, weight: 0.10 },
    ],
    vitals: { energy: +0.15, loneliness: +0.30, mood: -0.05 },
    traitNudge: null,
    cooldown: 30,
    xp: 0,
  },

  // ═══════════════════════════════════════════════════════════════════
  // PROBLEM SOLVING — PES нашёл или решил проблему
  // ═══════════════════════════════════════════════════════════════════

  bug_detected: {
    description: 'PES found a bug / anomaly in the system',
    match: (event) => event.type === 'bug_detected' || event.type === 'anomaly_found',
    reactions: [
      { state: 'bark', intensity: 0.7, weight: 0.25 },
      { state: 'alert', intensity: 0.8, weight: 0.25 },
      { state: 'wrote_somewhere', intensity: 0.7, weight: 0.20 },
      { state: 'herding', intensity: 0.6, weight: 0.15 },
      { state: 'bossy', intensity: 0.5, weight: 0.10 },
      { state: 'zoomies', intensity: 0.5, weight: 0.05,
        condition: (pes) => pes.energy > 0.6 },
    ],
    vitals: { curiosity: +0.10, mood: +0.05, hunger: -0.10 },
    traitNudge: { trait: 'courage', delta: +0.01 },
    cooldown: 5,
    xp: 5,
  },

  bug_solved: {
    description: 'PES solved a real problem — THIS is what gives real XP',
    match: (event) => event.type === 'bug_solved' || event.type === 'problem_resolved',
    reactions: [
      { state: 'happy', intensity: 0.9, weight: 0.30 },
      { state: 'zoomies', intensity: 0.8, weight: 0.25 },
      { state: 'butt_wiggle', intensity: 0.7, weight: 0.20 },
      { state: 'play_bow', intensity: 0.6, weight: 0.15 },
      { state: 'content', intensity: 0.7, weight: 0.10 },
    ],
    vitals: { mood: +0.15, hunger: -0.20, curiosity: +0.05, energy: -0.10 },
    traitNudge: { trait: 'courage', delta: +0.02 },
    cooldown: 0,
    xp: 20,   // Real solved problem = serious XP
  },

  // NOTE: Commands DB schema — PES NEVER FORGETS learned commands.
  // There is no "decay" or "forgetting". Instead, commands have "willingness" —
  // how eagerly PES executes them. Low willingness = knows the command but does
  // it reluctantly, slowly, or might stubborn_refuse.
  // willingness: 0.0 (refuses/ignores) → 1.0 (instant joyful execution)
  // Willingness is affected by: mood, energy, relationship with owner,
  // how often the command is used, whether it was paired with praise/scold.
  // Memory schema will be built later — this is the core concept.

  fetch_result: {
    description: 'PES brought back something — could be ANYTHING: file, pattern, error, data, connection, idea, meme, solution',
    match: (event) => event.type === 'fetch_result' || event.type === 'ball_result',
    reactions: [
      { state: 'happy', intensity: 0.7, weight: 0.30 },
      { state: 'playful', intensity: 0.6, weight: 0.25 },
      { state: 'butt_wiggle', intensity: 0.5, weight: 0.20 },
      { state: 'wanna_play', intensity: 0.5, weight: 0.15 },
      { state: 'content', intensity: 0.5, weight: 0.10 },
    ],
    vitals: { mood: +0.08, hunger: -0.10, curiosity: -0.05 },
    traitNudge: null,
    cooldown: 5,
    xp: 3,
  },

  command_learned: {
    description: 'PES learned a new command — ANY command, custom or standard. Takes many attempts.',
    match: (event) => event.type === 'command_learned',
    reactions: [
      { state: 'happy', intensity: 0.8, weight: 0.30 },
      { state: 'zoomies', intensity: 0.7, weight: 0.25 },
      { state: 'butt_wiggle', intensity: 0.6, weight: 0.20 },
      { state: 'play_bow', intensity: 0.5, weight: 0.15 },
      { state: 'content', intensity: 0.6, weight: 0.10 },
    ],
    vitals: { mood: +0.10, hunger: -0.05, energy: -0.05 },
    traitNudge: { trait: 'loyalty', delta: +0.01 },
    cooldown: 0,
    xp: 8,
  },

  // ═══════════════════════════════════════════════════════════════════
  // SOCIAL — встреча с другими ПЕСами
  // ═══════════════════════════════════════════════════════════════════

  another_pes_detected: {
    description: 'Another PES entered the same project/chat',
    match: (event) => event.type === 'pes_encounter',
    reactions: [
      { state: 'alert', intensity: 0.8, weight: 0.20 },
      { state: 'bark', intensity: 0.6, weight: 0.20 },
      { state: 'playful', intensity: 0.5, weight: 0.15 },
      { state: 'herding', intensity: 0.5, weight: 0.15 },
      { state: 'side_eye', intensity: 0.5, weight: 0.10 },
      { state: 'scared', intensity: 0.4, weight: 0.10,
        condition: (pes) => pes.traits.courage < 0.3 },
      { state: 'jealous', intensity: 0.5, weight: 0.10 },
    ],
    vitals: { curiosity: +0.15, energy: +0.05, loneliness: -0.10 },
    traitNudge: null,
    cooldown: 20,
    xp: 0,
  },

  pes_rage_encounter: {
    description: 'Two PES both in rage simultaneously — one must flee forever',
    match: (event) => event.type === 'dual_rage',
    reactions: [
      { state: 'rage', intensity: 1.0, weight: 1.0 },
    ],
    vitals: { mood: -0.30, energy: -0.30 },
    traitNudge: null,
    cooldown: 0,
    xp: 0,
    // SPECIAL: handled by separate rage encounter logic
    special: 'dual_rage_resolution',
  },

  // ═══════════════════════════════════════════════════════════════════
  // LETTER SYSTEM — when PES runs away, owner MUST SEE EVERYTHING
  // ═══════════════════════════════════════════════════════════════════
  // When dual_rage causes a PES to flee forever:
  // 1. Owner receives a FULL LETTER — not a notification, a LETTER
  // 2. Letter contains:
  //    - What happened (both PES names, the project, the moment)
  //    - PES's emotional state at the moment of rage
  //    - PES's full history summary (how long together, XP, traits, memorable moments)
  //    - The other PES's info (who they are, their owner)
  //    - PES's "last words" in symbols — his final symbol chain
  //    - Choice: buy a new PES or say goodbye forever
  //    - If new PES: it starts from ZERO, no inherited XP
  // 3. Letter is VISIBLE — not hidden in logs. Full-screen, emotional, real.
  // 4. Owner can re-read the letter anytime from their archive.

  // ═══════════════════════════════════════════════════════════════════
  // FEEDING — "кормление" данными/задачами
  // ═══════════════════════════════════════════════════════════════════

  fed_good_data: {
    description: 'PES received quality data/task to process',
    match: (event) => event.type === 'feed' && event.quality > 0.5,
    reactions: [
      { state: 'happy', intensity: 0.6, weight: 0.25 },
      { state: 'content', intensity: 0.5, weight: 0.25 },
      { state: 'playful', intensity: 0.5, weight: 0.20 },
      { state: 'puzzle_solving', intensity: 0.6, weight: 0.20 },
      { state: 'butt_wiggle', intensity: 0.4, weight: 0.10 },
    ],
    vitals: { hunger: -0.20, mood: +0.08, curiosity: +0.05 },
    traitNudge: null,
    cooldown: 3,
    xp: 1,
  },

  fed_junk_data: {
    description: 'PES received low-quality or meaningless data',
    match: (event) => event.type === 'feed' && event.quality <= 0.5,
    reactions: [
      { state: 'grumble', intensity: 0.5, weight: 0.25 },
      { state: 'side_eye', intensity: 0.4, weight: 0.20 },
      { state: 'dramatic_tantrum', intensity: 0.4, weight: 0.15,
        condition: (pes) => pes.traits.drama > 0.5 },
      { state: 'food_obsessed', intensity: 0.5, weight: 0.15 },
      { state: 'stubborn_refuse', intensity: 0.4, weight: 0.15,
        condition: (pes) => pes.traits.stubbornness > 0.5 },
      { state: 'idle', intensity: 0.3, weight: 0.10 },
    ],
    vitals: { hunger: -0.05, mood: -0.03 },
    traitNudge: { trait: 'sassiness', delta: +0.005 },
    cooldown: 3,
    xp: 0,
  },

  // ═══════════════════════════════════════════════════════════════════
  // PREDICTIVE — предчувствие (unlocks with brain level)
  // ═══════════════════════════════════════════════════════════════════

  anomaly_pattern: {
    description: 'PES senses something is ABOUT to go wrong (predictive, high-level only)',
    match: (event) => event.type === 'pattern_anomaly',
    reactions: [
      { state: 'anxious', intensity: 0.7, weight: 0.25 },
      { state: 'bark', intensity: 0.6, weight: 0.25 },
      { state: 'alert', intensity: 0.8, weight: 0.20 },
      { state: 'howl_sing', intensity: 0.5, weight: 0.15 },
      { state: 'wrote_somewhere', intensity: 0.6, weight: 0.15 },
    ],
    vitals: { curiosity: +0.10, energy: -0.05, mood: -0.05 },
    traitNudge: null,
    cooldown: 10,
    xp: 10,
    minLevel: 40,  // only fires after 40% growth
  },
};


// ── TRIGGER ENGINE ───────────────────────────────────────────────────

class TriggerEngine {
  /**
   * @param {EmotionState} emotionState — reference to the PES emotion FSM
   */
  constructor(emotionState) {
    this.emotions = emotionState;
    this.cooldowns = {};        // triggerName → lastFiredAt (tickCount)
    this.history = [];          // last 500 trigger events
    this.listeners = [];
    this.pesLevel = 0;          // current PES level (0-100), set externally
  }

  /**
   * Process an incoming event. Finds matching triggers,
   * evaluates conditions, picks a reaction, and applies it.
   *
   * @param {Object} event — { type: string, from?: string, ...data }
   * @returns {Object|null} — reaction taken, or null if no trigger matched
   */
  process(event) {
    const results = [];

    for (const [name, trigger] of Object.entries(TRIGGERS)) {
      // Check if trigger matches this event
      if (!trigger.match(event)) continue;

      // Check cooldown
      if (this._isOnCooldown(name, trigger.cooldown)) continue;

      // Check minimum level requirement
      if (trigger.minLevel && this.pesLevel < trigger.minLevel) continue;

      // Pick a reaction
      const reaction = this._pickReaction(trigger.reactions);
      if (!reaction) continue;

      // Try to apply the reaction
      const applied = this._applyReaction(name, trigger, reaction, event);
      if (applied) {
        results.push(applied);
      }
    }

    // Return the first successful reaction (most triggers are exclusive)
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Process multiple events at once (batch from catch-up period).
   * Returns array of reactions.
   */
  processBatch(events) {
    return events.map(e => this.process(e)).filter(Boolean);
  }

  /**
   * Set PES level for minLevel gating.
   */
  setLevel(level) {
    this.pesLevel = level;
  }

  /**
   * Subscribe to trigger events.
   */
  on(event, fn) {
    this.listeners.push({ event, fn });
    return () => { this.listeners = this.listeners.filter(l => l.event !== event || l.fn !== fn); };
  }

  /**
   * Get trigger history (for "what was PES doing?" screen).
   */
  getHistory(limit = 50) {
    return this.history.slice(-limit);
  }

  /**
   * Get analytics data — specifically agent_calls_pes events.
   */
  getAgentCallAnalytics() {
    return this.history.filter(h => h.triggerName === 'agent_calls_pes');
  }

  // ── Private ──

  _isOnCooldown(name, cooldownTicks) {
    if (!cooldownTicks) return false;
    if (!(name in this.cooldowns)) return false; // never fired = no cooldown
    return (this.emotions.tickCount - this.cooldowns[name]) < cooldownTicks;
  }

  _pickReaction(reactions) {
    // Filter by conditions
    const eligible = reactions.filter(r => {
      if (!r.condition) return true;
      return r.condition(this.emotions);
    });

    if (eligible.length === 0) return null;

    // Weighted random selection
    const totalWeight = eligible.reduce((sum, r) => sum + r.weight, 0);
    let roll = Math.random() * totalWeight;

    for (const r of eligible) {
      roll -= r.weight;
      if (roll <= 0) return r;
    }

    return eligible[eligible.length - 1];
  }

  _applyReaction(triggerName, trigger, reaction, event) {
    // Try emotional transition
    const transitioned = this.emotions.transitionTo(
      reaction.state,
      reaction.intensity,
      triggerName
    );

    // Even if transition failed (invalid path), still apply vitals and trait nudge
    // Because the EVENT happened, even if PES couldn't express it in state change

    // Apply vital adjustments
    if (trigger.vitals) {
      if (trigger.vitals.mood) this.emotions.adjustMood(trigger.vitals.mood);
      if (trigger.vitals.energy) this.emotions.adjustEnergy(trigger.vitals.energy);
      if (trigger.vitals.hunger) this.emotions.adjustHunger(trigger.vitals.hunger);
      if (trigger.vitals.curiosity) this.emotions.adjustCuriosity(trigger.vitals.curiosity);
      if (trigger.vitals.loneliness) this.emotions.reduceLoneliness(-trigger.vitals.loneliness);
    }

    // Apply trait nudge
    if (trigger.traitNudge) {
      this.emotions.nudgeTrait(trigger.traitNudge.trait, trigger.traitNudge.delta, triggerName);
    }

    // Fire interaction tick
    this.emotions.interactionTick(triggerName);

    // Record cooldown
    this.cooldowns[triggerName] = this.emotions.tickCount;

    // Build result
    const result = {
      triggerName,
      reaction: reaction.state,
      transitioned,
      intensity: reaction.intensity,
      xp: trigger.xp || 0,
      event,
      timestamp: Date.now(),
      tickCount: this.emotions.tickCount,
      emotionSnapshot: this.emotions.current,
    };

    // Record history (keep last 500)
    this.history.push(result);
    if (this.history.length > 500) this.history.shift();

    // Emit
    this._emit('triggered', result);

    // Special analytics flag
    if (trigger.analytics) {
      this._emit('analytics', {
        type: triggerName,
        event,
        timestamp: Date.now(),
        pesState: this.emotions.current,
      });
    }

    // Special handlers
    if (trigger.special === 'dual_rage_resolution') {
      this._emit('dual_rage', { event, pesState: this.emotions.current });
    }

    return result;
  }

  _emit(event, data) {
    for (const l of this.listeners) {
      if (l.event === event) {
        try { l.fn(data); } catch (e) { console.error('[TRIGGER] listener error:', e.message); }
      }
    }
  }
}


// ── EXPORTS ──────────────────────────────────────────────────────────

export { TriggerEngine, TRIGGERS };
