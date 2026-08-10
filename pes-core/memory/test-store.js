// Quick integration test for MemoryStore
import { MemoryStore } from './store.js';
import { unlinkSync, existsSync } from 'node:fs';

const DB_PATH = '/tmp/pes-test-store.db';
if (existsSync(DB_PATH)) unlinkSync(DB_PATH);

const store = new MemoryStore(DB_PATH).init();

let passed = 0;
let failed = 0;
function assert(condition, msg) {
  if (condition) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.error(`  ❌ ${msg}`); }
}

// --- STATS ---
console.log('\n📊 STATS');
const stats = store.getStats();
assert(stats.id === 1, 'Singleton stats exists');
assert(stats.xp === 0, 'Initial XP = 0');
assert(stats.phase === 'puppy', 'Initial phase = puppy');
assert(stats.courage === 0.3, 'Initial courage = 0.3');
assert(typeof stats.trait_phases === 'object', 'trait_phases is parsed JSON');
assert(stats.trait_phases.courage === 'resistance', 'courage phase = resistance');

// --- COMMANDS ---
console.log('\n🎾 COMMANDS');
const cmd1 = store.learnCommand('sit', { category: 'standard' });
assert(cmd1.input === 'sit', 'Command created: sit');
assert(cmd1.category === 'standard', 'Category = standard');
assert(cmd1.understood === 0, 'Not yet understood');

const result = store.markCommandLearned(cmd1.id);
assert(result.xp === 8, 'Learned command → +8 XP');
assert(result.command.understood === 1, 'Now understood');

const cmd2 = store.learnCommand('sit'); // reinforce
assert(cmd2.attempts === 2, 'Attempts incremented to 2');

const cmd3 = store.learnCommand('scan_api', { category: 'custom' });
store.markCommandLearned(cmd3.id);

const allCmds = store.listCommands({ understood: true });
assert(allCmds.length === 2, '2 understood commands');

store.useCommand(cmd1.id, true);
const used = store.getCommand('sit');
assert(used.attempts === 3, 'Attempts = 3 after use');

// --- XP ---
console.log('\n⭐ XP');
const statsAfterXP = store.getStats();
assert(statsAfterXP.xp === 16, 'Total XP = 16 (8+8 for two commands)');
assert(statsAfterXP.level > 0, `Level > 0 (actual: ${statsAfterXP.level})`);

const xpLog = store.getXPLog();
assert(xpLog.length === 2, '2 XP log entries');

const xpByReason = store.getXPByReason();
assert(xpByReason[0].reason === 'command_learned', 'XP by reason works');

// addXP directly
store.addXP(20, 'solved_bug', JSON.stringify({ file: 'api.js', line: 42 }));
assert(store.getStats().xp === 36, 'XP after solved_bug = 36');

try {
  store.addXP(100, 'just_because');
  assert(false, 'Should reject invalid XP reason');
} catch (e) {
  assert(e.message.includes('Invalid XP reason'), 'Rejects invalid XP reason');
}

// --- INTERACTIONS ---
console.log('\n📝 INTERACTIONS');
const intId = store.logInteraction({
  actor: 'owner',
  action_type: 'praise',
  action_detail: 'Good boy!',
  emotion_before: 'playful',
  emotion_after: 'happy',
  context: { text: 'молодец' }
});
assert(typeof intId === 'number', 'Interaction logged');

store.logInteraction({ actor: 'agent:ralph', action_type: 'error', action_detail: '500 in /api' });
store.logInteraction({ actor: 'owner', action_type: 'scold', action_detail: 'No!' });

const history = store.getHistory({ limit: 10 });
assert(history.length === 3, '3 interactions in history');

const praiseCount = store.countByType('praise');
assert(praiseCount === 1, '1 praise interaction');

const ownerHistory = store.getHistory({ actor: 'owner' });
assert(ownerHistory.length === 2, '2 owner interactions');

