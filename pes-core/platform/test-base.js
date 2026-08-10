// ============================================================
// Tests for PES Platform — Base Adapter
// ============================================================

import { strict as assert } from 'node:assert';
import { EventEmitter } from 'node:events';
import { PesPlatformAdapter, RENDER_MODE, PRESENCE, MEDIA_TYPE } from './base.js';

let passed = 0;
let total = 0;

function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    console.log(`  ❌ ${name}: ${err.message}`);
  }
}

async function testAsync(name, fn) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    console.log(`  ❌ ${name}: ${err.message}`);
  }
}


// ── Mock PES ────────────────────────────────────────────────

class MockPes extends EventEmitter {
  constructor() {
    super();
    this.name = 'Тестик';
    this.ownerId = 'nikitron';
    this.mode = 'active';
    this._reactions = [];
  }

  react(expressionId, reaction) {
    this._reactions.push({ expressionId, reaction });
  }
}


// ── Test Adapter (concrete implementation) ──────────────────

class TestAdapter extends PesPlatformAdapter {
  constructor(pes, config = {}) {
    super(pes, { platformName: 'test', ...config });
    this.sentMessages = [];
    this.collecting = false;
    this.presenceState = null;
  }

  async sendMessage(output) {
    const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.sentMessages.push({ output, msgId });
    return msgId;
  }

  async startCollecting() {
    this.collecting = true;
  }

  async stopCollecting() {
    this.collecting = false;
  }

  async setPresence(state) {
    this.presenceState = state;
  }
}


// ── Mock ExpressionResult ───────────────────────────────────

function mockExpressionResult(overrides = {}) {
  const mockExpression = {
    bodyKey: 'butt_wiggle_fast',
    voiceKey: 'bark_excitement',
    glyphKeys: ['paw', 'arrow', 'heart'],
    renderBody() { return '~🍑~🍑~'; },
    renderVoice() { return 'ГАВгавгавгавГАВ!'; },
    renderGlyphs() { return '🐾→💛'; },
    toJSON() {
      return {
        id: this.id || 'expr_test',
        bodyKey: this.bodyKey,
        voiceKey: this.voiceKey,
        glyphKeys: this.glyphKeys,
      };
    },
    ...overrides.expression,
  };

  return {
    id: 'er_test_001',
    expression: mockExpression,
    priority: 50,
    triggerName: 'owner_returned',
    combo: null,
    suppressed: false,
    shouldNotify: false,
    emotionSnapshot: { current: 'happy', intensity: 0.7 },
    platformHints: {},
    timestamp: Date.now(),
    ...overrides,
  };
}


// ── TESTS ───────────────────────────────────────────────────

console.log('\n══════ PesPlatformAdapter — Constructor ══════');

test('creates adapter with pes', () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);
  assert.equal(adapter.platformName, 'test');
  assert.equal(adapter.renderMode, RENDER_MODE.FULL);
  assert.equal(adapter.isConnected, false);
});

test('throws without pes', () => {
  assert.throws(() => new TestAdapter(null), /requires a Pes instance/);
});

test('custom config', () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes, { renderMode: RENDER_MODE.COMPACT });
  assert.equal(adapter.renderMode, RENDER_MODE.COMPACT);
});

test('initial stats are zero', () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);
  assert.deepEqual(adapter.deliveryStats, { sent: 0, failed: 0, reactions: 0 });
});


console.log('\n══════ Media Registry ══════');

test('registerMedia and getMedia', () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);
  adapter.registerMedia(MEDIA_TYPE.STICKER, 'butt_wiggle_fast', 'sticker_file_id_123');
  assert.equal(adapter.getMedia(MEDIA_TYPE.STICKER, 'butt_wiggle_fast'), 'sticker_file_id_123');
});

test('getMedia returns null for missing', () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);
  assert.equal(adapter.getMedia(MEDIA_TYPE.STICKER, 'nonexistent'), null);
});

test('loadMediaPack — bulk load', () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);
  adapter.loadMediaPack({
    [MEDIA_TYPE.STICKER]: {
      'butt_wiggle_fast': 'sticker_1',
      'sploot': 'sticker_2',
      'play_bow': 'sticker_3',
    },
    [MEDIA_TYPE.SOUND]: {
      'bark_excitement': 'bark.ogg',
      'whine': 'whine.ogg',
    },
    [MEDIA_TYPE.REACTION]: {
      'happy': '❤️',
      'angry': '😡',
    },
  });

  assert.equal(adapter.getMedia(MEDIA_TYPE.STICKER, 'butt_wiggle_fast'), 'sticker_1');
  assert.equal(adapter.getMedia(MEDIA_TYPE.STICKER, 'sploot'), 'sticker_2');
  assert.equal(adapter.getMedia(MEDIA_TYPE.SOUND, 'bark_excitement'), 'bark.ogg');
  assert.equal(adapter.getMedia(MEDIA_TYPE.REACTION, 'happy'), '❤️');
});

