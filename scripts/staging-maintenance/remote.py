"""Pinned staging-side recovery actions. Run via SSH, never installed by tests."""
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request


APP = Path("/root/production/business-crm")
HBA = Path("/etc/postgresql/16/main/pg_hba.conf")
REMOTE_LOCK = None


def check(value, message):
    if not value:
        raise RuntimeError(message)


def run(argv, **kwargs):
    return subprocess.run(argv, check=True, capture_output=True, text=True,
                          timeout=15, pass_fds=(() if REMOTE_LOCK is None else (REMOTE_LOCK,)),
                          **kwargs).stdout.strip()


def sql(query):
    return run(["/usr/sbin/runuser", "-u", "postgres", "--", "/usr/bin/psql", "-X",
                "-v", "ON_ERROR_STOP=1", "-qAt", "-d", "godcrm_test", "-c", query])


def inventory():
    rows = json.loads(run(["/usr/bin/pm2", "jlist"]))
    found = {}
    for name in ("godcrm", "bdd-runner"):
        matches = [r for r in rows if r["name"] == name]
        check(len(matches) == 1, "ambiguous or absent PM2 process")
        row = matches[0]
        check(row["pm2_env"]["pm_cwd"] == str(APP), "PM2 cwd mismatch")
        check(row["pm2_env"]["status"] in ("online", "stopped"), "unexpected PM2 status")
        found[name] = row["pm2_env"]["status"]
    return found


def unit_state(unit):
    check(run(["/bin/systemctl", "show", unit, "-p", "LoadState", "--value"]) == "loaded",
          "unit not loaded")
    return run(["/bin/systemctl", "show", unit, "-p", "ActiveState", "--value"])


def ingress(request, action="status"):
    """Execute sealed ingress bytes with the sealed nested manifest, not a
    mutable installed script or systemd's cached ActiveState."""
    m = request["manifest"]
    policy = m["ingress"]
    check(policy["target"] == m["target"] and policy["machine_id"] == m["target_machine_id"],
          "ingress target mismatch")
    source = base64.b64decode(request["payload"]["ingress-control.py"], validate=True)
    namespace = {"__name__": "sealed_ingress_control"}
    exec(compile(source, "<sealed-ingress-control>", "exec"), namespace)
    return namespace["execute"](action, policy)


def control_states(request):
    manifest = request["manifest"]
    result = inventory()
    for name, unit in units(manifest).items():
        if name != "ingress":
            result[name] = unit_state(unit)
    status = ingress(request)
    check(status in ("closed", "open"), "ingress transition incomplete")
    result["ingress"] = "active" if status == "closed" else "inactive"
    return result


def units(manifest):
    ingress = manifest["ingress_unit"]
    check(re.fullmatch(r"godcrm-staging-ingress(?:-[a-z0-9-]+)?\.service", ingress), "invalid ingress unit")
    return {"cron": "cron.service", "cleanup": "cleanup-orphaned-nodes.timer", "ingress": ingress}


def fingerprint(manifest):
    """Hash complete enumerated immutable roots incl. names, types, modes, owners.

    No excludes or .gitignore. A mutable log in these roots makes the probe fail;
    resolve the inventory before enabling maintenance, never ignore a mismatch.
    Symlinks are hashed as links and their external target must have its own root.
    """
    roots = manifest["fingerprint_roots"]
    check(str(APP) in roots, "application root missing")
    records = []
    covered = [Path(p).resolve() for p in roots]
    for root in roots:
        path = Path(root)
        check(path.is_absolute() and path.exists() and not path.is_symlink(), "invalid fingerprint root")
        paths = [path]
        if path.is_dir():
            paths.extend(sorted(path.rglob("*")))
        for item in paths:
            info = item.lstat()
            prefix = [str(item), stat.S_IMODE(info.st_mode), info.st_uid, info.st_gid]
            if item.is_symlink():
                target = item.resolve(strict=True)
                check(any(target == r or target.is_relative_to(r) for r in covered),
                      "external symlink target not fingerprinted")
                record = prefix + ["link", os.readlink(item)]
            elif item.is_dir():
                record = prefix + ["dir"]
            else:
                check(stat.S_ISREG(info.st_mode), "special file in payload")
                hasher = hashlib.sha256()
                with item.open("rb") as stream:
                    for block in iter(lambda: stream.read(1024 * 1024), b""):
                        hasher.update(block)
                after = item.stat()
                check((info.st_ino, info.st_size, info.st_mtime_ns) ==
                      (after.st_ino, after.st_size, after.st_mtime_ns), "payload changed while hashing")
                record = prefix + ["file", hasher.hexdigest()]
            records.append(record)
    return hashlib.sha256(json.dumps(records, separators=(",", ":")).encode()).hexdigest()


def database(request, mode):
    if mode == "auto":
        mode = "online" if inventory()["godcrm"] == "online" else "next-start"
    probe = base64.b64decode(request["payload"]["runtime-check.mjs"], validate=True).decode()
    # Only mode is added; never output PM2/.env values. The pinned candidate probe
    # checks actual current/next-start DB connections, not just config strings.
    environment = dict(os.environ, RUNTIME_CHECK_MODE=mode)
    run(["/usr/bin/node", "--input-type=module", "-e", probe], cwd=APP, env=environment)


