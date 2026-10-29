#!/usr/bin/env python3
"""Independent staging executor — a root-owned systemd service, NOT a godcrm child.

The CRM broker (backend/services/ops/stagingExecutionBroker.js) connects to the
Unix socket and writes ONE JSON line `{"body": {...}, "sig": "<hmac-sha256>"}`.
The key is provisioned out of band (STAGING_CHANNEL_KEY_FILE, root 0600); the
broker reads the same file. Everything in `body` is re-validated here against
this process's own fixed configuration: the single action, the sysadmin role,
the fixed target, the fixed source repo and this installation's own digest.
Nothing in the request can name a command, path, host, env, role or grant.

Authorization lasts exactly as long as the broker keeps the connection open:
EOF (broker died, grant revoked, lease lost) kills the preflight process group
and the reply is `status: revoked, exit_code 124`. The deadline is enforced
here too. One run at a time; a second connection during a run is `busy`.

    executor.py            serve (systemd)
    executor.py --digest   print this installation's executor digest
"""
import hashlib
import hmac
import json
import os
import re
import signal
import socket
import struct
import subprocess
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
FILES = ('executor.py', 'preflight.py')
TARGET = {'host_alias': 'dev72', 'host': '<DEV_IP>', 'domain': 'dev.godcrm.ai', 'database': 'godcrm_test'}
ACTIONS = frozenset(('staging.preflight',))
ROLES = frozenset(('sysadmin',))
INT_KEYS = ('v', 'run_id', 'issued_at', 'deadline_s', 'agent_id', 'space_id')
STR_KEYS = ('nonce', 'action', 'job_id', 'role', 'candidate_sha', 'source_repo', 'expected_executor_sha256')
BODY_KEYS = frozenset(INT_KEYS + STR_KEYS + ('target',))
SKEW_SECONDS = 60
MAX_LINE = 16384
MAX_OUTPUT = 256 * 1024
CLEAN_ENV = {'LANG': 'C.UTF-8', 'HOME': '/root', 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null'}

RUN_LOCK = threading.Lock()
NONCES = {}
NONCE_LOCK = threading.Lock()


def config():
    env = os.environ
    return {
        'socket': env.get('STAGING_SOCKET', '/run/godcrm-staging-executor/executor.sock'),
        'key_file': env.get('STAGING_CHANNEL_KEY_FILE', '/etc/godcrm-staging-executor/channel.key'),
        'source_repo': env.get('STAGING_SOURCE_REPO', '/root/production/business-crm'),
        'timeout': int(env.get('STAGING_PREFLIGHT_TIMEOUT', '120')),
        'remote': env.get('STAGING_PREFLIGHT_REMOTE', '1') == '1',
        'coord_db': env.get('STAGING_COORD_DB', 'godcrm_prod'),
        'peer_uids': {int(u) for u in env.get('STAGING_PEER_UIDS', '0').split(',') if u.strip()},
        'path': env.get('PATH', '/usr/sbin:/usr/bin:/sbin:/bin'),
    }


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def sign(key, body):
    return hmac.new(key.encode(), canonical(body).encode(), 'sha256').hexdigest()


def executor_digest(root=HERE):
    digest = hashlib.sha256()
    for name in FILES:
        digest.update(name.encode() + b'\0' + (Path(root) / name).read_bytes() + b'\0')
    return digest.hexdigest()


def load_key(path):
    key = Path(path).read_text().strip()
    if len(key) < 32:
        raise SystemExit('channel key too short')
    return key


def nonce_fresh(nonce, now):
    with NONCE_LOCK:
        for seen, at in list(NONCES.items()):
            if now - at > 2 * SKEW_SECONDS:
                del NONCES[seen]
        if nonce in NONCES:
            return False
        NONCES[nonce] = now
        return True


def validate(body, cfg, now):
    """Return a denial reason or None. Order matters: cheap and generic first."""
    if not isinstance(body, dict) or set(body) != BODY_KEYS:
        return 'invalid_request'
    if any(not isinstance(body[k], int) or isinstance(body[k], bool) for k in INT_KEYS):
        return 'invalid_request'
    if any(not isinstance(body[k], str) for k in STR_KEYS) or not isinstance(body['target'], dict):
        return 'invalid_request'
    if body['v'] != 1:
        return 'unsupported_version'
    if abs(now - body['issued_at']) > SKEW_SECONDS:
        return 'stale_request'
    if not re.fullmatch('[0-9a-f]{32}', body['nonce']) or not nonce_fresh(body['nonce'], now):
        return 'replay'
    if body['action'] not in ACTIONS:
        return 'action_denied'
    if body['role'] not in ROLES:
        return 'role_denied'
    if not re.fullmatch('[0-9a-f]{40}', body['candidate_sha']):
        return 'invalid_sha'
    if body['target'] != TARGET:
        return 'target_mismatch'
    try:
        if os.path.realpath(body['source_repo']) != os.path.realpath(cfg['source_repo']):
            return 'repo_mismatch'
    except OSError:
        return 'repo_mismatch'
    if body['expected_executor_sha256'] != executor_digest():
        return 'executor_digest_mismatch'
    if body['deadline_s'] <= 0:
        return 'deadline_denied'
    return None


def kill_group(child):
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(child.pid, sig)
        except ProcessLookupError:
            return
        try:
            child.wait(timeout=2)
            return
        except subprocess.TimeoutExpired:
            continue


def run_preflight(conn, body, cfg):
    """Spawn preflight.py in its own session; stop it on broker EOF or deadline."""
    state = {'revoked': False, 'timeout': False}
    deadline = min(body['deadline_s'], cfg['timeout'])  # the installation's cap always wins
    env = dict(CLEAN_ENV, PATH=cfg['path'])
    child = subprocess.Popen(
        [sys.executable, str(HERE / 'preflight.py')], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, env=env, start_new_session=True, cwd='/')
    started = time.time()

    def watch():
        conn.settimeout(0.5)
        while child.poll() is None:
            try:
                if conn.recv(1, socket.MSG_PEEK) == b'':
                    state['revoked'] = True
                    kill_group(child)
                    return
            except socket.timeout:
                pass
            except OSError:
                state['revoked'] = True
                kill_group(child)
                return
            if time.time() - started > deadline:
                state['timeout'] = True
                kill_group(child)
                return

    watcher = threading.Thread(target=watch, daemon=True)
    watcher.start()
    payload = json.dumps({
        'run_id': body['run_id'], 'candidate_sha': body['candidate_sha'], 'source_repo': cfg['source_repo'],
        'target': TARGET, 'remote': cfg['remote'], 'coord_db': cfg['coord_db'], 'executor_root': str(HERE),
    })
    try:
        out, err = child.communicate(payload.encode(), timeout=deadline + 5)
    except subprocess.TimeoutExpired:
        state['timeout'] = True
        kill_group(child)
        out, err = child.communicate()
    watcher.join(timeout=2)
    finished = time.time()
    out, err = out[:MAX_OUTPUT], err[:MAX_OUTPUT]
    log_sha256 = hashlib.sha256(out + b'\0' + err).hexdigest()
    report = {'started_at': int(started), 'finished_at': int(finished), 'log_sha256': log_sha256, 'checks': None}
    if state['revoked']:
        report.update(status='revoked', exit_code=124)
    elif state['timeout']:
        report.update(status='timeout', exit_code=124)
    else:
        try:
            parsed = json.loads(out.decode('utf-8', 'replace'))
            checks = parsed.get('checks') if isinstance(parsed, dict) else None
        except ValueError:
            checks = None
        if isinstance(checks, dict) and child.returncode in (0, 1):
            report.update(status='finished' if child.returncode == 0 else 'preflight_failed',
                          exit_code=child.returncode, checks=checks)
        else:
            report.update(status='failed', exit_code=125)
    return report


def peer_uid(conn):
    creds = conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize('iII'))
    _pid, uid, _gid = struct.unpack('iII', creds)
    return uid