test('hasMedia', () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);
  adapter.registerMedia(MEDIA_TYPE.STICKER, 'test_key', 'value');
  assert.equal(adapter.hasMedia(MEDIA_TYPE.STICKER, 'test_key'), true);
  assert.equal(adapter.hasMedia(MEDIA_TYPE.STICKER, 'missing'), false);
});

test('getMediaKeys', () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);
  adapter.registerMedia(MEDIA_TYPE.STICKER, 'a', '1');
  adapter.registerMedia(MEDIA_TYPE.STICKER, 'b', '2');
  const keys = adapter.getMediaKeys(MEDIA_TYPE.STICKER);
  assert.deepEqual(keys, ['a', 'b']);
});


console.log('\n══════ Render Expression — FULL mode ══════');

test('renders full expression with text fallback', () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);
  const result = mockExpressionResult();
  const output = adapter.renderExpression(result);

  assert.ok(output);
  assert.equal(output.text, '🐾→💛');
  assert.equal(output.sticker, '~🍑~🍑~');  // falls back to renderBody()
  assert.ok(output.meta.voiceText);
  assert.equal(output.expressionId, 'er_test_001');
});

test('renders with sticker from registry', () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);
  adapter.registerMedia(MEDIA_TYPE.STICKER, 'butt_wiggle_fast', 'CAACAgI_corgi_wiggle');

  const result = mockExpressionResult();
  const output = adapter.renderExpression(result);

  assert.equal(output.sticker, 'CAACAgI_corgi_wiggle');
});

test('renders with sticker from emotion fallback', () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);
  adapter.registerMedia(MEDIA_TYPE.STICKER, 'happy', 'CAACAgI_happy_corgi');

  const result = mockExpressionResult();
  const output = adapter.renderExpression(result);

  // bodyKey 'butt_wiggle_fast' not in registry, but emotion 'happy' is
  assert.equal(output.sticker, 'CAACAgI_happy_corgi');
});

test('renders with sound from registry', () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);
  adapter.registerMedia(MEDIA_TYPE.SOUND, 'bark_excitement', 'bark.ogg');

  const result = mockExpressionResult();
  const output = adapter.renderExpression(result);

  assert.equal(output.sound, 'bark.ogg');
  assert.ok(output.meta.voiceText);
});

test('renders reaction from emotion registry', () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);
  adapter.registerMedia(MEDIA_TYPE.REACTION, 'happy', '🐾');

  const result = mockExpressionResult();
  const output = adapter.renderExpression(result);

  assert.equal(output.reaction, '🐾');
});

test('renders reaction from platformHints', () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);

  const result = mockExpressionResult({ platformHints: { reaction: '🔥' } });
  const output = adapter.renderExpression(result);

  assert.equal(output.reaction, '🔥');
});

test('null expression returns null', () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);
  assert.equal(adapter.renderExpression(null), null);
  assert.equal(adapter.renderExpression({ expression: null }), null);
});


console.log('\n══════ Render Expression — COMPACT mode ══════');

test('compact mode: only glyphs', () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes, { renderMode: RENDER_MODE.COMPACT });

  const result = mockExpressionResult();
  const output = adapter.renderExpression(result);

  assert.equal(output.text, '🐾→💛');
  assert.equal(output.sticker, null);  // no body in compact
  assert.equal(output.sound, null);     // no voice in compact
});


console.log('\n══════ Render Expression — DEBUG mode ══════');

test('debug mode: includes internal state', () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes, { renderMode: RENDER_MODE.DEBUG });

  const result = mockExpressionResult();
  const output = adapter.renderExpression(result);

  assert.ok(output.meta.emotion);
  assert.equal(output.meta.triggerName, 'owner_returned');
  assert.equal(output.meta.emotion.current, 'happy');
});


console.log('\n══════ Render Expression — RICH mode ══════');

test('rich mode: sticker + caption', () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes, { renderMode: RENDER_MODE.RICH });
  adapter.registerMedia(MEDIA_TYPE.STICKER, 'butt_wiggle_fast', 'sticker_rich');

  const result = mockExpressionResult();
  const output = adapter.renderExpression(result);

  assert.equal(output.sticker, 'sticker_rich');
  assert.ok(output.meta.caption);
});


