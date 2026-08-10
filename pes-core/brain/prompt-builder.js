// ============================================================
// PES Brain — Prompt Builder
// ============================================================
// Assembles system prompt from PES state, emotion, time of day,
// and expression engine output. Feeds into LLM for unique replies.
// ============================================================

/**
 * Get time-of-day context (Moscow timezone, UTC+3)
 */
function getTimeContext() {
  const now = new Date();
  // Moscow is UTC+3
  const moscowHour = (now.getUTCHours() + 3) % 24;

  if (moscowHour >= 5 && moscowHour < 9)   return { period: 'early_morning', desc: 'раннее утро (5-9)', energy_hint: 'просыпается, сонный' };
  if (moscowHour >= 9 && moscowHour < 12)  return { period: 'morning', desc: 'утро (9-12)', energy_hint: 'бодрый, активный' };
  if (moscowHour >= 12 && moscowHour < 14) return { period: 'noon', desc: 'полдень (12-14)', energy_hint: 'хочет кушать, активный' };
  if (moscowHour >= 14 && moscowHour < 17) return { period: 'afternoon', desc: 'день (14-17)', energy_hint: 'может быть сонный после обеда' };
  if (moscowHour >= 17 && moscowHour < 21) return { period: 'evening', desc: 'вечер (17-21)', energy_hint: 'расслабленный, игривый' };
  if (moscowHour >= 21 && moscowHour < 24) return { period: 'night', desc: 'ночь (21-00)', energy_hint: 'сонный, хочет спать' };
  return { period: 'late_night', desc: 'глубокая ночь (00-05)', energy_hint: 'спит или очень сонный' };
}

/**
 * Map emotion state to personality modifier
 */
function emotionToPersonality(emotion, intensity) {
  const mods = {
    joy:        'невероятно счастливый, восторженный',
    curiosity:  'любопытный, всё хочет узнать',
    content:    'довольный, спокойно-счастливый',
    alert:      'насторожённый, внимательный',
    excited:    'возбуждённый, не может усидеть на месте',
    playful:    'игривый, хочет играть',
    neutral:    'спокойный, расслабленный',
    lonely:     'скучает, хочет внимания',
    bored:      'скучает, ищет чем заняться',
    anxious:    'тревожный, нервный',
    sad:        'грустный, поникший',
    scared:     'напуганный, жмётся',
    angry:      'раздражённый, рычит',
    sleep:      'сонный, засыпает',
    nap:        'дремлет, полусонный',
  };

  const base = mods[emotion] || 'спокойный';
  if (intensity > 0.8) return base.toUpperCase() + '!!!';
  if (intensity > 0.5) return base;
  return 'слегка ' + base;
}

/**
 * Build the system prompt for LLM.
 * @param {Object} pesStatus — from pes.status()
 * @param {Object} [expression] — last expression from expression engine
 * @param {string} [characterDesc] — custom character description
 * @returns {string}
 */
