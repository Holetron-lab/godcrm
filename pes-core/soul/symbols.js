/**
 * PES Soul — Symbol Composer (главный модуль выражения)
 *
 * Собирает всё воедино: тело + голос + символы + диалект + следы.
 * Импортирует из разбитых модулей:
 *   body.js      — позы корги (23 шт)
 *   voice.js     — звуки корги (18 шт)
 *   glyphs.js    — визуальные символы (46 шт), тиры, уровни
 *   dialect.js   — уникальный язык каждого ПЕС
 *   trace.js     — "написала где-то" (следы в системе)
 *   expression.js — одно высказывание (3 канала)
 */

import { BODY, BODY_MAP } from './body.js';
import { VOICE, VOICE_MAP } from './voice.js';
import { GLYPHS, ARROW, getTier, getAvailableGlyphs, getMaxChainLength, PUPPY_GLYPH_MAP } from './glyphs.js';
import { PesDialect } from './dialect.js';
import { TRACE_TYPES, PesTrace } from './trace.js';
import { PesExpression } from './expression.js';


class SymbolComposer {
  constructor() {
    this.history = [];
    this.maxHistory = 200;
    this.traces = [];
    this.dialect = new PesDialect();
  }

  // ── Главные методы выражения ──

  /**
   * ПЕС выражает текущее эмоциональное состояние.
   * Комбинирует тело + голос + символы в зависимости от эмоции и уровня.
   */
  express(emotionState, level, context = {}) {
    const tier = getTier(level);
    const bodyKey = this._pickBody(emotionState, tier);
    const voiceKey = this._pickVoice(emotionState, tier);
    const glyphKeys = this._pickGlyphs(emotionState, level, tier, context);

    const expr = new PesExpression({
      bodyKey,
      voiceKey,
      glyphKeys,
      meaning: emotionState,
      context,
      confidence: this._calcConfidence(level, tier),
      level,
    });

    this._addToHistory(expr);
    return expr;
  }

  /**
   * ПЕС нашёл что-то — техническое обнаружение.
   * @param {string} type - 'bug', 'file', 'pattern', 'security', 'performance', 'prediction'
   */
  expressDiscovery(type, level, context = {}) {
    const tier = getTier(level);
    const bodyKey = this.dialect.prefer('body', ['ears_forward', 'nose_nudge', 'low_crouch']);

    const voiceCandidates = {
      bug:         ['bark_alert', 'grumble', 'bark_muffled'],
      file:        ['pig_grunt', 'bark_muffled', 'grumble'],
      pattern:     ['roo_roo', 'mumble', 'grumble'],
      security:    ['bark_alert', 'bark_alert', 'howl'],
      performance: ['huff', 'grumble', 'bark_frustration'],
      prediction:  ['whine', 'howl', 'roo_roo'],
    };
    const voiceKey = this.dialect.prefer('voice', voiceCandidates[type] || ['bark_alert']);
    const glyphKeys = this._buildDiscoveryGlyphs(type, level, tier, context);

    const expr = new PesExpression({
      bodyKey,
      voiceKey,
      glyphKeys,
      meaning: `discovery_${type}`,
      context,
      confidence: this._calcConfidence(level, tier),
      level,
    });

    this._addToHistory(expr);
    return expr;
  }

