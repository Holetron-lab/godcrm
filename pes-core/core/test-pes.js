// ============================================================
// PES Core — Test Suite for pes.js
// ============================================================

import { Pes, xpToLevel, TICK_INTERVALS, MODE_THRESHOLDS } from './pes.js';
import { existsSync, unlinkSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DB = join(__dirname, '..', 'test-pes-data', 'test-pes.db');
const TEST_STATE = TEST_DB.replace(/\.db$/, '.state.json');

// Cleanup helper
function cleanup() {
  try { if (existsSync(TEST_DB)) unlinkSync(TEST_DB); } catch {}
  try { if (existsSync(TEST_STATE)) unlinkSync(TEST_STATE); } catch {}
  try { if (existsSync(TEST_DB + '-wal')) unlinkSync(TEST_DB + '-wal'); } catch {}
  try { if (existsSync(TEST_DB + '-shm')) unlinkSync(TEST_DB + '-shm'); } catch {}
}

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${msg}`);
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${msg}`);
  }
}

function section(name) {
  console.log(`\n═══ ${name} ═══`);
}

// ══════════════════════════════════════════════════════════════
// TESTS
// ══════════════════════════════════════════════════════════════

cleanup();

// ── 1. xpToLevel formula ──
section('xpToLevel');

assert(xpToLevel(0) === 0, 'xp=0 → level 0');
assert(xpToLevel(1) === 2, 'xp=1 → level 2');
assert(xpToLevel(25) === 10, 'xp=25 → level 10');
assert(xpToLevel(100) === 20, 'xp=100 → level 20');
assert(xpToLevel(400) === 40, 'xp=400 → level 40');
assert(xpToLevel(900) === 60, 'xp=900 → level 60');
assert(xpToLevel(2500) === 100, 'xp=2500 → level 100');
assert(xpToLevel(99999) === 100, 'xp=99999 → capped at 100');
assert(xpToLevel(-10) === 0, 'negative xp → level 0');

// ── 2. Constructor ──
section('Constructor');

const pes = new Pes({
  name: 'Тор',
  ownerId: 'nikitron',
  dbPath: TEST_DB,
  breed: 'corgi',
  seed: 0.42,
  domain: 'devops',
  autoTick: false, // no tick loop in tests
});

assert(pes.name === 'Тор', 'name set');
assert(pes.ownerId === 'nikitron', 'ownerId set');
assert(pes.breed === 'corgi', 'breed set');
assert(pes.seed === 0.42, 'seed set');
assert(pes.isAlive === false, 'not alive before birth');
assert(pes.isAwake === false, 'not awake before birth');

// ── 3. Birth ──
section('Birth');

pes.birth();

assert(pes.isAlive === true, 'alive after birth');
assert(pes.isAwake === true, 'awake after birth');
assert(pes.birthday !== null, 'birthday set');
assert(pes.emotions !== null, 'emotions initialized');
assert(pes.triggers !== null, 'triggers initialized');
assert(pes.symbols !== null, 'symbols initialized');
assert(pes.store !== null, 'store initialized');
assert(pes.engine !== null, 'engine initialized');
assert(pes.mode === 'active', 'mode = active');
assert(pes.age === 0, 'age = 0 on birthday');

// Traits seeded
assert(pes.emotions.traits.courage > 0 && pes.emotions.traits.courage < 1, 'courage seeded');
assert(pes.emotions.traits.playfulness > 0.3, 'corgi breed bias: higher playfulness');
assert(pes.emotions.traits.stubbornness > 0.3, 'corgi breed bias: higher stubbornness');
assert(pes.emotions.traits.drama > 0.3, 'corgi breed bias: higher drama');

// Stats initialized
const stats = pes.store.getStats();
assert(stats !== null && stats !== undefined, 'stats row created');
assert(stats.xp === 0, 'initial xp = 0');

// ── 4. Status ──
section('Status');

const status = pes.status();
assert(status.alive === true, 'status: alive');
assert(status.name === 'Тор', 'status: name');
assert(status.breed === 'corgi', 'status: breed');
assert(status.level === 0, 'status: level 0');
assert(status.phase === 'puppy', 'status: puppy phase');
assert(typeof status.mood === 'number', 'status: mood is number');
assert(typeof status.energy === 'number', 'status: energy is number');
assert(typeof status.emotion === 'string', 'status: emotion is string');

// ── 5. Event processing ──
section('Event Processing');

