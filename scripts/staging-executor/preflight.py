#!/usr/bin/env python3
"""Read-only staging preflight — spawned by executor.py only.

Reads one JSON object on stdin (run_id, candidate_sha, source_repo, target,
remote, coord_db, executor_root) and prints `{"ok": bool, "checks": {...}}`.
Exit 0 when every check passed, 1 otherwise. A positive result never
authorizes a release.

Every check is bounded, sanitized (enums, digests, counts, booleans — no raw
command output, env or secrets) and read-only: this file never stops
services, installs files, copies payloads, restores data, builds or deploys.
"""
import hashlib
import json
import os
import re
import ssl
import subprocess
import sys
import urllib.error
import urllib.request

AGENT_HOME_IP = '<PROD_IP>'
SSH = ['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10']
CONFIG_FILES = ('scripts/deploy.local.env', 'scripts/staging-sync.exclude', 'scripts/dev-operation.sh',
                'scripts/dev-refresh.sh', 'scripts/staging-lease.sh', 'Makefile')
PSQL = ['runuser', '-u', 'postgres', '--', 'psql', '-v', 'ON_ERROR_STOP=1', '-qAt', '-d']


def run(cmd, timeout=20, stdin=None):
    done = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, input=stdin)
    return done.returncode, done.stdout, done.stderr


def digest_file(path):
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()


def guarded(fn, *args):
    try:
        return fn(*args)
    except Exception as error:  # noqa: BLE001 — class name only, never the message
        return {'ok': False, 'error': type(error).__name__}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        raise urllib.error.HTTPError(None, 310, 'redirect refused', None, None)