  /**
   * ПЕС принёс что-то (fetch). МОЖЕТ БЫТЬ ЧТО УГОДНО.
   * @param {string} quality - 'junk', 'maybe', 'useful', 'gold', 'abstract'
   */
  expressFetch(quality, level, context = {}) {
    const tier = getTier(level);

    const bodyOptions = quality === 'junk'
      ? ['butt_wiggle_slow', 'paw_tap']
      : quality === 'gold' || quality === 'abstract'
        ? ['butt_wiggle_turbo', 'bunny_hop', 'spin']
        : ['butt_wiggle_fast', 'nose_nudge'];
    const bodyKey = this.dialect.prefer('body', bodyOptions);

    const voiceOptions = {
      junk:     ['bark_play', 'pig_grunt', 'huff'],
      maybe:    ['bark_play', 'roo_roo', 'mumble'],
      useful:   ['roo_roo', 'bark_excitement', 'bark_demand'],
      gold:     ['bark_excitement', 'roo_roo', 'scream'],
      abstract: ['roo_roo', 'howl', 'mumble'],
    };
    const voiceKey = this.dialect.prefer('voice', voiceOptions[quality] || voiceOptions.junk);
    const glyphKeys = this._buildFetchGlyphs(quality, level, tier, context);

    const expr = new PesExpression({
      bodyKey,
      voiceKey,
      glyphKeys,
      meaning: `fetch_${quality}`,
      context,
      confidence: this._qualityToConfidence(quality),
      level,
    });

    this._addToHistory(expr);
    return expr;
  }

  /**
   * Социальное взаимодействие — встреча с другим ПЕС или агентом.
   */
  expressSocial(event, level, context = {}) {
    const socialMap = {
      meet_pes:   { body: ['nose_nudge', 'ears_forward', 'side_eye'], voice: ['pig_grunt', 'grumble', 'whine'], glyphs: ['paw', 'nose', 'arrow', 'other_pes'] },
      play_pes:   { body: ['play_bow', 'butt_wiggle_fast', 'bunny_hop'], voice: ['bark_play', 'roo_roo', 'yip'], glyphs: ['paw', 'ball', 'other_pes', 'heart'] },
      fight_pes:  { body: ['ears_forward', 'low_crouch'], voice: ['bark_alert', 'bark_herding'], glyphs: ['paw', 'fight', 'other_pes'] },
      flee_pes:   { body: ['no_wiggle', 'hide_behind'], voice: ['whine', 'sigh'], glyphs: ['other_pes', 'dots', 'dots', 'dots'] },
      scared_pes: { body: ['ears_flat', 'hide_behind', 'belly_up'], voice: ['whine', 'yip', 'scream'], glyphs: ['other_pes', 'arrow', 'fire', 'arrow', 'sad'] },
      agent_call: { body: ['ears_forward', 'butt_wiggle_slow'], voice: ['bark_muffled', 'grumble'], glyphs: ['robot', 'arrow', 'paw', 'exclaim'] },
      dual_rage:  { body: ['low_crouch', 'ears_forward'], voice: ['bark_alert', 'scream', 'howl'], glyphs: ['fire', 'fire', 'fight', 'fire', 'fire'] },
    };

    const map = socialMap[event] || socialMap.meet_pes;
    const bodyKey = this.dialect.prefer('body', map.body);
    const voiceKey = this.dialect.prefer('voice', map.voice);

    const expr = new PesExpression({
      bodyKey,
      voiceKey,
      glyphKeys: map.glyphs,
      meaning: `social_${event}`,
      context,
      confidence: 0.9,
      level,
    });

    this._addToHistory(expr);
    return expr;
  }

  // ── Следы ("Написала где-то") ──

  leaveTrace(level, context = {}) {
    const tier = getTier(level);

    const traceMessages = {
      puppy:       ['🐾 тут был', '🐾❗', '🐾...', '🐾👃'],
      young:       ['🐾 пахнет странно', '🐾 видел тут что-то', '🐾→❓'],
    };

    let message;
    if (tier === 'puppy' || tier === 'young') {
      const msgs = traceMessages[tier];
      message = msgs[Math.floor(Math.random() * msgs.length)];
    } else {
      const parts = ['🐾'];
      if (context.file) parts.push(`→${context.file}`);
      if (context.bug) parts.push('→🐛');
      if (context.description) parts.push(`[${context.description}]`);
      if (context.line) parts.push(`L${context.line}`);
      message = parts.join('');
    }

    const traceTypeOptions = ['code_comment', 'log_entry', 'file_mark', 'hidden_note', 'console_message'];
    if (level >= 40) traceTypeOptions.push('metadata', 'db_note');
    const traceType = traceTypeOptions[Math.floor(Math.random() * traceTypeOptions.length)];

    const trace = new PesTrace(traceType, message, context.file || 'unknown', level);
    this.traces.push(trace);
    return trace;
  }

