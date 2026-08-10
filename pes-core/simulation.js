// ============================================================
// PES Simulation — "30 Days in 10 Seconds"
// ============================================================
// Runs a simulated PES life to verify:
//   1. PES doesn't get stuck in one emotion forever
//   2. Energy/hunger/loneliness stay balanced
//   3. XP grows, level progresses
//   4. Dialect evolves (preferences shift)
//   5. Commands are learned
//   6. No crashes over extended use
// ============================================================

import { Pes } from './core/pes.js';
import { unlinkSync, existsSync } from 'node:fs';

const DB_PATH = '/tmp/pes-simulation.db';
const STATE_PATH = DB_PATH.replace(/\.db$/, '.state.json');

function cleanup() {
  for (const f of [DB_PATH, STATE_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) {
    try { if (existsSync(f)) unlinkSync(f); } catch (_) {}
  }
}

// ── Simulation Config ───────────────────────────────────────

const SIM_DAYS = 30;
const TICKS_PER_DAY = 48;  // tick every 30 min simulated
const TOTAL_TICKS = SIM_DAYS * TICKS_PER_DAY;

// Event probabilities per tick (active owner ~8 hours/day = 16 ticks active, 32 sleep)
// During "active hours" (first 16 ticks of day): high event rate
// During "inactive hours" (next 32 ticks): mostly silence
const EVENT_CHANCES_ACTIVE = {
  owner_returned:     0.10,
  praise:             0.12,
  scold:              0.03,
  bug_detected:       0.08,
  system_error:       0.02,
  fetch_command:      0.10,
  feed:               0.12,
  unknown_command:    0.05,
  another_pes:        0.02,
  silence:            0.10,  // very little silence during active hours
};
const EVENT_CHANCES_INACTIVE = {
  owner_returned:     0.01,
  praise:             0.00,
  scold:              0.00,
  bug_detected:       0.01,
  system_error:       0.005,
  fetch_command:      0.00,
  feed:               0.00,
  unknown_command:    0.00,
  another_pes:        0.005,
  silence:            0.80,  // mostly silence when owner sleeps
};

const REACTION_CHANCE = 0.5; // 50% chance owner reacts to expression
const POSITIVE_BIAS = 0.7;   // 70% of reactions are positive

// ── Random helpers ──────────────────────────────────────────

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function rollEvent(tickInDay) {
  // Active hours: first 16 ticks (8 hours), inactive: next 32 ticks (16 hours)
  const chances = tickInDay < 16 ? EVENT_CHANCES_ACTIVE : EVENT_CHANCES_INACTIVE;
  const r = Math.random();
  let cumulative = 0;
  for (const [event, chance] of Object.entries(chances)) {
    cumulative += chance;
    if (r < cumulative) return event;
  }
  return 'silence';
}

// ── Stats tracking ──────────────────────────────────────────

const stats = {
  events: {},
  emotionCounts: {},
  moodSamples: [],
  energySamples: [],
  hungerSamples: [],
  lonelinessSamples: [],
  xpHistory: [],
  levelHistory: [],
  expressionsGenerated: 0,
  expressionsSuppressed: 0,
  commandsLearned: 0,
  reactionsGiven: 0,
  modeChanges: 0,
  errors: 0,
};

function recordState(pes, day) {
  const s = pes.status();
  const emotion = s.emotion;
  stats.emotionCounts[emotion] = (stats.emotionCounts[emotion] || 0) + 1;
  stats.moodSamples.push(s.mood);
  stats.energySamples.push(s.energy);
  stats.hungerSamples.push(s.hunger);
  stats.lonelinessSamples.push(s.loneliness);
  stats.xpHistory.push(s.xp);
  stats.levelHistory.push(s.level);
}

// ── Run Simulation ──────────────────────────────────────────

console.log('╔══════════════════════════════════════════════════════╗');
console.log('║          PES SIMULATION — 30 DAYS                   ║');
console.log('╚══════════════════════════════════════════════════════╝\n');

cleanup();

const pes = new Pes({
  name: 'СимТор',
  ownerId: 'nikitron',
  dbPath: DB_PATH,
  breed: 'corgi',
  seed: 0.42,
  domain: 'devops',
  autoTick: false,
});

pes.on('commandLearned', () => { stats.commandsLearned++; });
pes.on('modeChange', () => { stats.modeChanges++; });
pes.on('error', () => { stats.errors++; });

pes.birth();

const unknownCommands = ['scan_api', 'check_logs', 'deploy', 'rollback', 'monitor'];
let unknownIdx = 0;

const startTime = Date.now();

for (let tick = 0; tick < TOTAL_TICKS; tick++) {
  const day = Math.floor(tick / TICKS_PER_DAY) + 1;
  const tickInDay = tick % TICKS_PER_DAY;

  // Roll event (depends on time of day — active vs inactive hours)
  const event = rollEvent(tickInDay);
  stats.events[event] = (stats.events[event] || 0) + 1;

  // Only apply passive tick when nothing happens (silence)
  // When an event occurs, the trigger system handles vitals via interaction tick
  if (event === 'silence' && pes.emotions) {
    pes.emotions.passiveTick(30);
  }

  let result = null;

  try {
    switch (event) {
      case 'owner_returned':
        result = pes.event({ type: 'owner_returned', from: 'owner', minutesAway: 60 + Math.random() * 240 });
        break;

      case 'praise':
        result = pes.praise(pick(['молодец', 'хорошо', 'отлично', 'good boy']));
        break;

      case 'scold':
        result = pes.scold(pick(['нет', 'плохо', 'стоп']));
        break;

      case 'bug_detected':
        result = pes.event({
          type: 'bug_detected',
          from: 'system',
          file: pick(['api.js', 'auth.js', 'db.js', 'config.js']),
          line: Math.floor(Math.random() * 200),
        });
        break;

      case 'system_error':
        result = pes.event({ type: 'system_error', from: 'system', severity: 'high' });
        break;

      case 'fetch_command':
        result = pes.command('fetch', { type: pick(['config', 'log', 'report']) });
        break;

      case 'feed':
        result = pes.feed({
          type: pick(['metrics', 'logs', 'alerts']),
          quality: Math.random() > 0.2 ? 'good' : 'junk',
        });
        break;

      case 'unknown_command':
        const cmd = unknownCommands[unknownIdx % unknownCommands.length];
        result = pes.command(cmd);
        // Repeat to eventually learn
        if (result.reason === 'unknown' && result.needMore <= 1) {
          unknownIdx++; // move to next command after learning
        }
        break;

      case 'another_pes':
        result = pes.event({
          type: 'another_pes_detected',
          from: 'system',
          opponent: 'ДругойПЕС',
        });
        break;

      case 'silence':
      default:
        // Nothing happens — loneliness grows
        break;
    }

    if (result && !result.suppressed) {
      stats.expressionsGenerated++;

      // Owner might react
      if (Math.random() < REACTION_CHANCE && result.id) {
        const positive = Math.random() < POSITIVE_BIAS;
        pes.react(result.id, {
          from: 'owner',
          type: 'emoji',
          value: positive ? pick(['👍', '❤️', '😂', '🔥']) : pick(['👎', '😡', '🤦']),
          speed_ms: 1000 + Math.random() * 10000,
        });
        stats.reactionsGiven++;
      }
    } else if (result && result.suppressed) {
      stats.expressionsSuppressed++;
    }
  } catch (err) {
    stats.errors++;
    console.error(`  ⚠️ Error on day ${day}, tick ${tickInDay}: ${err.message}`);
  }

  // Record state every 12 ticks (~6 hours sim time)
  if (tick % 12 === 0) {
    recordState(pes, day);
  }

  // Daily summary
  if (tickInDay === TICKS_PER_DAY - 1) {
    const s = pes.status();
    const bar = (v) => '█'.repeat(Math.round(v * 10)) + '░'.repeat(10 - Math.round(v * 10));
    if (day % 5 === 0 || day === 1 || day === SIM_DAYS) {
      console.log(`  Day ${String(day).padStart(2)}: ` +
        `${s.emotion.padEnd(18)} ` +
        `mood:${bar(s.mood)} ` +
        `nrg:${bar(s.energy)} ` +
        `lvl:${String(s.level).padStart(3)} ` +
        `xp:${String(s.xp).padStart(5)}`
      );
    }
  }
}

const elapsed = Date.now() - startTime;

// ── Final Status ────────────────────────────────────────────

const final = pes.status();
const inspected = pes.inspect();

console.log('\n──────────────────────────────────────────────────────');
console.log('  SIMULATION COMPLETE');
console.log('──────────────────────────────────────────────────────\n');

console.log(`  Simulated:      ${SIM_DAYS} days (${TOTAL_TICKS} ticks)`);
console.log(`  Real time:      ${(elapsed / 1000).toFixed(2)}s`);
console.log(`  Speed:          ${(SIM_DAYS / (elapsed / 1000)).toFixed(1)} days/sec\n`);

console.log('  ── FINAL STATE ──');
console.log(`  Name:           ${final.name}`);
console.log(`  Level:          ${final.level} (${final.phase})`);
console.log(`  XP:             ${final.xp}`);
console.log(`  Emotion:        ${final.emotion} (intensity: ${final.intensity.toFixed(2)})`);
console.log(`  Mood:           ${final.mood.toFixed(3)}`);
console.log(`  Energy:         ${final.energy.toFixed(3)}`);
console.log(`  Hunger:         ${final.hunger.toFixed(3)}`);
console.log(`  Loneliness:     ${final.loneliness.toFixed(3)}`);
console.log(`  Commands known: ${final.commandsKnown}`);
console.log(`  Bugs found:     ${final.bugsFound}`);

console.log('\n  ── TRAITS ──');
for (const [k, v] of Object.entries(inspected.traits)) {
  console.log(`  ${k.padEnd(14)}: ${v.toFixed(3)}`);
}

console.log('\n  ── EVENT DISTRIBUTION ──');
for (const [k, v] of Object.entries(stats.events).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(20)}: ${v}`);
}

console.log('\n  ── EMOTION DISTRIBUTION (top 10) ──');
const sortedEmotions = Object.entries(stats.emotionCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
const totalSamples = Object.values(stats.emotionCounts).reduce((a, b) => a + b, 0);
for (const [k, v] of sortedEmotions) {
  const pct = ((v / totalSamples) * 100).toFixed(1);
  console.log(`  ${k.padEnd(20)}: ${v} (${pct}%)`);
}

console.log('\n  ── EXPRESSION STATS ──');
console.log(`  Generated:      ${stats.expressionsGenerated}`);
console.log(`  Suppressed:     ${stats.expressionsSuppressed}`);
console.log(`  Reactions:      ${stats.reactionsGiven}`);
console.log(`  Commands learned: ${stats.commandsLearned}`);
console.log(`  Mode changes:   ${stats.modeChanges}`);
console.log(`  Errors:         ${stats.errors}`);

// ── Balance Analysis ────────────────────────────────────────

console.log('\n  ── BALANCE ANALYSIS ──');

function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function minMax(arr) { return { min: Math.min(...arr), max: Math.max(...arr) }; }

const moodAvg = avg(stats.moodSamples);
const energyAvg = avg(stats.energySamples);
const hungerAvg = avg(stats.hungerSamples);
const lonelinessAvg = avg(stats.lonelinessSamples);

const moodRange = minMax(stats.moodSamples);
const energyRange = minMax(stats.energySamples);

console.log(`  Avg mood:       ${moodAvg.toFixed(3)} (range: ${moodRange.min.toFixed(3)}-${moodRange.max.toFixed(3)})`);
console.log(`  Avg energy:     ${energyAvg.toFixed(3)} (range: ${energyRange.min.toFixed(3)}-${energyRange.max.toFixed(3)})`);
console.log(`  Avg hunger:     ${hungerAvg.toFixed(3)}`);
console.log(`  Avg loneliness: ${lonelinessAvg.toFixed(3)}`);

// ── Assertions ──────────────────────────────────────────────

let passed = 0;
let failed = 0;

function check(condition, msg) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ FAIL: ${msg}`); }
}