def fetch(url, limit=65536):
    opener = urllib.request.build_opener(NoRedirect, urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    with opener.open(url, timeout=10) as response:
        return response.status, response.read(limit).decode('utf-8', 'replace')


# ─── local checks ───────────────────────────────────────────────────

def host_identity():
    rc, out, _ = run(['hostname', '-I'])
    addrs = out.split()
    machine = hashlib.sha256(open('/etc/machine-id', 'rb').read()).hexdigest()[:16]
    return {'ok': rc == 0 and AGENT_HOME_IP in addrs, 'hostname': os.uname().nodename,
            'agent_home': AGENT_HOME_IP in addrs, 'machine_id_digest': machine}


def source(repo, sha):
    git = ['git', '-C', repo]
    _, head, _ = run(git + ['rev-parse', 'HEAD'])
    _, branch, _ = run(git + ['branch', '--show-current'])
    _, status, _ = run(git + ['status', '--porcelain', '--untracked-files=no', '--', '.', ':!.mcp.json'])
    exists = run(git + ['cat-file', '-e', f'{sha}^{{commit}}'])[0] == 0
    head, branch = head.strip(), branch.strip()
    clean = status.strip() == ''
    return {'ok': exists and head == sha and clean, 'head': head, 'candidate_exists': exists,
            'head_is_candidate': head == sha, 'branch': branch, 'on_main': branch == 'main', 'clean': clean}


def installed_code(root):
    bad = []
    for name in ('executor.py', 'preflight.py'):
        st = os.stat(os.path.join(root, name))
        if st.st_uid != 0 or st.st_mode & 0o022:
            bad.append(name)
    st = os.stat(root)
    if st.st_uid != 0 or st.st_mode & 0o022:
        bad.append('.')
    return {'ok': not bad, 'root': root, 'unprotected': bad}


def config_digests(repo, target):
    digests = {}
    for rel in CONFIG_FILES:
        path = os.path.join(repo, rel)
        digests[rel] = digest_file(path) if os.path.isfile(path) else None
    dev_host = None
    env_file = os.path.join(repo, 'scripts/deploy.local.env')
    if os.path.isfile(env_file):
        match = re.search(r'^DEV_HOST=(\S+)', open(env_file).read(), re.M)
        dev_host = match.group(1).strip('"\'') if match else None
    return {'ok': all(digests.values()) and dev_host == target['host_alias'], 'digests': digests,
            'dev_host': dev_host}


def coordination(coord_db, run_id):
    def count(sql):
        rc, out, _ = run(PSQL + [coord_db, '-c', sql])
        if rc != 0:
            raise RuntimeError('psql')
        return int(out.strip() or 0)
    jobs = count("select count(*) from agent_jobs where status in ('processing','pending')")
    reservations = count('select count(*) from _agent_write_reservations where expires_at > now()')
    foreign = count('select count(*) from ops_staging_leases where released_at is null and expires_at > now() '
                    f'and coalesce(run_id, -1) <> {int(run_id)}')
    return {'ok': reservations == 0 and foreign == 0, 'jobs_unfinished': jobs,
            'reservations_live': reservations, 'foreign_leases_live': foreign, 'database': coord_db}


def refresh_state():
    _, active, _ = run(['systemctl', 'show', 'godcrm-dev-refresh.service', '-p', 'ActiveState', '--value'])
    _, next_run, _ = run(['systemctl', 'show', 'godcrm-dev-refresh.timer', '-p', 'NextElapseUSecRealtime', '--value'])
    active = active.strip() or 'unknown'
    return {'ok': active == 'inactive', 'service': active, 'timer_next': next_run.strip()[:40] or None}


# ─── remote (dev72) checks ──────────────────────────────────────────

def remote_identity(alias):
    rc, out, _ = run(SSH + [alias, 'cat', '/etc/machine-id'])
    local = open('/etc/machine-id').read().strip()
    remote = out.strip()
    return {'ok': rc == 0 and bool(remote) and remote != local, 'distinct': bool(remote) and remote != local,
            'machine_id_digest': hashlib.sha256(remote.encode()).hexdigest()[:16] if remote else None}


def remote_runtime_db(alias, repo):
    script = open(os.path.join(repo, 'scripts/dev-runtime-check.mjs')).read()
    rc, _, _ = run(SSH + [alias, f'cd {repo} && node --input-type=module'], timeout=40, stdin=script)
    return {'ok': rc == 0, 'exit_code': rc}


def remote_runtime(alias):
    rc, out, _ = run(SSH + [alias, 'pm2', 'jlist'], timeout=30)
    processes = {}
    for proc in json.loads(out or '[]'):
        if proc.get('name') in ('godcrm', 'bdd-runner'):
            env = proc.get('pm2_env') or {}
            processes[proc['name']] = {'pid': proc.get('pid'), 'status': env.get('status'),
                                       'pm_uptime': env.get('pm_uptime'), 'restarts': env.get('restart_time')}
    return {'ok': rc == 0 and processes.get('godcrm', {}).get('status') == 'online', 'processes': processes}


def remote_cron_writers(alias):
    rc, out, _ = run(SSH + [alias, 'crontab', '-l'])
    lines = [l for l in out.splitlines() if l.strip() and not l.lstrip().startswith('#')]
    names = ('sync-uploads', 'architect-cron', 'pg_dump', 'backup')
    present = sorted({n for n in names if any(n in l for l in lines)})
    return {'ok': rc == 0, 'crontab_digest': hashlib.sha256(out.encode()).hexdigest(), 'entries': len(lines),
            'unexcluded_writers': present}


def health(domain):
    status, body = fetch(f'https://{domain}/api/health')
    data = json.loads(body)
    app = data.get('status') if data.get('status') in ('ok', 'degraded', 'error') else 'unknown'
    db = (data.get('database') or {}).get('status')
    db = db if db in ('connected', 'disconnected', 'error') else 'unknown'
    return {'ok': status == 200 and app == 'ok' and db == 'connected', 'http': status, 'status': app, 'database': db}


def served_release(domain):
    status, body = fetch(f'https://{domain}/')
    match = re.search(r'/assets/(index-[A-Za-z0-9_-]+\.js)', body)
    return {'ok': status == 200 and bool(match), 'http': status, 'asset': match.group(1) if match else None}


def main():
    spec = json.loads(sys.stdin.read() or '{}')
    repo, sha, target = spec['source_repo'], spec['candidate_sha'], spec['target']
    checks = {
        'host_identity': guarded(host_identity),
        'source': guarded(source, repo, sha),
        'installed_code': guarded(installed_code, spec['executor_root']),
        'config_digests': guarded(config_digests, repo, target),
        'coordination': guarded(coordination, spec['coord_db'], spec['run_id']),
        'refresh_state': guarded(refresh_state),
    }
    if spec.get('remote'):
        alias = target['host_alias']
        checks.update({
            'remote_identity': guarded(remote_identity, alias),
            'remote_runtime_db': guarded(remote_runtime_db, alias, repo),
            'remote_runtime': guarded(remote_runtime, alias),
            'remote_cron_writers': guarded(remote_cron_writers, alias),
            'health': guarded(health, target['domain']),
            'served_release': guarded(served_release, target['domain']),
        })
    ok = all(c.get('ok') is True for c in checks.values())
    sys.stdout.write(json.dumps({'ok': ok, 'remote': bool(spec.get('remote')), 'checks': checks}) + '\n')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
