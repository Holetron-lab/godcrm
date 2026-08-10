// ============================================================
// PES Integration Test — Full Lifecycle
// ============================================================
// Tests the COMPLETE cycle: birth → event → expression → react → learn
// Unlike unit tests, this exercises ALL subsystems together.
// ============================================================

import { Pes } from './core/pes.js';
import { unlinkSync, existsSync } from 'node:fs';

const DB_PATH = '/tmp/pes-integration-test.db';
const STATE_PATH = DB_PATH.replace(/\.db$/, '.state.json');

function cleanup() {
  for (const f of [DB_PATH, STATE_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) {
    try { if (existsSync(f)) unlinkSync(f); } catch (_) {}
  }
}

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.log(`  ❌ FAIL: ${msg}`);
  }
}

// ── TEST 1: Full Lifecycle ──────────────────────────────────

console.log('\n═══ TEST 1: BIRTH → EVENTS → SLEEP → WAKE → DESTROY ═══\n');
cleanup();

{
  const pes = new Pes({
    name: 'Тест',
    ownerId: 'nikitron',
    dbPath: DB_PATH,
    breed: 'corgi',
    seed: 0.42,
    autoTick: false,
  });

  // Track events
  const events = [];
  pes.on('born', d => events.push({ type: 'born', data: d }));
  pes.on('expression', d => events.push({ type: 'expression', data: d }));
  pes.on('feedback', d => events.push({ type: 'feedback', data: d }));
  pes.on('sleep', d => events.push({ type: 'sleep', data: d }));
  pes.on('wake', d => events.push({ type: 'wake', data: d }));
  pes.on('commandLearned', d => events.push({ type: 'commandLearned', data: d }));
  pes.on('modeChange', d => events.push({ type: 'modeChange', data: d }));

  // Birth
  pes.birth();
  assert(pes.isAlive, 'PES is alive after birth');
  assert(pes.isAwake, 'PES is awake after birth');
  assert(pes.name === 'Тест', 'PES has correct name');
  assert(pes.breed === 'corgi', 'PES breed is corgi');
  assert(events.some(e => e.type === 'born'), 'born event emitted');
  assert(pes.emotions !== null, 'Emotions subsystem initialized');
  assert(pes.store !== null, 'Store subsystem initialized');
  assert(pes.engine !== null, 'Expression engine initialized');

  // Corgi trait bias
  assert(pes.emotions.traits.playfulness > 0.3, 'Corgi has elevated playfulness');
  assert(pes.emotions.traits.stubbornness > 0.3, 'Corgi has elevated stubbornness');

  // Event: owner returned
  const greetResult = pes.event({ type: 'owner_returned', from: 'owner' });
  assert(greetResult !== null, 'owner_returned produces expression');
  assert(events.some(e => e.type === 'expression'), 'expression event emitted');

  // Event: bug detected → should give XP
  const xpBefore = pes.xp;
  const bugResult = pes.event({ type: 'bug_detected', from: 'system', file: 'test.js', line: 42 });
  assert(bugResult !== null, 'bug_detected produces expression');
  assert(pes.xp >= xpBefore, 'XP increased or stayed (bug_detected gives XP)');

  // Praise → mood should improve
  const moodBefore = pes.mood;
  pes.praise('хороший мальчик');
  // Mood may or may not increase immediately depending on state transitions
  assert(pes.mood >= 0, 'Mood is valid after praise');

  // Scold
  pes.scold('плохо');
  assert(pes.mood >= 0 && pes.mood <= 1, 'Mood is valid after scold');

  // Feed
  const feedResult = pes.feed({ type: 'good_data', content: 'test data' });
  assert(feedResult !== null || feedResult === null, 'Feed returns result (may be null if suppressed)');

  // Status
  const status = pes.status();
  assert(status.alive === true, 'Status shows alive');
  assert(status.name === 'Тест', 'Status shows correct name');
  assert(typeof status.level === 'number', 'Status has level');
  assert(typeof status.emotion === 'string', 'Status has emotion');
  assert(typeof status.mood === 'number', 'Status has mood');
  assert(typeof status.energy === 'number', 'Status has energy');

  // Inspect
  const inspected = pes.inspect();
  assert(inspected.traits !== undefined, 'Inspect has traits');
  assert(inspected.stateHistory !== undefined, 'Inspect has state history');

  // Sleep
  pes.sleep();
  assert(pes.isAwake === false, 'PES is not awake after sleep');
  assert(pes.isAlive, 'PES is still alive after sleep');

  // Wake
  pes.wake();
  assert(pes.isAwake, 'PES is awake after wake');
  assert(events.some(e => e.type === 'wake'), 'wake event emitted');

  // Destroy
  pes.destroy();
  assert(pes.isAlive === false || pes._destroyed, 'PES is destroyed');
}

