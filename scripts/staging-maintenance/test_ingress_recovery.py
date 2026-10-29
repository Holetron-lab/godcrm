"""Recovery ordering plus real remote -> sealed ingress -> physical readback."""
import base64
import copy
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import remote
from test_recovery import Fixture, HERE


class RecoveryIngressTests(unittest.TestCase):
    def setUp(self):
        self.case = Fixture(methodName='runTest')
        self.addCleanup(self.case.doCleanups)
        self.case.setUp()

    def test_failed_close_blocks_before_hba_or_any_writer(self):
        c = self.case; c.capture()
        for status in ('draining', 'installing', 'drift', 'unknown'):
            c.mutate(ingress_status=status, events=[])
            c.gate('restore', expected=1)
            events = c.read()['events']
            self.assertFalse(any(a in ('unfence', 'restore_control') for a, _ in events))
            self.assertEqual(c.read()['hba'], 'fence')
            c.assert_blocked()

    def test_retry_rechecks_ingress_even_after_app_started(self):
        c = self.case; c.capture(); c.mutate(fail='restore_control:godcrm')
        c.gate('restore', expected=1)
        self.assertEqual(c.read()['controls']['godcrm'], 'online')
        c.mutate(fail='', ingress_status='drift', events=[])
        c.gate('restore', expected=1)
        self.assertFalse(any(a == 'restore_control' for a, _ in c.read()['events']))
        c.assert_blocked()
        c.mutate(ingress_status='closed')
        c.gate('restore')

    def test_sealed_ingress_tamper_stops_before_adapter(self):
        c = self.case; c.capture(); c.mutate(events=[])
        with (c.bundle / 'ingress-control.py').open('a') as stream: stream.write('\n# drift\n')
        c.gate('restore', expected=1)
        self.assertEqual(c.read()['events'], [])
        c.assert_blocked()


class RemoteIngressTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='remote-ingress-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.current = None
        self.deletes = 0
        self.systemctl = []
        self.drain_failure = False
        self.machine = Path('/etc/machine-id').read_text().strip()
        import hashlib
        self.manifest = dict(target='<DEV_IP>', target_machine_id=self.machine,
            ingress_unit='godcrm-staging-ingress.service', controls={'ingress':'inactive'},
            ingress=dict(mode='approved-for-admin', target='<DEV_IP>', machine_id=self.machine,
                         nginx_uid=33, nginx_sha256=hashlib.sha256(b'configuration\n').hexdigest(),
                         prerequisites_verified=True, state_dir=str(self.root)))
        self.request = dict(manifest=self.manifest, arguments={}, payload={
            'ingress-control.py': base64.b64encode((HERE.parent / 'staging-ingress/control.py').read_bytes()).decode()})
        p = patch.object(subprocess, 'run', side_effect=self.command)
        p.start(); self.addCleanup(p.stop)

    def command(self, argv, **kwargs):
        output = ''
        if argv[0] in ('hostname', '/bin/hostname'): output = '<DEV_IP>\n'
        elif argv[:2] == ['nginx', '-T']: output = 'configuration\n'
        elif argv == ['nft', '-j', 'list', 'tables']:
            output = json.dumps({'nftables': [] if self.current is None else [{'table': {'name':'godcrm_staging_3660','family':'inet'}}]})
        elif argv[:5] == ['nft','-j','list','table','inet']:
            output = json.dumps({'nftables': self.current})
        elif argv == ['nft','-j','list','ruleset']: output = '{}'
        elif argv == ['nft','--check','-f','-']: pass
        elif argv == ['nft','-f','-']:
            self.current = [{'table': {'name':'godcrm_staging_3660','family':'inet'}}]
        elif argv[:3] == ['nft','delete','table']:
            self.deletes += 1; self.current = None
        elif argv[0] == 'ss':
            if self.drain_failure: raise RuntimeError('socket drain failed')
        elif argv[0] == '/bin/systemctl':
            self.systemctl.append(argv)
            if 'LoadState' in argv: output = 'loaded'
            elif 'ActiveState' in argv: output = 'inactive'
        else: raise AssertionError(argv)
        return subprocess.CompletedProcess(argv, 0, stdout=output, stderr='')

    def act(self, action, **arguments):
        request = dict(self.request, action=action, arguments=arguments)
        with patch.object(remote, 'sql', return_value='godcrm_test'):
            return remote.remote(request)

    def test_real_sealed_readback_overrides_inactive_oneshot(self):
        self.assertEqual(remote.ingress(self.request, 'close'), 'closed')
        with patch.object(remote, 'inventory', return_value={'godcrm':'stopped','bdd-runner':'stopped'}):
            self.assertEqual(remote.control_states(self.request)['ingress'], 'active')
        self.act('restore_control', control='ingress', target='inactive')
        self.assertEqual(remote.ingress(self.request), 'open')
        self.assertEqual(self.deletes, 1)
        self.act('restore_control', control='ingress', target='inactive')
        self.assertEqual(self.deletes, 1)

    def test_real_failed_close_refuses_recovery_and_open(self):
        self.drain_failure = True
        with self.assertRaises(RuntimeError): remote.ingress(self.request, 'close')
        for action, args in [('recovery_ingress', {'intended':True}),
                             ('restore_control', {'control':'ingress','target':'inactive'})]:
            with self.subTest(action=action), self.assertRaises(RuntimeError): self.act(action, **args)
        self.assertEqual(self.deletes, 0)
        self.assertEqual(self.systemctl, [])

    def test_drift_refuses_without_systemctl_stop(self):
        remote.ingress(self.request, 'close'); self.current.append({'rule':{'foreign':True}})
        with self.assertRaises(RuntimeError): self.act('restore_control', control='ingress', target='inactive')
        self.assertEqual(self.deletes, 0)
        self.assertEqual(self.systemctl, [])

    def test_unjournalled_closed_ingress_refuses(self):
        remote.ingress(self.request, 'close')
        with self.assertRaisesRegex(RuntimeError, 'unjournalled'):
            self.act('recovery_ingress', intended=False)

    def test_target_mismatch_and_review_manifest_refuse(self):
        self.manifest['ingress']['machine_id'] = 'different'
        with self.assertRaisesRegex(RuntimeError, 'target mismatch'): remote.ingress(self.request)
        self.manifest['ingress']['machine_id'] = self.machine
        self.manifest['ingress']['mode'] = 'review-only'
        with self.assertRaisesRegex(RuntimeError, 'review only'): remote.ingress(self.request)

    def test_failed_cleanup_still_blocks_quiet_check(self):
        remote.ingress(self.request, 'close')
        with patch.object(remote, 'control_states', return_value={}), \
             patch.object(remote, 'unit_state', return_value='failed'):
            with self.assertRaisesRegex(RuntimeError, 'cleanup still running'):
                self.act('writers_closed')


def load_tests(loader, tests, pattern):
    # Imported Fixture's 18 cases are loaded once from test_recovery.
    return unittest.TestSuite(loader.loadTestsFromTestCase(cls)
                              for cls in (RecoveryIngressTests, RemoteIngressTests))


if __name__ == '__main__':
    unittest.main()
