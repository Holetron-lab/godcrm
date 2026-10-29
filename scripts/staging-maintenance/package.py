#!/usr/bin/env python3
"""Materialize a review bundle from a manifest and candidate Git objects.

No root install, SSH, runtime writes, enter, or systemd calls. The generated
wrapper commits to every payload byte via SHA256SUMS and is itself pinned by
gate enter. Build into a NEW private directory, then keep it immutable.
"""
import hashlib
import json
from pathlib import Path
import shlex
import shutil
import subprocess
import sys


CANDIDATE = "9ac8301d05ae623c27f8e97d7fe423abb4509ea7"
PIN_PATHS = ["Makefile", "scripts/dev-operation.sh", "scripts/dev-refresh.sh",
             "scripts/staging-lease.sh", "scripts/staging-sync.sh",
             "scripts/staging-sync.exclude", "scripts/deploy.sh",
             "scripts/dev-runtime-check.mjs", "package-lock.json", "package.json"]


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def materialize(destination, manifest_path, original, fenced, state):
    destination = Path(destination).absolute()
    destination.mkdir(mode=0o700, parents=False, exist_ok=False)
    source = Path(__file__).resolve().parent
    manifest = json.loads(Path(manifest_path).read_text())
    if manifest["candidate"] != CANDIDATE:
        raise ValueError("candidate mismatch")
    if not Path(state).is_absolute():
        raise ValueError("absolute state directory required")
    for name in ("recovery.py", "supervisor.py", "remote.py"):
        shutil.copyfile(source / name, destination / name)
    shutil.copyfile(source.parent / "staging-ingress" / "control.py",
                    destination / "ingress-control.py")
    shutil.copyfile(source / "adapter.py", destination / "adapter")
    (destination / "adapter").chmod(0o700)
    shutil.copyfile(manifest_path, destination / "manifest.json")
    shutil.copyfile(original, destination / "pg_hba.original")
    shutil.copyfile(fenced, destination / "pg_hba.fence")
    pins = {}
    for name in PIN_PATHS:
        content = subprocess.check_output(["git", "show", CANDIDATE + ":" + name])
        pins[name] = hashlib.sha256(content).hexdigest()
        if name == "scripts/staging-lease.sh":
            (destination / "gate.sh").write_bytes(content)
        if name == "scripts/dev-runtime-check.mjs":
            (destination / "runtime-check.mjs").write_bytes(content)
    (destination / "candidate-pins.json").write_text(json.dumps(pins, indent=2) + "\n")
    seal_bundle(destination, state)
    return destination


def seal_bundle(destination, state):
    destination = Path(destination).resolve()
    ignored = {"pins.json", "SHA256SUMS", "hook"}
    pins = {p.name: sha(p) for p in sorted(destination.iterdir()) if p.name not in ignored}
    (destination / "pins.json").write_text(json.dumps(pins, sort_keys=True) + "\n")
    pins["pins.json"] = sha(destination / "pins.json")
    (destination / "SHA256SUMS").write_text("".join(f"{value}  {name}\n" for name, value in pins.items()))
    checksum = sha(destination / "SHA256SUMS")
    root, state_q = shlex.quote(str(destination)), shlex.quote(str(state))
    seal = pins["pins.json"]
    wrapper = f'''#!/bin/bash
set -euo pipefail
umask 077
cd -- {root}
test "$(/usr/bin/sha256sum SHA256SUMS | /usr/bin/cut -c1-64)" = {checksum}
/usr/bin/sha256sum --status -c SHA256SUMS
export STAGING_STATE_DIR={state_q}
export PYTHONDONTWRITEBYTECODE=1
case "${{1:-restore}}" in
 restore) exec /usr/bin/python3 {root}/recovery.py {root} {seal} {state_q} restore ;;
 watchdog|status) exec /bin/bash {root}/gate.sh "$1" ;;
 supervise) shift; exec /usr/bin/python3 {root}/supervisor.py {root} {seal} {state_q} "$@" ;;
 bind|intent|unfence|accept)
   exec /bin/bash {root}/gate.sh run -- /usr/bin/python3 {root}/recovery.py {root} {seal} {state_q} "$@" ;;
 *) echo 'unknown infra command' >&2; exit 2 ;;
esac
'''
    (destination / "hook").write_text(wrapper)
    (destination / "hook").chmod(0o700)


if __name__ == "__main__":
    if len(sys.argv) != 6:
        sys.exit("usage: package.py NEW_DIR MANIFEST ORIGINAL_HBA FENCED_HBA STATE_DIR")
    print(materialize(*sys.argv[1:]))
