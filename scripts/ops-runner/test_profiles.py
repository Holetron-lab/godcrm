import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location('profiles', Path(__file__).with_name('profiles.py'))
profiles = importlib.util.module_from_spec(spec)
spec.loader.exec_module(profiles)


class ProfileTests(unittest.TestCase):
    def setUp(self):
        self.context = dict(job_id='20457', agent_id=7, space_id=11, role='sysadmin',
                            repo='/root/wt-job-sysadmin', candidate_sha='a' * 40)
        self.grant = dict(self.context, profile='diagnostics', issued_at=100, expires_at=3700,
                          actions=['host.identity', 'ring0.health'])
        self.request = dict(job_id='20457', candidate_sha='a' * 40, action='host.identity')

    def local(self, action='node-test', files=None):
        self.grant.update(profile='local-qa', image='sha256:' + 'a' * 64,
                          actions=[action], suites={'selected': {'action': action,
                          'files': files if files is not None else ['scripts/test.cjs']}})
        self.request.update(action=action, suite_id='selected')

    def test_valid_diagnostics(self):
        self.assertEqual(profiles.validate(self.request, self.grant, self.context, 200), [])

    def test_request_cannot_extend_capability(self):
        for key, value in [('url', 'https://crm.hltrn.cc'), ('command', 'id'),
                           ('repo', '/srv/godcrm/live'), ('profile', 'staging-qa'),
                           ('files', ['x']), ('env', {'JWT_SECRET': 'x'})]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                profiles.validate(dict(self.request, **{key: value}), self.grant, self.context, 200)

    def test_cross_job_sha_identity_scope_and_role_deny(self):
        for key in self.context:
            with self.subTest(key=key), self.assertRaises(ValueError):
                profiles.validate(self.request, self.grant, dict(self.context, **{key: 'other'}), 200)
        for key in ['job_id', 'candidate_sha']:
            with self.subTest(key=key), self.assertRaises(ValueError):
                profiles.validate(dict(self.request, **{key: 'other'}), self.grant, self.context, 200)

    def test_expiry_revocation_future_and_ttl(self):
        for fields, now in [({}, 3700), ({}, 99), ({'expires_at': 3701}, 200), ({'revoked': True}, 200)]:
            with self.subTest(fields=fields, now=now), self.assertRaises(ValueError):
                profiles.validate(self.request, dict(self.grant, **fields), self.context, now)

    def test_role_allowlist(self):
        for role in ['frontend-qa', 'architect', 'summary', 'admin']:
            with self.subTest(role=role), self.assertRaises(ValueError):
                profiles.validate(self.request, dict(self.grant, role=role), dict(self.context, role=role), 200)
        self.local()
        for role in profiles.ROLES['local-qa']:
            profiles.validate(self.request, dict(self.grant, role=role), dict(self.context, role=role), 200)

    def test_dangerous_actions_deny_even_if_granted(self):
        for action in ['restart-deploy-bot', 'restart-godcrm', 'ssh', 'sql', 'make-dev', 'schema.status', 'ring1.health']:
            with self.subTest(action=action), self.assertRaises(ValueError):
                profiles.validate(dict(self.request, action=action), dict(self.grant, actions=[action]), self.context, 200)

    def test_selected_suites_only(self):
        self.local()
        self.assertEqual(profiles.validate(self.request, self.grant, self.context, 200), ['node', '--test', 'scripts/test.cjs'])
        for suite in ['unknown', '../selected', '--eval']:
            with self.subTest(suite=suite), self.assertRaises(ValueError):
                profiles.validate(dict(self.request, suite_id=suite), self.grant, self.context, 200)
        with self.assertRaises(ValueError):
            profiles.validate(dict(self.request, action='vitest'), self.grant, self.context, 200)

    def test_unsafe_suite_paths(self):
        for file in ['/root/.env', '../.env', '--eval', '']:
            self.local(files=[file])
            with self.subTest(file=file), self.assertRaises(ValueError):
                profiles.validate(self.request, self.grant, self.context, 200)

    def test_build_vitest_browser(self):
        for action in ['build', 'vitest', 'browser-test']:
            self.local(action, [] if action == 'build' else ['test.cjs'])
            command = profiles.validate(self.request, self.grant, self.context, 200)
            self.assertEqual(command[0], 'node')
            if action == 'vitest':
                self.assertIn('--maxWorkers=1', command)
                self.assertIn('--configLoader', command)

    def test_unpinned_image_denied(self):
        self.local()
        for image in ['godcrm-ops-runner:1', '', 'sha256:abc']:
            with self.subTest(image=image), self.assertRaises(ValueError):
                profiles.validate(self.request, dict(self.grant, image=image), self.context, 200)

    def test_qa_boundaries(self):
        with tempfile.TemporaryDirectory() as path:
            self.grant.update(modules=path, image='sha256:' + 'a' * 64)
            args = profiles.qa_args(self.grant, Path(path) / 'work', 'job', ['node', '--test', 'x.cjs'])
            for flag in ['--network=none', '--read-only', '--cap-drop=ALL', '--user=65534:65534',
                         '--security-opt=no-new-privileges', '--shm-size=256m']:
                self.assertIn(flag, args)
            for flag in ['--privileged', '--network=host', '--no-sandbox', '--security-opt=seccomp=unconfined']:
                self.assertNotIn(flag, args)
            self.assertEqual(args[0], '/usr/bin/docker')

    def test_health_redacts_raw_fields(self):
        body = json.dumps({'status': 'ok', 'database': {'status': 'connected', 'password': 'secret'},
                           'env': 'secret', 'token': 'secret'})
        self.assertEqual(profiles.diagnostics.health(body), {'status': 'ok', 'database': 'connected'})
        with self.assertRaises(ValueError):
            profiles.diagnostics.health('{"status":"secret"}')

    def test_redirect_and_response_limit_fail_closed(self):
        connection = Mock()
        response = connection.getresponse.return_value
        with patch.object(profiles.diagnostics.http.client, 'HTTPSConnection', return_value=connection):
            response.status = 302
            with self.assertRaises(ValueError):
                profiles.diagnostics.fetch('app.godcrm.ai', '/', 10)
            response.read.assert_not_called()
            response.status = 200
            response.read.return_value = b'x' * 11
            with self.assertRaises(ValueError):
                profiles.diagnostics.fetch('app.godcrm.ai', '/', 10)
            self.assertEqual(connection.close.call_count, 2)

    def test_diagnostics_no_arbitrary_origin_or_asset(self):
        with patch.object(profiles.diagnostics, 'fetch') as fetch:
            fetch.return_value = b'<script src="https://crm.hltrn.cc/assets/index-a.js"></script>'
            with self.assertRaises(ValueError):
                profiles.diagnostics.diagnose('staging.release')
            fetch.assert_called_once_with('dev.godcrm.ai', '/', 262144)
        with patch.object(profiles.diagnostics, 'fetch', side_effect=[b'<script src="/assets/index-a.js"></script>', b'asset']):
            self.assertIsNone(profiles.diagnostics.diagnose('ring0.release')['commit_sha'])

    def test_denied_before_any_operation(self):
        with patch.object(profiles.diagnostics, 'diagnose') as diagnose, patch.object(profiles, 'run_qa') as qa:
            with self.assertRaises(ValueError):
                profiles.run_check(self.request, self.grant, self.context, lambda: False)
            diagnose.assert_not_called()
            qa.assert_not_called()

    def test_errors_never_return_raw_exception(self):
        with patch.object(profiles.time, 'time', return_value=200), patch.object(profiles.diagnostics, 'diagnose', side_effect=OSError('secret')):
            result = profiles.run_check(self.request, self.grant, self.context, lambda: True)
            self.assertEqual(result['exit_code'], 125)
            self.assertNotIn('secret', json.dumps(result))

    def test_revocation_discards_diagnostic_result(self):
        calls = iter([True, False])
        with patch.object(profiles.time, 'time', return_value=200), patch.object(profiles.diagnostics, 'diagnose', return_value={'status': 'ok'}):
            result = profiles.run_check(self.request, self.grant, self.context, lambda: next(calls))
            self.assertEqual(result['exit_code'], 124)
            self.assertNotIn('checks', result)


if __name__ == '__main__':
    unittest.main()
