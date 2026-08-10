// ============================================================
// Tests: TelegramAdapter
// ============================================================
// Tests the Telegram adapter WITHOUT actual Telegram API calls.
// Mocks the API layer, tests routing, keyword parsing,
// sticker management, lifecycle hooks, and feedback loop.
// ============================================================

import { TelegramAdapter, KEYWORDS, DEFAULT_STICKER_EMOTION_MAP, thinkingDelay } from './telegram.js';
import { PesPlatformAdapter, RENDER_MODE, MEDIA_TYPE, PRESENCE } from './base.js';
import { Pes } from '../core/pes.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, existsSync, rmSync } from 'node:fs';

let testNum = 0;
let passed = 0;
let failed = 0;

function assert(condition, msg) {
  testNum++;
  if (condition) {
    passed++;
    console.log(`  ✅ ${testNum}. ${msg}`);
  } else {
    failed++;
    console.log(`  ❌ ${testNum}. ${msg}`);
  }
}

function section(name) {
  console.log(`\n── ${name} ──`);
}

// ── Test setup ────────────────────────────────────────────

const TEST_DIR = join(tmpdir(), `pes-telegram-test-${Date.now()}`);
mkdirSync(TEST_DIR, { recursive: true });

function makePes(name = 'TestDog') {
  const dbPath = join(TEST_DIR, `${name}-${Date.now()}.db`);
  const pes = new Pes({
    name,
    ownerId: 'nikitron',
    dbPath,
    autoTick: false,
    seed: 0.42,
  });
  pes.birth();
  return pes;
}

function makeAdapter(pes, overrides = {}) {
  const adapter = new TelegramAdapter(pes, {
    botToken: 'FAKE_TOKEN_123',
    chatId: '12345',
    autoListen: false,
    useThinkingDelay: false,
    ...overrides,
  });
  return adapter;
}


// ════════════════════════════════════════════════════════════
// TEST SUITE
// ════════════════════════════════════════════════════════════

console.log('🐾 TelegramAdapter Tests\n');


// ── 1. Constructor ──

section('Constructor');

{
  const pes = makePes('Thor');
  const adapter = makeAdapter(pes);

  assert(adapter instanceof PesPlatformAdapter, 'extends PesPlatformAdapter');
  assert(adapter.platformName === 'telegram', 'platformName = telegram');
  assert(adapter.renderMode === RENDER_MODE.RICH, 'default renderMode = RICH');
  assert(adapter.botToken === 'FAKE_TOKEN_123', 'botToken stored');
  assert(adapter.chatId === '12345', 'chatId stored as string');
  assert(adapter.useThinkingDelay === false, 'useThinkingDelay from config');
  assert(adapter._polling === false, 'polling off initially');
  assert(adapter._currentStickerPack === null, 'no sticker pack initially');

  adapter.destroy();
  pes.destroy();
}

// Constructor validation
{
  const pes = makePes('Thor2');
  let threw = false;
  try { new TelegramAdapter(pes, { chatId: '123' }); }
  catch { threw = true; }
  assert(threw, 'throws without botToken');

  threw = false;
  try { new TelegramAdapter(pes, { botToken: 'tok' }); }
  catch { threw = true; }
  assert(threw, 'throws without chatId');

  pes.destroy();
}


// ── 2. Keyword Matching ──

section('Keyword Matching');