  getUndiscoveredTraces() {
    return this.traces.filter(t => !t.discovered);
  }

  discoverTrace(traceId) {
    const trace = this.traces.find(t => t.id === traceId);
    if (trace) {
      trace.discovered = true;
      return true;
    }
    return false;
  }

  // ── Свободная композиция (30+ уровень) ──

  compose(glyphKeys, meaning, level, context = {}) {
    if (level < 30) return null;

    const available = getAvailableGlyphs(level);
    const valid = glyphKeys.every(k =>
      k === 'arrow' || k === '→' || k.startsWith('raw:') || available[k]
    );
    if (!valid) return null;

    const maxLen = getMaxChainLength(level);
    if (glyphKeys.length > maxLen) return null;

    const expr = new PesExpression({
      glyphKeys,
      meaning,
      context,
      confidence: this._calcConfidence(level, getTier(level)),
      level,
    });

    this._addToHistory(expr);

    this.dialect.glyphCombos.push({
      keys: [...glyphKeys],
      meaning,
      created_at: Date.now(),
    });

    return expr;
  }

  teachMeaning(glyphKeys, meaning) {
    this.dialect.teachMeaning(glyphKeys, meaning);
    return true;
  }

  // ── История ──

  getHistory(n = 10) {
    return this.history.slice(-n);
  }

  getRenderedHistory(n = 10) {
    return this.getHistory(n).map(e => e.render());
  }

  // ── Сохранение / загрузка ──

  save() {
    return {
      history: this.history.map(e => e.toJSON()),
      traces: this.traces.map(t => t.toJSON()),
      dialect: this.dialect.save(),
    };
  }

  load(data) {
    if (!data) return;

    if (data.dialect) {
      this.dialect.load(data.dialect);
    }

    if (data.traces) {
      this.traces = data.traces.map(t => {
        const trace = new PesTrace(t.type, t.message, t.location, t.pesLevel);
        trace.id = t.id;
        trace.timestamp = t.timestamp;
        trace.discovered = t.discovered;
        return trace;
      });
    }

    if (data.history) {
      this.history = data.history.map(h => {
        const expr = new PesExpression({
          bodyKey: h.bodyKey,
          voiceKey: h.voiceKey,
          glyphKeys: h.glyphKeys,
          meaning: h.meaning,
          context: h.context,
          confidence: h.confidence,
          level: h.level,
        });
        expr.id = h.id;
        expr.timestamp = h.timestamp;
        return expr;
      });
    }
  }

  // ── ВНУТРЕННИЕ МЕТОДЫ ──

  _pickBody(emotionState) {
    const options = BODY_MAP[emotionState] || ['butt_wiggle_slow'];
    return this.dialect.prefer('body', options);
  }

  _pickVoice(emotionState) {
    const options = VOICE_MAP[emotionState] || [null];
    return this.dialect.prefer('voice', options);
  }

  _pickGlyphs(emotionState, level, tier, context) {
    if (tier === 'puppy') return this._puppyGlyphs(emotionState);
    if (tier === 'young') return this._youngGlyphs(emotionState, context);
    return this._adultGlyphs(emotionState, level, tier, context);
  }

  _puppyGlyphs(emotionState) {
    const options = PUPPY_GLYPH_MAP[emotionState] || [['paw', 'question']];
    return options[Math.floor(Math.random() * options.length)];
  }

