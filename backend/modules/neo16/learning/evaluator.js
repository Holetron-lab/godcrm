// Neo16 W2 — the evaluator contract and a deterministic rule-based evaluator.
//
// Contract adapted from Polyglot Path's structured dialogue output (doc 239900
// §External Reuse): the NPC's in-character reply is separated from the recognised
// INTENT, actionable FEEDBACK, GRAMMAR_ERRORS and VOCABULARY. Whatever produces it
// (rules here, an LLM adapter in W2-S3), the quest service validates the output
// against `EvaluationSchema` and treats `intent` as EVIDENCE: the server decides
// whether it completes a goal (content `requires`, right NPC, confidence floor).
//
// The rule evaluator is the offline/test implementation and the fallback when no
// model is configured. It is deliberately small; it is not a grammar checker.

import { z } from 'zod';

const intentName = z.string().regex(/^[a-z][a-z0-9_]*$/).max(64);

export const EvaluationSchema = z
  .object({
    npc_response: z.string().min(1).max(2000),
    intent: z.object({ name: intentName, confidence: z.number().min(0).max(1) }),
    feedback: z
      .array(z.object({ type: z.enum(['grammar', 'vocabulary', 'pragmatics', 'praise']), message: z.string().max(500) }))
      .max(3),
    grammar_errors: z
      .array(z.object({ original: z.string().max(300), corrected: z.string().max(300), rule: z.string().max(160) }))
      .max(10),
    vocabulary: z.array(z.object({ term: z.string().max(80), meaning: z.string().max(300) })).max(10),
  })
  .strict();

export const RULE_EVALUATOR_VERSION = 'rule-v1';

const INTENT_PATTERNS = [
  ['ask_time', /\b(when|what time|which day|what day|(is|will) (she|he|dr\.? \w+) (be )?(free|available))\b/i],
  ['ask_place', /\b(where|which (room|office|lab|place|building))\b/i],
  ['confirm_meeting', /\b(see you|deal|confirm|sounds good|perfect|i'?ll be there|works for me|let'?s meet)\b/i],
];

// A handful of B1-typical slips. One correction per turn (doc: "one or two actionable corrections").
const GRAMMAR_RULES = [
  [/\b(didn'?t|doesn'?t|don'?t) (went|saw|came|took|made|did)\b/i, (m) => `${m[1]} ${BASE[m[2].toLowerCase()]}`, 'after did/does/do + not, use the base form of the verb'],
  [/\bwhat did happened\b/i, () => 'what happened', '"what happened?" takes no auxiliary did'],
  [/\bi am agree\b/i, () => 'I agree', '"agree" is a verb: I agree, not I am agree'],
];
const BASE = { went: 'go', saw: 'see', came: 'come', took: 'take', made: 'make', did: 'do' };

const NPC_LINES = {
  ask_time: "She's free on Thursday after two.",
  ask_place: 'Lab B, second floor. Ask for her at the door.',
  confirm_meeting: 'Thursday at two in Lab B, then. See you there.',
  small_talk: "Sure. Anything else I can help you with?",
};

/**
 * Deterministic evaluator. `ctx` is the same object an LLM adapter receives:
 * `{ text, npc, quest, goalsDone }`. Returns a plain object matching EvaluationSchema.
 */
export function ruleEvaluator({ text }) {
  const hit = INTENT_PATTERNS.find(([, re]) => re.test(text));
  const name = hit ? hit[0] : 'small_talk';

  const grammar_errors = [];
  for (const [re, fix, rule] of GRAMMAR_RULES) {
    const m = text.match(re);
    if (m) {
      grammar_errors.push({ original: m[0], corrected: fix(m), rule });
      break;
    }
  }
  const feedback = grammar_errors.length
    ? [{ type: 'grammar', message: `${grammar_errors[0].corrected} — ${grammar_errors[0].rule}` }]
    : [];

  return {
    npc_response: NPC_LINES[name],
    intent: { name, confidence: hit ? 0.9 : 0.5 },
    feedback,
    grammar_errors,
    vocabulary: [],
  };
}
