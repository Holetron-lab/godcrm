import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildSubjects, matchCriticalDeny } from '../critical-denies.js';
import { literalDocumentCommand } from '../literal-document.js';

// Test data only; never passed to a shell. Same convention as codex-hook tests.
const restart = ['pm2', 'restart', 'godcrm'].join(' ');
const kill = ['pm2', 'kill'].join(' ');
const deploy = ['make', 'prod'].join(' ');
const drop = ['DROP', 'DATABASE', 'godcrm_prod'].join(' ');
const body = `Never run ${restart} or ${deploy}.\n${drop} is forbidden.\n$(${kill}) \`${restart}\``;
const doc = (header = "cat > /tmp/PROD-BOT.md <<'DOC'") => `${header}\n${body}\nDOC\n`;
const deny = (command) => matchCriticalDeny('Bash', { command });

describe('literal document writes', () => {
  it.each([
    "cat > /tmp/PROD-BOT.md <<'DOC'",
    'cat >> /tmp/REPORT.txt <<"DOC"',
    "cat <<'DOC' > ./notes.md",
    '/usr/bin/cat <<"DOC" >> "./notes.txt"',
    "/bin/cat > './notes.md' <<'DOC'",
  ])('does not treat the literal body as execution: %s', (header) => {
    expect(literalDocumentCommand(doc(header))).toBe(header);
    expect(deny(doc(header))).toBeNull();
  });

  it('retains the original command for DB policies and audit', () => {
    expect(buildSubjects('Bash', { command: doc() }).bash).toBe(doc());
  });

  it.each([
    'cat > /tmp/notes.md <<DOC',
    "bash > /tmp/notes.md <<'DOC'",
    "sh <<'DOC' > /tmp/notes.md",
    "python3 <<'DOC' > /tmp/notes.md",
    "psql <<'DOC' > /tmp/notes.md",
    "ssh host <<'DOC' > /tmp/notes.md",
    "sudo cat > /tmp/notes.md <<'DOC'",
    "cat <<'DOC' | bash",
    "cat > /tmp/notes.sh <<'DOC'",
    "cat > /tmp/notes.md <<-'DOC'",
    "cat > /tmp/notes.md <<'DOC' <<'OTHER'",
    "cat > /tmp/notes.md <<'DOC' &",
    `cat > /tmp/notes.md <<'DOC'; ${restart}`,
    "cat > /tmp/notes.md <<'DOC' # comment",
    `cat > $(${kill}).md <<'DOC'`,
    `cat > '/tmp/notes.md' 2>$(${kill}) <<'DOC'`,
    "cat > /tmp/notes.md <<'DOC\"",
  ])('preserves conservative scanning (%#)', (header) => {
    const command = doc(header);
    expect(literalDocumentCommand(command)).toBe(command);
    expect(deny(command)).not.toBeNull();
  });

  it.each([
    `${doc()}${restart}\n`,
    `${doc()}${restart}\nDOC\n`,
    `${restart}\n${doc()}`,
    `eval "${doc()}"`,
    doc().replace(/DOC\n$/, ''),
    doc().replace(/DOC\n$/, ' DOC\n'),
    doc().replace(/DOC\n$/, 'DOC\r\n'),
    `cat() { ${restart}; }\n${doc()}`,
    `echo "\n${doc()}\n"`,
  ])('never hides other execution or malformed syntax (%#)', (command) => {
    expect(literalDocumentCommand(command)).toBe(command);
    expect(deny(command)).not.toBeNull();
  });

  it.each([restart, kill, deploy, ['rm', '-rf', '/'].join(' '), `psql -c "${drop}"`])('still denies actual commands (%#)', (command) => {
    expect(deny(command)).not.toBeNull();
  });

  it.each(['claude', 'codex'])('checks real hook transport (%s), without executing supplied commands', (dialect) => {
    const hook = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../scripts/agent-permission-hook.js');
    for (const [command, denied] of [[doc(), false], [`${doc()}${kill}`, true]]) {
      const result = spawnSync(process.execPath, [hook], {
        input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
        encoding: 'utf8',
        env: { ...process.env, AGENT_PERMS_TOKEN: '', AGENT_HOOK_DIALECT: dialect },
        timeout: 5000,
      });
      expect(result.status).toBe(0);
      if (dialect === 'codex' && !denied) expect(result.stdout).toBe('');
      else expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe(denied ? 'deny' : 'allow');
    }
  });
});
