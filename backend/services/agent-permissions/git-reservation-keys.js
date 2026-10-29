/** Resolve advisory git locks without executing user shell text. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath } from 'node:fs/promises';
import path from 'node:path';

const execFileAsync = promisify(execFile);
export const LEGACY_GIT_INDEX_KEY = '::git-index::';
const WRITE_VERBS = new Set(['commit', 'add', 'mv', 'rm', 'reset', 'stash', 'merge', 'rebase', 'cherry-pick', 'apply', 'restore']);

// Only literal commands, && and ; are understood. Expansion, redirection,
// pipelines, subshells and wrappers keep the legacy advisory key. Never eval.
function literalCommands(command) {
  if (typeof command !== 'string' || /[$`\\(){}<>|\n\r]/.test(command)) return null;
  const commands = [[]];
  let word = '', quote = null, started = false;
  const flush = () => {
    if (started) commands.at(-1).push(word);
    word = ''; started = false;
  };
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) quote = null;
      else word += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch; started = true;
    } else if (/\s/.test(ch)) {
      flush();
    } else if (ch === ';' || (ch === '&' && command[i + 1] === '&')) {
      flush();
      // cd followed by ; does not guarantee the directory changed.
      if (ch === ';' && commands.at(-1)[0] === 'cd') return null;
      if (ch === '&') i++;
      commands.push([]);
    } else if ('&*?[]#~'.includes(ch)) {
      return null;
    } else {
      word += ch; started = true;
    }
  }
  if (quote) return null;
  flush();
  return commands.filter(parts => parts.length);
}

export async function gitReservationKeys(command, cwd) {
  const fallback = [LEGACY_GIT_INDEX_KEY];
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) return fallback;
  const commands = literalCommands(command);
  if (!commands) return fallback;
  let directory = cwd;
  const targets = [];
  for (const parts of commands) {
    if (parts[0] === 'cd' && parts.length === 2 && !parts[1].startsWith('-')) {
      directory = path.resolve(directory, parts[1]);
      continue;
    }
    // This wrapper always runs Git in cwd; it accepts no global -C/--git-dir.
    if (path.basename(parts[0]) === 'node' &&
        path.basename(parts[1] || '') === 'worktree-git.mjs' &&
        ['commit', 'cherry-pick'].includes(parts[2])) {
      targets.push(directory);
      continue;
    }
    if (parts[0] !== 'git') return fallback;
    let target = directory, i = 1;
    while (parts[i] === '-C') {
      if (!parts[i + 1]) return fallback;
      target = path.resolve(target, parts[i + 1]);
      i += 2;
    }
    // Unknown global options may redirect the repository/index. Do not guess.
    if (!parts[i] || parts[i].startsWith('-')) return fallback;
    if (WRITE_VERBS.has(parts[i])) targets.push(target);
  }
  if (!targets.length) return fallback;
  try {
    const keys = [];
    // Ignore the server's Git environment (e.g. inherited hook GIT_INDEX_FILE).
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
    for (const target of new Set(targets)) {
      const { stdout } = await execFileAsync('git', ['-C', target, 'rev-parse', '--absolute-git-dir'], {
        env, timeout: 1000, maxBuffer: 8192,
      });
      const gitDir = await realpath(stdout.trim());
      keys.push(`${LEGACY_GIT_INDEX_KEY}:${gitDir}`);
    }
    return [...new Set(keys)].sort();
  } catch {
    return fallback;
  }
}