def read_line(conn):
    conn.settimeout(10)
    buf = b''
    while b'\n' not in buf:
        chunk = conn.recv(4096)
        if not chunk:
            return None
        buf += chunk
        if len(buf) > MAX_LINE:
            return None
    return buf.split(b'\n', 1)[0]


def handle(conn, cfg, key):
    digest = executor_digest()

    def reply(body):
        try:
            conn.sendall((json.dumps({'body': body, 'sig': sign(key, body)}) + '\n').encode())
        except OSError:
            pass

    def deny(reason, body=None):
        reply({'v': 1, 'run_id': body.get('run_id') if isinstance(body, dict) else None,
               'nonce': body.get('nonce') if isinstance(body, dict) else None,
               'status': 'denied', 'denied': reason, 'executor_sha256': digest})

    try:
        if peer_uid(conn) not in cfg['peer_uids']:
            return deny('peer_denied')
        line = read_line(conn)
        if line is None:
            return deny('invalid_envelope')
        try:
            envelope = json.loads(line)
        except ValueError:
            return deny('invalid_envelope')
        if not isinstance(envelope, dict) or set(envelope) != {'body', 'sig'} or not isinstance(envelope['body'], dict):
            return deny('invalid_envelope')
        body = envelope['body']
        if not isinstance(envelope['sig'], str) or not hmac.compare_digest(sign(key, body), envelope['sig']):
            return deny('bad_signature', body)
        reason = validate(body, cfg, int(time.time()))
        if reason:
            return deny(reason, body)
        if not RUN_LOCK.acquire(blocking=False):
            return deny('busy', body)
        try:
            report = run_preflight(conn, body, cfg)
        finally:
            RUN_LOCK.release()
        report.update(v=1, run_id=body['run_id'], nonce=body['nonce'], action=body['action'],
                      executor_sha256=digest, target=TARGET)
        reply(report)
    finally:
        try:
            conn.close()
        except OSError:
            pass


def serve(cfg):
    key = load_key(cfg['key_file'])
    sock_path = Path(cfg['socket'])
    sock_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if sock_path.exists():
        sock_path.unlink()
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(str(sock_path))
    os.chmod(str(sock_path), 0o600)
    server.listen(4)
    sys.stdout.write(json.dumps({'listening': str(sock_path), 'executor_sha256': executor_digest(),
                                 'remote_checks': cfg['remote'], 'source_repo': cfg['source_repo']}) + '\n')
    sys.stdout.flush()
    while True:
        conn, _ = server.accept()
        threading.Thread(target=handle, args=(conn, cfg, key), daemon=True).start()


def main(argv):
    if argv[1:] == ['--digest']:
        sys.stdout.write(executor_digest() + '\n')
        return 0
    if argv[1:]:
        sys.stderr.write('usage: executor.py [--digest]\n')
        return 2
    serve(config())
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