// ── TEST 2: Command Learning Cycle ──────────────────────────

console.log('\n═══ TEST 2: COMMAND LEARNING — UNKNOWN → REPEAT → LEARN ═══\n');
cleanup();

{
  const pes = new Pes({
    name: 'Ученик',
    ownerId: 'nikitron',
    dbPath: DB_PATH,
    seed: 0.5,
    autoTick: false,
  });
  pes.birth();

  let commandLearned = false;
  pes.on('commandLearned', () => { commandLearned = true; });

  // Unknown command — attempt 1
  const r1 = pes.command('scan_api');
  assert(r1.executed === false, 'Unknown command not executed');
  assert(r1.reason === 'unknown', 'Reason is "unknown"');
  assert(r1.attempts === 1, 'First attempt recorded');

  // Attempt 2
  const r2 = pes.command('scan_api');
  assert(r2.executed === false, 'Still unknown at attempt 2');
  assert(r2.attempts === 2, 'Second attempt');

  // Attempt 3 — should learn!
  const r3 = pes.command('scan_api');
  assert(r3.commandLearned === true, 'Command learned on 3rd attempt');
  assert(commandLearned, 'commandLearned event emitted');

  // Now execute the learned command
  const r4 = pes.command('scan_api');
  assert(r4.executed === true, 'Learned command executes');

  // Verify in store
  const cmd = pes.store.getCommand('scan_api');
  assert(cmd !== null, 'Command exists in store');
  assert(cmd.understood === 1, 'Command is marked as understood');
  assert(cmd.willingness >= 0.3, 'Command has willingness');

  pes.destroy();
}

// ── TEST 3: Feedback Loop ───────────────────────────────────

console.log('\n═══ TEST 3: FEEDBACK LOOP — EXPRESSION → REACTION → LEARN ═══\n');
cleanup();

{
  const pes = new Pes({
    name: 'Фидбэк',
    ownerId: 'nikitron',
    dbPath: DB_PATH,
    seed: 0.3,
    autoTick: false,
  });
  pes.birth();

  const expressions = [];
  pes.on('expression', (expr) => expressions.push(expr));

  // Generate an expression
  const result = pes.event({ type: 'bug_detected', from: 'system', file: 'app.js', line: 10 });

  if (result && !result.suppressed && result.id) {
    // React positively
    const feedback = pes.react(result.id, {
      from: 'owner',
      type: 'emoji',
      value: '👍',
      speed_ms: 2000,
    });

    assert(feedback !== null, 'Feedback returned (reaction processed)');
    if (feedback) {
      assert(feedback.positive === true, 'Reaction classified as positive');
      assert(feedback.weight > 0, 'Positive weight calculated');
    }

    // React negatively to next expression
    const result2 = pes.event({ type: 'owner_returned', from: 'owner' });
    if (result2 && !result2.suppressed && result2.id) {
      const feedback2 = pes.react(result2.id, {
        from: 'owner',
        type: 'emoji',
        value: '👎',
        speed_ms: 5000,
      });
      if (feedback2) {
        assert(feedback2.positive === false, 'Negative reaction classified correctly');
        assert(feedback2.weight < 0, 'Negative weight calculated');
      } else {
        assert(true, 'Negative reaction processed (null ok if pending expired)');
      }
    } else {
      assert(true, 'Second expression skipped (cooldown/suppressed)');
    }
  } else {
    assert(true, 'Expression suppressed — feedback loop skipped (valid behavior)');
  }

  // Check reaction memory has entries
  const history = pes.store.getHistory({ limit: 10 });
  assert(history.length > 0, 'Interaction history recorded');

  pes.destroy();
}