console.log('\n══════ Delivery ══════');

await testAsync('deliver sends message and tracks', async () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);

  const result = mockExpressionResult();
  const success = await adapter.deliver(result);

  assert.equal(success, true);
  assert.equal(adapter.stats.sent, 1);
  assert.equal(adapter.sentMessages.length, 1);
  assert.equal(adapter.trackedMessages, 1);
});

await testAsync('deliver skips suppressed', async () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);

  const result = mockExpressionResult({ suppressed: true });
  const success = await adapter.deliver(result);

  assert.equal(success, false);
  assert.equal(adapter.stats.sent, 0);
});

await testAsync('deliver tracks failure', async () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);
  // Override sendMessage to throw
  adapter.sendMessage = async () => { throw new Error('network error'); };

  const result = mockExpressionResult();
  const success = await adapter.deliver(result);

  assert.equal(success, false);
  assert.equal(adapter.stats.failed, 1);
});

await testAsync('deliver null returns false', async () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);
  assert.equal(await adapter.deliver(null), false);
});


console.log('\n══════ Feedback Bridge ══════');

await testAsync('onUserReaction feeds back to PES', async () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);

  // Deliver a message first to create tracking
  const result = mockExpressionResult();
  await adapter.deliver(result);

  // Get the platform message ID
  const msgId = adapter.sentMessages[0].msgId;

  // Simulate owner reaction
  adapter.onUserReaction(msgId, '👍', 'nikitron', { isOwner: true, speed_ms: 2000 });

  assert.equal(pes._reactions.length, 1);
  assert.equal(pes._reactions[0].expressionId, 'er_test_001');
  assert.equal(pes._reactions[0].reaction.from, 'owner');
  assert.equal(pes._reactions[0].reaction.type, 'emoji_positive');
  assert.equal(pes._reactions[0].reaction.value, '👍');
  assert.equal(adapter.stats.reactions, 1);
});

test('onUserReaction — unknown message ignored', () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);
  adapter.onUserReaction('unknown_msg', '👍', 'nikitron');
  assert.equal(pes._reactions.length, 0);
});

await testAsync('onUserReaction — group member', async () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);

  const result = mockExpressionResult();
  await adapter.deliver(result);
  const msgId = adapter.sentMessages[0].msgId;

  adapter.onUserReaction(msgId, '😂', 'dev1', { isOwner: false });

  assert.equal(pes._reactions[0].reaction.from, 'group:dev1');
  assert.equal(pes._reactions[0].reaction.type, 'emoji_positive');
});

await testAsync('onUserReaction — negative emoji', async () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);

  const result = mockExpressionResult();
  await adapter.deliver(result);
  const msgId = adapter.sentMessages[0].msgId;

  adapter.onUserReaction(msgId, '👎', 'nikitron', { isOwner: true });

  assert.equal(pes._reactions[0].reaction.type, 'emoji_negative');
});

await testAsync('onUserReaction — text reaction', async () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);

  const result = mockExpressionResult();
  await adapter.deliver(result);
  const msgId = adapter.sentMessages[0].msgId;

  adapter.onUserReaction(msgId, 'молодец!', 'nikitron', { isOwner: true });

  assert.equal(pes._reactions[0].reaction.type, 'text');
  assert.equal(pes._reactions[0].reaction.value, 'молодец!');
});


console.log('\n══════ Reaction Classification ══════');

test('classifies positive emojis', () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);
  assert.equal(adapter._classifyReaction('👍'), 'emoji_positive');
  assert.equal(adapter._classifyReaction('❤️'), 'emoji_positive');
  assert.equal(adapter._classifyReaction('🔥'), 'emoji_positive');
  assert.equal(adapter._classifyReaction('😂'), 'emoji_positive');
  assert.equal(adapter._classifyReaction('💯'), 'emoji_positive');
});

test('classifies negative emojis', () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);
  assert.equal(adapter._classifyReaction('👎'), 'emoji_negative');
  assert.equal(adapter._classifyReaction('😡'), 'emoji_negative');
  assert.equal(adapter._classifyReaction('💩'), 'emoji_negative');
});

test('classifies text', () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);
  assert.equal(adapter._classifyReaction('молодец'), 'text');
  assert.equal(adapter._classifyReaction('плохо'), 'text');
});