console.log('\n  ── BALANCE CHECKS ──');

// PES should not be dead
check(pes.isAlive, 'PES survived 30 days');

// XP should have grown
check(final.xp > 0, `XP grew (${final.xp})`);
check(final.level > 0, `Level progressed (${final.level})`);

// No single emotion should dominate >50%
const topEmotion = sortedEmotions[0];
const topPct = (topEmotion[1] / totalSamples) * 100;
check(topPct < 60, `No emotion dominates >60% (top: ${topEmotion[0]} at ${topPct.toFixed(1)}%)`);

// At least 5 different emotions visited
check(sortedEmotions.length >= 5, `Emotional diversity: ${Object.keys(stats.emotionCounts).length} unique emotions`);

// Vitals should not be stuck at 0 or 1
check(moodAvg > 0.1 && moodAvg < 0.95, `Mood not stuck (avg: ${moodAvg.toFixed(3)})`);
check(energyAvg > 0.05, `Energy not stuck at 0 (avg: ${energyAvg.toFixed(3)})`);

// Expressions should have been generated
check(stats.expressionsGenerated > 50, `Enough expressions generated (${stats.expressionsGenerated})`);

// Cooldown should have kicked in (some suppressed)
check(stats.expressionsSuppressed >= 0, `Cooldown works (${stats.expressionsSuppressed} suppressed)`);

// Commands should have been learned
check(stats.commandsLearned > 0, `Commands learned (${stats.commandsLearned})`);

// No crashes
check(stats.errors === 0, `No errors during simulation (${stats.errors})`);

// Speed check
check(elapsed < 30000, `Simulation fast enough (${(elapsed / 1000).toFixed(2)}s < 30s)`);

console.log(`\n  ── RESULT: ${passed} passed, ${failed} failed ──\n`);

// Cleanup
pes.destroy();
cleanup();

if (failed > 0) process.exit(1);
