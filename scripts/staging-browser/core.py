"""Strict broker IPC and secret-free artifact validation. Python standard library only."""
import hashlib
import hmac
import json
import math
import os
from pathlib import Path
import re
import stat
import time
import uuid

SUITES = ('computed-contrast-v1', 'axe-v1', 'trace-metrics-v1', 'clipboard-v1')
PIN_KEYS = {'executor', 'image', 'dependencies', 'seccomp', 'egress', 'suites', 'installation'}
ROLES = {'sysadmin', 'developer', 'developer-ralph', 'frontend-developer', 'frontend-qa'}
ROOT = Path('/opt/godcrm-staging-browser')
STATE = Path('/var/lib/godcrm-staging-browser')
RUN = Path('/run/godcrm-staging-browser')
ETC = Path('/etc/godcrm-staging-browser')


def canonical(value):
    # Match JSON.stringify number spelling used by the Node broker (notably
    # 1.0, small exponents and -0). Protocol keys are ASCII, hence key order agrees.
    from decimal import Decimal
    def render(item):
        if isinstance(item, dict):
            return '{' + ','.join(render(k) + ':' + render(item[k]) for k in sorted(item)) + '}'
        if isinstance(item, list):
            return '[' + ','.join(render(v) for v in item) + ']'
        if type(item) is float:
            if not math.isfinite(item):
                raise ValueError('finite')
            if item == 0:
                return '0'
            raw = repr(item)
            if 1e-6 <= abs(item) < 1e21:
                return format(Decimal(raw), 'f').rstrip('0').rstrip('.') if '.' in format(Decimal(raw), 'f') else format(Decimal(raw), 'f')
            mantissa, exponent = raw.split('e')
            exponent = int(exponent)
            return mantissa.rstrip('0').rstrip('.') + 'e' + ('+' if exponent >= 0 else '-') + str(abs(exponent))
        return json.dumps(item, ensure_ascii=False, allow_nan=False, separators=(',', ':'))
    return render(value).encode()


def digest(value):
    return hashlib.sha256(value).hexdigest()


def sign(key, body):
    return hmac.new(key.encode(), canonical(body), hashlib.sha256).hexdigest()


def exact(value, keys):
    if not isinstance(value, dict) or set(value) != set(keys):
        raise ValueError('shape')


def match(value, pattern):
    if not isinstance(value, str) or not re.fullmatch(pattern, value):
        raise ValueError('format')


def identifier(value):
    if not isinstance(value, str) or str(uuid.UUID(value)) != value:
        raise ValueError('uuid')


def integer(value, low, high):
    if type(value) is not int or not low <= value <= high:
        raise ValueError('integer')


def pins(value):
    exact(value, PIN_KEYS)
    for key, item in value.items():
        match(item, ('sha256:' if key == 'image' else '') + '[a-f0-9]{64}')


def trusted(path, private=False):
    path = Path(path)
    for part in (path, *path.parents):
        st = part.lstat()
        if stat.S_ISLNK(st.st_mode) or st.st_uid != 0 or st.st_mode & (0o077 if part == path and private else 0o022):
            raise ValueError('untrusted_path')
    return path


def read_json(path, limit=65536, private=False):
    path = trusted(path, private)
    if path.stat().st_size > limit:
        raise ValueError('size')
    return decode(path.read_bytes())


def decode(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('duplicate_key')
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('finite')))


