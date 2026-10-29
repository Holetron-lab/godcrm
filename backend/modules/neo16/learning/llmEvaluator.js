// Neo16 W2-S4 — LLM evaluator adapter: the provider-agnostic core.
//
// Produces the same `EvaluationSchema` object as the rule evaluator, but from a model. The
// adapter owns PROMPT → PARSE → VALIDATE; the network call is an injected transport
// `complete({ system, user }) → Promise<string>`, so vitest never reaches a provider (tests
// inject a deterministic fake) and the provider/model choice lives in exactly one place: the
// transport wired by routes.js. The quest service keeps treating `intent` as EVIDENCE — nothing
// the model says can complete a goal or award XP by itself (doc 239900 §Learning Loop 4, 5).
//
// Parse/validation failures throw; `submitUtterance` turns that into a `failed`, retryable
// receipt and a 502 EVALUATION_FAILED (doc §Runtime step 3: many attempts, one commit).

import { EvaluationSchema } from './evaluator.js';

export const LLM_EVALUATOR_VERSION = 'llm-v1';
export const SMALL_TALK = 'small_talk';

const OUTPUT_SHAPE =
  '{"npc_response": string, "intent": {"name": string, "confidence": number 0..1}, ' +
  '"feedback": [{"type": "grammar"|"vocabulary"|"pragmatics"|"praise", "message": string}], ' +
  '"grammar_errors": [{"original": string, "corrected": string, "rule": string}], ' +
  '"vocabulary": [{"term": string, "meaning": string}]}';

/**
 * Prompt for one utterance. `ctx` is what `submitUtterance` passes to any evaluator:
 * `{ text, npc, quest, goalsDone }` — the quest is the durable content row.
 * Only goals the learner can complete with THIS NPC right now are disclosed, so the
 * model cannot leak later-stage answers; the server still decides what counts.
 */
export function buildPrompt({ text, npc, quest, goalsDone = [] }) {
  const done = new Set(goalsDone);
  const goals = quest.payload.goals;
  const open = goals.filter((g) => !done.has(g.key) && g.npc === npc.key && (g.requires ?? []).every((r) => done.has(r)));
  const intents = [...new Set([...goals.map((g) => g.intent), SMALL_TALK])];
  const system = [
    `You play ${npc.name}, ${npc.role}, in an English-practice town game. Persona: ${npc.persona}`,
    `Quest: ${quest.title}. ${quest.payload.intro}`,
    `The learner is around ${quest.level_hint ?? 'B1'}. Always answer in English, in character, in one or two short sentences. Never translate.`,
    `Reveal information only when the learner asks for it. Goals the learner can complete with you right now: ${
      open.map((g) => `${g.intent} — ${g.title}`).join('; ') || 'none'}.`,
    `Then classify the learner's message: "intent.name" is exactly one of ${intents.join(', ')}; "confidence" is 0..1.`,
    'Give at most two actionable corrections as "feedback" (type "praise" is allowed), list real grammar errors with the ' +
      'corrected form and a short rule, and up to three useful vocabulary items. Do not correct what is already correct.',
    `Reply with ONLY one JSON object, no prose: ${OUTPUT_SHAPE}`,
  ].join('\n');
  return { system, user: text, intents, openGoals: open.map((g) => g.key) };
}

/** Tolerates a fenced block or prose around the object; anything else is a parse error. */
export function parseModelJson(raw) {
  const s = String(raw).trim();
  const fenced = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const body = fenced ? fenced[1] : s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1);
  return JSON.parse(body);
}

/**
 * @param {object} opts
 * @param {(req: {system: string, user: string}) => Promise<string>} opts.complete  provider transport
 * @param {string} opts.model  recorded on every turn as `evaluator_version` = `llm-v1:<model>`
 * @returns {{ evaluate: (ctx: object) => Promise<object>, evaluatorVersion: string }}
 */
export function createLlmEvaluator({ complete, model }) {
  if (typeof complete !== 'function' || !model) throw new TypeError('createLlmEvaluator needs { complete, model }');
  return {
    evaluatorVersion: `${LLM_EVALUATOR_VERSION}:${model}`,
    async evaluate(ctx) {
      const { system, user } = buildPrompt(ctx);
      return EvaluationSchema.parse(parseModelJson(await complete({ system, user })));
    },
  };
}