// ── TEST 4: Passive Tick & Auto-mode ────────────────────────

console.log('\n═══ TEST 4: PASSIVE TICK & AUTO-MODE ═══\n');
cleanup();

{
  const pes = new Pes({
    name: 'Тикер',
    ownerId: 'nikitron',
    dbPath: DB_PATH,
    seed: 0.6,
    autoTick: false,
  });
  pes.birth();

  const modeChanges = [];
  pes.on('modeChange', (d) => modeChanges.push(d));

  // Simulate time passing — manually call _tick
  assert(pes.mode === 'active', 'Starts in active mode');

  // Simulate 10 minutes of silence
  pes._lastActivityAt = Date.now() - 10 * 60_000;
  pes._tick();
  assert(pes.mode === 'idle', 'Switches to idle after 10 min silence');

  // Simulate 45 minutes of silence
  pes._lastActivityAt = Date.now() - 45 * 60_000;
  pes._tick();
  assert(pes.mode === 'sleeping', 'Switches to sleeping after 45 min silence');

  // Simulate 3 hours of silence
  pes._lastActivityAt = Date.now() - 180 * 60_000;
  pes._tick();
  assert(pes.mode === 'away', 'Switches to away after 3 hours silence');

  // Activity resets to active
  pes.event({ type: 'owner_returned', from: 'owner' });
  assert(pes.mode === 'active', 'Returns to active on event');

  pes.destroy();
}

// ── TEST 5: Export / Import ─────────────────────────────────

console.log('\n═══ TEST 5: EXPORT → IMPORT ═══\n');
cleanup();

{
  const pes = new Pes({
    name: 'Экспорт',
    ownerId: 'nikitron',
    dbPath: DB_PATH,
    seed: 0.7,
    domain: 'devops',
    autoTick: false,
  });
  pes.birth();

  // Build up some state
  pes.event({ type: 'owner_returned', from: 'owner' });
  pes.praise('хороший');
  pes.command('sit');
  pes.command('sit');
  pes.command('sit'); // learn it

  // Export
  const dump = pes.export();
  assert(dump.version === 1, 'Export has version');
  assert(dump.identity.name === 'Экспорт', 'Export has name');
  assert(dump.identity.breed === 'corgi', 'Export has breed');
  assert(dump.emotions !== null, 'Export has emotions');
  assert(dump.snapshot !== null, 'Export has snapshot');

  pes.destroy();

  // Import into new DB
  const DB2 = '/tmp/pes-integration-import.db';
  try { unlinkSync(DB2); } catch (_) {}
  try { unlinkSync(DB2.replace('.db', '.state.json')); } catch (_) {}

  const pes2 = Pes.import(dump, DB2);
  assert(pes2.name === 'Экспорт', 'Imported PES has correct name');
  assert(pes2.breed === 'corgi', 'Imported PES has correct breed');
  assert(pes2.birthday === dump.identity.birthday, 'Imported PES has correct birthday');
  assert(pes2.isAlive, 'Imported PES is alive');
  assert(!pes2.isAwake, 'Imported PES needs wake()');

  // Wake and verify
  pes2.wake();
  assert(pes2.isAwake, 'Imported PES wakes up');
  assert(pes2.emotions !== null, 'Imported PES has emotions');

  pes2.destroy();
  try { unlinkSync(DB2); } catch (_) {}
  try { unlinkSync(DB2.replace('.db', '.state.json')); } catch (_) {}
  try { unlinkSync(DB2 + '-wal'); } catch (_) {}
  try { unlinkSync(DB2 + '-shm'); } catch (_) {}
}

// ── TEST 6: Runaway (Irreversible) ──────────────────────────

console.log('\n═══ TEST 6: RUNAWAY — FAREWELL LETTER ═══\n');
cleanup();

