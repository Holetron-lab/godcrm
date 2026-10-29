#!/usr/bin/env python3
"""Separate staging installation, forced SSH command. NEVER run on Ring 0/1.

The deploy owner provides a root-owned manifest of ALL synced application files,
including dist and backend, tied to the committed source SHA. This helper measures
those actual bytes and actual DB via the existing read-only runtime probe.
No agent can issue/rewrite the receipt; missing receipt blocks worker preflight.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
import uuid

ROOT = Path('/opt/godcrm-staging-attestor')
APP = Path('/root/production/business-crm')


def safe(path):
    for part in (path, *path.parents):
        st = part.lstat()
        if part.is_symlink() or st.st_uid != 0 or st.st_mode & 0o022:
            raise ValueError('untrusted')
    return path


def main():
    nonce = os.environ.get('SSH_ORIGINAL_COMMAND', '')
    if str(uuid.UUID(nonce)) != nonce:
        raise ValueError('nonce')
    receipt = json.loads(safe(ROOT / 'deployment.json').read_text())
    if set(receipt) != {'candidate_sha', 'files', 'asset'} or not re.fullmatch('[a-f0-9]{40}', receipt['candidate_sha']):
        raise ValueError('receipt')
    required = {'backend/server.js', 'package-lock.json', 'dist/index.html'}
    if not required <= set(receipt['files']) or receipt['asset'] not in receipt['files']:
        raise ValueError('coverage')
    measured = {str(p.relative_to(APP)) for tree in ('backend', 'dist') for p in (APP / tree).rglob('*') if p.is_file()}
    if not measured <= set(receipt['files']):
        raise ValueError('incomplete_coverage')
    for name, checksum in receipt['files'].items():
        if name.startswith('/') or '..' in Path(name).parts or not re.fullmatch('[a-f0-9]{64}', checksum):
            raise ValueError('path')
        if hashlib.sha256(safe(APP / name).read_bytes()).hexdigest() != checksum:
            raise ValueError('drift')
    # Installed independently beside node_modules symlink provisioned by owner;
    # helper's hash is pinned in the installation package, not loaded from worktree.
    result = subprocess.run(['/usr/bin/node', str(safe(ROOT / 'runtime-check.mjs'))], cwd=APP,
                            env={'PATH':'/usr/local/bin:/usr/bin:/bin','HOME':'/root'},
                            stdin=subprocess.DEVNULL, capture_output=True, timeout=2, check=True)
    runtime = json.loads(result.stdout)
    if runtime.get('database') != 'godcrm_test' or runtime.get('status') != 'online':
        raise ValueError('database')
    print(json.dumps({'nonce':nonce, 'candidate_sha':receipt['candidate_sha'], 'database':'godcrm_test',
                      'verified_at':time.time(), 'asset_sha256':receipt['files'][receipt['asset']]}))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        raise SystemExit(1)