// --- RELATIONSHIPS ---
console.log('\n🤝 RELATIONSHIPS');
const rel = store.addOrUpdateRelationship('owner', { trust: 0.3, affection: 0.5 });
assert(rel.entity === 'owner', 'Owner relationship created');
assert(rel.trust === 0.3, 'Trust = 0.3');

store.updateTrust('owner', 0.2);
const updatedRel = store.getRelationship('owner');
assert(updatedRel.trust === 0.5, 'Trust updated to 0.5');

store.addOrUpdateRelationship('agent:ralph', { trust: 0.1 });
const allRels = store.listRelationships();
assert(allRels.length === 2, '2 relationships');

// Phase auto-advance: owner has 2 interactions now, need 5 for acquaintance
for (let i = 0; i < 4; i++) store.addOrUpdateRelationship('owner', { trust: 0.5 });
store.updatePhase('owner');
const ownerRel = store.getRelationship('owner');
assert(ownerRel.relationship_phase === 'acquaintance', `Owner phase: ${ownerRel.relationship_phase} (expected acquaintance)`);

// --- FETCH LOG ---
console.log('\n🎾 FETCH LOG');
const fetchId = store.logFetch('file', JSON.stringify({ path: 'config.js', finding: 'hardcoded port' }));
assert(typeof fetchId === 'number', 'Fetch logged');

store.rateFetch(fetchId, 0.9);
const fetch = store.db.prepare('SELECT * FROM fetch_log WHERE id = ?').get(fetchId);
assert(fetch.usefulness_rating === 0.9, 'Fetch rated 0.9');

store.logFetch('junk', JSON.stringify({ content: 'nothing useful' }));
const fetchLog = store.getFetchLog();
assert(fetchLog.length === 2, '2 fetch entries');

const fileFetches = store.getFetchLog({ fetchType: 'file' });
assert(fileFetches.length === 1, '1 file fetch');

// --- LETTERS ---
console.log('\n📜 LETTERS');
const letter = store.createLetter('milestone', 'owner', { message: 'PES reached level 10!', xp: 36 });
assert(letter.letter_type === 'milestone', 'Milestone letter created');
assert(letter.read === 0, 'Letter unread');

const unread = store.getUnreadLetters('owner');
assert(unread.length === 1, '1 unread letter');

store.markLetterRead(letter.id);
const read = store.getUnreadLetters('owner');
assert(read.length === 0, '0 unread after marking read');

// Snapshot
const snapshot = store.createSnapshot();
assert(snapshot.stats.xp === 36, 'Snapshot has correct XP');
assert(snapshot.commands_learned.length === 2, 'Snapshot has 2 commands');
assert(snapshot.total_interactions >= 3, 'Snapshot has interactions');

// --- TRAIT CHANGES ---
console.log('\n🐺 TRAIT CHANGES (White Fang)');
// Set critical period (7 days from now)
store.setCriticalPeriodEnd(new Date(Date.now() + 7 * 86400000).toISOString());

const traitResult = store.updateTrait('courage', 1, 'owner_praise');
assert(traitResult.trait === 'courage', 'Trait update returned');
assert(traitResult.delta > 0, `Positive delta: ${traitResult.delta}`);
assert(traitResult.phase === 'resistance', 'Phase = resistance (first attempt)');
assert(traitResult.newValue > 0.3, `Courage increased: ${traitResult.newValue}`);

// Multiple updates
for (let i = 0; i < 5; i++) store.updateTrait('courage', 1, 'praise');
const courageLog = store.getTraitChangeLog('courage');
assert(courageLog.length === 6, '6 courage change entries');

// --- SESSIONS ---
console.log('\n🔌 SESSIONS');
const sessionId = store.startSession('playful');
assert(typeof sessionId === 'number', 'Session started');

const active = store.getActiveSession();
assert(active !== null, 'Active session exists');
assert(active.mood_start === 'playful', 'Mood start = playful');

const ended = store.endSession(sessionId, 'happy');
assert(ended.moodEnd === 'happy', 'Session ended with mood');
assert(ended.duration >= 0, `Duration: ${ended.duration}s`);

