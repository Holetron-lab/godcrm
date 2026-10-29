"""Fixed Docker adapter; no shell, mutable worktree imports or agent parameters."""
import fcntl
import json
import os
from pathlib import Path
import select
import subprocess
import time
from core import ROOT, ETC, RUN, STATE, canonical, digest, pins, read_json, trusted, exact, staging_session
from egress import tls_probe

ENV = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'HOME': '/nonexistent'}
DOCKER = '/usr/bin/docker'


def command(args, timeout=2):
    result = subprocess.run(args, env=ENV, stdin=subprocess.DEVNULL, capture_output=True, timeout=timeout, check=True)
    if len(result.stdout) > 1048576:
        raise ValueError('output_limit')
    return result.stdout


def actual_pins(root=ROOT):
    manifest = read_json(root / 'installation.json', 1048576)
    exact(manifest, {'files', 'image', 'groups'})
    paths = manifest['files']
    if set(p.name for p in root.iterdir()) != set(paths) | {'installation.json', 'manifest.json'}:
        raise ValueError('unmeasured_installation_file')
    if not isinstance(paths, dict) or not paths:
        raise ValueError('installation_files')
    for name, checksum in paths.items():
        if not isinstance(name, str) or name.startswith('/') or '..' in Path(name).parts:
            raise ValueError('installation_path')
        file = trusted(root / name)
        if digest(file.read_bytes()) != checksum:
            raise ValueError('installation_changed')
    groups = manifest['groups']
    exact(groups, {'executor', 'dependencies', 'seccomp', 'egress', 'suites'})
    result = {group: digest(canonical({name: paths[name] for name in names})) for group, names in groups.items()}
    result.update(image=manifest['image'], installation=digest(canonical(manifest)))
    pins(result)
    if result != read_json(root / 'manifest.json', 16384):
        raise ValueError('pins_changed')
    image = json.loads(command([DOCKER, 'image', 'inspect', result['image']]))[0]
    if image['Id'] != result['image']:
        raise ValueError('image_changed')
    return result


def attest(candidate):
    import uuid
    nonce = str(uuid.uuid4())
    # Dedicated SSH key with forced command, pinned known_hosts, no forwarding.
    raw = command(['/usr/bin/ssh', '-F', str(trusted(ETC / 'ssh_config', True)),
                   'godcrm-browser-attest', nonce], timeout=3)
    receipt = json.loads(raw)
    exact(receipt, {'nonce', 'candidate_sha', 'database', 'verified_at', 'asset_sha256'})
    if receipt['nonce'] != nonce or receipt['candidate_sha'] != candidate or receipt['database'] != 'godcrm_test' or not 0 <= time.time() - receipt['verified_at'] <= 5:
        raise ValueError('staging_attestation')
    from core import match
    match(receipt['asset_sha256'], '[a-f0-9]{64}')
    return receipt


def prerequisites(body, ledger):
    """Measured prerequisites shared by IPC and administrative qualification."""
    observed = actual_pins()
    if observed != body['pins']:
        raise ValueError('pin_mismatch')
    if not ledger.reaper_ready():
        raise ValueError('reaper_unavailable')
    if Path('/proc/sys/kernel/unprivileged_userns_clone').read_text().strip() != '1' or not tls_probe():
        raise ValueError('sandbox_tls_unavailable')
    staging_session(read_json(ETC / 'staging-session.json', 32768, private=True), body.get('deadline_at'))
    receipt = attest(body['candidate_sha'])
    return {'pins': observed, 'candidate_sha': body['candidate_sha'], 'database': 'godcrm_test',
            'receipt': receipt}


def readiness(body, ledger):
    from acceptance import accepted
    if actual_pins() != body['pins']:
        raise ValueError('pin_mismatch')
    # No administrative flag/operation reaches this path. Even valid old acceptance
    # cannot reopen IPC during qualification. Check before any network or allocation.
    checks = accepted(body)
    measured = prerequisites(body, ledger)
    return {'pins': measured['pins'], 'candidate_sha': measured['candidate_sha'],
            'database': 'godcrm_test', 'capabilities': {**checks, 'cleanup_ms': 10000}}


