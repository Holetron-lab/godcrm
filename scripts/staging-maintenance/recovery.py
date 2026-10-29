#!/usr/bin/env python3
"""Pinned, fail-closed recovery protocol. No installation or capture entrypoint.

The adapter is a separately pinned executable implementing JSON request/response
on stdin/stdout. It MUST implement the assertions in ADAPTER.md. Tests use an
isolated adapter; shipping this engine alone never enables live recovery.
"""
import hashlib
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys


class Refused(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise Refused(message)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def verify_bundle(root, seal):
    root = Path(root).resolve()
    index = root / "pins.json"
    require(digest(index) == seal, "bundle seal mismatch")
    pins = json.loads(index.read_text())
    require(isinstance(pins, dict) and pins, "empty pins")
    for name, expected in pins.items():
        path = root / name
        require(not Path(name).is_absolute() and ".." not in Path(name).parts,
                "unsafe pin path")
        require(path.is_file() and not path.is_symlink()
                and path.resolve().is_relative_to(root), "non-regular pinned payload")
        require(digest(path) == expected, "payload mismatch: " + name)
    for name in ("recovery.py", "adapter", "manifest.json", "gate.sh",
                 "pg_hba.original", "pg_hba.fence", "supervisor.py",
                 "remote.py", "runtime-check.mjs", "ingress-control.py"):
        require(name in pins, "missing required pin: " + name)
    return root


def read_record(path):
    result = {}
    for line in Path(path).read_text().splitlines():
        key, value = line.split("=", 1)
        require(key not in result, "duplicate record key")
        result[key] = value
    return result


def atomic_json(path, value):
    path = Path(path)
    temporary = path.with_suffix(".tmp")
    with open(temporary, "w", opener=lambda p, f: os.open(p, f, 0o600)) as stream:
        json.dump(value, stream, sort_keys=True)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)
    fd = os.open(path.parent, os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


class Recovery:
    def __init__(self, root, seal, state):
        self.root = verify_bundle(root, seal)
        self.seal = seal
        self.state = Path(state)
        # gate run/restore inherit fd 9. Refuse direct execution without it.
        lock = (self.state / "lock").stat()
        inherited = os.fstat(9)
        require((lock.st_dev, lock.st_ino) == (inherited.st_dev, inherited.st_ino),
                "shared gate lock fd required")
        fcntl.flock(9, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.manifest = json.loads((self.root / "manifest.json").read_text())
        self.record = read_record(self.state / "maintenance")
        require(self.manifest["candidate"] == "9ac8301d05ae623c27f8e97d7fe423abb4509ea7",
                "wrong candidate")
        require(self.manifest["controller"] == "<PROD_IP>"
                and self.manifest["target"] == "<DEV_IP>"
                and self.manifest["database"] == "godcrm_test", "wrong target")
        require(self.record["holder"] == self.manifest["holder"], "wrong holder")
        controls = self.manifest["controls"]
        require(set(controls) == {"godcrm", "bdd-runner", "cron", "cleanup", "ingress", "refresh"},
                "incomplete control inventory")
        require(self.manifest["restore_order"] ==
                ["godcrm", "bdd-runner", "cleanup", "cron", "ingress", "refresh"],
                "unsafe restore order")
        self.journal_path = self.state / (self.record["id"] + ".infra.json")

    def rpc(self, action, **arguments):
        verify_bundle(self.root, self.seal)
        request = dict(action=action, arguments=arguments,
                       manifest=self.manifest, session=self.record["id"])
        try:
            timeout = 930 if action == "fingerprint" else 45
            result = subprocess.run([str(self.root / "adapter")],
                                    input=json.dumps(request), text=True,
                                    capture_output=True, timeout=timeout, check=False,
                                    env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin",
                                         "HOME": "/root", "LANG": "C.UTF-8"})
        except subprocess.TimeoutExpired as error:
            raise Refused("adapter timeout: " + action) from error
        # Never print adapter stderr: PM2/config diagnostics can contain secrets.
        require(result.returncode == 0, "adapter failed: " + action)
        response = json.loads(result.stdout)
        require(response.get("ok") is True, "adapter refused: " + action)
        return response

    def holder(self):
        token = os.environ.get("STAGING_MAINTENANCE_TOKEN", "")
        require(token and hashlib.sha256(token.encode()).hexdigest()
                == self.record["token_sha256"], "holder token required")
        require(self.record["phase"] == "active", "not active")

    def journal(self):
        data = json.loads(self.journal_path.read_text())
        require(data["session"] == self.record["id"] and data["seal"] == self.seal,
                "journal belongs to another session/bundle")
        require(set(data["intents"]) <= set(self.manifest["controls"]) | {"hba"},
                "unknown control intent")
        return data

    def identity(self):
        self.rpc("identity")  # fixed hosts, machine identities, peer DB identity

    def bind(self):
        self.holder()
        self.identity()
        require(self.record["step"] == "precheck", "bind before capture only")
        if self.journal_path.exists():
            self.journal()
            return
        self.rpc("fingerprint", expected=self.manifest["original_fingerprint"])
        self.rpc("original_controls")
        atomic_json(self.journal_path, dict(session=self.record["id"], seal=self.seal,
                                           intents=[], completed=[], acceptance=None))

    def intent(self, control):
        self.holder()
        require(self.record["step"] == "capture", "intent requires capture")
        require(control in self.manifest["controls"] or control == "hba", "unknown control")
        data = self.journal()
        if control not in data["intents"]:
            data["intents"].append(control)
            atomic_json(self.journal_path, data)  # durable BEFORE the external action

    def unfence(self):
        data = self.journal()
        require("hba" in data["intents"], "missing HBA write-ahead intent")
        # The adapter accepts only original or this session's exact fenced bytes,
        # restores original owner/mode atomically, reloads even on a retry, then
        # verifies parse/load time, unchanged postmaster and new app connection.
        self.rpc("unfence")

    def activate_unfence(self):
        self.holder()
        require(self.record["step"] == "apply", "unfence requires apply")
        self.identity()
        self.rpc("writers_closed")
        self.rpc("fingerprint", expected=self.manifest["candidate_fingerprint"])
        self.unfence()
        self.rpc("database", mode="next-start")

    def accept(self):
        self.holder()
        require(self.record["step"] == "activate", "accept requires activate")
        self.identity()
        self.rpc("fingerprint", expected=self.manifest["candidate_fingerprint"])
        self.rpc("background_closed")
        self.rpc("database", mode="online")
        self.rpc("health")
        data = self.journal()
        data["acceptance"] = self.manifest["candidate_fingerprint"]
        atomic_json(self.journal_path, data)

    def restore(self):
        require(os.environ.get("STAGING_MAINTENANCE_ID") == self.record["id"],
                "restore session mismatch")
        step = os.environ.get("STAGING_MAINTENANCE_STEP")
        require(step == self.record["step"], "restore phase mismatch")
        require(self.record["phase"] in ("restoring", "restore_failed"),
                "restore must run through the gate")
        self.identity()
        # No unattended recovery of a potentially modified payload/database.
        require(step in ("precheck", "capture", "release"),
                "manual recovery required after apply/activate")
        data = self.journal()
        expected = self.manifest["original_fingerprint"]
        if step == "release":
            expected = self.manifest["candidate_fingerprint"]
            require(data["acceptance"] == expected, "release has no acceptance")
        self.rpc("fingerprint", expected=expected)
        # A failed close or drift must block BEFORE HBA/writer restoration.
        # On retry only a journalled opening may be resumed; it is never quiet.
        self.rpc("recovery_ingress", intended="ingress" in data["intents"])
        if "hba" in data["intents"]:
            self.unfence()
        self.rpc("database", mode="auto")
        # Restore only journalled changes, in declared dependency order; actions
        # are idempotent and re-observed even when an earlier attempt completed.
        for control in self.manifest["restore_order"]:
            if control not in data["intents"]:
                continue
            target = self.manifest["controls"][control]
            if step == "release" and control == "godcrm":
                target = "online"
            self.rpc("fingerprint", expected=expected)
            self.rpc("restore_control", control=control, target=target)
            if control == "godcrm" and target == "online":
                self.rpc("database", mode="online")
                self.rpc("health")
            if control not in data["completed"]:
                data["completed"].append(control)
                atomic_json(self.journal_path, data)
        self.rpc("final_controls", intents=data["intents"], release=step == "release")


def main():
    root, seal, state, command, *args = sys.argv[1:]
    recovery = Recovery(root, seal, state)
    commands = {"bind": recovery.bind, "intent": recovery.intent,
                "unfence": recovery.activate_unfence, "accept": recovery.accept,
                "restore": recovery.restore}
    require(command in commands, "unknown command")
    commands[command](*args)
    print("INFRA_OK=" + command)


if __name__ == "__main__":
    try:
        main()
    except (Refused, OSError, ValueError, KeyError, TypeError) as failure:
        print("INFRA_BLOCKED: " + str(failure), file=sys.stderr)
        sys.exit(1)
