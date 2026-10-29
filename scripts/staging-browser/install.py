#!/usr/bin/env python3
"""Owner-only first installation. Explicit digest + backup, no start/enable/grants."""
import argparse
import os
from pathlib import Path
import secrets
import shutil
import subprocess
from core import canonical, decode, digest, trusted, match


def install(bundle, expected, backup):
    if os.geteuid() != 0:
        raise ValueError('root_required')
    match(expected, '[a-f0-9]{64}')
    manifest = decode((bundle / 'installation.json').read_bytes())
    if digest(canonical(manifest)) != expected:
        raise ValueError('installation_pin')
    for name, checksum in manifest['files'].items():
        if name.startswith('/') or '..' in Path(name).parts or (bundle / name).is_symlink() or digest((bundle / name).read_bytes()) != checksum:
            raise ValueError('package_changed')
    destinations = [Path('/opt/godcrm-staging-browser'), Path('/etc/godcrm-staging-browser'),
                    Path('/var/lib/godcrm-staging-browser'), Path('/run/godcrm-staging-browser')]
    units = [Path('/etc/systemd/system') / name for name in ('godcrm-staging-browser.service','godcrm-staging-browser-reaper.service','godcrm-staging-browser-qualify.service')]
    if any(p.exists() or p.is_symlink() for p in destinations + units):
        raise ValueError('first_install_only')
    if backup.parent != Path('/root/backups/temp'):
        raise ValueError('backup_path')
    backup.mkdir(mode=0o700)
    data = canonical({'absent': [str(p) for p in destinations + units], 'installation': expected})
    (backup / 'before.json').write_bytes(data)
    if (backup / 'before.json').read_bytes() != data:
        raise ValueError('backup_failed')
    for directory in destinations:
        directory.mkdir(mode=0o755 if directory.name == 'godcrm-staging-browser' and directory.parent in [Path('/opt'),Path('/run')] else 0o700)
    target = destinations[0]
    for name in [*manifest['files'], 'installation.json', 'manifest.json']:
        shutil.copyfile(bundle / name, target / name)
        (target / name).chmod(0o644)
    for unit in units:
        shutil.copyfile(target / unit.name, unit)
        unit.chmod(0o644)
    key = destinations[1] / 'channel.key'
    key.write_text(secrets.token_hex(32) + '\n')
    key.chmod(0o600)
    acceptance_key = destinations[1] / 'acceptance.key'
    acceptance_key.write_text(secrets.token_hex(32) + '\n')
    acceptance_key.chmod(0o600)
    # Empty acceptance/session/SSH config intentionally NOT synthesized.
    # Operator review + actual install tests are needed before preflight can ALLOW.
    subprocess.run(['/usr/bin/systemctl', 'daemon-reload'], check=True)
    print('INSTALLED_INACTIVE: no acceptance, session, grants or service activation')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--expected-installation', required=True)
    parser.add_argument('--backup', type=Path, required=True)
    args = parser.parse_args()
    install(args.bundle, args.expected_installation, args.backup)