def docker_args(body, proxy):
    return [DOCKER, 'create', '--name', body['worker_id'], '--label', 'godcrm.browser.run=' + body['run_id'],
            '--label', 'godcrm.browser.job=' + body['job_id'], '--network=none', '--user=65534:65534',
            '--cap-drop=ALL', '--security-opt=no-new-privileges', '--security-opt=seccomp=' + str(ROOT / 'seccomp.json'),
            '--read-only', '--pids-limit=256', '--memory=1g', '--cpus=1', '--init', '--ipc=private', '--shm-size=256m',
            '--tmpfs=/tmp:rw,nosuid,nodev,size=128m,uid=65534,gid=65534', '--env=HOME=/tmp',
            '--mount', 'type=bind,src=' + str(proxy) + ',dst=/egress.sock,readonly',
            '--mount', 'type=bind,src=' + str(proxy.parent / 'session.json') + ',dst=/session.json,readonly',
            '--entrypoint=node', body['pins']['image'], '/worker/suites.mjs', body['suite_id'], str(body['deadline_at'])]


def lock_run(body):
    path = STATE / (body['run_id'] + '.lock')
    fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    until = time.monotonic() + 0.8
    while True:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return fd
        except BlockingIOError:
            if time.monotonic() >= until:
                os.close(fd)
                raise ValueError('cleanup_busy')
            time.sleep(0.02)


def cleanup(body, ledger):
    _, previous = ledger.get(body['run_id'], body['worker_id'])
    fd = lock_run(body)
    try:
        ledger.mark(body['run_id'], 'uncertain' if previous == 'uncertain' else 'cleaning')
        listed = command([DOCKER, 'container', 'ls', '-aq', '--filter', 'name=^/' + body['worker_id'] + '$'], timeout=1).decode().strip()
        if listed:
            info = json.loads(command([DOCKER, 'inspect', body['worker_id']], timeout=1))[0]
            if info['Config']['Labels'].get('godcrm.browser.run') != body['run_id'] or info['Config']['Labels'].get('godcrm.browser.job') != body['job_id']:
                raise ValueError('foreign_container')
            command([DOCKER, 'rm', '-f', body['worker_id']], timeout=1)
        if command([DOCKER, 'container', 'ls', '-aq', '--filter', 'name=^/' + body['worker_id'] + '$'], timeout=1).strip():
            raise ValueError('cleanup_pending')
        directory = RUN / body['run_id']
        if directory.exists():
            trusted(directory)
            socket = directory / 'egress.sock'
            if socket.exists():
                import stat
                if not stat.S_ISSOCK(socket.lstat().st_mode):
                    raise ValueError('cleanup_path')
                socket.unlink()
            session = directory / 'session.json'
            if session.exists():
                import stat
                st = session.lstat()
                if not stat.S_ISREG(st.st_mode) or st.st_uid not in (0, 65534):
                    raise ValueError('session_path')
                session.unlink()
            directory.rmdir()
        if previous == 'uncertain':
            raise ValueError('allocation_outcome_unknown')
        ledger.mark(body['run_id'], 'cleaned')
        return {'run_id': body['run_id'], 'worker_id': body['worker_id'], 'cleaned': True}
    finally:
        os.close(fd)


def execute(body, ledger, connection, proxy):
    fd = lock_run(body)
    try:
        if ledger.get(body['run_id'], body['worker_id'])[1] != 'registered' or time.time() * 1000 >= body['deadline_at']:
            raise ValueError('cancelled')
        try:
            command(docker_args(body, proxy), timeout=2)
        except subprocess.TimeoutExpired:
            ledger.mark(body['run_id'], 'uncertain')
            raise
    finally:
        os.close(fd)
    proc = subprocess.Popen([DOCKER, 'start', '-a', body['worker_id']], env=ENV,
                            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    buffer = bytearray()
    try:
        while proc.poll() is None:
            if time.time() * 1000 >= body['deadline_at'] or not ledger.reaper_ready() or ledger.get(body['run_id'], body['worker_id'])[1] != 'registered':
                raise ValueError('deadline_or_reaper')
            ledger.beat(body['run_id'])
            readable, _, _ = select.select([proc.stdout, connection], [], [], 0.1)
            if connection in readable:
                # Any second message or EOF cancels. Never accept stream commands.
                raise ValueError('cancelled')
            if proc.stdout in readable:
                buffer.extend(os.read(proc.stdout.fileno(), 65536))
            if len(buffer) > 60000:
                raise ValueError('output_limit')
        buffer.extend(proc.stdout.read(60001 - len(buffer)))
        if proc.returncode != 0 or len(buffer) > 60000:
            raise ValueError('suite_failed')
        from core import decode, artifact
        return artifact(decode(buffer))
    finally:
        if proc.poll() is None:
            proc.kill()  # Only this docker attach client, never CRM or unrecorded processes.
        proc.wait(timeout=1)
        proc.stdout.close()
