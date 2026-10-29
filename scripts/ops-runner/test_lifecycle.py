import importlib.util
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('profiles', Path(__file__).with_name('profiles.py'))
profiles = importlib.util.module_from_spec(spec)
spec.loader.exec_module(profiles)


class LifecycleTests(unittest.TestCase):
    def test_revocation_removes_only_job_container(self):
        with tempfile.TemporaryDirectory() as path:
            grant = dict(repo='/trusted/worktree', candidate_sha='a' * 40,
                         expires_at=time.time() + 100, suites={'s': {'files': []}})
            process = Mock()
            process.poll.side_effect = [None, None]
            authorized = iter([True, False])
            with patch.object(profiles.tempfile, 'mkdtemp', return_value=path), \
                 patch.object(profiles, 'snapshot'), patch.object(profiles, 'qa_args', return_value=['docker']), \
                 patch.object(profiles.subprocess, 'Popen', return_value=process), \
                 patch.object(profiles.subprocess, 'run', return_value=Mock(returncode=0)) as remove:
                grant['image'] = 'sha256:' + 'a' * 64
                result = profiles.run_qa({'suite_id': 's', 'action': 'build'}, grant, ['node'], lambda: next(authorized))
                self.assertEqual(result['exit_code'], 124)
                self.assertEqual(remove.call_args.args[0], ['/usr/bin/docker', 'rm', '-f', result['container']])
                self.assertTrue(result['container'].startswith('godcrm-profile-'))
                process.terminate.assert_called_once()

    def test_changed_head_fails_before_archive(self):
        with patch.object(profiles.subprocess, 'check_output', return_value='b' * 40), \
             patch.object(profiles.subprocess, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'head_changed'):
                profiles.snapshot('/trusted/worktree', 'a' * 40, Path('/unused'))
            run.assert_not_called()

    def test_browser_policy_is_fixed_and_scoped(self):
        with tempfile.TemporaryDirectory() as path:
            grant = dict(modules=path, image='sha256:' + 'a' * 64,
                         suites={'browser': dict(action='browser-test', files=['browser.cjs'])})
            args = profiles.qa_args(grant, Path(path) / 'work', 'job', ['node', '--test', 'browser.cjs'], 'browser-test')
            policy = '--security-opt=seccomp=' + str(profiles.HERE / 'browser-seccomp.json')
            self.assertIn(policy, args)
            args = profiles.qa_args(grant, Path(path) / 'work', 'job', ['node', '--test', 'browser.cjs'], 'node-test')
            self.assertNotIn(policy, args)

    def test_seccomp_retains_default_deny_and_kernel_guards(self):
        import json
        policy = json.loads((profiles.HERE / 'browser-seccomp.json').read_text())
        self.assertEqual(policy['defaultAction'], 'SCMP_ACT_ERRNO')
        always = {name for row in policy['syscalls'] if row['action'] == 'SCMP_ACT_ALLOW'
                  and not row.get('args') and not row.get('includes') and not row.get('excludes')
                  for name in row['names']}
        self.assertTrue({'clone', 'unshare', 'setns', 'chroot'} <= always)
        self.assertTrue({'mount', 'bpf', 'ptrace', 'reboot', 'init_module'}.isdisjoint(always))


if __name__ == '__main__':
    unittest.main()