test('classifies silence', () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);
  assert.equal(adapter._classifyReaction(null), 'silence');
  assert.equal(adapter._classifyReaction(''), 'silence');
});


console.log('\n══════ Message Tracking ══════');

test('trackMessage and lookup', () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);
  adapter.trackMessage('expr_1', 'msg_1');
  adapter.trackMessage('expr_2', 'msg_2');

  assert.equal(adapter._lookupExpression('msg_1'), 'expr_1');
  assert.equal(adapter._lookupExpression('msg_2'), 'expr_2');
  assert.equal(adapter._lookupExpression('msg_3'), null);
});

test('trackMessage evicts oldest when full', () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);
  adapter.messageMapMaxSize = 3;

  adapter.trackMessage('expr_1', 'msg_1');
  adapter.trackMessage('expr_2', 'msg_2');
  adapter.trackMessage('expr_3', 'msg_3');
  adapter.trackMessage('expr_4', 'msg_4');  // should evict msg_1

  assert.equal(adapter._lookupExpression('msg_1'), null);  // evicted
  assert.equal(adapter._lookupExpression('msg_4'), 'expr_4');
  assert.equal(adapter.trackedMessages, 3);
});


console.log('\n══════ Listening ══════');

await testAsync('startListening sets connected and presence', async () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);

  await adapter.startListening();

  assert.equal(adapter.isConnected, true);
  assert.equal(adapter.collecting, true);
  assert.equal(adapter.presenceState, PRESENCE.ONLINE);
});

await testAsync('stopListening disconnects', async () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);

  await adapter.startListening();
  await adapter.stopListening();

  assert.equal(adapter.isConnected, false);
  assert.equal(adapter.collecting, false);
  assert.equal(adapter.presenceState, PRESENCE.OFFLINE);
});


console.log('\n══════ Auto-delivery on PES expression event ══════');

await testAsync('auto-delivers when connected', async () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);
  await adapter.startListening();

  // Simulate PES emitting an expression
  const result = mockExpressionResult();
  pes.emit('expression', result);

  // Wait for async delivery
  await new Promise(r => setTimeout(r, 50));

  assert.equal(adapter.sentMessages.length, 1);
  assert.equal(adapter.stats.sent, 1);
});

await testAsync('does not deliver when disconnected', async () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);
  // NOT connected

  const result = mockExpressionResult();
  pes.emit('expression', result);

  await new Promise(r => setTimeout(r, 50));

  assert.equal(adapter.sentMessages.length, 0);
});


console.log('\n══════ Lifecycle Events ══════');

await testAsync('onBorn emits lifecycle event', async () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);

  let received = null;
  adapter.on('lifecycle', (data) => { received = data; });

  pes.emit('born', { name: 'Тестик' });
  await new Promise(r => setTimeout(r, 20));

  assert.ok(received);
  assert.equal(received.event, 'born');
});

await testAsync('onWake sets presence ONLINE', async () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);

  pes.emit('wake', {});
  await new Promise(r => setTimeout(r, 20));

  assert.equal(adapter.presenceState, PRESENCE.ONLINE);
});

await testAsync('onSleep sets presence SLEEPING', async () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);

  pes.emit('sleep', {});
  await new Promise(r => setTimeout(r, 20));

  assert.equal(adapter.presenceState, PRESENCE.SLEEPING);
});

await testAsync('onRunaway sets presence OFFLINE', async () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);

  pes.emit('runaway', { letter: 'прощай' });
  await new Promise(r => setTimeout(r, 20));

  assert.equal(adapter.presenceState, PRESENCE.OFFLINE);
});

await testAsync('onModeChange updates presence', async () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);

  pes.emit('modeChange', { oldMode: 'active', newMode: 'idle' });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(adapter.presenceState, PRESENCE.IDLE);

  pes.emit('modeChange', { oldMode: 'idle', newMode: 'sleeping' });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(adapter.presenceState, PRESENCE.SLEEPING);
});


console.log('\n══════ Render Mode ══════');

test('setRenderMode changes mode', () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);
  adapter.setRenderMode(RENDER_MODE.DEBUG);
  assert.equal(adapter.renderMode, RENDER_MODE.DEBUG);
});

test('setRenderMode ignores invalid', () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);
  adapter.setRenderMode('invalid_mode');
  assert.equal(adapter.renderMode, RENDER_MODE.FULL);  // unchanged
});


console.log('\n══════ Destroy ══════');

