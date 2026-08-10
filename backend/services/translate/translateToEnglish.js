// backend/services/translate/translateToEnglish.js
// RU→EN translation for the Anti-Marketing Marketing Club pipeline.
//
// This box has no Anthropic API key — Claude access is the OAuth subscription
// via the `claude-translate` CLI (Sonnet, retry/backoff-wrapped, token in
// /root/.config/godcrm-translate.env). We shell out to it rather than call
// api.anthropic.com directly.
//
// Three voice profiles (build-in-public EN channel):
//   - 'kitchen' : raw machine dub of AI "kitchen" output. Do NOT smooth or
//                 improve. Keeps the leading 🍳 marker, appends a sober footer.
//   - 'voice'   : the owner's personal posts. Adaptation by voice. No footer.
//   - 'twitter' : tweet-shaped EN adaptation of a voice post, staged into the
//                 twitter_stage topic for manual posting to X. No footer.

import { spawn } from 'child_process';
import { apiLogger } from '../../utils/logger.js';

const CLI = process.env.CLAUDE_TRANSLATE_BIN || 'claude-translate';
const TIMEOUT_MS = 180000;

const KITCHEN_FOOTER = '🤖 auto-translated from Russian';

const PROMPTS = {
  kitchen:
    "Translate this Russian Telegram post to English. It is raw, copy-pasted AI " +
    "\"kitchen\" output. Translate faithfully — do NOT polish, smooth, summarize, or " +
    "improve it; if the source is clumsy, stay clumsy. Preserve line breaks, lists, " +
    "and any leading emoji (including a leading 🍳). Output ONLY the translation, no " +
    "preamble, no quotes.",
  voice:
    "Translate this Russian Telegram post by an indie builder to English. Adapt it in " +
    "a raw, lowercase, personal voice — not a literal word-for-word gloss. No marketing, " +
    "no calls to action, no hype. Preserve the brand line \"we eat ourselves to grow, " +
    "live\" if present. Output ONLY the translation, no preamble, no quotes.",
  twitter:
    "Adapt this Russian Telegram post into a single English tweet for an indie builder's " +
    "X account. Lowercase, punchy, tighter than the original — cut to the core idea so it " +
    "fits comfortably in one tweet. Raw personal voice. No marketing, no hashtags, no " +
    "calls to action, no hype, no links. Preserve the brand line \"we eat ourselves to " +
    "grow, live\" if present. You may end with one short, neutral line noting the fuller " +
    "stuff lives in telegram — a plain statement, never \"click\"/\"join\"/a link — and " +
    "only if it fits naturally. Output ONLY the tweet text, no preamble, no quotes.",
};

/**
 * Translate Russian text to English under a given voice profile.
 * @param {string} ruText - Source Russian text
 * @param {'kitchen'|'voice'|'twitter'} [mode='kitchen'] - Voice profile
 * @returns {Promise<{success: boolean, text?: string, error?: string}>}
 */
export async function translateToEnglish(ruText, mode = 'kitchen') {
  const source = (ruText || '').trim();
  if (!source) return { success: false, error: 'empty source text' };

  const prompt = PROMPTS[mode] || PROMPTS.kitchen;

  let out;
  try {
    out = await runCli(source, prompt);
  } catch (err) {
    apiLogger.error({ err: err.message, mode }, '[translate] CLI failed');
    return { success: false, error: err.message };
  }

  const translated = (out || '').trim();
  if (!translated) return { success: false, error: 'empty translation' };

  const text = mode === 'kitchen' ? `${translated}\n\n${KITCHEN_FOOTER}` : translated;
  return { success: true, text };
}

/** Spawn claude-translate, feed source on stdin, resolve stdout. */
function runCli(source, prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn(CLI, [], {
      cwd: '/tmp', // CLI writes a transient err.$$ file in cwd
      env: {
        ...process.env,
        PROMPT_OVERRIDE: prompt,
        // ensure the bundled `claude` binary is reachable from the PM2 env
        PATH: `${process.env.PATH || ''}:/usr/local/bin:/usr/bin`,
      },
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('translate timeout'));
    }, TIMEOUT_MS);

    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`claude-translate exit ${code}: ${stderr.trim().slice(0, 160)}`));
    });

    child.stdin.write(source);
    child.stdin.end();
  });
}

export { KITCHEN_FOOTER };