def unfence(request):
    manifest = request["manifest"]
    original = base64.b64decode(request["payload"]["pg_hba.original"], validate=True)
    fenced = base64.b64decode(request["payload"]["pg_hba.fence"], validate=True)
    check(not HBA.is_symlink(), "HBA symlink refused")
    check(HBA.read_bytes() in (original, fenced), "unknown HBA content")
    check(sql("show hba_file") == str(HBA), "wrong HBA path")
    started = sql("select pg_postmaster_start_time()")
    loaded = sql("select pg_conf_load_time()")
    meta = manifest["hba_metadata"]
    descriptor, name = tempfile.mkstemp(prefix=".staging-hba-", dir=HBA.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(original)
            stream.flush()
            os.fchown(stream.fileno(), meta["uid"], meta["gid"])
            os.fchmod(stream.fileno(), meta["mode"])
            os.fsync(stream.fileno())
        # Compare again immediately before replacing. All writers must already be
        # excluded; this does not substitute for the shared maintenance gate.
        check(HBA.read_bytes() in (original, fenced), "concurrent HBA change")
        os.replace(name, HBA)
        directory = os.open(HBA.parent, os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(name):
            os.unlink(name)
    check(sql("select count(*) from pg_hba_file_rules where error is not null") == "0",
          "invalid HBA after restore")
    check(sql("select pg_reload_conf()") == "t", "reload not signalled")
    for _ in range(20):
        if sql("select pg_conf_load_time()") != loaded:
            break
        time.sleep(0.2)
    else:
        raise RuntimeError("reload not observed")
    check(sql("select pg_postmaster_start_time()") == started, "unexpected PostgreSQL restart")
    check(HBA.read_bytes() == original, "HBA changed after reload")
    info = HBA.stat()
    check((info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) ==
          (meta["uid"], meta["gid"], meta["mode"]), "HBA metadata mismatch")
    database(request, "auto")


def remote(request):
    manifest, args = request["manifest"], request["arguments"]
    check(os.geteuid() == 0, "root required")
    check("<DEV_IP>" in run(["/bin/hostname", "-I"]).split(), "wrong target")
    check(Path("/etc/machine-id").read_text().strip() == manifest["target_machine_id"],
          "wrong target machine id")
    check(sql("select current_database()") == "godcrm_test", "wrong database")
    action = request["action"]
    if action == "identity":
        return
    if action == "fingerprint":
        check(fingerprint(manifest) == args["expected"], "payload fingerprint mismatch")
    elif action in ("original_controls", "final_controls", "writers_closed", "background_closed"):
        states = control_states(request)
        if action == "original_controls":
            expected = manifest["controls"]
        elif action == "final_controls":
            expected = {k: manifest["controls"][k] for k in args["intents"] if k != "hba"}
            if args["release"] and "godcrm" in expected:
                expected["godcrm"] = "online"
        else:
            expected = {"bdd-runner": "stopped", "cron": "inactive", "cleanup": "inactive", "ingress": "active"}
            if action == "writers_closed":
                expected["godcrm"] = "stopped"
            check(unit_state("cleanup-orphaned-nodes.service") == "inactive", "cleanup still running")
        for control, state in expected.items():
            if control != "refresh":
                check(states[control] == state, "control state mismatch: " + control)
    elif action == "recovery_ingress":
        status = ingress(request)
        target = manifest["controls"]["ingress"]
        check(target in ("active", "inactive"), "invalid original ingress state")
        if args["intended"] and target == "inactive":
            check(status in ("closed", "opening", "open"), "ingress recovery refused")
        else:
            check(status == ("closed" if target == "active" else "open"),
                  "unjournalled ingress change")
    elif action == "unfence":
        unfence(request)
    elif action == "database":
        check(args["mode"] in ("stopped", "next-start", "online", "auto"), "unknown DB mode")
        database(request, args["mode"])
    elif action == "health":
        with urllib.request.urlopen("http://127.0.0.1:5000/api/health", timeout=5) as response:
            check(response.status == 200, "unhealthy")
    elif action == "restore_control":
        name, target = args["control"], args["target"]
        if name == "ingress":
            check(target in ("active", "inactive"), "invalid ingress target")
            if target == "active":
                check(ingress(request) == "closed", "original closed ingress lost")
            else:
                # execute(open) verifies physical rules/journal even when the
                # oneshot is failed/inactive, and safely resumes its own opening.
                check(ingress(request, "open") == "open", "ingress open failed")
                unit = units(manifest)[name]
                if unit_state(unit) == "active":
                    run(["/bin/systemctl", "stop", unit])
                check(ingress(request) == "open", "ingress final readback failed")
        elif name in ("godcrm", "bdd-runner"):
            observed = inventory()[name]
            check(target in ("online", "stopped"), "invalid PM2 target")
            if observed != target:
                if target == "online":
                    database(request, "auto")
                run(["/usr/bin/pm2", "restart" if target == "online" else "stop", name])
            check(inventory()[name] == target, "PM2 restore readback failed")
        else:
            unit = units(manifest)[name]
            check(target in ("active", "inactive"), "unsupported service state")
            if unit_state(unit) != target:
                run(["/bin/systemctl", "start" if target == "active" else "stop", unit])
            check(unit_state(unit) == target, "unit restore readback failed")
    else:
        raise RuntimeError("unknown adapter action")


if __name__ == "__main__":
    try:
        request = json.load(sys.stdin)
        check("<DEV_IP>" in run(["/bin/hostname", "-I"]).split(), "wrong target")
        check(Path("/etc/machine-id").read_text().strip() == request["manifest"]["target_machine_id"],
              "wrong target machine id")
        # A timed-out SSH client must not let its retry overtake a still-running
        # remote action. CLI children inherit this lock until they finish too.
        REMOTE_LOCK = os.open("/run/lock/godcrm-staging-maintenance.lock", os.O_CREAT | os.O_RDWR, 0o600)
        fcntl.flock(REMOTE_LOCK, fcntl.LOCK_EX | fcntl.LOCK_NB)
        remote(request)
        print('{"ok": true}')
    except Exception:
        print('{"ok": false}')
        sys.exit(1)
