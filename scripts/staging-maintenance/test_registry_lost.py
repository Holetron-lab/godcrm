"""Registry refusal and recovery using the real gate and sealed infra wrapper.

Fake DB and service adapter only. PTY tests exercise supervisor exit propagation,
including refusal versus temporary contention; no live services are invoked.
"""
import os
import pty
import select
import signal
import time
import unittest

import test_recovery as protocol


PRESENT = '#!/bin/bash\ncase "$*" in *to_regclass*) echo t ;; *) : ;; esac\n'
ABSENT = '#!/bin/bash\ncase "$*" in *to_regclass*) echo f ;; *) : ;; esac\n'
UNREADABLE = '#!/bin/bash\nexit 2\n'
GARBAGE = '#!/bin/bash\necho "psql: notice"\n'
EMPTY = '#!/bin/bash\nexit 0\n'


class RegistryLost(protocol.Fixture):
    def registry(self, body):
        stub = self.bin / "runuser"
        stub.write_text(body)
        stub.chmod(0o700)

    def test_new_operations_refused_without_registry_holder_included(self):
        self.capture()
        sentinel = self.root / "payload-ran"
        for body in (ABSENT, UNREADABLE, GARBAGE, EMPTY):
            with self.subTest(registry=body):
                self.registry(body)
                before = self.read()
                self.gate("run", "--", "/usr/bin/touch", str(sentinel), expected=1)
                self.assertFalse(sentinel.exists())
                for args in (("bind",), ("intent", "godcrm"), ("unfence",), ("accept",)):
                    self.hook(*args, expected=1)
                status = self.hook("status", expected=1)
                self.assertIn("gate=refused", status.stdout)
                self.assertIn("holder=", status.stdout)
                self.assertIn("step=capture", status.stdout)
                self.assertEqual(self.read(), before)
                self.assert_blocked()

    def test_capture_restore_works_without_registry_and_grants_no_readiness(self):
        self.capture()
        self.registry(ABSENT)
        self.gate("restore", "test")
        self.assertEqual(self.read()["controls"], self.initial["controls"])
        self.assertEqual(self.read()["hba"], "original")
        self.assertFalse((self.state / "maintenance").exists())
        self.gate("run", "--", "/bin/true", expected=1)
        self.gate("restore", "retry")
        self.gate("enter", "--holder", self.manifest["holder"],
                  "--restore", str(self.bundle / "hook"), expected=1)
        self.assertFalse((self.state / "maintenance").exists())

    def test_watchdog_recovers_a_lost_holder_without_registry(self):
        self.capture()
        self.registry(UNREADABLE)
        (self.state / "heartbeat").write_text("1\n")
        result = self.hook("watchdog")
        self.assertIn("MAINTENANCE_RELEASED", result.stdout)
        self.assertEqual(self.read()["controls"], self.initial["controls"])
        self.assertFalse((self.state / "maintenance").exists())

    def test_partial_apply_stays_blocked_without_registry(self):
        self.capture()
        self.gate("mark", "apply")
        self.registry(ABSENT)
        self.mutate(fingerprint="partially-installed", events=[])
        for _ in range(2):
            self.gate("restore", expected=1)
            self.assertFalse(any(a == "restore_control" for a, _ in self.read()["events"]))
            self.assert_blocked()
        status = self.gate("status", expected=1)
        self.assertIn("maintenance=restore_failed", status.stdout)
        self.assertIn("gate=refused", status.stdout)

    def supervise_in_pty(self, command, expected):
        pid, master = pty.fork()
        if pid == 0:
            os.execve(str(self.bundle / "hook"),
                      [str(self.bundle / "hook"), "supervise", *command], self.env)
        reaped = False
        output = bytearray()
        try:
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                if select.select([master], [], [], 0.05)[0]:
                    try:
                        output.extend(os.read(master, 65536))
                    except OSError:
                        pass  # Linux PTY returns EIO after its slave exits.
                done, status = os.waitpid(pid, os.WNOHANG)
                if done:
                    reaped = True
                    self.assertEqual(os.waitstatus_to_exitcode(status), expected,
                                     output.decode(errors="replace"))
                    return output.decode(errors="replace")
            self.fail("supervisor did not propagate child exit within 10s")
        finally:
            os.close(master)
            if not reaped:
                try:
                    os.kill(pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                os.waitpid(pid, 0)

    def test_supervisor_propagates_registry_refusal_not_temporary_75(self):
        self.capture()
        sentinel = self.root / "supervised-payload-ran"
        command = ["/bin/bash", str(self.bundle / "gate.sh"), "run", "--",
                   "/usr/bin/touch", str(sentinel)]
        for body in (ABSENT, UNREADABLE, GARBAGE, EMPTY):
            with self.subTest(registry=body):
                self.registry(body)
                self.supervise_in_pty(command, 1)
                self.assertFalse(sentinel.exists())
                before = (self.state / "heartbeat").read_bytes()
                time.sleep(0.1)
                self.assertEqual((self.state / "heartbeat").read_bytes(), before)
                self.assertEqual(self.read()["controls"]["godcrm"], "stopped")
                self.assertTrue((self.state / "maintenance").exists())
        # Refusal ends the supervisor, not recovery access; lost-holder recovery
        # is still available through the pinned watchdog with the DB unreadable.
        self.registry(UNREADABLE)
        (self.state / "heartbeat").write_text("1\n")
        self.hook("watchdog")
        self.assertEqual(self.read()["controls"], self.initial["controls"])

    def test_supervisor_propagates_hook_refusal_and_success(self):
        self.capture()
        self.registry(ABSENT)
        self.supervise_in_pty([str(self.bundle / "hook"), "intent", "godcrm"], 1)
        self.registry(PRESENT)
        self.supervise_in_pty([str(self.bundle / "hook"), "intent", "godcrm"], 0)

    def test_supervisor_preserves_real_contention_75(self):
        self.capture()
        self.supervise_in_pty(["/usr/bin/env", "-u", "STAGING_MAINTENANCE_TOKEN",
                              "/bin/bash", str(self.bundle / "gate.sh"),
                              "run", "--", "/bin/true"], 75)
        self.assertTrue((self.state / "maintenance").exists())


def load_tests(loader, tests, pattern):
    # Fixture supplies helpers and its own 18 tests, already loaded separately.
    # Avoid reporting inherited tests as additional registry acceptance cases.
    return unittest.TestSuite(RegistryLost(name) for name in sorted(RegistryLost.__dict__)
                              if name.startswith("test_"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
