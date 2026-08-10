/**
 * PES Soul — Body Language
 *
 * Корги-специфичные позы и движения тела.
 * Тело ВСЕГДА "говорит" — даже когда ПЕС молчит.
 * У корги нет хвоста — попа = главный индикатор настроения.
 */

// === ПОПА И ХВОСТ (у корги хвоста нет — попа = главный индикатор) ===
// === УШИ (у корги огромные, каждое микро-движение видно) ===
// === ПОЗА ===

const BODY = {
  // --- Попа ---
  butt_wiggle_slow:   { visual: '~🍑~',     meaning: 'mild_interest',       intensity: 0.3 },
  butt_wiggle_fast:   { visual: '~🍑~🍑~',  meaning: 'very_excited',        intensity: 0.8 },
  butt_wiggle_turbo:  { visual: '💫🍑💫',    meaning: 'maximum_joy',         intensity: 1.0 },
  no_wiggle:          { visual: '🍑.',       meaning: 'something_wrong',     intensity: 0.0 },

  // --- Уши ---
  ears_forward:       { visual: '⌃⌃',       meaning: 'alert_focused',       intensity: 0.6 },
  ears_airplane:      { visual: '⌐⌐',       meaning: 'playful_relaxed',     intensity: 0.4 },
  ears_one_up:        { visual: '⌃⌐',       meaning: 'processing_unsure',   intensity: 0.3 },
  ears_flat:          { visual: '──',        meaning: 'scared_submissive',   intensity: 0.7 },
  ears_twitching:     { visual: '⌃⚡⌃',     meaning: 'tracking_sounds',     intensity: 0.5 },

  // --- Поза ---
  sploot:             { visual: '___🐾',     meaning: 'total_comfort',       intensity: 0.2 },
  play_bow:           { visual: '⌄🐾🍑⌃',  meaning: 'lets_play',           intensity: 0.7 },
  corgi_flop:         { visual: '🐾~thud',  meaning: 'trust_demand_pets',   intensity: 0.5 },
  low_crouch:         { visual: '..🐾..',    meaning: 'herding_stalk',       intensity: 0.8 },
  belly_up:           { visual: '🐾⊙',      meaning: 'total_trust',         intensity: 0.3 },
  lean:               { visual: '🐾>',       meaning: 'i_need_you',          intensity: 0.5 },
  body_block:         { visual: '🐾▌',       meaning: 'protecting_blocking', intensity: 0.7 },
  bunny_hop:          { visual: '🐾↑↓↑',    meaning: 'excited_running',     intensity: 0.9 },
  spin:               { visual: '🐾↻',       meaning: 'cant_contain_joy',    intensity: 0.9 },
  paw_tap:            { visual: '🐾✋',      meaning: 'pay_attention_to_me', intensity: 0.4 },
  nose_nudge:         { visual: '🐾👃>',     meaning: 'hey_look_at_this',    intensity: 0.5 },
  side_eye:           { visual: '🐾👀',      meaning: 'suspicious_judging',  intensity: 0.4 },
  hide_behind:        { visual: '|🐾',       meaning: 'scared_hiding',       intensity: 0.6 },
  circle:             { visual: '🐾↻↻',      meaning: 'herding_circling',    intensity: 0.7 },
};

/**
 * Маппинг: эмоция → какие позы возможны.
 * SymbolComposer использует dialect.prefer() чтобы выбрать из этих вариантов.
 */
const BODY_MAP = {
  idle:              ['sploot', 'lean'],
  content:           ['sploot', 'corgi_flop', 'belly_up'],
  playful:           ['butt_wiggle_fast', 'play_bow', 'bunny_hop'],
  happy:             ['butt_wiggle_fast', 'spin', 'corgi_flop'],
  butt_wiggle:       ['butt_wiggle_turbo'],
  zoomies:           ['bunny_hop', 'spin', 'butt_wiggle_turbo'],
  play_bow:          ['play_bow', 'butt_wiggle_fast'],
  greeting_frenzy:   ['spin', 'butt_wiggle_turbo', 'bunny_hop', 'lean'],
  puppy_eyes:        ['lean', 'paw_tap', 'nose_nudge'],
  wanna_play:        ['play_bow', 'paw_tap', 'nose_nudge'],
  velcro:            ['lean', 'corgi_flop'],
  jealous:           ['body_block', 'lean', 'nose_nudge'],
  howl_sing:         ['ears_forward', 'butt_wiggle_slow'],
  alert:             ['ears_forward', 'ears_twitching', 'low_crouch'],
  bark:              ['ears_forward', 'body_block', 'butt_wiggle_slow', 'paw_tap', 'nose_nudge', 'ears_twitching'],
  herding:           ['low_crouch', 'circle', 'body_block'],
  bossy:             ['body_block', 'paw_tap', 'ears_forward'],
  puzzle_solving:    ['ears_one_up', 'side_eye', 'nose_nudge'],
  wrote_somewhere:   ['side_eye', 'butt_wiggle_slow'],
  grumble:           ['side_eye', 'ears_airplane'],
  dramatic_tantrum:  ['corgi_flop', 'belly_up', 'spin'],
  stubborn_refuse:   ['side_eye', 'ears_flat', 'no_wiggle'],
  sulking:           ['no_wiggle', 'ears_flat', 'hide_behind'],
  side_eye:          ['side_eye'],
  sleep:             ['sploot', 'corgi_flop'],
  nap:               ['sploot'],
  sploot:            ['sploot'],
  corgi_flop:        ['corgi_flop'],
  scared:            ['ears_flat', 'hide_behind'],
  anxious:           ['ears_twitching', 'paw_tap'],
  separation_stress: ['no_wiggle', 'lean', 'paw_tap'],
  rage:              ['low_crouch', 'ears_forward'],
  sneaky:            ['low_crouch', 'side_eye'],
  food_obsessed:     ['butt_wiggle_turbo', 'nose_nudge', 'spin'],
};

export { BODY, BODY_MAP };
