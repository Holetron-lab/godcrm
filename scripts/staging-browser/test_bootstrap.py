"""No installed-service PASS inferred: fake Docker boundary, real ledger/IPC/records."""
from contextlib import ExitStack
import copy
import json
import os
from pathlib import Path
import socket
import tempfile
import threading
import time
import unittest
import uuid
from unittest.mock import patch
import acceptance
import publish_acceptance
import qualify
import runtime
import worker
from core import canonical, digest, sign, request
from ledger import Ledger
from test_worker import body, envelope, KEY, PINS, sample


class BootstrapTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=Path.cwd())
        self.root = Path(self.temp.name)
        self.etc = self.root / 'etc'; self.etc.mkdir(mode=0o700)
        self.state = self.root / 'state'; self.state.mkdir(mode=0o700)
        self.stack = ExitStack()
        for module in [acceptance, publish_acceptance, qualify, worker, runtime]:
            for name, value in [('ETC', self.etc), ('STATE', self.state)]:
                if hasattr(module, name): self.stack.enter_context(patch.object(module, name, value))
        for module in [runtime, qualify, publish_acceptance]:
            self.stack.enter_context(patch.object(module, 'actual_pins', return_value=PINS))
        self.authority = {'principal': 'fixture-admin', 'channel': 'fixture-console', 'authorization_ref': 'test:22055'}
        self.write(self.etc / 'administrator.json', self.authority)
        self.write(self.etc / 'acceptance.key', 'ab' * 32, raw=True)
        self.request = {'writer': self.authority, 'pins': PINS, 'candidate_sha': 'b'*40,
                        'qualification_id': str(uuid.uuid4()), 'issued_at': int(time.time()),
                        'expires_at': int(time.time()) + 280}
        self.service = {'unit': qualify.UNIT, 'invocation_id': 'a'*32, 'policy': qualify.POLICY,
                        'unit_sha256': 'c'*64}
        self.addCleanup(self.temp.cleanup)
        self.addCleanup(self.stack.close)

    def write(self, path, value, raw=False):
        path.write_bytes(value.encode() if raw else canonical(value)); path.chmod(0o600)

    def fixture_suite(self, request_body, ledger, connection, gate):
        self.assertFalse((self.etc/'acceptance.json').exists())
        ledger.register(request_body)
        gate(request_body, ledger)
        value = sample()
        value['kind'] = publish_acceptance.SUITE_KINDS[request_body['suite_id']]
        descriptor = ledger.save_artifact(request_body, value)
        ledger.mark(request_body['run_id'], 'cleaned')
        return {'run_id': request_body['run_id'], 'worker_id': request_body['worker_id'],
                'report': {'passed': True, 'checks': value['checks'], 'artifacts': [descriptor]}}

    def qualification(self):
        self.write(self.etc/'qualification-request.json', self.request)
        measured = {'receipt': {'nonce': str(uuid.uuid4()), 'candidate_sha': 'b'*40,
                               'database': 'godcrm_test', 'verified_at': time.time(), 'asset_sha256': 'd'*64}}
        with patch.object(qualify, 'installed_service', return_value=self.service), \
             patch.object(qualify, 'prerequisites', return_value=measured), \
             patch.object(qualify, 'execute_run', side_effect=self.fixture_suite), \
             patch.object(worker, 'readiness', side_effect=AssertionError('No agent readiness bypass')):
            qualify.qualify()
        return json.loads((self.state/'qualification-evidence.json').read_text())

    def accepted_fixture(self):
        evidence = self.qualification()
        (self.etc/'qualification-request.json').unlink()  # Administrator archive modeled.
        decisions = {}
        for capability in acceptance.CHECKS:
            proof = {'capability': capability, 'pins': PINS, 'candidate_sha': 'b'*40,
                     'kernel': os.uname().release, 'performed_at': time.time(), 'passed': True,
                     'method': 'unit fixture only', 'observations': {'fixture': True}}
            path = self.state / ('capability-'+capability+'.json'); self.write(path, proof)
            decisions[capability] = {'status': 'PASS', 'evidence_sha256': digest(path.read_bytes())}
        review = {'writer': self.authority, 'review_ref': 'fixture:review',
                  'qualification_sha256': digest(canonical(evidence)), 'expires_at': time.time()+300,
                  'checks': decisions}
        self.write(self.etc/'acceptance-review.json', review)
        publish_acceptance.publish()
        return json.loads((self.etc/'acceptance.json').read_text())

    def ipc(self, value):
        client, server = socket.socketpair(); client.settimeout(4)
        thread = threading.Thread(target=worker.serve_one, args=(server, KEY)); thread.start()
        try:
            client.sendall(envelope(value)+b'\n'); raw = bytearray()
            while not raw.endswith(b'\n'):
                chunk = client.recv(65536)
                if not chunk: break
                raw.extend(chunk)
            reply = json.loads(raw)
            self.assertEqual(reply['sig'], sign(KEY, reply['body']))
            return reply['body']['result']
        finally:
            client.close(); thread.join(timeout=4)
            self.assertFalse(thread.is_alive())

    def denied(self):
        with patch.object(worker, 'execute', side_effect=AssertionError('allocated')) as execute, \
             patch.object(runtime, 'command', return_value=b''):
            for op in ['preflight', 'run']:
                self.assertEqual(self.ipc(body(op))['decision'], 'BLOCKED')
            execute.assert_not_called()

    def test_missing_acceptance_denies_agent_ipc(self): self.denied()

    def test_qualification_emits_four_suite_receipts_before_acceptance(self):
        evidence = self.qualification()
        self.assertEqual(len(evidence['body']['suites']), 4)
        self.assertFalse((self.etc/'acceptance.json').exists())
        self.assertEqual(acceptance.verified(evidence, 'qualification-v1'), evidence['body'])
        self.denied()

    def test_valid_acceptance_readback(self):
        self.accepted_fixture()
        self.assertTrue(all(acceptance.accepted(body()).values()))

    def test_expired_acceptance_denies(self):
        value = self.accepted_fixture()['body']; value.update(issued_at=time.time()-20, expires_at=time.time()-1)
        self.write(self.etc/'acceptance.json', acceptance.signed(value)); self.denied()

    def test_tampered_acceptance_denies(self):
        value = self.accepted_fixture(); value['body']['expires_at'] += 1
        self.write(self.etc/'acceptance.json', value); self.denied()

    def test_signed_wrong_candidate_denies(self):
        value = self.accepted_fixture()['body']; value['candidate_sha'] = 'e'*40
        self.write(self.etc/'acceptance.json', acceptance.signed(value)); self.denied()

    def test_replaced_evidence_denies(self):
        self.accepted_fixture(); self.write(self.state/'qualification-evidence.json', {})
        self.denied()

    def test_false_check_denies(self):
        value = self.accepted_fixture()['body']; value['checks']['sandbox'] = False
        self.write(self.etc/'acceptance.json', acceptance.signed(value)); self.denied()

    def test_administrative_interlock_denies_valid_acceptance(self):
        self.accepted_fixture(); self.write(self.etc/'qualification-request.json', self.request)
        self.denied()

    def test_unknown_administrator_blocks(self):
        self.write(self.etc/'administrator.json', {**self.authority, 'principal': 'UNKNOWN'})
        with self.assertRaises(ValueError): acceptance.writer()

    def test_direct_shell_qualification_denied(self):
        with patch.dict(os.environ, {'INVOCATION_ID': ''}):
            with self.assertRaises(ValueError): qualify.installed_service()

    def test_no_bootstrap_opcode_or_flag(self):
        for extra in [('op', 'qualify'), ('bootstrap', True), ('acceptance', False)]:
            value = body(); value[extra[0]] = extra[1]
            with self.assertRaises(ValueError): request(envelope(value), KEY)

    def test_expired_qualification_blocks(self):
        self.request['expires_at'] = int(time.time())-1
        self.write(self.etc/'qualification-request.json', self.request)
        with self.assertRaises(ValueError): qualify.authorization()

    def test_qualification_one_use(self):
        self.qualification(); (self.state/'qualification-evidence.json').unlink()
        with self.assertRaises(FileExistsError): self.qualification()

    def test_publisher_requires_review_and_all_proofs(self):
        self.qualification(); (self.etc/'qualification-request.json').unlink()
        with self.assertRaises(FileNotFoundError): publish_acceptance.publish()
        self.assertFalse((self.etc/'acceptance.json').exists())

    def test_failed_suite_cannot_publish(self):
        value = self.qualification()['body']; value['suites'][0]['result']['report']['passed'] = False
        with self.assertRaises(ValueError): publish_acceptance.suite_evidence(value, PINS)

    def test_missing_suite_cannot_publish(self):
        value = self.qualification()['body']; value['suites'].pop()
        with self.assertRaises(ValueError): publish_acceptance.suite_evidence(value, PINS)

    def test_record_refuses_overwrite_and_symlink(self):
        path = self.etc/'test.json'; acceptance.create_record(path, {'ok': True})
        with self.assertRaises(FileExistsError): acceptance.create_record(path, {})
        link = self.etc/'link.json'; link.symlink_to(path)
        with self.assertRaises(FileExistsError): acceptance.create_record(link, {})

    def test_artifact_access_blocked_after_acceptance_expiry(self):
        value = self.accepted_fixture()['body']; value.update(issued_at=time.time()-20, expires_at=time.time()-1)
        self.write(self.etc/'acceptance.json', acceptance.signed(value))
        ledger = Ledger(self.state/'ledger.sqlite'); registered = body(); ledger.register(registered)
        descriptor = ledger.save_artifact(registered, sample()); ledger.mark(registered['run_id'], 'cleaned')
        ledger.db.close()
        message = {key: registered[key] for key in ['v','nonce','issued_at','run_id','worker_id','job_id','pins']}
        message.update(op='artifact', artifact_id=descriptor['id'])
        self.assertEqual(self.ipc(message)['decision'], 'BLOCKED')

    def test_symlink_acceptance_denies(self):
        self.accepted_fixture(); path = self.etc/'acceptance.json'
        path.rename(self.etc/'original.json'); path.symlink_to(self.etc/'original.json')
        self.denied()

    def test_qualification_failure_cannot_create_acceptance(self):
        with patch.object(qualify, 'execute_run', side_effect=RuntimeError('fixture failure')):
            self.write(self.etc/'qualification-request.json', self.request)
            with patch.object(qualify, 'installed_service', return_value=self.service), \
                 patch.object(qualify, 'prerequisites', return_value={}):
                with self.assertRaises(RuntimeError): qualify.qualify()
        self.assertFalse((self.etc/'acceptance.json').exists())
        self.assertFalse((self.state/'qualification-evidence.json').exists())
        self.denied()

    def test_missing_or_changed_capability_proof_cannot_publish(self):
        self.accepted_fixture(); (self.etc/'acceptance.json').unlink()
        proof = self.state/'capability-sandbox.json'
        self.write(proof, {})
        with self.assertRaises(ValueError): publish_acceptance.publish()
        self.assertFalse((self.etc/'acceptance.json').exists())

    def test_wrong_kernel_or_pins_denies(self):
        original = self.accepted_fixture()['body']
        for changed in [{**original, 'kernel': 'other-kernel'},
                        {**original, 'pins': {**PINS, 'executor': 'e'*64}}]:
            self.write(self.etc/'acceptance.json', acceptance.signed(changed)); self.denied()

    def test_production_run_always_selects_readiness(self):
        with patch.object(worker, 'execute_run') as execute:
            b = body(); worker.run(b, None, None)
            execute.assert_called_once_with(b, None, None, worker.readiness)

    def test_shared_lifecycle_registers_and_cleans_fixture(self):
        run = self.root/'run'; run.mkdir(mode=0o755)
        ledger = Ledger(self.state/'ledger.sqlite'); b = body()
        client, peer = socket.socketpair()
        session = {'origin':'https://dev.godcrm.ai','database':'godcrm_test',
                   'expires_at':int(time.time()*1000)+350000, 'read_only':True,
                   'storageState':{'cookies':[],'origins':[]}}
        self.write(self.etc/'staging-session.json', session)
        try:
            with patch.object(worker, 'RUN', run), patch.object(runtime, 'RUN', run), \
                 patch.object(runtime, 'command', return_value=b''), patch.object(worker, 'Egress'), \
                 patch.object(worker, 'execute', return_value=sample()) as execute:
                result = worker.execute_run(b, ledger, client, lambda b, l: None)
            self.assertTrue(result['report']['passed'])
            self.assertEqual(ledger.get(b['run_id'],b['worker_id'])[1], 'cleaned')
            self.assertFalse((run/b['run_id']).exists()); execute.assert_called_once()
        finally:
            ledger.db.close(); client.close(); peer.close()

    def test_acceptance_must_cover_run_deadline(self):
        value = self.accepted_fixture()['body']; value['expires_at'] = time.time()+10
        self.write(self.etc/'acceptance.json', acceptance.signed(value))
        with self.assertRaisesRegex(ValueError, 'acceptance_shorter_than_run'):
            acceptance.accepted(body())

    def test_spoofed_invocation_without_cgroup_denied(self):
        with patch.dict(os.environ, {'INVOCATION_ID': 'a'*32}):
            with self.assertRaisesRegex(ValueError, 'installed_unit_required'):
                qualify.installed_service()

    def test_units_same_security_properties(self):
        here = Path(__file__).parent
        def properties(name):
            return dict(line.split('=',1) for line in (here/name).read_text().splitlines() if '=' in line)
        agent = properties('godcrm-staging-browser.service'); admin = properties(qualify.UNIT)
        for name in ['User','Group','UMask','WorkingDirectory','NoNewPrivileges','ProtectSystem',
                     'ProtectHome','ReadWritePaths','PrivateTmp','RestrictAddressFamilies',
                     'IPAddressDeny','IPAddressAllow','KillMode','TimeoutStopSec']:
            self.assertEqual(agent[name], admin[name], name)
        self.assertEqual(admin['Conflicts'], 'godcrm-staging-browser.service')
        self.assertEqual(admin['TimeoutStartSec'], '310')


if __name__ == '__main__': unittest.main()
