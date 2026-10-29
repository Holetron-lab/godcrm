#!/usr/bin/python3
"""Live adapter template; invoked only by a sealed recovery bundle on .128.

No shell interpolation of secrets. Remote helper runs from stdin/code, is not
installed into the staging application. stdout is the sanitized JSON protocol.
"""
import base64
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys


def call(argv, timeout=35, **kwargs):
    return subprocess.run(argv, check=True, capture_output=True, text=True,
                          timeout=timeout, **kwargs).stdout.strip()


def adapter(request):
    bundle = Path(__file__).resolve().parent
    manifest = request["manifest"]
    if manifest.get("mode") != "live":
        raise RuntimeError("live manifest required")
    if os.geteuid() != 0 or "<PROD_IP>" not in call(["/bin/hostname", "-I"]).split():
        raise RuntimeError("wrong controller")
    if Path("/etc/machine-id").read_text().strip() != manifest["controller_machine_id"]:
        raise RuntimeError("controller machine id mismatch")
    action = request["action"]
    arguments = request["arguments"]
    local_target = manifest["controls"]["refresh"]
    unit = "godcrm-dev-refresh.timer"
    if action in ("writers_closed", "background_closed"):
        if call(["/bin/systemctl", "show", unit, "-p", "ActiveState", "--value"]) != "inactive":
            raise RuntimeError("refresh not excluded")
    if action == "original_controls":
        if call(["/bin/systemctl", "show", unit, "-p", "ActiveState", "--value"]) != local_target:
            raise RuntimeError("refresh original state mismatch")
    if action == "restore_control" and arguments["control"] == "refresh":
        target = arguments["target"]
        if target not in ("active", "inactive"):
            raise RuntimeError("unsupported timer state")
        observed = call(["/bin/systemctl", "show", unit, "-p", "ActiveState", "--value"])
        if observed != target:
            call(["/bin/systemctl", "start" if target == "active" else "stop", unit])
        if call(["/bin/systemctl", "show", unit, "-p", "ActiveState", "--value"]) != target:
            raise RuntimeError("timer readback mismatch")
        return {"ok": True}
    if action == "final_controls" and "refresh" in arguments["intents"]:
        if call(["/bin/systemctl", "show", unit, "-p", "ActiveState", "--value"]) != local_target:
            raise RuntimeError("refresh readback mismatch")
    request["payload"] = {
        name: base64.b64encode((bundle / name).read_bytes()).decode()
        for name in ("pg_hba.original", "pg_hba.fence", "runtime-check.mjs", "ingress-control.py")
    }
    helper = (bundle / "remote.py").read_text()
    ssh = ["/usr/bin/ssh", "-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
           "-o", "UpdateHostKeys=no", "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=5",
           "-o", "ServerAliveCountMax=2", "-p", "2222", "root@<DEV_IP>",
           "/usr/bin/python3 -c " + shlex.quote(helper)]
    return json.loads(call(ssh, input=json.dumps(request), timeout=920 if action == "fingerprint" else 35))


if __name__ == "__main__":
    try:
        print(json.dumps(adapter(json.load(sys.stdin))))
    except Exception:
        # Subprocess exceptions can embed the inline helper/connection details.
        print('{"ok": false, "error": "live adapter refused; inspect private diagnostics"}')
        sys.exit(1)
