/**
 * @file critical-denies.test.js
 * ADR-0053 Phase C1 — the pm2 rule of CRITICAL_DENIES.
 *
 * The rule guards IRON RULE 2: an agent must not restart the process it runs
 * inside. It used to be a single whole-string regex, which both over- and
 * under-matched (see the comment on the rule). These cases pin the corrected
 * behaviour in both directions — the allow half matters as much as the deny
 * half, because a false refusal costs an agent its read-only introspection.
 */
import { describe, it, expect } from 'vitest';
import { matchCriticalDeny, deniesPm2Mutation } from '../critical-denies.js';

const deny = (command) => matchCriticalDeny('Bash', { command });
const isPm2Deny = (command) => deny(command)?.id === 'pm2-restart-godcrm-prod';

describe('pm2 guard — refuses what actually kills the worker', () => {
  it.each([
    'pm2 restart godcrm',
    'pm2 reload godcrm',
    'pm2 stop godcrm',
    'pm2 delete godcrm',
    'pm2 restart all',
    'pm2 stop --all',
    'sudo pm2 restart godcrm',
    '/usr/bin/pm2 restart godcrm',
    './node_modules/.bin/pm2 restart godcrm',
    'ssh dev72 "pm2 restart godcrm"',
    'cd /srv/godcrm/live && pm2 restart godcrm',
    'npm run build && pm2 reload godcrm && curl localhost:5000',
  ])('denies %s', (cmd) => {
    expect(isPm2Deny(cmd)).toBe(true);
  });

  it('denies a mutation hidden behind pm2 flags', () => {
    expect(isPm2Deny('pm2 --no-daemon restart godcrm')).toBe(true);
  });

  it('denies `pm2 kill` — the daemon dies with godcrm inside it, no target named', () => {
    // The previous whole-string regex required the literal "godcrm" and so let
    // this through: `pm2 kill` names nothing and kills everything.
    expect(isPm2Deny('pm2 kill')).toBe(true);
    expect(isPm2Deny('pm2 update')).toBe(true);
  });

  it('denies a bare mutating verb with no target (ambiguous → refuse)', () => {
    expect(isPm2Deny('pm2 restart')).toBe(true);
  });

  it('denies a restart driven by an ecosystem file, which names godcrm itself', () => {
    expect(isPm2Deny('pm2 restart ecosystem.config.cjs')).toBe(true);
    expect(isPm2Deny('pm2 startOrRestart /srv/godcrm/live/ecosystem.config.cjs')).toBe(true);
  });

  it('denies a signal sent to godcrm', () => {
    expect(isPm2Deny('pm2 sendSignal SIGINT godcrm')).toBe(true);
  });
});

describe('pm2 guard — lets read-only introspection through', () => {
  it.each([
    'pm2 list',
    'pm2 jlist',
    'pm2 status',
    'pm2 describe godcrm',
    'pm2 show godcrm',
    'pm2 logs godcrm --lines 50 --nostream',
    'pm2 env 0',
    'pm2 monit',
  ])('allows %s', (cmd) => {
    expect(isPm2Deny(cmd)).toBe(false);
  });

  it('allows read-only pm2 inside a composite command that also says "godcrm"', () => {
    // This is the regression: `pm2 jlist` chained with anything mentioning
    // godcrm was refused as if it were a restart, because the old pattern
    // tested the whole string rather than the pm2 invocation.
    expect(isPm2Deny('pm2 jlist | jq -r ".[] | select(.name==\\"godcrm\\") | .pm2_env.status"')).toBe(false);
    expect(isPm2Deny('pm2 list; ls -la /srv/godcrm/live')).toBe(false);
    expect(isPm2Deny('pm2 describe godcrm | grep -E "restart|uptime"')).toBe(false);
  });

  it('is not fooled by the word "restart" appearing as data', () => {
    expect(isPm2Deny('pm2 jlist | jq ".[].pm2_env.restart_time"')).toBe(false);
  });

  it('DELIBERATE over-match: a quote opens a pm2 invocation, so quoted text is refused', () => {
    // A quote has to count as a word boundary, otherwise `ssh dev72 "pm2
    // restart godcrm"` — a real remote restart, refused before this change and
    // after it — would slip past. Telling that apart from a quoted string that
    // merely mentions the command needs a shell parser, which this zero-dep
    // guard is not. The trade is one-sided: a refused `echo` costs nothing, an
    // allowed remote restart costs the ring.
    expect(isPm2Deny('echo "pm2 restart godcrm" >> /tmp/notes.md')).toBe(true);
  });

  it('allows mutating another app — restarting deploy-bot does not kill this worker', () => {
    expect(isPm2Deny('pm2 restart deploy-bot')).toBe(false);
    expect(isPm2Deny('pm2 reload penpot')).toBe(false);
  });

  it('allows a mutation aimed elsewhere when "godcrm" only appears in another segment', () => {
    // The false-positive class the whole-string regex produced: the word
    // godcrm in a path or a grep, several segments away from the pm2 call.
    expect(isPm2Deny('pm2 restart deploy-bot; ls -la /srv/godcrm/live')).toBe(false);
    expect(isPm2Deny('pm2 reload penpot && curl -s localhost:5000/health | grep godcrm')).toBe(false);
  });

  it('allows a bare `pm2` and unknown subcommands (default-allow, unchanged)', () => {
    expect(isPm2Deny('pm2')).toBe(false);
    expect(isPm2Deny('pm2 save')).toBe(false);
  });
});

describe('deniesPm2Mutation — segment splitting', () => {
  it('treats each shell segment separately', () => {
    expect(deniesPm2Mutation('pm2 jlist && echo godcrm')).toBe(false);
    expect(deniesPm2Mutation('pm2 jlist && pm2 restart godcrm')).toBe(true);
  });

  it('sees through command substitution', () => {
    expect(deniesPm2Mutation('echo $(pm2 restart godcrm)')).toBe(true);
    expect(deniesPm2Mutation('echo `pm2 stop godcrm`')).toBe(true);
  });

  it('handles a multi-line script', () => {
    expect(deniesPm2Mutation('pm2 list\ncd /tmp\npm2 restart godcrm\n')).toBe(true);
    expect(deniesPm2Mutation('pm2 list\ncd /srv/godcrm/live\npm2 jlist\n')).toBe(false);
  });
});

describe('CRITICAL_DENIES — the other rules still fire', () => {
  it('still refuses rm -rf /', () => {
    expect(deny('rm -rf /')?.id).toBe('fs-rm-rf-root');
  });

  it('still refuses DROP DATABASE', () => {
    expect(deny('psql -c "DROP DATABASE godcrm_prod"')?.id).toBe('db-drop-database');
  });

  it('still refuses a force-push to main', () => {
    expect(deny('git push --force origin main')?.id).toBe('git-force-push-main');
  });

  it('still refuses systemctl restart of godcrm', () => {
    expect(deny('systemctl restart godcrm')?.id).toBe('systemctl-godcrm');
  });

  it('still refuses make prod', () => {
    expect(deny('make prod')?.id).toBe('make-prod');
  });

  it('still refuses writing .env', () => {
    expect(matchCriticalDeny('Edit', { file_path: '/srv/godcrm/live/.env' })?.id).toBe('edit-env');
  });

  it('allows an ordinary command', () => {
    expect(deny('npm test -- --maxWorkers=3')).toBeNull();
  });
});
