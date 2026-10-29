#!/usr/bin/env python3
"""Approved host entry point, not a privileged service or sandbox bypass."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import time
import uuid

IMAGE = 'godcrm-ops-runner:1'


def command_for(action, files):
    if action in ('node-test', 'vitest'):
        if not files or any(not f or f.startswith('-') or Path(f).is_absolute()
                            or '..' in Path(f).parts for f in files):
            raise ValueError('Supply explicit repository-relative test files')
        if action == 'node-test':
            return ['node', '--test', *files]
        return ['node', 'node_modules/vitest/vitest.mjs', 'run', '--maxWorkers=2', *files]
    if action == 'build' and not files:
        return ['node', 'node_modules/vite/bin/vite.js', 'build']
    raise ValueError('Unsupported action or extra arguments')


def allowed_member(member):
    parts = Path(member.name).parts
    return (not Path(member.name).is_absolute() and '..' not in parts
            and not any(p.startswith('.env') or p in ('.mcp.json', '.git', 'node_modules')
                        or p.endswith('.local.env') for p in parts)
            and (member.isfile() or member.isdir()))


def container_args(image, workspace, modules, name, command):
    return ['docker', 'run', '--rm', '--pull=never', '--name', name,
            '--network=none', '--read-only', '--cap-drop=ALL',
            '--security-opt=no-new-privileges', '--user=65534:65534',
            '--cpus=2',
            '--memory=' + ('4g' if command[-1] == 'build' else '2g'),
            '--memory-swap=' + ('4g' if command[-1] == 'build' else '2g'),
            '--env=NODE_OPTIONS=--max-old-space-size=' + ('3072' if command[-1] == 'build' else '1024'),
            '--pids-limit=256',
            '--tmpfs=/tmp:rw,nosuid,nodev,size=512m,mode=1777',
            '--tmpfs=/work/node_modules/.vite-temp:rw,nosuid,nodev,size=64m,mode=1777',
            '--tmpfs=/work/node_modules/.vite:rw,nosuid,nodev,size=128m,mode=1777',
            '--mount', f'type=bind,src={workspace},dst=/work',
            '--mount', f'type=bind,src={modules},dst=/work/node_modules,readonly',
            '--workdir=/work',
            '--env=NODE_ENV=' + ('production' if command[-1] == 'build' else 'test'),
            '--env=HOME=/tmp',
            '--entrypoint=/usr/local/bin/node', image, *command[1:]]


def pm2_command(action):
    return {'pm2-status': ['pm2', 'list'],
            'restart-deploy-bot': ['pm2', 'restart', 'deploy-bot']}[action]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['node-test', 'vitest', 'build',
                                          'pm2-status', 'restart-deploy-bot'])
    parser.add_argument('--repo', default='.')
    parser.add_argument('files', nargs='*')
    args = parser.parse_args()
    if args.action in ('pm2-status', 'restart-deploy-bot'):
        if args.files:
            parser.error('PM2 actions accept no targets or extra arguments')
        return subprocess.run(pm2_command(args.action), timeout=60, check=False).returncode
    try:
        command = command_for(args.action, args.files)
    except ValueError as error:
        parser.error(str(error))
    repo = Path(args.repo).resolve(strict=True)
    sha = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD'], text=True).strip()
    modules = (repo / 'node_modules').resolve(strict=True)
    if ',' in str(modules):
        parser.error('Unsupported comma in dependency path')
    image = subprocess.check_output(['docker', 'image', 'inspect', IMAGE,
                                     '--format={{.Id}}'], text=True).strip()
    run = Path(tempfile.mkdtemp(prefix='godcrm-ops-'))
    workspace = run / 'work'
    workspace.mkdir()
    archive = run / 'source.tar'
    with archive.open('wb') as output:
        subprocess.run(['git', '-C', str(repo), 'archive', sha], stdout=output, check=True)
    with tarfile.open(archive) as source:
        source.extractall(workspace, members=[m for m in source if allowed_member(m)], filter='data')
    archive.unlink()
    for file in args.files:
        if not (workspace / file).is_file():
            parser.error(f'Test file absent from committed snapshot: {file}')
    for path in [workspace, *workspace.rglob('*')]:
        os.chown(path, 65534, 65534)
    name = 'godcrm-ops-' + uuid.uuid4().hex
    report = {'sha': sha, 'image': image, 'action': args.action, 'files': args.files,
              'started_at': time.time(), 'container': name}
    print(f'Artifacts: {run}\nSHA: {sha}', flush=True)
    code = 125
    try:
        with (run / 'output.log').open('w') as output:
            result = subprocess.run(container_args(image, workspace, modules, name, command),
                                    stdout=output, stderr=subprocess.STDOUT, timeout=900, check=False)
            code = result.returncode
    except subprocess.TimeoutExpired:
        code = 124
    except KeyboardInterrupt:
        code = 130
    finally:
        subprocess.run(['docker', 'rm', '-f', name], stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, timeout=30, check=False)
        report.update(exit_code=code, finished_at=time.time())
        (run / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
    print((run / 'output.log').read_text())
    return code


if __name__ == '__main__':
    raise SystemExit(main())
