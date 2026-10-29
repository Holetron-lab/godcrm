#!/usr/bin/env python3
"""Fixed installed systemd qualification. No socket, CLI parameters or grants."""
import os
from pathlib import Path
import socket
import time
import uuid
from acceptance import create_record, signed, writer
from core import ROOT, STATE, ETC, SUITES, canonical, digest, exact, integer, match, read_json, trusted
from ledger import Ledger
from runtime import actual_pins, command, prerequisites
from worker import execute_run

UNIT = 'godcrm-staging-browser-qualify.service'
POLICY = {
    'User': 'root', 'Group': 'root', 'UMask': '0077', 'NoNewPrivileges': 'yes',
    'ProtectSystem': 'strict', 'ProtectHome': 'read-only', 'PrivateTmp': 'yes',
    'RestrictAddressFamilies': 'AF_UNIX AF_INET',
    'ReadWritePaths': '/run/godcrm-staging-browser /var/lib/godcrm-staging-browser',
    'IPAddressDeny': '0.0.0.0/0 ::/0', 'IPAddressAllow': '<DEV_IP>/32',
    'KillMode': 'control-group', 'TimeoutStopUSec': '10s',
}


def installed_service():
    if os.geteuid() != 0:
        raise ValueError('administrator_identity')
    invocation = os.environ.get('INVOCATION_ID', '')
    match(invocation, '[a-f0-9]{32}')
    if not any(line.split(':', 2)[-1].strip().endswith('/' + UNIT)
               for line in Path('/proc/self/cgroup').read_text().splitlines()):
        raise ValueError('installed_unit_required')
    # Measure on-disk unit and effective restrictions; reject manager drop-ins.
    for unit in (UNIT, 'godcrm-staging-browser.service'):
        if trusted(Path('/etc/systemd/system') / unit).read_bytes() != trusted(ROOT / unit).read_bytes():
            raise ValueError('unit_bytes')
    properties = ['FragmentPath', 'DropInPaths', *POLICY]
    raw = command(['/usr/bin/systemctl', 'show', UNIT, '--property=' + ','.join(properties)])
    actual = dict(line.split('=', 1) for line in raw.decode().splitlines())
    expected = {**POLICY, 'FragmentPath': '/etc/systemd/system/' + UNIT, 'DropInPaths': ''}
    if actual != expected:
        raise ValueError('unit_confinement')
    return {'unit': UNIT, 'invocation_id': invocation, 'policy': actual,
            'unit_sha256': digest((ROOT / UNIT).read_bytes())}


def authorization():
    value = read_json(ETC / 'qualification-request.json', private=True)
    exact(value, {'writer', 'candidate_sha', 'pins', 'issued_at', 'expires_at', 'qualification_id'})
    if value['writer'] != writer():
        raise ValueError('administrator_mismatch')
    match(value['candidate_sha'], '[a-f0-9]{40}')
    if str(uuid.UUID(value['qualification_id'])) != value['qualification_id']:
        raise ValueError('qualification_id')
    now = int(time.time())
    integer(value['issued_at'], now - 300, now)
    integer(value['expires_at'], now + 1, value['issued_at'] + 300)
    if value['pins'] != actual_pins():
        raise ValueError('qualification_pins')
    return value


def qualify():
    service = installed_service()
    auth = authorization()
    if os.path.lexists(ETC / 'acceptance.json'):
        raise ValueError('archive_prior_acceptance_first')
    output = STATE / 'qualification-evidence.json'
    if os.path.lexists(output):
        raise ValueError('archive_prior_evidence_first')
    # Durable one-use request even if service crashes before evidence is published.
    create_record(STATE / ('qualification-' + auth['qualification_id'] + '.used'), auth)
    ledger = Ledger(STATE / 'ledger.sqlite')
    client, peer = socket.socketpair()  # Kept private; never bound/listened/exported.
    results = []
    started = time.time()
    try:
        if ledger.pending():
            raise ValueError('reconciliation_pending')
        for suite in SUITES:
            if authorization() != auth:
                raise ValueError('qualification_revoked')
            run_id = str(uuid.uuid4())
            body = {'run_id': run_id, 'worker_id': 'godcrm-browser-' + run_id,
                    'job_id': 'qualification-' + auth['qualification_id'], 'pins': auth['pins'],
                    'suite_id': suite, 'candidate_sha': auth['candidate_sha'],
                    'deadline_at': auth['expires_at'] * 1000, 'cleanup_ms': 10000, 'writes': False}
            measured = {}
            def measure(request_body, registered_ledger):
                measured.update(prerequisites(request_body, registered_ledger))
            report = execute_run(body, ledger, client, measure)
            artifacts = [ledger.fetch({**body, 'artifact_id': d['id']}) for d in report['report']['artifacts']]
            if ledger.get(run_id, body['worker_id'])[1] != 'cleaned':
                raise ValueError('cleanup_pending')
            results.append({'suite_id': suite, 'result': report, 'artifacts': artifacts,
                            'attestation': measured['receipt'], 'cleaned': True})
        if authorization() != auth or installed_service() != service:
            raise ValueError('qualification_changed')
        evidence = {'kind': 'qualification-v1', 'writer': auth['writer'], 'pins': auth['pins'],
                    'candidate_sha': auth['candidate_sha'], 'kernel': os.uname().release,
                    'qualification_id': auth['qualification_id'], 'started_at': started,
                    'finished_at': time.time(), 'service': service, 'suites': results}
        create_record(output, signed(evidence))
        # No acceptance, capabilities=true, worker start or interlock removal here.
    finally:
        client.close()
        peer.close()
        ledger.db.close()


if __name__ == '__main__':
    import sys
    if len(sys.argv) != 1:
        raise SystemExit(2)
    try:
        qualify()
    except Exception:
        raise SystemExit(1)  # No session or unsanitized exception in journald.
