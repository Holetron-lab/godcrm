import json
from pathlib import Path
import socket
import tempfile
import threading
import unittest
from unittest.mock import patch
from core import sign
from test_worker import body,envelope,KEY
import worker


class IpcTests(unittest.TestCase):
    def test_real_unix_peer_and_signed_roundtrip(self):
        with tempfile.TemporaryDirectory() as directory:
            request=body('preflight')
            expected={'pins':request['pins'],'candidate_sha':request['candidate_sha'],'database':'godcrm_test'}
            with patch.object(worker,'STATE',Path(directory)),patch.object(worker,'readiness',return_value=expected):
                client,server=socket.socketpair();client.settimeout(3)
                t=threading.Thread(target=worker.serve_one,args=(server,KEY));t.start()
                client.sendall(envelope(request)+b'\n');raw=bytearray()
                while not raw.endswith(b'\n'):raw.extend(client.recv(65536))
                reply=json.loads(raw);self.assertEqual(reply['sig'],sign(KEY,reply['body']))
                self.assertEqual(reply['body']['nonce'],request['nonce']);self.assertEqual(reply['body']['result'],expected)
                client.close();t.join(timeout=3);self.assertFalse(t.is_alive())


if __name__=='__main__':unittest.main()