const noActive = store.getActiveSession();
assert(noActive === null, 'No active session after end');

// --- REACTIONS ---
console.log('\n👍 REACTIONS');
store.logReaction({
  pes_action: 'fetch',
  pes_expression: '🐾→🎾→📂config.js',
  reactor: 'owner',
  reaction_type: 'emoji',
  reaction_value: '👍',
  reaction_speed: 5,
  weight: 1.0,
  pattern_tags: ['config_file'],
  platform: 'telegram'
});

store.logReaction({
  pes_action: 'fetch',
  reactor: 'owner',
  reaction_type: 'text',
  reaction_value: 'good find!',
  weight: 0.8,
  platform: 'web'
});

store.logReaction({
  pes_action: 'fetch',
  reactor: 'owner',
  reaction_type: 'emoji',
  reaction_value: '👍',
  weight: 1.0
});

store.logReaction({
  pes_action: 'bark',
  reactor: 'owner',
  reaction_type: 'emoji',
  reaction_value: '👎',
  weight: -1.0
});

const fetchWeight = store.getPatternWeight('fetch');
assert(fetchWeight.count === 3, '3 fetch reactions');
assert(fetchWeight.avgWeight > 0.5, `Positive avg weight: ${fetchWeight.avgWeight}`);

// Recalculate preference
const fetchPref = store.recalculatePreference('fetch');
assert(fetchPref !== null, 'Preference recalculated');
assert(fetchPref.positive > 0, `Positive count: ${fetchPref.positive}`);
console.log(`  📊 fetch behavior: ${fetchPref.behavior}, confidence: ${fetchPref.confidence}`);

const barkPref = store.recalculatePreference('bark');
assert(barkPref.behavior === 'avoid' || barkPref.behavior === 'decrease', `Bark behavior: ${barkPref.behavior}`);

// shouldDo
const shouldFetch = store.shouldDo('fetch');
assert(shouldFetch !== 'avoid' && shouldFetch !== 'never', `Should fetch: ${shouldFetch}`);

const shouldBark = store.shouldDo('bark');
console.log(`  📊 shouldDo bark: ${shouldBark}`);

const shouldUnknown = store.shouldDo('dance');
assert(shouldUnknown === 'neutral', 'Unknown action = neutral');

// --- PREFERENCES ---
console.log('\n⚙️ PREFERENCES');
const pref = store.getPreference('fetch');
assert(pref !== null, 'Fetch preference exists');

const avoided = store.getByBehavior('avoid');
console.log(`  📊 Avoided patterns: ${avoided.length}`);

// --- SUMMARY ---
console.log('\n📋 SUMMARY');
const summary = store.getSummary();
assert(summary.xp === 36, `Summary XP: ${summary.xp}`);
assert(summary.commands_understood === 2, `Commands understood: ${summary.commands_understood}`);
assert(summary.known_entities === 2, `Known entities: ${summary.known_entities}`);
assert(summary.unread_letters === 0, 'No unread letters');
console.log(`  📊 Level: ${summary.level}, Phase: ${summary.phase}`);
console.log(`  📊 Interactions 24h: ${summary.interactions_last_24h}`);
console.log(`  📊 Preferred: ${summary.preferred_patterns}, Avoided: ${summary.avoided_patterns}`);

// --- WILLINGNESS DECAY ---
console.log('\n⏳ WILLINGNESS DECAY');
const beforeDecay = store.getCommand('sit');
console.log(`  Before: willingness = ${beforeDecay.willingness}`);
store.decayWillingness(0); // 0 days = decay everything
const afterDecay = store.getCommand('sit');
assert(afterDecay.willingness < beforeDecay.willingness || afterDecay.willingness === 0.1,
  `After decay: ${afterDecay.willingness}`);

// Cleanup
store.close();
if (existsSync(DB_PATH)) unlinkSync(DB_PATH);

console.log(`\n${'='.repeat(40)}`);
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`${'='.repeat(40)}`);
process.exit(failed > 0 ? 1 : 0);