{
  const pes = makePes('KeyDog');
  const adapter = makeAdapter(pes);

  // Track events
  const events = [];
  pes.on('expression', e => events.push(e));

  // Test greeting
  const greetMatches = ['привет', 'Привет!', 'здравствуй', 'хай', 'hi', 'Hello'];
  for (const g of greetMatches) {
    assert(KEYWORDS.greetings.patterns.some(p => p.test(g)), `greeting: "${g}" matches`);
  }

  // Test praise
  const praiseMatches = ['молодец', 'хорошо', 'КЛАСС', 'супер', 'good boy'];
  for (const p of praiseMatches) {
    assert(KEYWORDS.praise.patterns.some(pat => pat.test(p)), `praise: "${p}" matches`);
  }

  // Test scold (note: "нет" and "стоп" use ^ anchor + exact-end patterns)
  const scoldMatches = ['нет', 'плохо', 'стоп', 'фу'];
  for (const s of scoldMatches) {
    const matched = KEYWORDS.scold.patterns.some(p => p.test(s));
    assert(matched, `scold: "${s}" matches`);
  }

  // Test fetch
  const fetchMatches = ['принеси', 'найди config.js', 'fetch'];
  for (const f of fetchMatches) {
    assert(KEYWORDS.fetch.patterns.some(p => p.test(f)), `fetch: "${f}" matches`);
  }

  // Test status
  assert(KEYWORDS.status.patterns.some(p => p.test('как дела')), 'status: "как дела" matches');
  assert(KEYWORDS.status.patterns.some(p => p.test('статус')), 'status: "статус" matches');

  // Non-match
  assert(!KEYWORDS.greetings.patterns.some(p => p.test('code review')), 'non-match: "code review" not a greeting');

  adapter.destroy();
  pes.destroy();
}


// ── 3. Sticker Emotion Map ──

section('Sticker Emotion Map');

{
  assert(DEFAULT_STICKER_EMOTION_MAP.butt_wiggle_turbo === 'happy', 'butt_wiggle_turbo → happy');
  assert(DEFAULT_STICKER_EMOTION_MAP.ears_forward === 'alert', 'ears_forward → alert');
  assert(DEFAULT_STICKER_EMOTION_MAP.sploot === 'relaxed', 'sploot → relaxed');
  assert(DEFAULT_STICKER_EMOTION_MAP.zoomies === 'zoomies', 'zoomies → zoomies');
  assert(DEFAULT_STICKER_EMOTION_MAP.hide_behind === 'scared', 'hide_behind → scared');
}


// ── 4. Thinking Delay ──

section('Thinking Delay');

{
  const puppy = thinkingDelay(5);
  const young = thinkingDelay(30);
  const adult = thinkingDelay(50);
  const experienced = thinkingDelay(70);
  const cyber = thinkingDelay(90);

  assert(puppy >= 2000, `puppy delay >= 2000ms (got ${Math.round(puppy)})`);
  assert(young >= 1000 && young < 2100, `young delay 1000-2000ms (got ${Math.round(young)})`);
  assert(adult >= 500 && adult < 1100, `adult delay 500-1000ms (got ${Math.round(adult)})`);
  assert(experienced >= 200 && experienced < 600, `experienced delay 200-500ms (got ${Math.round(experienced)})`);
  assert(cyber < 210, `cyber delay < 210ms (got ${Math.round(cyber)})`);
}


// ── 5. Render ──

section('Render (formatBody / formatGlyphs)');

{
  const pes = makePes('RenderDog');
  const adapter = makeAdapter(pes);

  // No stickers registered → null
  assert(adapter.formatBody('butt_wiggle_turbo', {}) === null, 'no sticker → null');

  // Register a sticker
  adapter.registerMedia(MEDIA_TYPE.STICKER, 'happy', 'CAACAgI_happy_file_id');
  assert(adapter.formatBody('butt_wiggle_turbo', {}) === 'CAACAgI_happy_file_id',
    'butt_wiggle_turbo → happy sticker via DEFAULT_STICKER_EMOTION_MAP');

  // Direct body key lookup
  adapter.registerMedia(MEDIA_TYPE.STICKER, 'butt_wiggle_turbo', 'CAACAgI_direct_file');
  assert(adapter.formatBody('butt_wiggle_turbo', {}) === 'CAACAgI_direct_file',
    'direct bodyKey lookup takes priority');

  // Default sticker fallback
  adapter.registerMedia(MEDIA_TYPE.STICKER, 'default', 'CAACAgI_default');
  assert(adapter.formatBody('unknown_body_key', {}) === 'CAACAgI_default',
    'unknown bodyKey → default sticker');

  // Voice returns null (text mode for Telegram)
  assert(adapter.formatVoice(null, {}) === null, 'null voiceKey → null');

  // Glyphs
  assert(adapter.formatGlyphs(null, {}) === null, 'null glyphs → null');
  assert(adapter.formatGlyphs([], {}) === null, 'empty glyphs → null');

  adapter.destroy();
  pes.destroy();
}


