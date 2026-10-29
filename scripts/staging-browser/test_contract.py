import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from core import canonical
from test_worker import body
from ledger import Ledger
import runtime


class CompatibilityTests(unittest.TestCase):
    def test_node_canonical_numbers(self):
        values=[0.,-0.,1.,0.000001,1.2e-7,6.7021234123,300000.,1.23e+21]
        expected=subprocess.check_output(['node','-e','process.stdout.write(JSON.stringify(JSON.parse(process.argv[1])))',json.dumps(values)])
        self.assertEqual(canonical(values),expected)
    def test_canonical_body_matches_backend(self):
        value=body()
        script='const c=v=>Array.isArray(v)?v.map(c):v&&typeof v==="object"?Object.fromEntries(Object.keys(v).sort().map(k=>[k,c(v[k])])):v; process.stdout.write(JSON.stringify(c(JSON.parse(process.argv[1]))))'
        self.assertEqual(canonical(value),subprocess.check_output(['node','-e',script,json.dumps(value)]))
    def test_uncertain_allocation_never_becomes_cleaned(self):
        with tempfile.TemporaryDirectory() as d:
            ledger=Ledger(Path(d)/'db');b=body();ledger.register(b);ledger.mark(b['run_id'],'uncertain')
            with patch.object(runtime,'STATE',Path(d)),patch.object(runtime,'RUN',Path(d)),patch.object(runtime,'command',return_value=b''):
                with self.assertRaises(ValueError):runtime.cleanup(b,ledger)
            self.assertEqual(ledger.get(b['run_id'],b['worker_id'])[1],'uncertain')
            ledger.db.close()
    def test_changed_image_pins_block(self):
        with patch.object(runtime,'actual_pins',return_value={}):
            with self.assertRaises(ValueError):runtime.readiness(body(),None)
    def test_runtime_no_mutable_worktree_mount(self):
        b=body();args=runtime.docker_args(b,Path('/run/godcrm-staging-browser')/b['run_id']/'egress.sock')
        text=' '.join(args)
        self.assertNotIn(b['repo'],text);self.assertNotIn('docker.sock',text)
        self.assertIn('--network=none',args);self.assertIn('--cap-drop=ALL',args)
        self.assertIn('--user=65534:65534',args);self.assertIn('--read-only',args)
        self.assertNotIn('--no-sandbox',text)


if __name__=='__main__':unittest.main()
