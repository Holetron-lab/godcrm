#!/usr/bin/env python3
"""Prepared staging transport fence. Not installed or invoked by existing code.

The CLI refuses review manifests. Tests call the same primitives in a fresh
network namespace. Never flush the host ruleset or restart nginx.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

TABLE = "godcrm_staging_3660"
PORT_FILTER = "( sport = :5000 )"


def command(argv, data=None):
    return subprocess.run(argv, input=data, text=True, capture_output=True,
                          check=True, timeout=20).stdout


def rules(uid):
    if type(uid) is not int or uid <= 0:
        raise ValueError("nginx UID must be a non-root integer")
    return f'''table inet {TABLE} {{
  chain input {{
    type filter hook input priority -10; policy accept;
    iifname != "lo" tcp dport 5000 reject with tcp reset
  }}
  chain output {{
    type filter hook output priority -10; policy accept;
    oifname "lo" meta skuid {uid} tcp dport 5000 reject with tcp reset
  }}
}}
'''


def snapshot():
    """Distinguish absent table from inability to read netfilter."""
    entries = json.loads(command(["nft", "-j", "list", "tables"]))["nftables"]
    exists = any(x.get("table", {}).get("name") == TABLE and
                 x["table"].get("family") == "inet" for x in entries)
    if not exists:
        return None
    entries = json.loads(command(["nft", "-j", "list", "table", "inet", TABLE]))["nftables"]
    clean = []
    for entry in entries:
        if "metainfo" in entry:
            continue
        kind, value = next(iter(entry.items()))
        clean.append({kind: {k: v for k, v in value.items() if k != "handle"}})
    return clean


def drain():
    # Kernel socket destruction, no PID kills. Both IPv4 and IPv6, server side
    # only, including idle SSE/WebSocket upstream and external direct sockets.
    command(["ss", "-Knt", "state", "connected", PORT_FILTER])
    remaining = command(["ss", "-Hnt", "state", "connected", PORT_FILTER])
    if remaining.strip():
        raise RuntimeError("port 5000 connections remain; fence retained")


def close_transport(uid):
    if snapshot() is not None:
        raise RuntimeError("owned table already exists; inspect journal, do not replace")
    command(["nft", "--check", "-f", "-"], rules(uid))
    command(["nft", "-f", "-"], rules(uid))
    # On failure retain rules. Caller must not claim active/closed until drain.
    current = snapshot()
    if current is None:
        raise RuntimeError("fence missing after install")
    return current


def open_transport(expected):
    current = snapshot()
    if current is None:
        return
    if not expected or current != expected:
        raise RuntimeError("fence drift; refusing deletion")
    command(["nft", "delete", "table", "inet", TABLE])
    if snapshot() is not None:
        raise RuntimeError("fence still present")


def durable_json(path, value):
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as f:
        os.chmod(f.name, 0o600)
        json.dump(value, f, sort_keys=True)
        f.flush()
        os.fsync(f.fileno())
    os.replace(f.name, path)
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def validate_manifest(m):
    if m.get("mode") != "approved-for-admin" or os.geteuid() != 0:
        raise RuntimeError("review only / administrator required")
    if m.get("target") != "<DEV_IP>" or not m.get("machine_id"):
        raise RuntimeError("target must be staging .72")
    if Path("/etc/machine-id").read_text().strip() != m["machine_id"]:
        raise RuntimeError("wrong machine")
    addresses = command(["hostname", "-I"]).split()
    if m["target"] not in addresses or "<PROD_IP>" in addresses:
        raise RuntimeError("wrong host addresses")
    nginx = command(["nginx", "-T"])
    if hashlib.sha256(nginx.encode()).hexdigest() != m["nginx_sha256"]:
        raise RuntimeError("nginx inventory drift")
    rules(m["nginx_uid"])
    # Installation review must pin full nginx config and all worker UIDs,
    # firewall ordering/no flowtable bypass, listener identity, and this file.
    if m.get("prerequisites_verified") is not True:
        raise RuntimeError("installation prerequisites unverified")


def observed(existing, current):
    """Physical readback; opening is retryable, never evidence of closure."""
    if existing is None:
        if current is None:
            return "open"
    elif existing.get("rules"):
        phase = existing.get("phase")
        if phase == "closed" and current == existing["rules"]:
            return "closed"
        if phase == "open" and current is None:
            return "open"
        if phase == "opening" and (current is None or current == existing["rules"]):
            return "opening"
    raise RuntimeError("incomplete or drifted fence")


def execute(action, m):
    if action not in ("close", "open", "status"):
        raise RuntimeError("unknown ingress action")
    validate_manifest(m)
    state = Path(m["state_dir"])
    if not state.is_absolute() or state.is_symlink():
        raise RuntimeError("state must be a private precreated backup directory")
    st = state.stat()
    if st.st_uid != 0 or st.st_mode & 0o077:
        raise RuntimeError("insecure state directory")
    with (state / "ingress.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        journal = state / "ingress.json"
        existing = json.loads(journal.read_text()) if journal.exists() else None
        manifest_sha = hashlib.sha256(json.dumps(m, sort_keys=True).encode()).hexdigest()
        if existing is not None and existing.get("manifest_sha256") != manifest_sha:
            raise RuntimeError("ingress journal manifest mismatch")
        if action == "status":
            return observed(existing, snapshot())
        if action == "open":
            status = observed(existing, snapshot())
            if status == "open":
                return status
            if not existing or not existing.get("rules"):
                raise RuntimeError("no verified recovery journal")
            # Durable intent makes deletion-before-final-journal interruption
            # retryable. Installing/draining/unknown states cannot get here.
            existing["phase"] = "opening"
            durable_json(journal, existing)
            open_transport(existing["rules"])
            existing["phase"] = "open"
            durable_json(journal, existing)
            return observed(existing, snapshot())
        if existing:
            if existing.get("phase") == "closed" and snapshot() == existing["rules"]:
                return "closed"  # Preserve newly opened localhost acceptance sockets.
            raise RuntimeError("existing session; new backup directory required")
        if snapshot() is not None:
            raise RuntimeError("table predates this session")
        # Complete prior state before the first firewall mutation; never restore
        # a whole ruleset, because unrelated administrators may update it.
        before = state / "nft.before.json"
        if before.exists():
            raise RuntimeError("backup path exists")
        before.write_text(command(["nft", "-j", "list", "ruleset"]))
        os.chmod(before, 0o600)
        with before.open("rb") as f:
            os.fsync(f.fileno())
        checksum = hashlib.sha256(before.read_bytes()).hexdigest()
        common = {"backup_sha256": checksum, "manifest_sha256": manifest_sha}
        durable_json(journal, dict(common, phase="installing"))
        installed = close_transport(m["nginx_uid"])
        durable_json(journal, dict(common, phase="draining", rules=installed))
        drain()
        durable_json(journal, dict(common, phase="closed", rules=installed))
        return "closed"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["close", "open", "status"])
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args()
    print(execute(args.action, json.loads(args.manifest.read_text())))


if __name__ == "__main__":
    main()