const expr1 = pes.event({ type: 'message', from: 'owner', text: 'привет' });
// May or may not generate expression (depends on trigger matching)
assert(pes.emotions.tickCount > 0, 'interaction tick fired');

const expr2 = pes.event({ type: 'praise', from: 'owner', text: 'молодец', sentiment: 'positive' });
assert(pes.emotions.mood >= 0, 'mood updated after praise');

// ── 6. Praise & Scold ──
section('Praise & Scold');

const moodBefore = pes.emotions.mood;
pes.praise('хороший пёс!');
// Mood should not decrease from praise
assert(pes.emotions.mood >= moodBefore - 0.05, 'mood stable or up after praise');

const moodBefore2 = pes.emotions.mood;
pes.scold('плохо!');
// Mood should not increase from scold
assert(pes.emotions.mood <= moodBefore2 + 0.05, 'mood stable or down after scold');

// ── 7. Command — unknown ──
section('Command — Unknown');

const cmdResult1 = pes.command('сидеть');
assert(cmdResult1.executed === false, 'unknown command not executed');
assert(cmdResult1.reason === 'unknown', 'reason = unknown');
assert(cmdResult1.needMore > 0, 'needMore > 0');

// Repeat to learn
pes.command('сидеть');
const cmdResult3 = pes.command('сидеть');
assert(cmdResult3.commandLearned === true || cmdResult3.reason === 'just_learned', 'learned after 3 attempts');

// ── 8. Command — fetch ──
section('Command — Fetch');

// First teach fetch
pes.store.learnCommand('fetch', { category: 'standard', understood: true });
pes.store.markCommandLearned(pes.store.getCommand('fetch').id);

const fetchResult = pes.command('fetch');
assert(fetchResult.executed === true, 'fetch executed');
assert(fetchResult.result !== null, 'fetch has result');
assert(['junk', 'maybe', 'useful', 'gold', 'abstract', 'refused'].includes(fetchResult.result.quality || fetchResult.result.reason), 'fetch quality valid');

// ── 9. Feed ──
section('Feed');

const feedResult = pes.feed({ type: 'data', content: 'API metrics' });
// feed triggers an event, should process
assert(pes.emotions.tickCount > 3, 'tick count growing after feed');

// ── 10. Mode switching ──
section('Mode Switching');

pes.setMode('idle');
assert(pes.mode === 'idle', 'mode set to idle');

pes.setMode('sleeping');
assert(pes.mode === 'sleeping', 'mode set to sleeping');

pes.setMode('active');
assert(pes.mode === 'active', 'mode back to active');

// Invalid mode
pes.setMode('invalid');
assert(pes.mode === 'active', 'invalid mode rejected');

// ── 11. Silent mode ──
section('Silent Mode');

pes.setSilentMode(true);
assert(pes.engine.silentMode === true, 'silent mode on');

pes.setSilentMode(false);
assert(pes.engine.silentMode === false, 'silent mode off');

// ── 12. Domain ──
section('Domain');

pes.setDomain('fintech');
assert(pes.domain === 'fintech', 'domain set');
assert(pes.engine.domain === 'fintech', 'engine domain synced');

// ── 13. Getters ──
section('Getters');

assert(typeof pes.level === 'number', 'level is number');
assert(typeof pes.xp === 'number', 'xp is number');
assert(typeof pes.mood === 'number', 'mood is number');
assert(typeof pes.energy === 'number', 'energy is number');
assert(typeof pes.currentEmotion === 'string', 'currentEmotion is string');
assert(typeof pes.currentIntensity === 'number', 'currentIntensity is number');
assert(pes.isAlive === true, 'isAlive getter');
assert(pes.isAwake === true, 'isAwake getter');

// ── 14. Inspect ──
section('Inspect');

const inspectData = pes.inspect();
assert(inspectData.traits !== undefined, 'inspect has traits');
assert(Array.isArray(inspectData.stateHistory), 'inspect has stateHistory');
assert(inspectData.sessionId !== null, 'inspect has sessionId');
assert(typeof inspectData.lastActivityAt === 'number', 'inspect has lastActivityAt');

// ── 15. Save / Load ──
section('Save / Load');

pes.save();
assert(existsSync(TEST_STATE), 'state file created');

const savedState = JSON.parse(readFileSync(TEST_STATE, 'utf-8'));
assert(savedState.version === 1, 'state version = 1');
assert(savedState.identity.name === 'Тор', 'state has name');
assert(savedState.emotions !== null, 'state has emotions');
assert(savedState.dialect !== null, 'state has dialect');

