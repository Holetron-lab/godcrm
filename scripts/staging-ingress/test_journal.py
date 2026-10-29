"""Real ingress journal, mocked kernel. No host rules/services are changed."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import control


class JournalTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='ingress-journal-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.manifest = {'state_dir': str(self.root), 'nginx_uid': 33}
        self.current = None
        self.deletes = 0
        for name, value in [('validate_manifest', lambda m: None),
                            ('snapshot', lambda: copy.deepcopy(self.current)),
                            ('command', lambda *a: '{}'), ('drain', lambda: None),
                            ('close_transport', self.close), ('open_transport', self.open)]:
            p = patch.object(control, name, side_effect=value)
            p.start(); self.addCleanup(p.stop)

    def close(self, uid):
        self.current = [{'rule': {'uid': uid}}]
        return copy.deepcopy(self.current)

    def open(self, expected):
        if self.current is not None and self.current != expected:
            raise RuntimeError('drift')
        self.current = None
        self.deletes += 1

    def call(self, action):
        return control.execute(action, self.manifest)

    def test_complete_close_open_and_repeated_open(self):
        self.assertEqual(self.call('status'), 'open')
        self.assertEqual(self.call('close'), 'closed')
        self.assertEqual(self.call('status'), 'closed')
        self.assertEqual(self.call('open'), 'open')
        self.assertEqual(self.call('open'), 'open')
        self.assertEqual(self.deletes, 1)

    def test_failed_drain_never_opens(self):
        with patch.object(control, 'drain', side_effect=RuntimeError('failed drain')):
            with self.assertRaises(RuntimeError): self.call('close')
        for action in ('status', 'open'):
            with self.subTest(action=action), self.assertRaises(RuntimeError): self.call(action)
        self.assertIsNotNone(self.current)
        self.assertEqual(self.deletes, 0)

    def test_install_interruption_before_rules_journal_never_opens(self):
        def crash(uid):
            self.close(uid)
            raise RuntimeError('lost after install')
        with patch.object(control, 'close_transport', side_effect=crash):
            with self.assertRaises(RuntimeError): self.call('close')
        with self.assertRaises(RuntimeError): self.call('open')
        self.assertEqual(self.deletes, 0)

    def test_drift_never_opens_or_reports_closed(self):
        self.call('close'); self.current = [{'foreign': True}]
        for action in ('status', 'open', 'close'):
            with self.subTest(action=action), self.assertRaises(RuntimeError): self.call(action)
        self.assertEqual(self.deletes, 0)

    def test_interruption_after_deletion_resumes_own_opening(self):
        self.call('close')
        def crash(expected):
            self.open(expected)
            raise RuntimeError('lost after delete')
        with patch.object(control, 'open_transport', side_effect=crash):
            with self.assertRaises(RuntimeError): self.call('open')
        self.assertEqual(self.call('status'), 'opening')
        self.assertEqual(self.call('open'), 'open')
        self.assertEqual(self.call('status'), 'open')

    def test_interruption_before_deletion_and_later_drift(self):
        self.call('close')
        with patch.object(control, 'open_transport', side_effect=RuntimeError('interrupted')):
            with self.assertRaises(RuntimeError): self.call('open')
        self.assertEqual(self.call('status'), 'opening')
        self.current = [{'foreign': True}]
        with self.assertRaises(RuntimeError): self.call('open')
        self.assertEqual(self.deletes, 0)

    def test_missing_rules_after_closed_is_unknown(self):
        self.call('close'); self.current = None
        with self.assertRaises(RuntimeError): self.call('status')
        with self.assertRaises(RuntimeError): self.call('open')

    def test_manifest_change_refuses_before_deletion(self):
        self.call('close'); self.manifest['nginx_uid'] = 34
        with self.assertRaisesRegex(RuntimeError, 'manifest mismatch'): self.call('open')
        self.assertEqual(self.deletes, 0)

    def test_malformed_journal_refuses(self):
        (self.root / 'ingress.json').write_text('{')
        with self.assertRaises(ValueError): self.call('open')
        self.assertEqual(self.deletes, 0)


if __name__ == '__main__':
    unittest.main()
