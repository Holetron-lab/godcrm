"""Fixed read-only host operations. Import only from the trusted installation."""
import hashlib
import http.client
import json
from pathlib import Path
import re
import shutil
import socket
import ssl
import subprocess

ORIGINS = {'ring0': 'app.godcrm.ai', 'staging': 'dev.godcrm.ai'}
ACTIONS = frozenset(('host.identity', 'disk.status', 'runtime.status',
                     'ring0.health', 'staging.health', 'ring0.release', 'staging.release'))
ENV = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'}


def fetch(host, path, limit):
    # No proxy, credentials, redirects, caller-supplied origins or raw responses.
    connection = http.client.HTTPSConnection(host, timeout=8, context=ssl.create_default_context())
    try:
        connection.request('GET', path, headers={'Accept-Encoding': 'identity'})
        response = connection.getresponse()
        if response.status != 200:
            raise ValueError('http_status_' + str(response.status))
        body = response.read(limit + 1)
        if len(body) > limit:
            raise ValueError('response_too_large')
        return body
    finally:
        connection.close()


def health(body):
    data = json.loads(body)
    status = data.get('status')
    database = data.get('database', {}).get('status')
    if status not in ('ok', 'degraded') or database not in ('connected', 'disconnected', 'unknown'):
        raise ValueError('unexpected_health_shape')
    return {'status': status, 'database': database}


def diagnose(action):
    if action not in ACTIONS:
        raise ValueError('unknown_action')
    if action == 'host.identity':
        result = subprocess.run(['/usr/sbin/ip', '-json', 'address', 'show'],
                                capture_output=True, env=ENV, timeout=5, check=True)
        addresses = [a['local'] for item in json.loads(result.stdout)
                     for a in item.get('addr_info', []) if a.get('family') == 'inet']
        return {'hostname': socket.gethostname(), 'host': '<PROD_IP>',
                'expected_host': '<PROD_IP>' in addresses}
    if action == 'disk.status':
        usage = shutil.disk_usage('/srv/godcrm')
        return {'target': '/srv/godcrm', 'total': usage.total, 'free': usage.free}
    if action == 'runtime.status':
        helper = Path(__file__).with_name('pm2-status.cjs')
        result = subprocess.run(['/usr/bin/node', str(helper)], capture_output=True,
                                env=ENV, timeout=7, check=True)
        return json.loads(result.stdout)
    target, operation = action.split('.')
    host = ORIGINS[target]
    if operation == 'health':
        return health(fetch(host, '/api/health', 16384))
    # Served bundle identity, not a claim that it proves the backend commit.
    index = fetch(host, '/', 262144).decode('utf-8')
    assets = sorted(set(re.findall(r'\bsrc="(/assets/index-[A-Za-z0-9_-]+\.js)"', index)))
    if len(assets) != 1:
        raise ValueError('unexpected_entry_asset')
    body = fetch(host, assets[0], 16 * 1024 * 1024)
    return {'asset': assets[0], 'sha256': hashlib.sha256(body).hexdigest(),
            'bytes': len(body), 'commit_sha': None}