def request(raw, key, now=None):
    now = int(time.time() * 1000) if now is None else now
    if len(raw) > 16384:
        raise ValueError('size')
    envelope = decode(raw)
    exact(envelope, {'body', 'sig'})
    match(envelope['sig'], '[a-f0-9]{64}')
    body = envelope['body']
    if not hmac.compare_digest(envelope['sig'], sign(key, body)):
        raise ValueError('signature')
    common = {'v', 'nonce', 'issued_at', 'op'}
    fields = {
        'preflight': {'pins', 'suite_id', 'candidate_sha', 'job_id'},
        'run': {'run_id', 'worker_id', 'job_id', 'agent_id', 'space_id', 'role', 'repo', 'candidate_sha', 'pins', 'suite_id', 'deadline_at', 'cleanup_ms', 'writes'},
        'cleanup': {'run_id', 'worker_id'},
        'artifact': {'run_id', 'worker_id', 'artifact_id', 'job_id', 'pins'},
    }
    if not isinstance(body, dict) or body.get('op') not in fields:
        raise ValueError('operation')
    exact(body, common | fields[body['op']])
    if type(body['v']) is not int or body['v'] != 1:
        raise ValueError('version')
    identifier(body['nonce'])
    integer(body['issued_at'], now - 5000, now + 1000)
    if 'pins' in body:
        pins(body['pins'])
    if 'suite_id' in body and body['suite_id'] not in SUITES:
        raise ValueError('suite')
    if 'candidate_sha' in body:
        match(body['candidate_sha'], '[a-f0-9]{40}')
    if 'job_id' in body:
        match(body['job_id'], '[1-9][0-9]{0,19}')
    if 'run_id' in body:
        identifier(body['run_id'])
        if body['worker_id'] != 'godcrm-browser-' + body['run_id']:
            raise ValueError('worker_id')
    if 'artifact_id' in body:
        identifier(body['artifact_id'])
    if body['op'] == 'run':
        integer(body['deadline_at'], now + 1, now + 300000)
        integer(body['agent_id'], 1, 2**53 - 1)
        if type(body['space_id']) is not int or body['space_id'] != 11 or body['role'] not in ROLES:
            raise ValueError('identity')
        match(body['repo'], '/root/wt-[A-Za-z0-9._-]+')
        if type(body['cleanup_ms']) is not int or body['cleanup_ms'] != 10000 or body['writes'] is not False:
            raise ValueError('policy')
    return body


def artifact(value):
    exact(value, {'kind', 'checks', 'trace'})
    if value['kind'] not in {'contrast', 'axe', 'metrics', 'sanitized_trace', 'clipboard'}:
        raise ValueError('artifact_kind')
    if not isinstance(value['checks'], list) or not 1 <= len(value['checks']) <= 1000:
        raise ValueError('checks')
    for check in value['checks']:
        if not isinstance(check, dict) or set(check) - {'target', 'rule', 'passed', 'value', 'count'} or not {'target', 'rule', 'passed'} <= set(check):
            raise ValueError('check_shape')
        if check['target'] not in {'table', 'schema_drawer', 'access', 'clipboard'} or check['rule'] not in {'contrast', 'axe', 'lcp', 'inp', 'cls', 'clipboard'} or type(check['passed']) is not bool:
            raise ValueError('check_enum')
        for field in ('value', 'count'):
            if field in check:
                n = check[field]
                if type(n) not in (int, float) or not math.isfinite(n) or not 0 <= n <= (100000 if field == 'count' else 1e9):
                    raise ValueError('measurement')
                if field == 'count' and type(n) is not int:
                    raise ValueError('count')
    if not isinstance(value['trace'], list) or len(value['trace']) > 1000:
        raise ValueError('trace')
    for step in value['trace']:
        exact(step, {'action', 'start_ms', 'duration_ms'})
        if step['action'] not in {'navigate', 'open_drawer', 'switch_tab', 'scroll', 'expand_access', 'clipboard_roundtrip'}:
            raise ValueError('action')
        for field in ('start_ms', 'duration_ms'):
            if type(step[field]) not in (int, float) or not math.isfinite(step[field]) or not 0 <= step[field] <= 300000:
                raise ValueError('timing')
    if len(canonical(value)) > 60000:
        raise ValueError('artifact_size')
    return value


def staging_session(value, until=None):
    exact(value, {'origin','database','expires_at','read_only','storageState'})
    if value['origin'] != 'https://dev.godcrm.ai' or value['database'] != 'godcrm_test' or value['read_only'] is not True:
        raise ValueError('session_scope')
    now = int(time.time() * 1000)
    integer(value['expires_at'], (now if until is None else until) + 1, now + 3600000)
    state = value['storageState']
    exact(state, {'cookies','origins'})
    if not isinstance(state['cookies'],list) or not isinstance(state['origins'],list):
        raise ValueError('session_shape')
    for origin in state['origins']:
        if origin.get('origin') != 'https://dev.godcrm.ai':
            raise ValueError('foreign_session')
    for cookie in state['cookies']:
        if cookie.get('domain') not in ('dev.godcrm.ai','.dev.godcrm.ai') or cookie.get('secure') is not True:
            raise ValueError('foreign_cookie')
    if len(canonical(value)) > 32768:
        raise ValueError('session_size')
    return value