  _youngGlyphs(emotionState, context) {
    // Variety: multiple glyph patterns per emotion (randomly selected)
    const variants = {
      bark:   [['paw', 'arrow', 'exclaim'], ['paw', 'exclaim'], ['exclaim', 'sparkle'], ['paw', 'question'], ['paw', 'heart']],
      alert:  [['paw', 'arrow', 'exclaim'], ['paw', 'exclaim', 'exclaim'], ['exclaim', 'arrow', 'question']],
      herding: [['paw', 'arrow', 'exclaim'], ['paw', 'arrow', 'arrow']],
      puzzle_solving: [['paw', 'question'], ['question', 'dots', 'sparkle']],
      happy:  [['paw', 'heart'], ['sparkle', 'heart'], ['heart', 'heart']],
      playful: [['paw', 'heart'], ['sparkle', 'ball'], ['ball', 'sparkle'], ['paw', 'sparkle']],
      greeting_frenzy: [['paw', 'exclaim', 'heart'], ['heart', 'sparkle', 'exclaim'], ['paw', 'heart', 'heart']],
      butt_wiggle: [['paw', 'question'], ['sparkle', 'sparkle'], ['paw', 'sparkle']],
    };

    const emotionVariants = variants[emotionState];
    if (emotionVariants) {
      // Add context-specific glyphs to first variant if relevant
      if (context.file) {
        return ['paw', 'arrow', 'file'];
      }
      if (context.agent) {
        return ['paw', 'arrow', 'robot'];
      }
      return emotionVariants[Math.floor(Math.random() * emotionVariants.length)];
    }

    if (['scared', 'anxious', 'separation_stress'].includes(emotionState)) {
      return [['paw', 'sad'], ['sad', 'dots'], ['paw', 'dots', 'question']][Math.floor(Math.random() * 3)];
    }
    if (emotionState === 'rage') return ['fire', 'fire', 'fire'];
    if (['sleep', 'nap', 'sploot'].includes(emotionState)) return ['zzz'];

    return ['paw', 'question'];
  }

  _adultGlyphs(emotionState, level, tier, context) {
    const keys = ['paw', 'arrow'];

    if (['alert', 'bark', 'herding', 'bossy'].includes(emotionState)) {
      if (context.file) {
        keys.push('file', `raw:${context.file}`);
        if (context.line) keys.push('arrow', `raw:L${context.line}`);
      } else if (context.agent) {
        keys.push('robot');
      }
      keys.push('exclaim');
    } else if (emotionState === 'puzzle_solving') {
      keys.push('magnify');
      if (context.file) keys.push('arrow', 'file', `raw:${context.file}`);
    } else if (emotionState === 'wrote_somewhere') {
      keys.push('file');
      if (context.file) keys.push(`raw:${context.file}`);
      keys.push('arrow', 'check');
    } else if (emotionState === 'rage') {
      return ['fire', 'fire', 'fire', 'fire', 'fire'];
    } else if (['happy', 'playful', 'greeting_frenzy', 'zoomies'].includes(emotionState)) {
      keys.length = 0;
      keys.push('sparkle', 'paw', 'heart');
      if (tier === 'experienced' || tier === 'cyber') keys.push('sparkle');
    } else {
      keys.push('question');
    }

    return keys;
  }

  _buildDiscoveryGlyphs(type, level, tier, context) {
    const keys = ['paw', 'arrow'];

    if (tier === 'puppy') {
      keys.push('exclaim');
      return keys;
    }

    switch (type) {
      case 'bug':
        if (tier === 'young') {
          keys.push('bolt');
          if (context.file) keys.push('arrow', `raw:${context.file}`);
        } else {
          keys.push('file');
          if (context.file) keys.push(`raw:${context.file}`);
          keys.push('arrow', 'bug');
          if (context.line) keys.push(`raw:L${context.line}`);
          if (tier === 'experienced' || tier === 'cyber') {
            keys.push('arrow', 'check');
          }
        }
        break;

      case 'file':
        keys.push('file');
        if (context.file) keys.push(`raw:${context.file}`);
        break;

      case 'pattern':
        if (level >= 40) {
          keys.push('magnify', 'arrow', 'chart');
        } else {
          keys.push('magnify', 'question');
        }
        if (context.description) keys.push(`raw:[${context.description}]`);
        break;

      case 'security':
        if (level >= 25) {
          keys.push('lock', 'arrow', 'warn');
        } else {
          keys.push('exclaim', 'exclaim', 'exclaim');
        }
        if (context.file) keys.push('arrow', `raw:${context.file}`);
        break;

      case 'performance':
        if (level >= 35) {
          keys.push('clock', 'arrow', 'bolt');
        } else {
          keys.push('bolt', 'dots');
        }
        if (context.file) keys.push('arrow', `raw:${context.file}`);
        break;

      case 'prediction':
        keys.push('dots', 'arrow');
        if (tier === 'cyber') {
          keys.push('diamond', 'arrow', 'wave', 'arrow', 'bolt');
        } else if (tier === 'experienced') {
          keys.push('warn', 'arrow', 'bolt');
        } else {
          keys.push('warn');
        }
        break;

      default:
        keys.push('gift', 'question');
    }

    return keys;
  }