test('destroy cleans up', () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);
  adapter.trackMessage('e1', 'm1');

  adapter.destroy();

  assert.equal(adapter.isConnected, false);
  assert.equal(adapter.trackedMessages, 0);
});


console.log('\n══════ Custom Emoji in Glyphs ══════');

test('custom emoji replaces default glyphs', () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);
  adapter.registerMedia(MEDIA_TYPE.EMOJI, 'paw', '🐕');  // custom emoji for 'paw' glyph

  const result = mockExpressionResult();
  const output = adapter.renderExpression(result);

  // Should contain custom emoji
  assert.ok(output.text.includes('🐕'));
});


console.log('\n══════ Format Methods ══════');

test('formatBody — no body returns null', () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);
  assert.equal(adapter.formatBody(null, {}), null);
});

test('formatVoice — no voice returns null', () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);
  assert.equal(adapter.formatVoice(null, {}), null);
});

test('formatGlyphs — empty returns null', () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);
  assert.equal(adapter.formatGlyphs([], {}), null);
  assert.equal(adapter.formatGlyphs(null, {}), null);
});

test('formatReaction — null returns null', () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);
  assert.equal(adapter.formatReaction(null), null);
});

test('formatAnimation — with registry', () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);
  adapter.registerMedia(MEDIA_TYPE.ANIMATION, 'butt_wiggle_fast', 'corgi_run.gif');

  const result = mockExpressionResult();
  assert.equal(adapter.formatAnimation('butt_wiggle_fast', result), 'corgi_run.gif');
});

test('formatAnimation — emotion fallback', () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);
  adapter.registerMedia(MEDIA_TYPE.ANIMATION, 'happy', 'happy_corgi.gif');

  const result = mockExpressionResult();
  assert.equal(adapter.formatAnimation('unknown_body', result), 'happy_corgi.gif');
});


console.log('\n══════ Events Emitted ══════');

await testAsync('emits delivered event', async () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);

  let deliveredEvent = null;
  adapter.on('delivered', (data) => { deliveredEvent = data; });

  await adapter.deliver(mockExpressionResult());

  assert.ok(deliveredEvent);
  assert.equal(deliveredEvent.expressionId, 'er_test_001');
  assert.ok(deliveredEvent.messageId);
});

await testAsync('emits deliveryFailed event', async () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);
  adapter.sendMessage = async () => { throw new Error('timeout'); };

  let failedEvent = null;
  adapter.on('deliveryFailed', (data) => { failedEvent = data; });

  await adapter.deliver(mockExpressionResult());

  assert.ok(failedEvent);
  assert.equal(failedEvent.error, 'timeout');
});

await testAsync('emits reactionProcessed event', async () => {
  const pes = new MockPes();
  const adapter = new TestAdapter(pes);

  let reactionEvent = null;
  adapter.on('reactionProcessed', (data) => { reactionEvent = data; });

  await adapter.deliver(mockExpressionResult());
  const msgId = adapter.sentMessages[0].msgId;
  adapter.onUserReaction(msgId, '🔥', 'nikitron');

  assert.ok(reactionEvent);
  assert.equal(reactionEvent.reaction, '🔥');
});


console.log('\n══════ Constants ══════');

test('RENDER_MODE constants', () => {
  assert.equal(RENDER_MODE.FULL, 'full');
  assert.equal(RENDER_MODE.COMPACT, 'compact');
  assert.equal(RENDER_MODE.RICH, 'rich');
  assert.equal(RENDER_MODE.DEBUG, 'debug');
});

test('PRESENCE constants', () => {
  assert.equal(PRESENCE.ONLINE, 'online');
  assert.equal(PRESENCE.TYPING, 'typing');
  assert.equal(PRESENCE.SLEEPING, 'sleeping');
  assert.equal(PRESENCE.OFFLINE, 'offline');
});

test('MEDIA_TYPE constants', () => {
  assert.equal(MEDIA_TYPE.STICKER, 'sticker');
  assert.equal(MEDIA_TYPE.ANIMATION, 'animation');
  assert.equal(MEDIA_TYPE.SOUND, 'sound');
  assert.equal(MEDIA_TYPE.EMOJI, 'emoji');
  assert.equal(MEDIA_TYPE.REACTION, 'reaction');
});


// ── SUMMARY ─────────────────────────────────────────────────

console.log(`\n${'═'.repeat(50)}`);
console.log(`  РЕЗУЛЬТАТ: ${passed}/${total} тестов пройдено`);
console.log(`${'═'.repeat(50)}\n`);

if (passed !== total) process.exit(1);