// ── 6. Media Registry ──

section('Media Registry');

{
  const pes = makePes('MediaDog');
  const adapter = makeAdapter(pes);

  // Load media pack
  adapter.loadMediaPack({
    [MEDIA_TYPE.STICKER]: {
      happy: 'sticker_happy',
      sad: 'sticker_sad',
      sleeping: 'sticker_sleep',
    },
    [MEDIA_TYPE.REACTION]: {
      happy: '❤️',
      alert: '⚡',
    },
  });

  assert(adapter.getMedia(MEDIA_TYPE.STICKER, 'happy') === 'sticker_happy', 'sticker: happy loaded');
  assert(adapter.getMedia(MEDIA_TYPE.STICKER, 'sad') === 'sticker_sad', 'sticker: sad loaded');
  assert(adapter.getMedia(MEDIA_TYPE.REACTION, 'happy') === '❤️', 'reaction: happy loaded');
  assert(adapter.hasMedia(MEDIA_TYPE.STICKER, 'sleeping'), 'hasMedia: sleeping sticker exists');
  assert(!adapter.hasMedia(MEDIA_TYPE.STICKER, 'nonexistent'), 'hasMedia: nonexistent = false');

  const keys = adapter.getMediaKeys(MEDIA_TYPE.STICKER);
  assert(keys.length === 3, `sticker keys count = 3 (got ${keys.length})`);

  adapter.destroy();
  pes.destroy();
}


// ── 7. Message Tracking (feedback bridge) ──

section('Message Tracking & Feedback');

{
  const pes = makePes('FeedbackDog');
  const adapter = makeAdapter(pes);

  // Track messages
  adapter.trackMessage('expr_001', 'tg_msg_100');
  adapter.trackMessage('expr_002', 'tg_msg_101');
  adapter.trackMessage('expr_003', 'tg_msg_102');

  assert(adapter.trackedMessages === 3, 'tracked 3 messages');
  assert(adapter._lookupExpression('tg_msg_100') === 'expr_001', 'lookup: tg_msg_100 → expr_001');
  assert(adapter._lookupExpression('tg_msg_102') === 'expr_003', 'lookup: tg_msg_102 → expr_003');
  assert(adapter._lookupExpression('tg_msg_999') === null, 'lookup: unknown → null');

  // Reaction classification
  assert(adapter._classifyReaction('👍') === 'emoji_positive', '👍 = positive');
  assert(adapter._classifyReaction('👎') === 'emoji_negative', '👎 = negative');
  assert(adapter._classifyReaction('🤷') === 'emoji_neutral', '🤷 = neutral');
  assert(adapter._classifyReaction('hello') === 'text', '"hello" = text');
  assert(adapter._classifyReaction(null) === 'silence', 'null = silence');

  adapter.destroy();
  pes.destroy();
}


// ── 8. Auto-emoji map ──

section('Emoji → Emotion Key Map');

