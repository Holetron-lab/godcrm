import importlib.util
from pathlib import Path
import tarfile
import unittest

spec = importlib.util.spec_from_file_location('runner', Path(__file__).parents[1] / 'ops-runner.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class RunnerTests(unittest.TestCase):
    def test_reject_unsafe_paths(self):
        for value in ['../x', '/tmp/x', '--eval=x', '']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                runner.command_for('node-test', [value])

    def test_requires_test_selection(self):
        with self.assertRaises(ValueError):
            runner.command_for('vitest', [])

    def test_arguments_are_not_shell_text(self):
        value = 'tests/a;echo injected.test.js'
        self.assertEqual(runner.command_for('node-test', [value]), ['node', '--test', value])

    def test_snapshot_filters(self):
        for name in ['.env', 'a/.env.test', '.mcp.json', 'scripts/deploy.local.env', '../escape', '/absolute', 'node_modules/x']:
            with self.subTest(name=name):
                self.assertFalse(runner.allowed_member(tarfile.TarInfo(name)))
        self.assertTrue(runner.allowed_member(tarfile.TarInfo('src/feature.js')))

    def test_no_symlinks_or_devices(self):
        for kind in [tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.CHRTYPE, tarfile.FIFOTYPE]:
            item = tarfile.TarInfo('link')
            item.type = kind
            self.assertFalse(runner.allowed_member(item))

    def test_container_boundaries(self):
        args = runner.container_args('sha256:abc', '/tmp/work', '/repo/node_modules', 'job', ['node', '--test', 'test.js'])
        for flag in ['--network=none', '--read-only', '--cap-drop=ALL', '--user=65534:65534', '--pids-limit=256', '--security-opt=no-new-privileges']:
            self.assertIn(flag, args)
        self.assertIn('type=bind,src=/repo/node_modules,dst=/work/node_modules,readonly', args)
        self.assertNotIn('--privileged', args)

    def test_pm2_allowlist(self):
        self.assertEqual(runner.pm2_command('restart-deploy-bot'), ['pm2', 'restart', 'deploy-bot'])
        for action in ['restart-godcrm', 'restart', 'kill']:
            with self.assertRaises(KeyError):
                runner.pm2_command(action)


if __name__ == '__main__':
    unittest.main()
