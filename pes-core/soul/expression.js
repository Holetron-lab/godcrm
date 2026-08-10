/**
 * PES Soul — Expression
 *
 * Одно "высказывание" ПЕС — комбинация ТЕЛО + ГОЛОС + СИМВОЛЫ.
 * Всегда все 3 канала вместе.
 */

import { BODY } from './body.js';
import { VOICE } from './voice.js';
import { GLYPHS, ARROW } from './glyphs.js';

class PesExpression {
  /**
   * @param {Object} opts
   * @param {string}   opts.bodyKey    - ключ из BODY (или null)
   * @param {string}   opts.voiceKey   - ключ из VOICE (или null)
   * @param {string[]} opts.glyphKeys  - ключи из GLYPHS
   * @param {string}   opts.meaning    - внутреннее значение (не видно хозяину)
   * @param {Object}   opts.context    - контекст { file, line, agent, data, description }
   * @param {number}   opts.confidence - уверенность 0.0-1.0
   * @param {number}   opts.level      - уровень ПЕС когда создано
   */
  constructor({ bodyKey = null, voiceKey = null, glyphKeys = [], meaning, context = {}, confidence = 0.5, level = 0 }) {
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

  /** Рендер тела — что видно визуально */
  renderBody() {
    if (!this.bodyKey) return null;
    const b = BODY[this.bodyKey];
    return b ? b.visual : null;
  }

  /** Рендер голоса — что слышно */
  renderVoice() {
    if (!this.voiceKey) return null;
    const v = VOICE[this.voiceKey];
    return v ? v.sound : null;
  }

  /** Рендер символов — глифы в строку */
  renderGlyphs() {
    if (this.glyphKeys.length === 0) return null;
    const parts = [];
    for (const key of this.glyphKeys) {
      if (key === 'arrow' || key === '→') {
        parts.push(ARROW);
      } else if (key.startsWith('raw:')) {
        parts.push(key.slice(4));
      } else {
        const g = GLYPHS[key];
        if (g) parts.push(g.glyph);
      }
    }
    return parts.join('');
  }

  /** Полный рендер — все 3 канала */
  render() {
    const parts = [];
    const body = this.renderBody();
    const voice = this.renderVoice();
    const glyphs = this.renderGlyphs();

    if (body) parts.push(body);
    if (voice) parts.push(voice);
    if (glyphs) parts.push(glyphs);

    return parts.join(' ');
  }

  /** Для сохранения */
  toJSON() {
    return {
      id: this.id,
      bodyKey: this.bodyKey,
      voiceKey: this.voiceKey,
      glyphKeys: this.glyphKeys,
      rendered: this.render(),
      meaning: this.meaning,
      context: this.context,
      confidence: this.confidence,
      level: this.level,
      timestamp: this.timestamp,
    };
  }
}

export { PesExpression };