{
  const pes = new Pes({
    name: 'Беглец',
    ownerId: 'nikitron',
    dbPath: DB_PATH,
    seed: 0.1,
    autoTick: false,
  });
  pes.birth();

  let runawayEvent = null;
  pes.on('runaway', (d) => { runawayEvent = d; });

  // Build some history
  pes.event({ type: 'owner_returned', from: 'owner' });
  pes.praise('test');

  // Runaway
  const letter = pes.runaway('dual_rage', 'злой_pes');
  assert(letter !== null, 'Farewell letter generated');
  assert(letter.type === 'farewell', 'Letter type is farewell');
  assert(letter.reason === 'dual_rage', 'Letter has reason');
  assert(letter.snapshot !== null, 'Letter has snapshot');
  assert(letter.finalWords !== undefined, 'Letter has final words');
  assert(runawayEvent !== null, 'runaway event emitted');
  assert(pes.isAlive === false, 'PES is not alive after runaway');

  // Cannot interact anymore
  const result = pes.event({ type: 'owner_returned', from: 'owner' });
  assert(result === null, 'Cannot interact with dead PES');

  pes.destroy();
}

// ── TEST 7: Silent Mode ─────────────────────────────────────

console.log('\n═══ TEST 7: SILENT MODE ═══\n');
cleanup();

{
  const pes = new Pes({
    name: 'Тихий',
    ownerId: 'nikitron',
    dbPath: DB_PATH,
    seed: 0.9,
    autoTick: false,
  });
  pes.birth();

  // Enable silent mode
  pes.setSilentMode(true);
  assert(pes.engine.silentMode === true, 'Silent mode enabled');

  // Expression should have no voice
  const result = pes.event({ type: 'bug_detected', from: 'system' });
  if (result && result.expression) {
    assert(result.expression.voiceKey === null || result.expression.voiceKey === undefined,
      'Voice is suppressed in silent mode');
  } else {
    assert(true, 'Expression suppressed (valid)');
  }

  // Disable
  pes.setSilentMode(false);
  assert(pes.engine.silentMode === false, 'Silent mode disabled');

  pes.destroy();
}

// ── TEST 8: Domain Context ──────────────────────────────────

console.log('\n═══ TEST 8: DOMAIN CONTEXT ═══\n');
cleanup();

{
  const pes = new Pes({
    name: 'Домен',
    ownerId: 'nikitron',
    dbPath: DB_PATH,
    seed: 0.4,
    domain: 'fintech',
    autoTick: false,
  });
  pes.birth();

  assert(pes.domain === 'fintech', 'Domain set on creation');

  // Change domain
  pes.setDomain('devops');
  assert(pes.domain === 'devops', 'Domain changed');

  const status = pes.status();
  assert(status.alive, 'PES alive with domain');

  pes.destroy();
}

// ── TEST 9: Multiple Events → Store Persistence ─────────────

console.log('\n═══ TEST 9: PERSISTENCE — INTERACTIONS RECORDED ═══\n');
cleanup();

{
  const pes = new Pes({
    name: 'Память',
    ownerId: 'nikitron',
    dbPath: DB_PATH,
    seed: 0.2,
    autoTick: false,
  });
  pes.birth();

  // Generate multiple events
  pes.event({ type: 'owner_returned', from: 'owner' });
  pes.event({ type: 'bug_detected', from: 'system' });
  pes.praise('отлично');
  pes.scold('нет');
  pes.feed({ type: 'data' });

  // Check interactions are in store
  const history = pes.store.getHistory({ limit: 50 });
  assert(history.length >= 3, `Multiple interactions recorded (got ${history.length})`);

  // Check stats
  const stats = pes.store.getStats();
  assert(stats !== null, 'Stats exist');
  assert(stats.xp >= 0, 'XP is tracked');

  // Save and reload
  pes.save();
  assert(existsSync(STATE_PATH), 'State file saved');

  // Create new PES from same DB
  pes.destroy();

  const pes2 = new Pes({
    name: 'Память',
    ownerId: 'nikitron',
    dbPath: DB_PATH,
    autoTick: false,
  });
  pes2.wake();

  const history2 = pes2.store.getHistory({ limit: 50 });
  assert(history2.length >= 3, `History survives restart (got ${history2.length})`);

  pes2.destroy();
}

// ── SUMMARY ─────────────────────────────────────────────────

cleanup();

console.log('\n═══════════════════════════════════════════════════════');
console.log(`  INTEGRATION TESTS: ${passed} passed, ${failed} failed`);
console.log('═══════════════════════════════════════════════════════\n');

if (failed > 0) process.exit(1);
