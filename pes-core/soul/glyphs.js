/**
 * PES Soul — Glyphs (визуальные символы)
 *
 * Растут с уровнем. Щенок знает 10 базовых. КиберПёс — 50+.
 * Символы комбинируются в цепочки = "речь" ПЕС.
 *
 * Категории:
 *   core      — с рождения (🐾 💛 ❗ ❓ 💤 🎾 ✨ 🔥 💧 ...)
 *   object    — предметы (🦴 🪵 🎁 🔍 🔑 🛡️)
 *   tech      — технические (📂 ⚡ ❌ ✅ 🐛 ⚠️ ⚙️ 🔒 🗄️ 🌐 ⏰ 📊)
 *   connector — связки (→ ⇒ 🔄 ⑂ ⊕)
 *   social    — сущности (🐕 👤 🤖 🤝 💥)
 *   cyber     — абстрактные (◈ ⟁ ⧫ ⦿ ≋ ∞ ◌)
 */

const GLYPHS = {
  // === БАЗОВЫЕ (уровень 0 — с рождения) ===
  paw:          { glyph: '🐾', meaning: 'self/here',       category: 'core',      unlock: 0 },
  heart:        { glyph: '💛', meaning: 'love/good',        category: 'core',      unlock: 0 },
  sad:          { glyph: '💧', meaning: 'sad',              category: 'core',      unlock: 0 },
  exclaim:      { glyph: '❗', meaning: 'attention',        category: 'core',      unlock: 0 },
  question:     { glyph: '❓', meaning: 'confused',         category: 'core',      unlock: 0 },
  zzz:          { glyph: '💤', meaning: 'sleep',            category: 'core',      unlock: 0 },
  ball:         { glyph: '🎾', meaning: 'play/fetch',       category: 'core',      unlock: 0 },
  dots:         { glyph: '...', meaning: 'waiting',         category: 'core',      unlock: 0 },
  fire:         { glyph: '🔥', meaning: 'rage',             category: 'core',      unlock: 0 },
  sparkle:      { glyph: '✨', meaning: 'excited',          category: 'core',      unlock: 0 },

  // === ПРЕДМЕТЫ (уровень 5-15) ===
  bone:         { glyph: '🦴', meaning: 'reward',           category: 'object',    unlock: 5 },
  stick:        { glyph: '🪵', meaning: 'found_thing',      category: 'object',    unlock: 5 },
  nose:         { glyph: '👃', meaning: 'sniffing',         category: 'object',    unlock: 5 },
  gift:         { glyph: '🎁', meaning: 'surprise',         category: 'object',    unlock: 10 },
  magnify:      { glyph: '🔍', meaning: 'searching',        category: 'object',    unlock: 10 },
  key:          { glyph: '🔑', meaning: 'access',           category: 'object',    unlock: 15 },
  shield:       { glyph: '🛡️', meaning: 'protection',      category: 'object',    unlock: 15 },

  // === ТЕХНИЧЕСКИЕ (уровень 15-40 — мозг включается) ===
  file:         { glyph: '📂', meaning: 'file',             category: 'tech',      unlock: 15 },
  bolt:         { glyph: '⚡', meaning: 'error/problem',    category: 'tech',      unlock: 15 },
  cross:        { glyph: '❌', meaning: 'broken',           category: 'tech',      unlock: 15 },
  check:        { glyph: '✅', meaning: 'fixed/good',       category: 'tech',      unlock: 20 },
  bug:          { glyph: '🐛', meaning: 'bug',              category: 'tech',      unlock: 20 },
  warn:         { glyph: '⚠️', meaning: 'warning',          category: 'tech',      unlock: 20 },
  gear:         { glyph: '⚙️', meaning: 'config',           category: 'tech',      unlock: 25 },
  lock:         { glyph: '🔒', meaning: 'security',         category: 'tech',      unlock: 25 },
  database:     { glyph: '🗄️', meaning: 'database',        category: 'tech',      unlock: 30 },
  globe:        { glyph: '🌐', meaning: 'network',          category: 'tech',      unlock: 30 },
  clock:        { glyph: '⏰', meaning: 'performance',      category: 'tech',      unlock: 35 },
  chart:        { glyph: '📊', meaning: 'data_pattern',     category: 'tech',      unlock: 40 },

  // === КОННЕКТОРЫ (уровень 10-35) ===
  arrow:        { glyph: '→',  meaning: 'leads_to',         category: 'connector', unlock: 10 },
  cause:        { glyph: '⇒',  meaning: 'causes',           category: 'connector', unlock: 25 },
  loop:         { glyph: '🔄', meaning: 'repeating',        category: 'connector', unlock: 20 },
  split:        { glyph: '⑂',  meaning: 'choice',           category: 'connector', unlock: 30 },
  merge:        { glyph: '⊕',  meaning: 'combine',          category: 'connector', unlock: 35 },

  // === СОЦИАЛЬНЫЕ (уровень 0-15) ===
  other_pes:    { glyph: '🐕', meaning: 'another_pes',      category: 'social',    unlock: 0 },
  human:        { glyph: '👤', meaning: 'human',             category: 'social',    unlock: 0 },
  robot:        { glyph: '🤖', meaning: 'agent',             category: 'social',    unlock: 5 },
  handshake:    { glyph: '🤝', meaning: 'agreement',         category: 'social',    unlock: 15 },
  fight:        { glyph: '💥', meaning: 'conflict',          category: 'social',    unlock: 10 },

  // === КИБЕР (уровень 80+ — сжатая мудрость) ===
  diamond:      { glyph: '◈',  meaning: 'core_insight',     category: 'cyber',     unlock: 80 },
  triangle:     { glyph: '⟁',  meaning: 'structure',        category: 'cyber',     unlock: 80 },
  hexagon:      { glyph: '⧫',  meaning: 'pattern',          category: 'cyber',     unlock: 80 },
  circuit:      { glyph: '⦿',  meaning: 'deep_connection',  category: 'cyber',     unlock: 85 },
  wave:         { glyph: '≋',  meaning: 'signal',           category: 'cyber',     unlock: 85 },
  infinity:     { glyph: '∞',  meaning: 'deep_pattern',     category: 'cyber',     unlock: 90 },
  void:         { glyph: '◌',  meaning: 'unknown_beyond',   category: 'cyber',     unlock: 95 },
};