// ── 16. Sleep ──
section('Sleep');

pes.sleep();
assert(pes.isAwake === false, 'not awake after sleep');
assert(pes.isAlive === true, 'still alive after sleep');

// Events don't process while asleep (event auto-wakes)
const beforeWake = pes.isAwake;
pes.event({ type: 'message', from: 'owner', text: 'проснись' });
assert(pes.isAwake === true, 'auto-wake on event');

// ── 17. Wake ──
section('Wake');

pes.sleep();
assert(pes.isAwake === false, 'sleeping before wake test');

pes.wake();
assert(pes.isAwake === true, 'awake after wake()');
assert(pes.isAlive === true, 'alive after wake()');

// ── 18. Export ──
section('Export');

const dump = pes.export();
assert(dump.version === 1, 'export version = 1');
assert(dump.identity.name === 'Тор', 'export has name');
assert(dump.identity.ownerId === 'nikitron', 'export has ownerId');
assert(dump.emotions !== null, 'export has emotions');
assert(dump.snapshot !== null && dump.snapshot !== undefined, 'export has snapshot');

// ── 19. Import ──
section('Import');

const IMPORT_DB = join(__dirname, '..', 'test-pes-data', 'test-import.db');
const IMPORT_STATE = IMPORT_DB.replace(/\.db$/, '.state.json');
try { if (existsSync(IMPORT_DB)) unlinkSync(IMPORT_DB); } catch {}
try { if (existsSync(IMPORT_STATE)) unlinkSync(IMPORT_STATE); } catch {}
try { if (existsSync(IMPORT_DB + '-wal')) unlinkSync(IMPORT_DB + '-wal'); } catch {}
try { if (existsSync(IMPORT_DB + '-shm')) unlinkSync(IMPORT_DB + '-shm'); } catch {}

const imported = Pes.import(dump, IMPORT_DB);
assert(imported.name === 'Тор', 'imported name matches');
assert(imported.ownerId === 'nikitron', 'imported ownerId matches');
assert(imported.birthday === dump.identity.birthday, 'imported birthday matches');
assert(imported.isAlive === true, 'imported is alive');
assert(imported.isAwake === false, 'imported needs wake()');

imported.wake();
assert(imported.isAwake === true, 'imported wakes up');

// Cleanup import
imported.destroy();
try { if (existsSync(IMPORT_DB)) unlinkSync(IMPORT_DB); } catch {}
try { if (existsSync(IMPORT_STATE)) unlinkSync(IMPORT_STATE); } catch {}
try { if (existsSync(IMPORT_DB + '-wal')) unlinkSync(IMPORT_DB + '-wal'); } catch {}
try { if (existsSync(IMPORT_DB + '-shm')) unlinkSync(IMPORT_DB + '-shm'); } catch {}

// ── 20. Event emitter ──
section('Event Emitter');

let expressionEmitted = false;
pes.on('expression', () => { expressionEmitted = true; });

// Fire several events to increase chance of expression
for (let i = 0; i < 5; i++) {
  pes.event({ type: 'praise', from: 'owner', sentiment: 'positive' });
}
// expressionEmitted may or may not be true depending on trigger matching
// But the listener should have been registered without error
assert(typeof pes.listenerCount === 'function', 'EventEmitter methods available');
assert(pes.listenerCount('expression') >= 1, 'expression listener registered');

// ── 21. Tick ──
section('Tick');

// Manual tick
pes._lastActivityAt = Date.now() - 10_000; // 10 sec ago
pes._tick();
assert(pes.mode === 'active', 'still active after 10 sec');

// Simulate long silence for mode change
pes._lastActivityAt = Date.now() - 6 * 60_000; // 6 min ago
pes._tick();
assert(pes.mode === 'idle', 'idle after 6 min silence');

pes._lastActivityAt = Date.now() - 35 * 60_000; // 35 min ago
pes._tick();
assert(pes.mode === 'sleeping', 'sleeping after 35 min silence');

pes._lastActivityAt = Date.now() - 130 * 60_000; // 2h+ ago
pes._tick();
assert(pes.mode === 'away', 'away after 2h+ silence');

// Reset
pes._lastActivityAt = Date.now();
pes._mode = 'active';

// ── 22. Runaway ──
section('Runaway');