{
  const pes = makePes('EmojiDog');
  const adapter = makeAdapter(pes);

  assert(adapter._emojiToEmotionKey('😊') === 'happy', '😊 → happy');
  assert(adapter._emojiToEmotionKey('😢') === 'sad', '😢 → sad');
  assert(adapter._emojiToEmotionKey('😡') === 'rage', '😡 → rage');
  assert(adapter._emojiToEmotionKey('😴') === 'sleeping', '😴 → sleeping');
  assert(adapter._emojiToEmotionKey('🤔') === 'confused', '🤔 → confused');
  assert(adapter._emojiToEmotionKey('🔥') === 'excited', '🔥 → excited');
  assert(adapter._emojiToEmotionKey('🐾') === 'default', '🐾 → default');
  assert(adapter._emojiToEmotionKey('🌵') === null, '🌵 → null (unknown)');

  adapter.destroy();
  pes.destroy();
}


// ── 9. Delivery Pipeline (mock sendMessage) ──

section('Delivery Pipeline');

{
  const pes = makePes('DeliveryDog');
  const adapter = makeAdapter(pes);

  // Override sendMessage to capture output
  const sent = [];
  adapter.sendMessage = async (output) => {
    sent.push(output);
    return 'msg_' + sent.length;
  };

  adapter._connected = true;

  // Create a fake expression result
  const fakeResult = {
    id: 'test_expr_1',
    expression: {
      bodyKey: 'butt_wiggle_turbo',
      voiceKey: 'roo_roo',
      glyphKeys: ['paw', 'heart'],
      meaning: 'happy',
      renderBody: () => '💫🍑💫',
      renderVoice: () => 'руу-руу-руу!',
      renderGlyphs: () => '🐾❤️',
      render: () => '💫🍑💫 руу-руу-руу! 🐾❤️',
      toJSON: () => ({ bodyKey: 'butt_wiggle_turbo' }),
    },
    priority: 50,
    suppressed: false,
    shouldNotify: false,
    emotionSnapshot: { state: 'happy', intensity: 0.8 },
    platformHints: {},
  };

  // Deliver
  let success;
  (async () => {
    success = await adapter.deliver(fakeResult);
  })().then(() => {
    assert(success === true, 'delivery returned true');
    assert(sent.length === 1, 'sendMessage called once');
    assert(adapter.stats.sent === 1, 'stats.sent = 1');
    assert(adapter.trackedMessages === 1, 'message tracked for feedback');

    // Suppressed expressions should not deliver
    const suppressedResult = { ...fakeResult, suppressed: true };
    adapter.deliver(suppressedResult).then(s => {
      assert(s === false, 'suppressed delivery returns false');
    });
  });
}


// ── 10. Lifecycle Hooks ──

section('Lifecycle Hooks');

{
  const pes = makePes('LifeDog');
  const adapter = makeAdapter(pes);

  const lifecycleEvents = [];
  adapter.on('lifecycle', e => lifecycleEvents.push(e));

  // Override sendMessage (don't actually call API)
  adapter.sendMessage = async () => null;
  adapter._sendText = async () => ({ message_id: 1 });
  adapter._sendSticker = async () => ({ message_id: 2 });

  // Test onBorn
  adapter.onBorn({ name: 'LifeDog', breed: 'corgi' }).then(() => {
    assert(lifecycleEvents.some(e => e.event === 'born'), 'onBorn emits lifecycle:born');
  });

  // Test onWake
  adapter.onWake({ name: 'LifeDog', minutesAway: 120 }).then(() => {
    assert(lifecycleEvents.some(e => e.event === 'wake'), 'onWake emits lifecycle:wake');
  });

  // Test onSleep
  adapter.onSleep({ name: 'LifeDog' }).then(() => {
    assert(lifecycleEvents.some(e => e.event === 'sleep'), 'onSleep emits lifecycle:sleep');
  });

  // Test onLevelUp
  adapter.onLevelUp({ name: 'LifeDog', level: 20, xp: 100 }).then(() => {
    assert(lifecycleEvents.some(e => e.event === 'levelUp'), 'onLevelUp emits lifecycle:levelUp');
  });

  // Test onRunaway
  adapter.onRunaway({
    name: 'LifeDog',
    letter: {
      finalWords: '🐾...💤',
      reason: 'dual_rage',
      snapshot: { total_interactions: 42, commands_learned: 5 },
    }
  }).then(() => {
    assert(lifecycleEvents.some(e => e.event === 'runaway'), 'onRunaway emits lifecycle:runaway');
  });

  // Cleanup after async settles
  setTimeout(() => {
    adapter.destroy();
    pes.destroy();
  }, 100);
}


