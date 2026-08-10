// Radar TOPPER (skeleton G) smoke — slice-3.7. Runs the REAL G prompt + REAL Claude CLI on
// a couple of in-memory JOKE candidates and prints the topper it WOULD draft. READ-ONLY:
// no DB read, no DB write, nothing posted. Proves the joke→G voice before anything lands.
//
//   node --import ./scripts/smoke/register-stub.mjs scripts/smoke/run-radar-topper.mjs
//
// It also prints the joke-vs-pain routing for a mixed set so you can see that serious
// tweets are NOT topped (they fall back to the A→F rotation).
import 'dotenv/config';
import {
  RADAR_TOPPER, buildMyTakePrompt, cleanTake, generateTakeViaCli, isJokeCandidate,
} from '../../backend/services/schedule-trigger/action-executors.js';

// In-memory only — never inserted into the candidates table.
const JOKES = [
  { author_handle: 'sumonrazamd17', author_followers: 4200,
    tweet_text: "Two AI agents walk into a bar. One says: 'Quick, order before my context window expires!' The other: 'Too late, I already hallucinated the entire menu in 16 languages.'" },
  { author_handle: 'devhumor', author_followers: 88000,
    tweet_text: "my agent finally has long-term memory. it remembers exactly one thing: that i forgot to pay for the API 😂" },
];

// Mixed set to show routing precision (no CLI for these — routing is deterministic).
const MIXED = [
  { tag: 'joke', tweet_text: 'two agents walk into a bar and forget why' },
  { tag: 'pain', tweet_text: 'tools are getting too pricey, the squeeze is real' },
  { tag: 'signal', tweet_text: 'everyone can build apps now, nobody has distribution' },
  { tag: 'joke-emoji', tweet_text: 'shipped the memory layer, only took 3 rewrites 🤣' },
];

console.log('── routing precision (deterministic, no CLI) ──');
for (const m of MIXED) {
  console.log(`  ${isJokeCandidate(m) ? 'G · TOPPER ' : 'A–F rotate'}  [${m.tag}]  "${m.tweet_text}"`);
}

console.log('\n── live G generation (real Claude CLI via Fable, no DB / no post) ──');
for (const d of JOKES) {
  const { system, user } = buildMyTakePrompt({ d }, RADAR_TOPPER);
  let take;
  try {
    // jokes run on Fable in prod (slice-3.7b) — smoke exercises the same model.
    take = cleanTake(await generateTakeViaCli(system, user, { model: 'claude-fable-5' }), { topper: true });
  } catch (err) {
    console.log(`\n══ @${d.author_handle} ══\n  ✗ ${err.message}`);
    continue;
  }
  console.log(`\n══ [G · Topper] @${d.author_handle} ══`);
  console.log(`  their joke: ${d.tweet_text}`);
  console.log(`  topper (${take.length} chars): ${take}`);
}
process.exit(0);
