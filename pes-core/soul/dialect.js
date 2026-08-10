/**
 * PES Soul — Dialect
 *
 * Каждый ПЕС развивает СВОЙ уникальный язык.
 * Два ПЕСа одного уровня "говорят" по-разному.
 *
 * Диалект формируется через:
 *   - Какие позы/звуки/символы вызвали реакцию хозяина
 *   - Какие комбинации ПЕС сам придумал
 *   - Причуды (quirks) — уникальные привычки
 *   - Подпись (signature) — топ-5 самых частых символов
 */

class PesDialect {
  constructor() {
    this.bodyPreferences = {};    // какие позы чаще использует
    this.voicePreferences = {};   // какие звуки предпочитает
    this.glyphCombos = [];        // выученные комбинации символов
    this.customMeanings = {};     // хозяин научил: "🐾💛" = "молодец" для ЭТОГО пса
    this.signature = [];          // уникальная "подпись" — топ-5 символов
    this.quirks = {};             // причуды: "всегда ворчит перед сном", "лает на конфиги"
  }

  /**
   * Зафиксировать использование — ПЕС запоминает что работает.
   * Если хозяин отреагировал — усиливается.
   */
  reinforce(expressionType, key, ownerReacted) {
    const prefs = expressionType === 'body' ? this.bodyPreferences
      : expressionType === 'voice' ? this.voicePreferences
      : null;

    if (prefs) {
      if (!prefs[key]) prefs[key] = { uses: 0, successes: 0 };
      prefs[key].uses++;
      if (ownerReacted) prefs[key].successes++;
    }
  }

  /**
   * Получить предпочтительный вариант из списка кандидатов.
   * ПЕС чаще выбирает то что "работало" раньше.
   * Вес = 1.0 + (successes / uses) * 2.0
   */
  prefer(expressionType, candidates) {
    const prefs = expressionType === 'body' ? this.bodyPreferences
      : expressionType === 'voice' ? this.voicePreferences
      : null;

    if (!prefs || candidates.length === 0) {
      return candidates[Math.floor(Math.random() * candidates.length)];
    }

    const weighted = candidates.map(c => {
      const p = prefs[c];
      const weight = p ? 1.0 + (p.successes / Math.max(p.uses, 1)) * 2.0 : 1.0;
      return { key: c, weight };
    });

    const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
    let roll = Math.random() * totalWeight;
    for (const w of weighted) {
      roll -= w.weight;
      if (roll <= 0) return w.key;
    }
    return weighted[weighted.length - 1].key;
  }

  /**
   * Добавить причуду — уникальное поведение.
   * Например: "bark_at_configs" — лает каждый раз видя конфиг-файл.
   */
  addQuirk(name, trigger, response) {
    this.quirks[name] = { trigger, response, formed_at: Date.now() };
  }

  /**
   * Научить ПЕС значению комбинации (хозяин объясняет).
   * ПЕС помнит НАВСЕГДА.
   */
  teachMeaning(glyphCombo, meaning) {
    const key = glyphCombo.join('+');
    this.customMeanings[key] = { meaning, taught_at: Date.now() };
  }

  /**
   * Обновить подпись — топ-5 самых частых символов.
   * Формируется автоматически из истории.
   */
  updateSignature(history) {
    const freq = {};
    for (const expr of history) {
      if (expr.glyphKeys) {
        for (const k of expr.glyphKeys) {
          if (k !== 'arrow' && k !== '→' && !k.startsWith('raw:')) {
            freq[k] = (freq[k] || 0) + 1;
          }
        }
      }
    }
    this.signature = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([key]) => key);
  }

  save() {
    return {
      bodyPreferences: this.bodyPreferences,
      voicePreferences: this.voicePreferences,
      glyphCombos: this.glyphCombos,
      customMeanings: this.customMeanings,
      signature: this.signature,
      quirks: this.quirks,
    };
  }

  load(data) {
    if (!data) return;
    this.bodyPreferences = data.bodyPreferences || {};
    this.voicePreferences = data.voicePreferences || {};
    this.glyphCombos = data.glyphCombos || [];
    this.customMeanings = data.customMeanings || {};
    this.signature = data.signature || [];
    this.quirks = data.quirks || {};
  }
}

export { PesDialect };