// ── 11. Status Formatting ──

section('Status Formatting');

{
  const pes = makePes('StatusDog');
  const adapter = makeAdapter(pes);

  // Test bar helper
  assert(adapter._bar(1.0, 10) === '██████████', 'bar(1.0) = all filled');
  assert(adapter._bar(0.0, 10) === '░░░░░░░░░░', 'bar(0.0) = all empty');
  assert(adapter._bar(0.5, 10) === '█████░░░░░', 'bar(0.5) = half');

  adapter.destroy();
  pes.destroy();
}


// ── 12. Update Processing (mocked) ──

section('Update Processing');

(async () => {
  const pes = makePes('UpdateDog');
  const adapter = makeAdapter(pes);

  // Mock API methods
  adapter._sendText = async () => ({ message_id: 1 });
  adapter._sendSticker = async () => ({ message_id: 2 });
  adapter._setReaction = async () => true;

  const pesEvents = [];
  pes.on('expression', e => pesEvents.push(e));

  // Test text message processing
  await adapter._processUpdate({
    message: {
      chat: { id: 12345 },
      message_id: 100,
      text: 'привет',
    }
  });
  assert(adapter._lastOwnerMessageId === 100, 'lastOwnerMessageId updated');
  assert(pesEvents.length > 0, 'PES received event from greeting');

  // Test wrong chat ignored (should not trigger anything)
  await adapter._processUpdate({
    message: {
      chat: { id: 99999 },
      message_id: 200,
      text: 'привет',
    }
  });

  // Test bot command
  adapter._handleBotCommand = async (msg) => {
    assert(msg.text === '/status', 'bot command routed correctly');
  };

  await adapter._processUpdate({
    message: {
      chat: { id: 12345 },
      message_id: 101,
      text: '/status',
    }
  });

  // Test sticker message
  await adapter._processUpdate({
    message: {
      chat: { id: 12345 },
      message_id: 102,
      sticker: { emoji: '😊', file_id: 'sticker_123' },
    }
  });

  // Test reaction update
  adapter.trackMessage('expr_test', '103');
  await adapter._processUpdate({
    message_reaction: {
      chat: { id: 12345 },
      message_id: 103,
      new_reaction: [{ type: 'emoji', emoji: '👍' }],
      user: { id: 12345 },
    }
  });

  adapter.destroy();
  pes.destroy();
})();


// ── 13. PES Integration ──

section('PES Integration');

{
  const pes = makePes('IntDog');
  const adapter = makeAdapter(pes);

  // Verify PES and adapter are properly linked
  assert(adapter.pes === pes, 'adapter.pes points to PES instance');
  assert(adapter.pes.name === 'IntDog', 'adapter.pes.name correct');

  // PES praise → generates expression
  const expressions = [];
  pes.on('expression', e => expressions.push(e));

  pes.praise('good boy');

  // Give it a tick
  setTimeout(() => {
    assert(expressions.length > 0, 'PES praise generated expression');

    adapter.destroy();
    pes.destroy();
  }, 50);
}


// ── 14. Sticker Pack Loading (mock) ──

section('Sticker Pack Loading');

