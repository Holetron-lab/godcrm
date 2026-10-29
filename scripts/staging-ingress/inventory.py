#!/usr/bin/env python3
"""Read-only staging inventory; no environment, tokens or full argv output."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess


def read(argv):
    result = subprocess.run(argv, text=True, capture_output=True, timeout=25)
    return {"exit": result.returncode, "stdout": result.stdout}


def inventory():
    addresses = read(["hostname", "-I"])
    if "<DEV_IP>" not in addresses["stdout"].split():
        raise RuntimeError("not staging")
    result = {"timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "machine_id": Path("/etc/machine-id").read_text().strip(), "addresses": addresses,
              "processes": [], "containers": [], "sources": {}}
    for proc in Path("/proc").iterdir():
        if not proc.name.isdigit():
            continue
        try:
            name = (proc / "comm").read_text().strip()
            cwd = os.readlink(proc / "cwd")
            if not (any(n in name.lower() for n in ["node", "cron", "rsync", "claude", "codex", "vite", "nginx"])
                    or cwd.startswith("/root/production/business-crm")):
                continue
            args = (proc / "cmdline").read_bytes().split(b"\0")
            scripts = [a.decode(errors="replace") for a in args[:3]
                       if a.endswith((b".js", b".mjs", b".sh", b".py"))]
            result["processes"].append({"pid": int(proc.name), "name": name, "cwd": cwd,
                "exe": os.readlink(proc / "exe"), "scripts": scripts,
                "cgroup": (proc / "cgroup").read_text().strip(),
                "parent_uid": [s for s in (proc / "status").read_text().splitlines()
                               if s.startswith(("PPid:", "Uid:"))]})
        except OSError:
            continue
    ids = read(["docker", "ps", "-q"])
    if ids["exit"] != 0:
        result["docker_error"] = True
    for cid in ids["stdout"].split():
        d = json.loads(subprocess.check_output(["docker", "inspect", cid], text=True))[0]
        result["containers"].append({"name": d["Name"], "pid": d["State"]["Pid"],
            "image": d["Config"]["Image"], "network": d["HostConfig"]["NetworkMode"],
            "mounts": [{"source": m["Source"], "destination": m["Destination"], "rw": m["RW"]}
                       for m in d["Mounts"]]})
    for path in ["/usr/local/bin/cleanup-orphaned-nodes.sh", "/usr/local/bin/cleanup-stuck-vite",
                 "/root/scripts/sync-uploads.sh", "/root/production/business-crm/scripts/architect-cron.sh"]:
        result["sources"][path] = hashlib.sha256(Path(path).read_bytes()).hexdigest()
    result["cleanup"] = read(["systemctl", "show", "cleanup-orphaned-nodes.service",
        "-p", "ActiveState", "-p", "SubState", "-p", "Result", "-p", "MainPID",
        "-p", "ControlGroup", "-p", "ExecMainCode", "-p", "ExecMainStatus"])
    log = Path("/var/log/cleanup-orphaned-nodes.log").read_text(errors="replace").splitlines()
    result["cleanup_self_kill"] = [s for s in log[-150:]
        if ": /bin/bash /usr/local/bin/cleanup-orphaned-nodes.sh" in s][-5:]
    result["crontab"] = read(["crontab", "-l"])
    result["cron_digest"] = hashlib.sha256(result["crontab"]["stdout"].encode()).hexdigest()
    result["nginx"] = read(["nginx", "-T"])
    result["nginx_sha256"] = hashlib.sha256(result["nginx"]["stdout"].encode()).hexdigest()
    result["nft"] = read(["nft", "-j", "list", "ruleset"])
    result["units"] = read(["systemctl", "list-units", "--type=service", "--state=running", "--no-pager"])
    result["timers"] = read(["systemctl", "list-timers", "--all", "--no-pager"])
    result["db_sessions"] = read(["runuser", "-u", "postgres", "--", "psql", "-X", "-At",
        "-d", "godcrm_test", "-c", "BEGIN READ ONLY; SELECT current_database(); "
        "SELECT usename,application_name,client_addr,state,count(*) FROM pg_stat_activity "
        "WHERE datname=current_database() GROUP BY 1,2,3,4; COMMIT;"])
    return result


if __name__ == "__main__":
    print(json.dumps(inventory(), indent=2))
