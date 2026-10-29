"""Exercise the real remote helper on temporary HBA/tree with mocked services.

The adapter's live subprocess entrypoint is never invoked by this suite.
"""
import base64
import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import remote


class RemoteHelper(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="staging-hba-isolated-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.hba = self.root / "pg_hba.conf"
        self.hba.write_bytes(b"fenced\n")
        self.hba.chmod(0o600)
        self.patch = patch.object(remote, "HBA", self.hba)
        self.patch.start(); self.addCleanup(self.patch.stop)
        self.reloads = 0
        self.bad_parse = False
        self.restart = False
        self.request = {"manifest": {"hba_metadata": {"uid": os.getuid(), "gid": os.getgid(), "mode": 0o640}},
                        "payload": {"pg_hba.original": base64.b64encode(b"original\n").decode(),
                                    "pg_hba.fence": base64.b64encode(b"fenced\n").decode()}}

    def sql(self, query):
        if query == "show hba_file": return str(self.hba)
        if query == "select pg_postmaster_start_time()":
            return "other" if self.restart and self.reloads else "original-postmaster"
        if query == "select pg_conf_load_time()": return str(self.reloads)
        if query == "select pg_reload_conf()": self.reloads += 1; return "t"
        if "pg_hba_file_rules" in query: return "1" if self.bad_parse else "0"
        raise AssertionError(query)

    def test_compare_restore_metadata_reload_and_idempotent_retry(self):
        with patch.object(remote, "sql", side_effect=self.sql), patch.object(remote, "database") as database:
            remote.unfence(self.request)
            remote.unfence(self.request)
            self.assertEqual(self.reloads, 2)
            self.assertEqual(self.hba.read_bytes(), b"original\n")
            self.assertEqual(self.hba.stat().st_mode & 0o777, 0o640)
            self.assertEqual(database.call_count, 2)

    def test_unknown_hba_fails_before_mutation_and_reload(self):
        self.hba.write_bytes(b"foreign\n")
        with patch.object(remote, "sql", side_effect=self.sql), patch.object(remote, "database"):
            with self.assertRaisesRegex(RuntimeError, "unknown HBA"):
                remote.unfence(self.request)
        self.assertEqual(self.hba.read_bytes(), b"foreign\n")
        self.assertEqual(self.reloads, 0)

    def test_reload_refusal_after_write_is_retryable(self):
        with patch.object(remote, "sql", side_effect=self.sql), patch.object(remote, "database"):
            self.bad_parse = True
            with self.assertRaisesRegex(RuntimeError, "invalid HBA"):
                remote.unfence(self.request)
            self.assertEqual(self.reloads, 0)
            self.bad_parse = False
            remote.unfence(self.request)
            self.assertEqual(self.reloads, 1)

    def test_postmaster_restart_refused(self):
        self.restart = True
        with patch.object(remote, "sql", side_effect=self.sql), patch.object(remote, "database"):
            with self.assertRaisesRegex(RuntimeError, "unexpected PostgreSQL restart"):
                remote.unfence(self.request)

    def test_file_addition_deletion_mode_and_dependency_mutation_change_fingerprint(self):
        app = self.root / "app"
        app.mkdir(); (app / "package-lock.json").write_text("lock")
        dependencies = app / "node_modules"; dependencies.mkdir()
        dep = dependencies / "dep.js"; dep.write_text("version1")
        manifest = {"fingerprint_roots": [str(app)]}
        with patch.object(remote, "APP", app):
            original = remote.fingerprint(manifest)
            dep.write_text("version2")
            self.assertNotEqual(original, remote.fingerprint(manifest))
            dep.write_text("version1")
            self.assertEqual(original, remote.fingerprint(manifest))
            dep.chmod(0o700)
            self.assertNotEqual(original, remote.fingerprint(manifest))
            extra = app / "unexpected.js"; extra.write_text("extra")
            second = remote.fingerprint(manifest)
            extra.unlink()
            self.assertNotEqual(second, remote.fingerprint(manifest))

    def test_external_symlink_requires_target_inventory(self):
        app = self.root / "app"; app.mkdir()
        outside = self.root / "deps"; outside.mkdir()
        (outside / "dep").write_text("real dependency")
        (app / "node_modules").symlink_to(outside)
        with patch.object(remote, "APP", app):
            with self.assertRaisesRegex(RuntimeError, "external symlink"):
                remote.fingerprint({"fingerprint_roots": [str(app)]})
            remote.fingerprint({"fingerprint_roots": [str(app), str(outside)]})


if __name__ == "__main__":
    unittest.main(verbosity=2)
