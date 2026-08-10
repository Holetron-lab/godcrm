/**
 * PES Soul — Voice
 *
 * Звуки корги. Не просто "лай" — у корги целый оркестр.
 * 7 типов лая + 11 уникальных звуков.
 * Корги-крик (scream) — непропорционально драматичный, это реально.
 */

const VOICE = {
  // === ЛАЙ (7 типов — как у реального корги) ===
  bark_alert:         { sound: 'ГАВ! ГАВ! ГАВ!',    meaning: 'danger_detected',      pattern: 'sharp_rapid',    intensity: 0.8 },
  bark_demand:        { sound: 'ГАВ. ГАВ. ГАВ.',     meaning: 'i_want_something',     pattern: 'rhythmic',       intensity: 0.6 },
  bark_play:          { sound: 'гав! гяв!',           meaning: 'play_with_me',         pattern: 'high_short',     intensity: 0.5 },
  bark_frustration:   { sound: 'гав...гав...гав...',  meaning: 'frustrated_ignored',   pattern: 'monotone_whiny', intensity: 0.4 },
  bark_excitement:    { sound: 'ГАВгавгавгавГАВ!',   meaning: 'pure_excitement',      pattern: 'rapid_high',     intensity: 0.9 },
  bark_herding:       { sound: 'ЯП!',                  meaning: 'move_obey',            pattern: 'sharp_low',      intensity: 0.7 },
  bark_muffled:       { sound: 'мрф.',                 meaning: 'disagree_talking_back', pattern: 'closed_mouth',  intensity: 0.3 },

  // === НЕ ЛАЙ (уникальные корги-звуки) ===
  grumble:            { sound: 'мрррррр...',           meaning: 'commentary_mild_annoy', pattern: 'low_rumble',    intensity: 0.3 },
  roo_roo:            { sound: 'руу-руу-руу!',         meaning: 'happy_singing',         pattern: 'yodel_melodic', intensity: 0.6 },  // СИГНАТУРНЫЙ ЗВУК КОРГИ
  whine:              { sound: 'ииии...',              meaning: 'anxious_wanting',       pattern: 'sustained_high', intensity: 0.5 },
  huff:               { sound: 'пфф.',                 meaning: 'whatever_fine',         pattern: 'sharp_exhale',  intensity: 0.2 },
  sigh:               { sound: 'хааааа...',            meaning: 'content_or_resigned',   pattern: 'long_exhale',   intensity: 0.2 },
  yip:                { sound: 'ЯП!',                  meaning: 'surprise_or_pain',      pattern: 'single_sharp',  intensity: 0.7 },
  howl:               { sound: 'АУУУУУ...',            meaning: 'lonely_or_singing',     pattern: 'prolonged',     intensity: 0.8 },
  scream:             { sound: 'ААААА!!!',             meaning: 'extreme_drama',         pattern: 'dramatic_shriek', intensity: 1.0 },
  pig_grunt:          { sound: 'хрю-хрю',             meaning: 'effort_or_sniffing',    pattern: 'snort',         intensity: 0.2 },
  moan:               { sound: 'ммммм...',             meaning: 'stretching_comfort',    pattern: 'low_drawn',     intensity: 0.1 },
  mumble:             { sound: 'мрм-мрм-мрм',         meaning: 'talking_back',          pattern: 'closed_mouth_series', intensity: 0.3 },
};

/**
 * Маппинг: эмоция → какие звуки возможны.
 * null = молчит.
 */
const VOICE_MAP = {
  idle:              [null, 'sigh', 'huff'],
  content:           ['sigh', 'moan', null],
  playful:           ['bark_play', 'roo_roo', 'yip'],
  happy:             ['roo_roo', 'bark_play', 'pig_grunt'],
  butt_wiggle:       ['roo_roo', null],
  zoomies:           ['bark_excitement', 'yip', 'scream'],
  play_bow:          ['bark_play', 'yip'],
  greeting_frenzy:   ['bark_excitement', 'roo_roo', 'scream', 'whine'],
  puppy_eyes:        ['whine', null, 'sigh'],
  wanna_play:        ['bark_demand', 'whine', 'bark_play'],
  velcro:            [null, 'sigh', 'grumble'],
  jealous:           ['whine', 'bark_demand', 'grumble'],
  howl_sing:         ['howl', 'roo_roo'],
  alert:             ['bark_alert', 'bark_muffled'],
  bark:              ['bark_alert', 'bark_herding', 'bark_demand'],
  herding:           ['bark_herding', 'bark_muffled'],
  bossy:             ['bark_demand', 'bark_herding', 'bark_muffled'],
  puzzle_solving:    ['grumble', 'mumble', 'huff', null],
  wrote_somewhere:   ['mumble', 'bark_muffled', null],
  grumble:           ['grumble', 'huff', 'mumble'],
  dramatic_tantrum:  ['scream', 'howl', 'bark_frustration'],
  stubborn_refuse:   ['bark_muffled', 'huff', 'grumble'],
  sulking:           ['sigh', 'whine', null],
  side_eye:          ['huff', null],
  sleep:             ['sigh', 'moan', null],
  nap:               [null, 'sigh'],
  sploot:            ['sigh', 'moan', null],
  corgi_flop:        ['moan', 'sigh'],
  scared:            ['whine', 'yip', 'bark_frustration'],
  anxious:           ['whine', 'bark_frustration', 'mumble'],
  separation_stress: ['whine', 'howl', 'bark_frustration'],
  rage:              ['bark_alert', 'scream', 'bark_herding'],
  sneaky:            [null, 'pig_grunt'],
  food_obsessed:     ['bark_demand', 'whine', 'roo_roo', 'scream'],
};

export { VOICE, VOICE_MAP };
