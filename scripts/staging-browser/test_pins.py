import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from core import canonical, digest
import runtime


class PinTests(unittest.TestCase):
    def setUp(self):
        # Not an installation: temporary bundle in allocated worktree, no service.
        self.temp=tempfile.TemporaryDirectory(dir=Path.cwd());self.root=Path(self.temp.name)
        (self.root/'worker.py').write_text('measured code\n');files={'worker.py':digest((self.root/'worker.py').read_bytes())}
        groups={key:['worker.py'] for key in ['executor','dependencies','seccomp','egress','suites']}
        manifest=dict(files=files,image='sha256:'+'a'*64,groups=groups)
        self.pins={key:digest(canonical(files)) for key in groups};self.pins.update(image=manifest['image'],installation=digest(canonical(manifest)))
        (self.root/'installation.json').write_bytes(canonical(manifest));(self.root/'manifest.json').write_bytes(canonical(self.pins))
        self.mock=patch.object(runtime,'command',return_value=json.dumps([{'Id':manifest['image']}]).encode());self.mock.start()
    def tearDown(self):self.mock.stop();self.temp.cleanup()
    def test_actual_bytes(self):self.assertEqual(runtime.actual_pins(self.root),self.pins)
    def test_modified_executor(self):
        (self.root/'worker.py').write_text('changed')
        with self.assertRaises(ValueError):runtime.actual_pins(self.root)
    def test_extra_shadow_module(self):
        (self.root/'ssl.py').write_text('shadow')
        with self.assertRaises(ValueError):runtime.actual_pins(self.root)
    def test_symlink_rejected(self):
        (self.root/'worker.py').unlink();(self.root/'worker.py').symlink_to('/etc/hostname')
        with self.assertRaises(ValueError):runtime.actual_pins(self.root)
    def test_different_image(self):
        with patch.object(runtime,'command',return_value=json.dumps([{'Id':'sha256:'+'b'*64}]).encode()):
            with self.assertRaises(ValueError):runtime.actual_pins(self.root)


if __name__=='__main__':unittest.main()
