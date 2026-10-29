import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import retire_cron
import sync_readback


class AdministratorTests(unittest.TestCase):
    def test_backup_then_install_and_exact_readback(self):
        original = b"# comment\n" + retire_cron.TARGET + b"0 1 * * * keep\n"
        candidate = retire_cron.proposed(original)
        with tempfile.TemporaryDirectory() as directory:
            def install(argv, **kwargs):
                self.assertEqual(Path(directory, "root.crontab.before").read_bytes(), original)
                self.assertEqual(Path(directory, "root.crontab.after").read_bytes(), candidate)
                self.assertTrue(Path(directory, "SHA256SUMS").is_file())
                self.assertEqual(argv, ["crontab", "-u", "root", str(Path(directory, "root.crontab.after"))])
            with patch.object(retire_cron.os, "geteuid", return_value=0), \
                    patch.object(retire_cron.tempfile, "mkdtemp", return_value=directory), \
                    patch.object(retire_cron.subprocess, "check_output", side_effect=[
                        "<DEV_IP>", original, original, candidate]), \
                    patch.object(retire_cron.subprocess, "run", side_effect=install) as run:
                retire_cron.retire(hashlib.sha256(original).hexdigest())
                run.assert_called_once()
            receipt = json.loads(Path(directory, "RETIREMENT.json").read_text())
            self.assertTrue(receipt["generic_restore_forbidden"])
            self.assertEqual(receipt["after"], hashlib.sha256(candidate).hexdigest())

    def test_second_read_drift_prevents_install(self):
        original = retire_cron.TARGET
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(retire_cron.os, "geteuid", return_value=0), \
                patch.object(retire_cron.tempfile, "mkdtemp", return_value=directory), \
                patch.object(retire_cron.subprocess, "check_output", side_effect=[
                    "<DEV_IP>", original, original + b"# concurrent\n"]), \
                patch.object(retire_cron.subprocess, "run") as run:
            with self.assertRaisesRegex(RuntimeError, "concurrent"):
                retire_cron.retire(hashlib.sha256(original).hexdigest())
            run.assert_not_called()

    def test_sync_descendants_and_orphans_are_not_hidden(self):
        with tempfile.TemporaryDirectory() as directory:
            for pid, parent, name, args in [
                (10, 1, "bash", ["bash", "/root/scripts/sync-uploads.sh"]),
                (11, 10, "rsync", ["rsync"]), (12, 11, "ssh", ["ssh"]),
                (15, 1, "ssh", ["ssh", "root@<LEGACY_IP>"]),
                (16, 1, "ssh", ["ssh", "other-host"]),
            ]:
                p = Path(directory, str(pid))
                p.mkdir()
                (p / "cmdline").write_bytes(b"\0".join(a.encode() for a in args))
                (p / "comm").write_text(name)
                (p / "status").write_text(f"PPid:\t{parent}\n")
            self.assertEqual([p["pid"] for p in sync_readback.sync_processes(Path(directory))],
                             [10, 11, 12, 15])


if __name__ == "__main__":
    unittest.main()
