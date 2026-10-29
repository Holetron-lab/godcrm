"""Trusted executor library; NOT an agent-callable privilege escalation entrypoint.

The broker supplies context/grant from server state and a revocation callback.
Only request is untrusted. Install this directory outside agent writable roots.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import tempfile
import time
import uuid


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


HERE = Path(__file__).resolve().parent
runner = load_module('ops_runner', HERE.parent / 'ops-runner.py')
diagnostics = load_module('ops_diagnostics', HERE / 'diagnostics.py')
ROLES = {'diagnostics': {'sysadmin'}, 'local-qa': {
    'sysadmin', 'developer', 'developer-ralph', 'frontend-developer', 'frontend-qa'}}
LOCAL = {'node-test', 'vitest', 'build', 'browser-test'}
CLEAN_ENV = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'HOME': '/nonexistent',
             'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null'}


def validate(request, grant, context, now=None):
    now = time.time() if now is None else now
    required = {'action', 'job_id', 'candidate_sha'}
    if not isinstance(request, dict) or not required <= request.keys() or request.keys() - required - {'suite_id'}:
        raise ValueError('invalid_request')
    if not all(isinstance(value, str) for value in request.values()):
        raise ValueError('invalid_request')
    profile = grant.get('profile')
    if profile not in ROLES or context.get('role') not in ROLES[profile]:
        raise ValueError('role_denied')
    if grant.get('revoked') or not grant['issued_at'] <= now < grant['expires_at'] <= grant['issued_at'] + 3600:
        raise ValueError('grant_expired_or_revoked')
    for key in ('job_id', 'agent_id', 'space_id', 'role', 'repo', 'candidate_sha'):
        if key not in context or grant.get(key) != context[key]:
            raise ValueError('context_mismatch')
    if any(request[key] != context[key] for key in ('job_id', 'candidate_sha')):
        raise ValueError('request_mismatch')
    if not re.fullmatch('[0-9a-f]{40}', request['candidate_sha']):
        raise ValueError('invalid_sha')
    action = request['action']
    supported = diagnostics.ACTIONS if profile == 'diagnostics' else LOCAL
    if action not in supported or action not in grant['actions']:
        raise ValueError('action_denied')
    if profile == 'diagnostics':
        if 'suite_id' in request:
            raise ValueError('unexpected_suite')
        return []
    suite = grant['suites'].get(request.get('suite_id'))
    if not suite or suite['action'] != action:
        raise ValueError('suite_denied')
    files = suite['files']
    if not isinstance(files, list) or not all(isinstance(f, str) for f in files):
        raise ValueError('invalid_suite')
    command = runner.command_for('node-test' if action == 'browser-test' else action, files)
    if action == 'vitest':
        command = ['node', 'node_modules/vitest/vitest.mjs', 'run', '--configLoader', 'runner', '--maxWorkers=1', *files]
    if not re.fullmatch('sha256:[0-9a-f]{64}', grant.get('image', '')):
        raise ValueError('image_must_be_pinned')
    return command


def snapshot(repo, sha, workspace):
    # Git config/hooks from the candidate are never executed on the host.
    actual = subprocess.check_output(['/usr/bin/git', '-C', repo, 'rev-parse', 'HEAD'],
                                     env=CLEAN_ENV, text=True, timeout=10).strip()
    if actual != sha:
        raise ValueError('head_changed')
    with tempfile.TemporaryFile() as archive:
        subprocess.run(['/usr/bin/git', '-C', repo, 'archive', '--format=tar', sha],
                       stdout=archive, env=CLEAN_ENV, timeout=60, check=True)
        archive.seek(0)
        with tarfile.open(fileobj=archive) as source:
            source.extractall(workspace, members=[m for m in source if runner.allowed_member(m)], filter='data')
    for path in [workspace, *workspace.rglob('*')]:
        os.chown(path, 65534, 65534)


def qa_args(grant, workspace, name, command, action=None):
    modules = Path(grant['modules']).resolve(strict=True)
    if ',' in str(modules) or ',' in str(workspace):
        raise ValueError('invalid_mount')
    args = runner.container_args(grant['image'], workspace, modules, name, command)
    args[0] = '/usr/bin/docker'
    # Chromium and fixture share only the container loopback. No host sockets.
    args[2:2] = ['--shm-size=256m', '--env=PLAYWRIGHT_BROWSERS_PATH=/ms-playwright',
                 '--env=XDG_CACHE_HOME=/tmp/cache']
    if action == 'browser-test':
        args[2:2] = ['--security-opt=seccomp=' + str(HERE / 'browser-seccomp.json')]
    return args


def run_qa(request, grant, command, still_authorized):
    run = Path(tempfile.mkdtemp(prefix='godcrm-profile-'))
    workspace = run / 'work'
    workspace.mkdir()
    snapshot(grant['repo'], grant['candidate_sha'], workspace)
    for file in grant['suites'][request['suite_id']]['files']:
        if not (workspace / file).is_file():
            raise ValueError('suite_file_absent')
    name = 'godcrm-profile-' + uuid.uuid4().hex
    args = qa_args(grant, workspace, name, command, request['action'])
    if not still_authorized() or time.time() >= grant['expires_at']:
        raise ValueError('grant_expired_or_revoked')
    deadline = min(time.time() + 900, grant['expires_at'])
    code = 125
    process = None
    try:
        with (run / 'output.log').open('wb') as output:
            process = subprocess.Popen(args, stdout=output, stderr=subprocess.STDOUT, env=CLEAN_ENV)
            while process.poll() is None:
                if time.time() >= deadline or not still_authorized():
                    code = 124
                    break
                if output.tell() > 4 * 1024 * 1024:
                    code = 122
                    break
                time.sleep(0.2)
            else:
                code = process.returncode
    finally:
        # Remove only this job's container, including on cancellation/error.
        removed = subprocess.run(['/usr/bin/docker', 'rm', '-f', name],
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                 env=CLEAN_ENV, timeout=30, check=False)
        if process is not None:
            if process.poll() is None:
                process.terminate()
            process.wait(timeout=10)
        if removed.returncode not in (0, 1):
            code = 125
    log = run / 'output.log'
    return {'exit_code': code, 'artifacts': str(run), 'image': grant['image'],
            'container': name, 'log_sha256': hashlib.sha256(log.read_bytes()).hexdigest()}


def run_check(request, grant, context, still_authorized):
    """Call only inside a trusted broker; callback must recheck server revocation."""
    command = validate(request, grant, context)
    if not still_authorized():
        raise ValueError('grant_revoked')
    started = time.time()
    report = {key: context[key] for key in ('job_id', 'agent_id', 'space_id', 'candidate_sha')}
    report.update(profile=grant['profile'], action=request['action'], started_at=started,
                  executor_sha256=executor_digest())
    try:
        if grant['profile'] == 'diagnostics':
            report.update(checks=diagnostics.diagnose(request['action']), exit_code=0)
        else:
            report.update(run_qa(request, grant, command, still_authorized))
        if time.time() >= grant['expires_at'] or not still_authorized():
            report = {**report, 'exit_code': 124}
            report.pop('checks', None)
    except (ValueError, OSError, subprocess.SubprocessError, diagnostics.http.client.HTTPException) as error:
        # Never include raw child output, HTTP errors, URLs, env or exceptions.
        report.update(exit_code=125, error=type(error).__name__)
    report['finished_at'] = time.time()
    return report


def executor_digest():
    digest = hashlib.sha256()
    for path in [HERE.parent / 'ops-runner.py', *[HERE / name for name in
                 ('profiles.py', 'diagnostics.py', 'pm2-status.cjs', 'browser-seccomp.json')]]:
        digest.update(path.name.encode() + b'\0' + path.read_bytes() + b'\0')
    return digest.hexdigest()