/** Стрелка-разделитель */
const ARROW = '→';

/** Уровневые тиры */
function getTier(level) {
  if (level < 20) return 'puppy';
  if (level < 40) return 'young';
  if (level < 60) return 'adult';
  if (level < 80) return 'experienced';
  return 'cyber';
}

/** Доступные глифы по уровню */
function getAvailableGlyphs(level) {
  const available = {};
  for (const [key, glyph] of Object.entries(GLYPHS)) {
    if (level >= glyph.unlock) {
      available[key] = glyph;
    }
  }
  return available;
}

/** Максимальная длина цепочки по уровню */
function getMaxChainLength(level) {
  const tier = getTier(level);
  return { puppy: 3, young: 5, adult: 8, experienced: 12, cyber: 20 }[tier];
}

/**
 * Маппинги: эмоция → глифы для разных уровней.
 */
const PUPPY_GLYPH_MAP = {
  idle:              [['paw', 'dots']],
  content:           [['paw', 'heart']],
  playful:           [['paw', 'sparkle'], ['ball']],
  happy:             [['paw', 'heart'], ['sparkle']],
  butt_wiggle:       [['sparkle', 'sparkle']],
  zoomies:           [['sparkle', 'sparkle', 'sparkle']],
  play_bow:          [['ball', 'question']],
  greeting_frenzy:   [['paw', 'exclaim', 'heart']],
  puppy_eyes:        [['paw', 'sad']],
  wanna_play:        [['paw', 'ball']],
  velcro:            [['paw', 'heart']],
  jealous:           [['paw', 'exclaim']],
  howl_sing:         [['paw']],
  alert:             [['paw', 'exclaim']],
  bark:              [['exclaim', 'exclaim'], ['paw', 'exclaim'], ['paw', 'sparkle'], ['exclaim', 'question'], ['paw', 'heart', 'exclaim']],
  herding:           [['paw', 'exclaim']],
  bossy:             [['exclaim']],
  puzzle_solving:    [['paw', 'question']],
  wrote_somewhere:   [['paw', 'dots']],
  grumble:           [['paw']],
  dramatic_tantrum:  [['exclaim', 'sad', 'exclaim']],
  stubborn_refuse:   [['paw']],
  sulking:           [['dots', 'sad']],
  side_eye:          [['paw', 'question']],
  sleep:             [['zzz']],
  nap:               [['zzz']],
  sploot:            [['zzz', 'heart']],
  corgi_flop:        [['zzz']],
  scared:            [['sad', 'sad']],
  anxious:           [['paw', 'dots', 'question']],
  separation_stress: [['paw', 'dots', 'question', 'sad']],
  rage:              [['fire', 'fire', 'fire']],
  sneaky:            [['paw', 'dots']],
  food_obsessed:     [['bone', 'exclaim']],
};

export {
  GLYPHS,
  ARROW,
  getTier,
  getAvailableGlyphs,
  getMaxChainLength,
  PUPPY_GLYPH_MAP,
};
