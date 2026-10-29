#!/usr/bin/env python3
"""Prepare an offline build context or sealed payload; never install/activate."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
from core import canonical, digest, match

HERE = Path(__file__).resolve().parent
BASE = 'sha256:7412f6aca276d30c9ddb21e1d1718632269cf0ebc287c4d82993f0f1405bdaee'
FILES = ['acceptance.py','qualify.py','publish_acceptance.py',
         'godcrm-staging-browser-qualify.service','core.py','ledger.py','egress.py','runtime.py','worker.py','reaper.py',
         'suites.mjs','visual.mjs','metrics.mjs','registry.json','seccomp.json','dependencies.json',
         'Dockerfile','package-lock.json','godcrm-staging-browser.service',
         'godcrm-staging-browser-reaper.service','remote_attest.py','runtime-check.mjs']


def prepare(destination, repo):
    destination.mkdir(mode=0o700)
    for file in FILES:
        source = HERE / file
        if source.exists():
            shutil.copyfile(source, destination / file)
    shutil.copyfile(repo / 'scripts/ops-runner/browser-seccomp.json', destination / 'seccomp.json')
    shutil.copyfile(repo / 'scripts/dev-runtime-check.mjs', destination / 'runtime-check.mjs')
    lock = json.loads((repo / 'package-lock.json').read_text())
    selected = {key: value for key, value in lock['packages'].items() if key in {
        'node_modules/playwright', 'node_modules/playwright-core', 'node_modules/axe-core'}}
    if len(selected) != 3:
        raise ValueError('dependencies')
    (destination / 'package-lock.json').write_bytes(canonical({'packages': selected}))
    dependencies = {'base_image': BASE, 'modules': {}, 'files': {}}
    vendor = destination / 'node_modules'
    for name, version in [('playwright','1.58.2'), ('playwright-core','1.58.2'), ('axe-core','4.11.1')]:
        source = (repo / 'node_modules' / name).resolve()
        package = json.loads((source / 'package.json').read_text())
        if package['version'] != version or selected['node_modules/' + name]['version'] != version:
            raise ValueError('dependency_version')
        shutil.copytree(source, vendor / name, symlinks=False)
        dependencies['modules'][name] = {'version': version, 'integrity': selected['node_modules/' + name]['integrity']}
    for file in sorted(vendor.rglob('*')):
        if file.is_file():
            dependencies['files'][str(file.relative_to(destination))] = digest(file.read_bytes())
    (destination / 'dependencies.json').write_bytes(canonical(dependencies))
    return {'context': str(destination), 'base': BASE, 'dependencies': digest(canonical(dependencies))}


def seal(context, image, destination):
    match(image, 'sha256:[a-f0-9]{64}')
    destination.mkdir(mode=0o700)
    for name in FILES:
        shutil.copyfile(context / name, destination / name)
    paths = {name: digest((destination / name).read_bytes()) for name in FILES}
    groups = {
        'executor': [name for name in FILES if name.endswith(('.py','.mjs','.service'))],
        'dependencies': ['dependencies.json','package-lock.json','Dockerfile'],
        'seccomp': ['seccomp.json'], 'egress': ['egress.py','godcrm-staging-browser.service','godcrm-staging-browser-qualify.service'],
        'suites': ['suites.mjs','visual.mjs','metrics.mjs','registry.json']}
    manifest = {'files': paths, 'image': image, 'groups': groups}
    pins = {group: digest(canonical({name: paths[name] for name in names})) for group, names in groups.items()}
    pins.update(image=image, installation=digest(canonical(manifest)))
    (destination / 'installation.json').write_bytes(canonical(manifest))
    (destination / 'manifest.json').write_bytes(canonical(pins))
    return pins


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['prepare','seal'])
    parser.add_argument('destination', type=Path)
    parser.add_argument('--repo', type=Path, default=HERE.parents[1])
    parser.add_argument('--context', type=Path)
    parser.add_argument('--image')
    args = parser.parse_args()
    print(json.dumps(prepare(args.destination, args.repo) if args.mode == 'prepare' else seal(args.context, args.image, args.destination), indent=2))
