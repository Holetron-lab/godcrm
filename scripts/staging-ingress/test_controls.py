import hashlib
import unittest
from unittest.mock import patch

import control
import retire_cron


class CronTests(unittest.TestCase):
    def test_exact_line_only_and_remaining_bytes_preserved(self):
        original = b"# before\nA=one\n" + retire_cron.TARGET + b"# after\n0 2 * * * other\n"
        result = retire_cron.prepare(original, hashlib.sha256(original).hexdigest())
        self.assertEqual(result, b"# before\nA=one\n# after\n0 2 * * * other\n")

    def test_missing_duplicate_and_edited_entries_refused(self):
        for original in [b"", retire_cron.TARGET * 2, retire_cron.TARGET.rstrip(),
                         retire_cron.TARGET.replace(b"*/5", b"*/10")]:
            with self.subTest(original=original), self.assertRaises(ValueError):
                retire_cron.proposed(original)

    def test_drift_refused(self):
        with self.assertRaisesRegex(ValueError, "drift"):
            retire_cron.prepare(retire_cron.TARGET, "0" * 64)


class ControlTests(unittest.TestCase):
    def test_review_manifest_refused_before_runtime_read(self):
        with patch.object(control, "command") as run, self.assertRaises(RuntimeError):
            control.validate_manifest({"mode": "review-only"})
        run.assert_not_called()

    def test_root_or_untyped_uid_refused(self):
        for uid in [0, -1, "33", True]:
            with self.subTest(uid=uid), self.assertRaises(ValueError):
                control.rules(uid)

    def test_drift_prevents_open(self):
        with patch.object(control, "snapshot", return_value=[{"drift": True}]), \
                patch.object(control, "command") as run, self.assertRaises(RuntimeError):
            control.open_transport([{"expected": True}])
        run.assert_not_called()

    def test_repeated_open_is_noop(self):
        with patch.object(control, "snapshot", return_value=None), patch.object(control, "command") as run:
            control.open_transport([{"expected": True}])
        run.assert_not_called()

    def test_existing_table_not_overwritten(self):
        with patch.object(control, "snapshot", return_value=[{}]), \
                patch.object(control, "command") as run, self.assertRaises(RuntimeError):
            control.close_transport(33)
        run.assert_not_called()

    def test_remaining_socket_fails_drain(self):
        with patch.object(control, "command", side_effect=["", "ESTAB remains"]), \
                self.assertRaisesRegex(RuntimeError, "remain"):
            control.drain()

    def test_socket_destroy_failure_propagates(self):
        with patch.object(control, "command", side_effect=RuntimeError("unsupported")), \
                self.assertRaisesRegex(RuntimeError, "unsupported"):
            control.drain()


if __name__ == "__main__":
    unittest.main()
