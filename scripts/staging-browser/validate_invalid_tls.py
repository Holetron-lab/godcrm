#!/usr/bin/env python3
"""Test-only upstream fixture injection; production proxy remains fixed."""
import argparse
import json
from pathlib import Path
import socket
import ssl
import subprocess
import tempfile
import threading
import time
import uuid
from unittest.mock import patch
from core import match
from egress import Egress


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--image',required=True);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args();match(args.image,'sha256:[a-f0-9]{64}')
    root=Path(__file__).resolve().parent
    with tempfile.TemporaryDirectory(prefix='browser-22051-invalid-tls-') as directory:
        folder=Path(directory);folder.chmod(0o755)
        subprocess.run(['/usr/bin/openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(folder/'key'),'-out',str(folder/'cert'),'-days','1','-subj','/CN=dev.godcrm.ai'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True)
        context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);context.load_cert_chain(folder/'cert',folder/'key')
        server=socket.socket();server.bind(('127.0.0.1',0));server.listen(8);server.settimeout(.2)
        stop=threading.Event()
        def serve():
            while not stop.is_set():
                try:
                    peer,_=server.accept();peer.settimeout(2)
                    with context.wrap_socket(peer,server_side=True) as stream:
                        stream.recv(4096);stream.sendall(b'HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n')
                except (OSError,ssl.SSLError):pass
        thread=threading.Thread(target=serve,daemon=True);thread.start()
        connect=socket.create_connection
        def fixture(address,timeout=None):
            if address != ('<DEV_IP>',443):raise ValueError('unexpected_fixture_target')
            return connect(server.getsockname(),timeout)
        worker='godcrm-browser-tls-test-'+str(uuid.uuid4());proxy=Egress(folder/'egress.sock',time.time()+20);result={}
        try:
            with patch('egress.socket.create_connection',side_effect=fixture):
                cmd=['/usr/bin/docker','run','--name',worker,'--network=none','--user=65534:65534','--cap-drop=ALL','--security-opt=no-new-privileges','--security-opt=seccomp='+str(root.parent/'ops-runner/browser-seccomp.json'),'--read-only','--pids-limit=256','--memory=1g','--cpus=1','--init','--ipc=private','--shm-size=256m','--tmpfs=/tmp:rw,nosuid,nodev,size=128m,uid=65534,gid=65534','--env=HOME=/tmp','--mount','type=bind,src='+str(folder/'egress.sock')+',dst=/egress.sock,readonly','--mount','type=bind,src='+str(root/'invalid-tls-check.mjs')+',dst=/worker/check.mjs,readonly','--entrypoint=node',args.image,'/worker/check.mjs']
                completed=subprocess.run(cmd,capture_output=True,timeout=20);result=json.loads(completed.stdout);result['exit']=completed.returncode
        finally:
            subprocess.run(['/usr/bin/docker','rm','-f',worker],capture_output=True,check=True,timeout=3)
            proxy.close();stop.set();server.close();thread.join(timeout=2)
            result['cleaned']=not subprocess.check_output(['/usr/bin/docker','container','ls','-aq','--filter','name=^/'+worker+'$'],timeout=2).strip()
            args.output.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))


if __name__=='__main__':main()
