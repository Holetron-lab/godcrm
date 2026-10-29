"""Isolated protocol acceptance. Real candidate gate; fake DB/service adapter.

No networking, PostgreSQL, PM2, systemctl or remote adapter execution.
"""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pty
import select
import signal
import subprocess
import tempfile
import time
import unittest

import package


HERE = Path(__file__).resolve().parent
FAKE = '''#!/usr/bin/python3
import json, sys
from pathlib import Path
r=json.load(sys.stdin); a=r['action']; args=r['arguments']; m=r['manifest']
p=Path(m['fixture']); s=json.loads(p.read_text()); s['events'].append([a,args])
ok=True
if a=='identity': ok=s['identity']
elif a=='fingerprint': ok=s['fingerprint']==args['expected']
elif a=='original_controls': ok=s['controls']==m['controls']
elif a=='recovery_ingress': ok=s.get('ingress_status','closed') in ('closed','opening','open')
elif a in ('writers_closed','background_closed'):
    expected=dict(ingress='active',cron='inactive',cleanup='inactive',refresh='inactive',**{'bdd-runner':'stopped'})
    if a=='writers_closed': expected['godcrm']='stopped'
    ok=all(s['controls'][k]==v for k,v in expected.items())
elif a=='unfence':
    ok=s['hba'] in ('original','fence')
    if ok: s['hba']='original'; s['reloads']+=1
elif a=='database':
    mode=args['mode']; online=s['controls']['godcrm']=='online'
    ok=s['db']=='godcrm_test' and s['hba']=='original'
    if mode=='online': ok=ok and online
    if mode=='next-start': ok=ok and not online
elif a=='health': ok=s['healthy'] and s['controls']['godcrm']=='online'
elif a=='restore_control':
    s['controls'][args['control']]=args['target']
elif a=='final_controls':
    expected={k:m['controls'][k] for k in args['intents'] if k!='hba'}
    if args['release']: expected['godcrm']='online'
    ok=all(s['controls'][k]==v for k,v in expected.items())
else: ok=False
if s['fail']==a or s['fail']==a+':'+args.get('control',''): ok=False
p.write_text(json.dumps(s)); print(json.dumps({'ok':ok})); sys.exit(0 if ok else 1)
'''


class Fixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="staging-infra-offline-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bundle = self.root / "bundle"
        self.state = self.root / "state"
        self.fake = self.root / "fake.json"
        manifest = json.loads((HERE / "manifest.example.json").read_text())
        manifest["controls"].update(getattr(self, "control_overrides", {}))
        manifest.update(mode="isolated-test", fixture=str(self.fake),
                        original_fingerprint="original-digest", candidate_fingerprint="candidate-digest")
        self.manifest = manifest
        self.initial = dict(identity=True, fingerprint="original-digest", controls=manifest['controls'].copy(),
                            hba="original", db="godcrm_test", healthy=True, reloads=0, fail="", events=[])
        self.write(self.initial)
        manifest_path = self.root / "manifest.json"
        manifest_path.write_text(json.dumps(manifest))
        original, fence = self.root / "original", self.root / "fence"
        original.write_text("original\n"); fence.write_text("fence\n")
        package.materialize(self.bundle, manifest_path, original, fence, self.state)
        (self.bundle / "adapter").write_text(FAKE)
        package.seal_bundle(self.bundle, self.state)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        stub = self.bin / "runuser"
        stub.write_text('#!/bin/bash\ncase "$*" in *to_regclass*) echo t ;; *) : ;; esac\n')
        stub.chmod(0o700)
        self.env = dict(os.environ, PATH=str(self.bin) + ":/usr/sbin:/usr/bin:/sbin:/bin",
                        STAGING_STATE_DIR=str(self.state), STAGING_LOCK_WAIT_SECONDS="1")
        result = self.gate("enter", "--holder", manifest["holder"], "--restore", str(self.bundle / "hook"))
        self.env["STAGING_MAINTENANCE_TOKEN"] = result.stdout.strip().split("=", 1)[1]
        self.hook("bind")

    def read(self):
        return json.loads(self.fake.read_text())

    def write(self, state):
        self.fake.write_text(json.dumps(state))

    def mutate(self, **values):
        state = self.read(); state.update(values); self.write(state)

    def command(self, argv, expected=0, env=None):
        result = subprocess.run(argv, env=env or self.env, text=True, capture_output=True, timeout=15)
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return result

    def gate(self, *args, expected=0, env=None):
        return self.command(["/bin/bash", str(self.bundle / "gate.sh"), *args], expected, env)

    def hook(self, *args, expected=0):
        return self.command([str(self.bundle / "hook"), *args], expected)

    def capture(self):
        self.gate("mark", "capture")
        for name in [*self.manifest["controls"], "hba"]:
            self.hook("intent", name)
        controls = dict(godcrm="stopped", cron="inactive", cleanup="inactive", ingress="active", refresh="inactive",
                        **{"bdd-runner": "stopped"})
        self.mutate(controls=controls, hba="fence")

    def assert_blocked(self):
        self.assertTrue((self.state / "maintenance").exists())
        outsider = dict(self.env); outsider.pop("STAGING_MAINTENANCE_TOKEN", None)
        self.gate("run", "--", "/bin/true", expected=75, env=outsider)

    def test_capture_restore_and_repeated_gate_restore(self):
        self.capture()
        self.gate("restore", "test")
        self.assertEqual(self.read()["controls"], self.initial["controls"])
        self.assertEqual(self.read()["hba"], "original")
        self.assertFalse((self.state / "maintenance").exists())
        self.gate("restore", "retry")

    def test_partial_apply_and_activate_never_start(self):
        self.capture()
        for step in ("apply", "activate"):
            # Separate state record phase is restored here only to exercise both
            # refusal branches of the same hook; no service is ever touched.
            path = self.state / "maintenance"
            value = path.read_text().replace("phase=restore_failed", "phase=active")
            path.write_text(value)
            self.gate("mark", step)
            self.mutate(fingerprint="partially-installed", events=[])
            self.gate("restore", expected=1)
            self.assertFalse(any(a == "restore_control" for a, _ in self.read()["events"]))
            self.assert_blocked()

    def test_unknown_fingerprint_and_identity_fail_before_unfence(self):
        self.capture()
        for changes in ({"identity": False}, {"identity": True, "fingerprint": "changed"}):
            self.mutate(**changes, events=[])
            self.gate("restore", expected=1)
            self.assertEqual(self.read()["hba"], "fence")
            self.assertFalse(any(a == "restore_control" for a, _ in self.read()["events"]))
            self.assert_blocked()

    def test_unknown_hba_and_wrong_database_fail_closed(self):
        self.capture()
        self.mutate(hba="foreign-change")
        self.gate("restore", expected=1)
        self.assert_blocked()
        self.mutate(hba="fence", db="godcrm_prod")
        self.gate("restore", expected=1)
        self.assertEqual(self.read()["controls"]["godcrm"], "stopped")
        self.assert_blocked()

    def test_retry_after_hba_write_before_reload_confirmation(self):
        self.capture()
        self.mutate(fail="unfence")
        self.gate("restore", expected=1)
        self.assertEqual(self.read()["hba"], "original")
        self.assert_blocked()
        self.mutate(fail="")
        self.gate("restore")
        self.assertEqual(self.read()["reloads"], 2)

    def test_retry_after_process_already_started(self):
        self.capture()
        self.mutate(fail="restore_control:godcrm")
        self.gate("restore", expected=1)
        self.assertEqual(self.read()["controls"]["godcrm"], "online")
        self.assert_blocked()
        self.mutate(fail="")
        self.gate("restore")

    def test_retry_after_each_control_action(self):
        for control in self.manifest["restore_order"]:
            with self.subTest(control=control):
                case = Fixture(methodName="runTest")
                try:
                    case.setUp()
                    case.capture()
                    case.mutate(fail="restore_control:" + control)
                    case.gate("restore", expected=1)
                    case.assert_blocked()
                    case.mutate(fail="")
                    case.gate("restore")
                    self.assertEqual(case.read()["controls"], case.initial["controls"])
                finally:
                    case.doCleanups()

    def test_stopped_at_entry_processes_and_inactive_timers_stay_stopped(self):
        case = Fixture(methodName="runTest")
        case.control_overrides = {"bdd-runner": "stopped", "godcrm": "stopped",
                                  "cron": "inactive", "cleanup": "inactive", "refresh": "inactive"}
        try:
            case.setUp()
            case.capture()
            case.gate("restore")
            self.assertEqual(case.read()["controls"], case.initial["controls"])
        finally:
            case.doCleanups()

    def test_no_holder_and_no_shared_lock_refuse(self):
        outsider = dict(self.env); outsider.pop("STAGING_MAINTENANCE_TOKEN", None)
        self.command([str(self.bundle / "hook"), "unfence"], expected=75, env=outsider)
        seal = hashlib.sha256((self.bundle / "pins.json").read_bytes()).hexdigest()
        self.command(["/usr/bin/python3", str(self.bundle / "recovery.py"),
                      str(self.bundle), seal, str(self.state), "bind"], expected=1)

    def test_no_journal_never_releases_gate(self):
        for path in self.state.glob("*.infra.json"):
            path.unlink()
        self.gate("restore", expected=1)
        self.assert_blocked()

    def test_unjournalled_changes_not_recovered(self):
        self.gate("mark", "capture")
        self.hook("intent", "hba")
        self.mutate(hba="fence", events=[])
        self.gate("restore")
        self.assertFalse(any(a == "restore_control" for a, _ in self.read()["events"]))

    def test_payload_tamper_refuses_before_adapter(self):
        self.capture()
        for name in ("remote.py", "manifest.json", "pg_hba.original", "adapter", "recovery.py", "gate.sh"):
            path = self.bundle / name
            original = path.read_bytes()
            path.write_bytes(original + b"\n ")
            self.mutate(events=[])
            # Use untampered gate to invoke hook when gate itself is corrupted.
            if name == "gate.sh":
                self.hook("restore", expected=1)
            else:
                self.gate("restore", expected=1)
            self.assertEqual(self.read()["events"], [])
            path.write_bytes(original)

    def test_release_requires_acceptance_even_with_valid_candidate(self):
        self.capture()
        self.gate("mark", "release")
        self.mutate(fingerprint="candidate-digest")
        self.gate("restore", expected=1)
        self.assert_blocked()

    def test_unfence_activate_accept_release(self):
        self.capture()
        self.gate("mark", "apply")
        self.mutate(fingerprint="candidate-digest")
        self.hook("unfence")
        self.gate("mark", "activate")
        state = self.read(); state["controls"]["godcrm"] = "online"; self.write(state)
        self.hook("accept")
        self.gate("mark", "release")
        self.gate("restore")
        self.assertEqual(self.read()["controls"], self.initial["controls"])

    def test_watchdog_session_loss_and_operation_lock(self):
        self.capture()
        (self.state / "heartbeat").write_text("0\n")
        lock_file = self.state / "lock"
        import fcntl
        with lock_file.open("r") as stream:
            fcntl.flock(stream, fcntl.LOCK_EX)
            self.gate("watchdog")
            self.assertTrue((self.state / "maintenance").exists())
        self.gate("watchdog")
        self.assertFalse((self.state / "maintenance").exists())

    def test_ssh_failure_leaves_gate_blocked(self):
        self.capture()
        self.mutate(fail="identity")
        self.gate("restore", expected=1)
        self.assert_blocked()

    def test_supervisor_without_tty_refuses(self):
        self.hook("supervise", "/bin/true", expected=1)

    def test_pty_disconnect_stops_supervisor_then_watchdog_recovers(self):
        self.capture()
        pid, master = pty.fork()
        if pid == 0:
            os.execve(str(self.bundle / "hook"), [str(self.bundle / "hook"), "supervise",
                      "/bin/sleep", "10"], self.env)
        try:
            deadline = time.monotonic() + 5
            # Wait for the foreground child's existence, proving first heartbeat
            # and TIOCGSID validation actually succeeded before disconnection.
            child_file = Path(f"/proc/{pid}/task/{pid}/children")
            found = False
            while time.monotonic() < deadline:
                if child_file.exists():
                    for child in child_file.read_text().split():
                        cmdline = Path(f"/proc/{child}/cmdline")
                        if cmdline.exists() and b"/bin/sleep" in cmdline.read_bytes():
                            found = True
                if found: break
                time.sleep(0.05)
            self.assertTrue(found, "supervisor never launched holder child")
            os.close(master); master = -1
            deadline = time.monotonic() + 5
            ended = False
            while time.monotonic() < deadline:
                done, status = os.waitpid(pid, os.WNOHANG)
                if done:
                    self.assertEqual(os.waitstatus_to_exitcode(status), 75)
                    ended = True
                    break
                time.sleep(0.05)
            self.assertTrue(ended, "supervisor survived PTY disconnect")
            before = (self.state / "heartbeat").read_text()
            time.sleep(0.2)
            self.assertEqual((self.state / "heartbeat").read_text(), before)
            (self.state / "heartbeat").write_text("0\n")
            self.gate("watchdog")
            self.assertFalse((self.state / "maintenance").exists())
        finally:
            if master >= 0: os.close(master)
            try: os.kill(pid, signal.SIGTERM)
            except ProcessLookupError: pass
            try: os.waitpid(pid, 0)
            except ChildProcessError: pass


if __name__ == "__main__":
    unittest.main(verbosity=2)