(async () => {
  const pes = makePes('StickerDog');
  const adapter = makeAdapter(pes);

  // Mock _getStickerSet
  adapter._getStickerSet = async (name) => ({
    name,
    stickers: [
      { file_id: 'file_0', emoji: '😊' },
      { file_id: 'file_1', emoji: '😢' },
      { file_id: 'file_2', emoji: '😡' },
      { file_id: 'file_3', emoji: '😴' },
      { file_id: 'file_4', emoji: '🐾' },
    ],
  });

  // Auto-mapping by emoji
  await adapter.loadStickerPack('TestCorgiPack');
  assert(adapter.currentStickerPack === 'TestCorgiPack', 'currentStickerPack set');
  assert(adapter.getMedia(MEDIA_TYPE.STICKER, 'happy') === 'file_0', 'emoji 😊 → happy');
  assert(adapter.getMedia(MEDIA_TYPE.STICKER, 'sad') === 'file_1', 'emoji 😢 → sad');
  assert(adapter.getMedia(MEDIA_TYPE.STICKER, 'rage') === 'file_2', 'emoji 😡 → rage');
  assert(adapter.getMedia(MEDIA_TYPE.STICKER, 'sleeping') === 'file_3', 'emoji 😴 → sleeping');
  assert(adapter.getMedia(MEDIA_TYPE.STICKER, 'default') === 'file_4', 'emoji 🐾 → default');
  assert(adapter.getMedia(MEDIA_TYPE.STICKER, 'pack_0') === 'file_0', 'pack_0 stored');

  // Explicit mapping
  await adapter.loadStickerPack('ExplicitPack', { 0: 'custom_happy', 2: 'custom_angry' });
  assert(adapter.getMedia(MEDIA_TYPE.STICKER, 'custom_happy') === 'file_0', 'explicit: 0 → custom_happy');
  assert(adapter.getMedia(MEDIA_TYPE.STICKER, 'custom_angry') === 'file_2', 'explicit: 2 → custom_angry');

  // Empty pack throws
  adapter._getStickerSet = async () => ({ name: 'empty', stickers: [] });
  try {
    await adapter.loadStickerPack('EmptyPack');
    assert(false, 'empty pack should throw');
  } catch (err) {
    assert(err.message.includes('empty'), 'empty pack throws error');
  }

  adapter.destroy();
  pes.destroy();
})();


// ── 15. Command Handling ──

section('Command Handling');

{
  const pes = makePes('CmdDog');
  const adapter = makeAdapter(pes);

  adapter._sendText = async () => ({ message_id: 1 });

  // /start on alive PES
  adapter._cmdStart({ chat: { id: 12345 } }).then(() => {
    assert(pes.isAlive, 'PES alive after /start');
  });

  // /silent toggle
  const wasSilent = pes.engine?.silentMode || false;
  adapter._cmdSilent({}).then(() => {
    assert((pes.engine?.silentMode || false) !== wasSilent, 'silent mode toggled');
  });

  setTimeout(() => {
    adapter.destroy();
    pes.destroy();
  }, 100);
}


// ── 16. Edge Cases ──

section('Edge Cases');

{
  const pes = makePes('EdgeDog');
  const adapter = makeAdapter(pes);

  // Deliver null → false
  adapter.deliver(null).then(r => assert(r === false, 'deliver(null) = false'));
  adapter.deliver({ suppressed: true }).then(r => assert(r === false, 'deliver(suppressed) = false'));

  // Render null expression → null
  assert(adapter.renderExpression(null) === null, 'renderExpression(null) = null');
  assert(adapter.renderExpression({ expression: null }) === null, 'renderExpression({expression:null}) = null');

  // chatId as number → stored as string
  const adapter2 = new TelegramAdapter(pes, {
    botToken: 'tok',
    chatId: 67890,
    autoListen: false,
  });
  assert(adapter2.chatId === '67890', 'chatId number → string');

  adapter.destroy();
  adapter2.destroy();
  pes.destroy();
}


// ── Summary ──

setTimeout(() => {
  console.log(`\n════════════════════════════════════════`);
  console.log(`  TOTAL: ${passed + failed} tests`);
  console.log(`  ✅ Passed: ${passed}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log(`════════════════════════════════════════\n`);

  // Cleanup
  try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch (_) {}

  if (failed > 0) process.exit(1);
}, 500);
