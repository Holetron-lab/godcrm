#!/usr/bin/env python3
"""Read-only targeted sync-process attribution. Never kills processes.

Run separately AFTER cron retirement. Exit 1 means candidates still need
administrator attribution/drain; no candidate is automatically declared safe.
"""
import json
from pathlib import Path


def sync_processes(root=Path("/proc")):
    records = {}
    seeds = set()
    for directory in root.iterdir():
        if not directory.name.isdigit():
            continue
        try:
            args = (directory / "cmdline").read_bytes().split(b"\0")
            name = (directory / "comm").read_text().strip()
            status = (directory / "status").read_text().splitlines()
            parent = int(next(s.split()[1] for s in status if s.startswith("PPid:")))
            pid = int(directory.name)
            records[pid] = {"pid": pid, "parent": parent, "name": name}
            if b"/root/scripts/sync-uploads.sh" in args:
                seeds.add(pid)
            elif name in ("rsync", "ssh") and any(
                    b"vpn-hicpu" in arg or b"<LEGACY_IP>" in arg or b"uploads" in arg for arg in args):
                seeds.add(pid)  # Orphaned child/other transfer; must be attributed.
        except (OSError, ValueError, StopIteration):
            continue
    found = set(seeds)
    while True:
        children = {pid for pid, r in records.items() if r["parent"] in found}
        if children <= found:
            break
        found.update(children)
    return [records[pid] for pid in sorted(found)]


if __name__ == "__main__":
    processes = sync_processes()
    print(json.dumps({"sync_candidates": processes, "snapshot_only": True}))
    raise SystemExit(1 if processes else 0)
