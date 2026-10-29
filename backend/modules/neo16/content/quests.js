// Neo16 W2 — authored content for the first quest (doc 239900 §Learning Loop).
//
// DATA ONLY. These rows are seeded into the module's `content` table (neo16_content)
// by the blueprint, keyed by (kind, content_key, content_version). The quest service
// reads the DURABLE row, never this constant, so a session always sees the exact
// content version it started with even after the module is upgraded.
//
// A quest is a set of goals. Each goal is satisfied by one validated INTENT spoken
// to one NPC, optionally after other goals (`requires`). Intent names are the
// contract between the content and the evaluator (learning/evaluator.js); the
// server, not the model, decides whether an intent completes a goal.

export const QUEST_KIND = 'quest';

export const ARRANGE_MEETING = Object.freeze({
  kind: QUEST_KIND,
  content_key: 'arrange_meeting',
  content_version: 1,
  title: 'Arrange a meeting with Dr. Reed',
  language: 'en',
  level_hint: 'B1',
  status: 'active',
  payload: {
    xp: 50,
    intro: 'Your handler needs you in the lab. Find out when Dr. Reed is free, where to meet, and confirm it with her.',
    // Habr reference (doc 239900 §External Reuse): two entry choices, same practice loop.
    preparation: {
      example: [
        { speaker: 'you', text: 'Hi Nora, when is Dr. Reed free this week?' },
        { speaker: 'nora', text: "She's free on Thursday after two." },
        { speaker: 'you', text: 'Great. Where should I meet her?' },
      ],
      phrases: [
        { text: 'When is she free?', note: 'asking about availability' },
        { text: 'Where should I meet her?', note: 'asking about place' },
        { text: 'Thursday at two works for me.', note: 'confirming a time' },
      ],
    },
    npcs: [
      {
        key: 'nora',
        name: 'Nora Blake',
        role: 'Receptionist',
        persona: 'Friendly, knows everyone, answers in short plain sentences. Knows Dr. Reed is free on Thursday after 2 pm, in Lab B.',
      },
      {
        key: 'reed',
        name: 'Dr. Evelyn Reed',
        role: 'Scientist',
        persona: 'Precise and busy. Agrees to a meeting only when the player states a concrete time and place.',
      },
      {
        key: 'casey',
        name: 'Casey Brooks',
        role: 'Colleague',
        persona: 'Chatty partner. Small talk only; gives a hint about Nora if asked.',
      },
    ],
    goals: [
      { key: 'ask_time', intent: 'ask_time', npc: 'nora', title: 'Find out when Dr. Reed is free', requires: [] },
      { key: 'ask_place', intent: 'ask_place', npc: 'nora', title: 'Find out where to meet her', requires: [] },
      {
        key: 'confirm',
        intent: 'confirm_meeting',
        npc: 'reed',
        title: 'Confirm the meeting with Dr. Reed',
        requires: ['ask_time', 'ask_place'],
      },
    ],
  },
});

/** Rows for the blueprint `seed` section — one group, natural key (kind, content_key, content_version). */
export const CONTENT_SEED_ROWS = Object.freeze([ARRANGE_MEETING]);
