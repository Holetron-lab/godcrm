#!/usr/bin/env python3
"""Administrator-only exact cron retirement. No application/runtime actions."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

TARGET = b"*/5 * * * * /root/scripts/sync-uploads.sh\n"


def proposed(original):
    lines = original.splitlines(keepends=True)
    if lines.count(TARGET) != 1:
        raise ValueError("expected exactly one obsolete sync entry")
    return b"".join(line for line in lines if line != TARGET)


def prepare(original, expected):
    if hashlib.sha256(original).hexdigest() != expected:
        raise ValueError("crontab drift: stop and review")
    return proposed(original)


def retire(expected):
    if os.geteuid() != 0:
        raise RuntimeError("administrator required")
    addresses = subprocess.check_output(["hostname", "-I"], text=True).split()
    if "<DEV_IP>" not in addresses or "<PROD_IP>" in addresses:
        raise RuntimeError("not staging")
    original = subprocess.check_output(["crontab", "-u", "root", "-l"])
    candidate = prepare(original, expected)
    directory = Path(tempfile.mkdtemp(prefix="retire-sync-3660-", dir="/root/backups/temp"))
    for name, data in [("root.crontab.before", original), ("root.crontab.after", candidate)]:
        p = directory / name
        p.write_bytes(data)
        os.chmod(p, 0o600)
        with p.open("rb") as f:
            os.fsync(f.fileno())
        if p.read_bytes() != data:
            raise RuntimeError("backup verification failed")
    checksums = {"root.crontab.before": hashlib.sha256(original).hexdigest(),
                 "root.crontab.after": hashlib.sha256(candidate).hexdigest()}
    sums = directory / "SHA256SUMS"
    sums.write_text("".join(f"{sha}  {name}\n" for name, sha in checksums.items()))
    with sums.open("rb") as f:
        os.fsync(f.fileno())
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
    # crontab has no atomic compare-and-swap: administrator must reserve the
    # root crontab scope for the entire command. Recheck immediately at apply.
    if subprocess.check_output(["crontab", "-u", "root", "-l"]) != original:
        raise RuntimeError("concurrent crontab change; nothing installed")
    subprocess.run(["crontab", "-u", "root", str(directory / "root.crontab.after")], check=True)
    readback = subprocess.check_output(["crontab", "-u", "root", "-l"])
    if readback != candidate:
        raise RuntimeError("readback mismatch: investigate; DO NOT restore old crontab")
    (directory / "RETIREMENT.json").write_text(json.dumps({
        "obsolete_sync_retired": True, "generic_restore_forbidden": True,
        "before": checksums["root.crontab.before"], "after": checksums["root.crontab.after"]}) + "\n")
    print("CRON_RETIRED=" + str(directory))
    print("POST_SHA256=" + hashlib.sha256(readback).hexdigest())
    print("SYNC_PROCESS_DRAIN_REQUIRED")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("--admin-apply", action="store_true")
    args = parser.parse_args()
    if not args.admin_apply:
        parser.error("preparation only; separate administrator authorization required")
    retire(args.expected_sha256)
