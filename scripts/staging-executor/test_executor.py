#!/usr/bin/env python3
"""Unit tests for the executor's trust boundary (no socket, no preflight).

    python3 -m unittest discover -s scripts/staging-executor -p 'test_*.py' -v

The end-to-end path (socket, HMAC round trip, revoke/timeout/broker-death,
lease contention) is covered by backend/__tests__/ops/staging-channel.test.js
against the real process; this file pins the pure validation contract.
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import executor  # noqa: E402

CFG = {'source_repo': str(HERE), 'timeout': 120}
NOW = 1_800_000_000


def body(**patch):
    base = {
        'v': 1, 'run_id': 1, 'nonce': 'a' * 32, 'issued_at': NOW, 'deadline_s': 120,
        'action': 'staging.preflight', 'job_id': '20841', 'agent_id': 31113, 'space_id': 11, 'role': 'sysadmin',
        'candidate_sha': 'c' * 40, 'source_repo': str(HERE), 'expected_executor_sha256': executor.executor_digest(),
        'target': dict(executor.TARGET),
    }
    base.update(patch)
    return base


class Canonical(unittest.TestCase):
    def test_sorted_compact_matches_node(self):
        self.assertEqual(executor.canonical({'b': [1, {'d': None, 'c': 'x'}], 'a': True}),
                         '{"a":true,"b":[1,{"c":"x","d":null}]}')

    def test_signature_depends_on_every_byte(self):
        a = executor.sign('k' * 32, body())
        self.assertNotEqual(a, executor.sign('k' * 32, body(run_id=2)))
        self.assertNotEqual(a, executor.sign('j' * 32, body()))
        self.assertEqual(a, executor.sign('k' * 32, dict(reversed(list(body().items())))))


class Validate(unittest.TestCase):
    def setUp(self):
        executor.NONCES.clear()

    def check(self, reason, **patch):
        self.assertEqual(executor.validate(body(**patch), CFG, NOW), reason)

    def test_accepts_the_exact_contract_once(self):
        self.check(None)
        self.check('replay')  # same nonce again

    def test_denies_everything_else_before_any_work(self):
        self.check('invalid_request', shell='id')
        b = body(); del b['role']
        self.assertEqual(executor.validate(b, CFG, NOW), 'invalid_request')
        self.check('invalid_request', run_id='1')
        self.check('invalid_request', run_id=True)
        self.check('unsupported_version', v=2)
        self.check('stale_request', issued_at=NOW - 61)
        self.check('stale_request', issued_at=NOW + 61)
        self.check('replay', nonce='not-hex')
        self.check('action_denied', action='staging.deploy', nonce='b' * 32)
        self.check('action_denied', action='host.identity', nonce='c' * 32)
        self.check('role_denied', role='developer-ralph', nonce='d' * 32)
        self.check('invalid_sha', candidate_sha='HEAD', nonce='e' * 32)
        self.check('target_mismatch', target=dict(executor.TARGET, database='godcrm_prod'), nonce='f' * 32)
        self.check('target_mismatch', target=dict(executor.TARGET, host='<PROD_IP>'), nonce='0' * 32)
        self.check('repo_mismatch', source_repo='/srv/godcrm/live', nonce='1' * 32)
        self.check('executor_digest_mismatch', expected_executor_sha256='0' * 64, nonce='2' * 32)
        self.check('deadline_denied', deadline_s=0, nonce='3' * 32)

    def test_actions_and_roles_are_closed_sets(self):
        self.assertEqual(executor.ACTIONS, frozenset({'staging.preflight'}))
        self.assertEqual(executor.ROLES, frozenset({'sysadmin'}))
        self.assertEqual(executor.TARGET['database'], 'godcrm_test')


class Digest(unittest.TestCase):
    def test_digest_covers_both_files_and_changes_with_content(self):
        with tempfile.TemporaryDirectory() as tmp:
            for name in executor.FILES:
                (Path(tmp) / name).write_bytes((HERE / name).read_bytes())
            self.assertEqual(executor.executor_digest(tmp), executor.executor_digest())
            (Path(tmp) / 'preflight.py').write_bytes(b'# tampered\n')
            self.assertNotEqual(executor.executor_digest(tmp), executor.executor_digest())

    def test_cli_digest_matches_library(self):
        out = subprocess.check_output([sys.executable, str(HERE / 'executor.py'), '--digest'], text=True).strip()
        self.assertEqual(out, executor.executor_digest())


class Preflight(unittest.TestCase):
    def test_report_is_sanitized_json_and_never_authorizes(self):
        spec = {'run_id': 1, 'candidate_sha': 'c' * 40, 'source_repo': '/nonexistent', 'target': executor.TARGET,
                'remote': False, 'coord_db': 'godcrm_test', 'executor_root': str(HERE)}
        done = subprocess.run([sys.executable, str(HERE / 'preflight.py')], input=json.dumps(spec), capture_output=True,
                              text=True, timeout=60, env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8'})
        report = json.loads(done.stdout)
        self.assertEqual(done.returncode, 1)  # nonexistent repo: source/config checks fail, nothing else happens
        self.assertFalse(report['ok'])
        self.assertFalse(report['remote'])
        self.assertEqual(set(report['checks']), {'host_identity', 'source', 'installed_code', 'config_digests', 'coordination', 'refresh_state'})
        self.assertFalse(report['checks']['source']['ok'])
        self.assertNotIn('authorize', done.stdout)
        for check in report['checks'].values():
            self.assertIn('ok', check)
            self.assertNotIn('stderr', check)
            self.assertNotIn('stdout', check)


if __name__ == '__main__':
    unittest.main()