  _buildFetchGlyphs(quality, level, tier, context) {
    const keys = ['paw'];

    switch (quality) {
      case 'junk':
        keys.push('ball', 'question');
        break;
      case 'maybe':
        keys.push('ball', 'arrow', 'gift');
        break;
      case 'useful':
        keys.push('ball', 'arrow', 'gift', 'check');
        break;
      case 'gold':
        keys.push('ball', 'arrow', 'gift', 'sparkle', 'sparkle');
        break;
      case 'abstract':
        if (tier === 'cyber') {
          keys.push('diamond', 'hexagon', 'wave');
        } else {
          keys.push('ball', 'arrow', 'gift', 'sparkle');
        }
        break;
    }

    if (level >= 40 && context.file) {
      keys.push('arrow', `raw:${context.file}`);
    }
    if (level >= 60 && context.description) {
      keys.push(`raw:[${context.description}]`);
    }

    return keys;
  }

  _calcConfidence(level, tier) {
    const base = { puppy: 0.1, young: 0.3, adult: 0.5, experienced: 0.7, cyber: 0.9 };
    return Math.max(0, Math.min(1, (base[tier] || 0.1) + (Math.random() * 0.2 - 0.1)));
  }

  _qualityToConfidence(quality) {
    const map = { junk: 0.1, maybe: 0.3, useful: 0.6, gold: 0.85, abstract: 0.95 };
    return map[quality] || 0.1;
  }

  _addToHistory(expr) {
    this.history.push(expr);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
    if (this.history.length % 20 === 0) {
      this.dialect.updateSignature(this.history);
    }
  }
}


// ── FETCH QUALITY ROLL ──
// Чем выше уровень → больше шанс на золото. Но НИКОГДА 100%.

function rollFetchQuality(level) {
  const roll = Math.random() * 100;

  if (level < 20) {
    if (roll < 70) return 'junk';
    if (roll < 90) return 'maybe';
    if (roll < 99) return 'useful';
    return 'gold';
  }

  if (level < 40) {
    if (roll < 40) return 'junk';
    if (roll < 70) return 'maybe';
    if (roll < 90) return 'useful';
    return 'gold';
  }

  if (level < 60) {
    if (roll < 15) return 'junk';
    if (roll < 35) return 'maybe';
    if (roll < 70) return 'useful';
    return 'gold';
  }

  if (level < 80) {
    if (roll < 5) return 'junk';
    if (roll < 15) return 'maybe';
    if (roll < 40) return 'useful';
    return 'gold';
  }

  // КиберПёс: почти всегда золото/абстракт, но 2% мусор
  if (roll < 2) return 'junk';
  if (roll < 8) return 'maybe';
  if (roll < 25) return 'useful';
  if (roll < 60) return 'gold';
  return 'abstract';
}


// ── EXPORTS ──

export {
  // Данные
  BODY, VOICE, GLYPHS, TRACE_TYPES, ARROW,
  // Классы
  PesExpression, PesDialect, PesTrace, SymbolComposer,
  // Функции
  rollFetchQuality, getTier, getAvailableGlyphs, getMaxChainLength,
};