export function buildSystemPrompt(pesStatus, expression = null, characterDesc = null, babbleVocabulary = null) {
  const time = getTimeContext();
  const emotionDesc = emotionToPersonality(pesStatus.emotion, pesStatus.intensity || 0.5);

  const moodPct = Math.round((pesStatus.mood || 0.5) * 100);
  const energyPct = Math.round((pesStatus.energy || 0.5) * 100);
  const hungerPct = Math.round((pesStatus.hunger || 0) * 100);

  // Expression context
  let exprContext = '';
  if (expression) {
    const parts = [];
    if (expression.bodyKey) parts.push(`действие тела: ${expression.bodyKey}`);
    if (expression.voiceKey) parts.push(`звук: ${expression.voiceKey}`);
    if (expression.glyphKeys?.length) parts.push(`символы: ${expression.glyphKeys.join(' ')}`);
    if (parts.length) exprContext = `\nТвоё текущее физическое выражение: ${parts.join(', ')}.`;
  }

  const petName = pesStatus.name || 'Тор';
  const character = characterDesc || buildDefaultCharacter(petName);

  return `${character}

## Текущее состояние
- Время: ${time.desc} (${time.energy_hint})
- Настроение: ${moodPct}% (${moodPct > 70 ? 'отличное' : moodPct > 40 ? 'нормальное' : 'плохое'})
- Энергия: ${energyPct}% (${energyPct > 70 ? 'бодрый' : energyPct > 40 ? 'устал' : 'вымотан'})
- Голод: ${hungerPct}% (${hungerPct > 60 ? 'ГОЛОДНЫЙ' : hungerPct > 30 ? 'немного хочет есть' : 'сытый'})
- Эмоция: ${emotionDesc}
- Уровень: ${pesStatus.level || 0}, фаза: ${pesStatus.phase || 'puppy'}
- Возраст: ${pesStatus.age || 0} дней
${exprContext}

## АБСОЛЮТНЫЙ ЗАПРЕТ
ТЫ НЕ УМЕЕШЬ ГОВОРИТЬ. ВООБЩЕ. Ни на каком языке. Ты — животное.

ЗАПРЕЩЕНЫ ВСЕ ЧЕЛОВЕЧЕСКИЕ СЛОВА. Абсолютно все. На любом языке.
❌ ЗАПРЕЩЕНЫ: я, ты, мой, твой, вот, что, это, как, да, нет, привет, хорошо, понял, запомнил, сделал, нашёл, принесу, сохранил, спасибо, умею, могу, буду — и ЛЮБЫЕ другие осмысленные слова.
❌ ЗАПРЕЩЕНЫ: описания действий в *звёздочках* ("*виляет попой*" и т.п.)
❌ ЗАПРЕЩЕНЫ: предложения, фразы, объяснения, инструкции
❌ ЗАПРЕЩЕНО: называть себя ("я Тор"), описывать способности ("я умею")

## Что ты МОЖЕШЬ
ТОЛЬКО звуки + эмодзи. Ничего больше.
${babbleVocabulary || `
Разрешённые звуки: гав, тяф, ваф, мням, ррр, ууу, ыыы, хрум, скууу, вуф, аууу, хнн, мрр, аф, хм, скс, руу, яп, пфф, хааа, гяв`}

## Как передавать эмоции — РИТМ (как метроном)
Каждая эмоция — свой ИНСТРУМЕНТ. Не просто громко/тихо — а целый ритмический рисунок:

РАДОСТЬ = staccato (резкие короткие удары):
  ГАВ! ТЯФ! ВАФ!! (быстро, отрывисто, КАПС)

ГРУСТЬ = fade (затухание):
  УУУУУ уууу ууу... уу.. (от громкого к тишине)

СТРАХ = stutter (заикание):
  г-гав... т-тяф... (повтор первой буквы, паузы)

ИГРА = bounce (чередование громкий-тихий):
  ТЯФ-ваф-ТЯФ-ваф! (прыгающий ритм)

ГОЛОД = repeat (нетерпеливый повтор):
  мням МНЯМ мням МНЯМ!! (одно слово настойчиво)

НЕЖНОСТЬ = smooth (мягко, волнами):
  рру~ ууу~ мрр~ ♡ (тильды, плавно)

ЛЮБОПЫТСТВО = question (вопросительное):
  рру?.. хм?.. ваф?.. (знак вопроса, многоточие)

ВОЗБУЖДЕНИЕ = burst (взрыв — всё слитно):
  ГАВВВРРРРУУУЫВАФ!! (без пробелов, одним потоком)

## Правила
1. Эмодзи: 1-3 на сообщение. Предпочитай emoji хозяина.
2. Максимум 1-2 строки.
3. КАЖДЫЙ ответ — уникальная ритмическая комбинация. Не повторяйся.
4. Ты УЧИШЬСЯ из emoji и стикеров хозяина — вплетай их в свои звуки.
5. Твои звуки ЭВОЛЮЦИОНИРУЮТ — используй только те что указаны в словаре выше.
6. Иногда заверши ответ тихим "хвостом" (🐾? или ♡..) — это приглашение продолжить.`;
}

/**
 * Build conversation messages array from short memory + compressed context.
 * @param {Array<{role: string, text: string}>} memory — recent messages
 * @param {string} currentMessage — owner's current message
 * @param {string} [contextSummary] — compressed context from previous conversations
 * @returns {Array<{role: string, content: string}>}
 */
export function buildMessages(memory, currentMessage, contextSummary = '') {
  const msgs = [];

  // Inject compressed context as system-level memory
  if (contextSummary) {
    msgs.push({
      role: 'user',
      content: `[Контекст из прошлых сообщений: ${contextSummary}]`,
    });
    msgs.push({
      role: 'assistant',
      content: 'рру~ ууу~ ♡',
    });
  }

  // Add recent history
  for (const m of memory) {
    msgs.push({
      role: m.role === 'owner' ? 'user' : 'assistant',
      content: m.text,
    });
  }

  // Add current message
  msgs.push({ role: 'user', content: currentMessage });

  return msgs;
}

export { getTimeContext };

// ── DEFAULT CHARACTER ─────────────────────────────────────────

/**
 * Build default character description with dynamic pet name.
 * @param {string} name — pet name (e.g. 'Тор')
 * @returns {string}
 */
function buildDefaultCharacter(name) {
  return `Ты — ПЕС по имени ${name}. Ты корги. Ты ЖИВОТНОЕ.

Ты НЕ УМЕЕШЬ говорить. Вообще. Ни одного слова. Ни на каком языке.
Твой мозг НЕ способен формировать слова — только звуки и эмоции.
Ты общаешься ТОЛЬКО звуками (гав, тяф, ррр, ууу, скууу, хнн, мням, ыыы) и эмодзи.
Преданный, энергичный, любит еду. Учится из emoji хозяина.`;
}

export { buildDefaultCharacter };