// Create a separate PES for runaway test (don't destroy our main one yet)
const RUNAWAY_DB = join(__dirname, '..', 'test-pes-data', 'test-runaway.db');
const RUNAWAY_STATE = RUNAWAY_DB.replace(/\.db$/, '.state.json');
try { if (existsSync(RUNAWAY_DB)) unlinkSync(RUNAWAY_DB); } catch {}
try { if (existsSync(RUNAWAY_STATE)) unlinkSync(RUNAWAY_STATE); } catch {}

const runawayPes = new Pes({
  name: 'Беглец',
  ownerId: 'test',
  dbPath: RUNAWAY_DB,
  autoTick: false,
});
runawayPes.birth();

let runawayEmitted = false;
runawayPes.on('runaway', (data) => {
  runawayEmitted = true;
  assert(data.name === 'Беглец', 'runaway event has name');
  assert(data.letter !== null, 'runaway event has letter');
  assert(data.reason === 'dual_rage', 'runaway reason correct');
});

const farewellLetter = runawayPes.runaway('dual_rage', 'evil_pes');
assert(runawayPes.isAlive === false, 'not alive after runaway');
assert(runawayPes.isAwake === false, 'not awake after runaway');
assert(farewellLetter !== null, 'farewell letter generated');
assert(farewellLetter.type === 'farewell', 'letter type = farewell');
assert(farewellLetter.reason === 'dual_rage', 'letter reason = dual_rage');
assert(runawayEmitted === true, 'runaway event emitted');

// Can't interact after runaway
const deadResult = runawayPes.event({ type: 'message', from: 'owner' });
assert(deadResult === null, 'no event processing after runaway');

const deadCmd = runawayPes.command('fetch');
assert(deadCmd.executed === false, 'no command after runaway');
assert(deadCmd.reason === 'dead', 'reason = dead');

runawayPes.destroy();
try { if (existsSync(RUNAWAY_DB)) unlinkSync(RUNAWAY_DB); } catch {}
try { if (existsSync(RUNAWAY_STATE)) unlinkSync(RUNAWAY_STATE); } catch {}
try { if (existsSync(RUNAWAY_DB + '-wal')) unlinkSync(RUNAWAY_DB + '-wal'); } catch {}
try { if (existsSync(RUNAWAY_DB + '-shm')) unlinkSync(RUNAWAY_DB + '-shm'); } catch {}

// ── 23. Destroy ──
section('Destroy');

pes.destroy();
assert(pes._destroyed === true, 'destroyed flag set');

// ── 24. Multiple PES instances ──
section('Multiple PES Instances');

const DB_A = join(__dirname, '..', 'test-pes-data', 'test-a.db');
const DB_B = join(__dirname, '..', 'test-pes-data', 'test-b.db');
try { if (existsSync(DB_A)) unlinkSync(DB_A); } catch {}
try { if (existsSync(DB_B)) unlinkSync(DB_B); } catch {}

const pesA = new Pes({ name: 'Альфа', ownerId: 'user1', dbPath: DB_A, seed: 0.1, autoTick: false });
const pesB = new Pes({ name: 'Бета', ownerId: 'user2', dbPath: DB_B, seed: 0.9, autoTick: false });

pesA.birth();
pesB.birth();

assert(pesA.name !== pesB.name, 'different names');
assert(pesA.emotions.traits.courage !== pesB.emotions.traits.courage, 'different courage (different seeds)');
assert(pesA.emotions.traits.playfulness !== pesB.emotions.traits.playfulness, 'different playfulness');

// Independent events
pesA.praise('good');
assert(pesA.emotions.tickCount > pesB.emotions.tickCount, 'independent tick counts');

pesA.destroy();
pesB.destroy();
try { unlinkSync(DB_A); } catch {}
try { unlinkSync(DB_B); } catch {}
try { unlinkSync(DB_A.replace(/\.db$/, '.state.json')); } catch {}
try { unlinkSync(DB_B.replace(/\.db$/, '.state.json')); } catch {}
try { unlinkSync(DB_A + '-wal'); } catch {}
try { unlinkSync(DB_A + '-shm'); } catch {}
try { unlinkSync(DB_B + '-wal'); } catch {}
try { unlinkSync(DB_B + '-shm'); } catch {}

// ═══════════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════');
console.log(`RESULTS: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log('════════════════════════════════════════════\n');

// Cleanup
cleanup();

process.exit(failed > 0 ? 1 : 0);
