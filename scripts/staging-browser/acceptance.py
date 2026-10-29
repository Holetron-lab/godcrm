"""Administrator records are separate from broker IPC; no acceptance synthesis."""
import hmac
import os
from pathlib import Path
import time
from core import ETC, STATE, canonical, digest, exact, match, pins, read_json, sign, trusted

CHECKS = {'sandbox', 'non_root', 'tls_verified', 'network_enforced', 'durable_reaper',
          'computed_styles', 'axe', 'trace_metrics', 'isolated_clipboard', 'sanitized_artifacts'}


def writer():
    value = read_json(ETC / 'administrator.json', private=True)
    exact(value, {'principal', 'channel', 'authorization_ref'})
    for field in value.values():
        match(field, '[A-Za-z0-9][A-Za-z0-9._:/@-]{2,159}')
        if any(word in field.upper() for word in ('UNKNOWN', 'PENDING', 'TODO', 'PLACEHOLDER')):
            raise ValueError('administrator_unassigned')
    return value


def key():
    value = trusted(ETC / 'acceptance.key', True).read_text().strip()
    match(value, '[a-f0-9]{64}')
    return value


def signed(value):
    return {'body': value, 'sig': sign(key(), value)}


def verified(envelope, kind):
    exact(envelope, {'body', 'sig'})
    match(envelope['sig'], '[a-f0-9]{64}')
    if not hmac.compare_digest(sign(key(), envelope['body']), envelope['sig']):
        raise ValueError('record_signature')
    value = envelope['body']
    if value.get('kind') != kind or value.get('writer') != writer():
        raise ValueError('record_authority')
    return value


def create_record(path, value):
    """Exclusive creation + fsync + readback. Renewal needs prior reviewed backup."""
    trusted(path.parent, True)
    data = canonical(value)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
        if trusted(path, True).read_bytes() != data:
            raise ValueError('record_readback')
    except BaseException:
        # Retain partial file for operator diagnosis; never replace a prior record.
        raise
    return digest(data)


def accepted(body):
    # Request file is a persistent administrative interlock, not a temporary grant.
    if os.path.lexists(ETC / 'qualification-request.json'):
        raise ValueError('qualification_in_progress')
    value = verified(read_json(ETC / 'acceptance.json', private=True), 'acceptance-v1')
    exact(value, {'kind', 'writer', 'pins', 'kernel', 'candidate_sha', 'issued_at',
                  'expires_at', 'checks', 'qualification_sha256', 'review_sha256'})
    now = time.time()
    if (type(value['issued_at']) not in (int, float) or type(value['expires_at']) not in (int, float)
            or not value['issued_at'] <= now < value['expires_at'] <= value['issued_at'] + 3600):
        raise ValueError('acceptance_expired')
    if body.get('op') == 'run' and value['expires_at'] * 1000 < body['deadline_at']:
        raise ValueError('acceptance_shorter_than_run')
    from runtime import actual_pins
    if (value['pins'] != body['pins'] or value['pins'] != actual_pins()
            or value['kernel'] != os.uname().release or value['candidate_sha'] != body['candidate_sha']):
        raise ValueError('acceptance_binding')
    pins(value['pins'])
    exact(value['checks'], CHECKS)
    if any(v is not True for v in value['checks'].values()):
        raise ValueError('acceptance_incomplete')
    for name, expected in [('qualification-evidence.json', value['qualification_sha256']),
                           ('acceptance-review.json', value['review_sha256'])]:
        match(expected, '[a-f0-9]{64}')
        path = (STATE if name.startswith('qualification') else ETC) / name
        if digest(trusted(path, True).read_bytes()) != expected:
            raise ValueError('evidence_changed')
    return value['checks']
