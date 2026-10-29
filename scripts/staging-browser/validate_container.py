#!/usr/bin/env python3
"""Run bounded preparation checks, no installation or host-policy modification."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import uuid
from core import digest, match
from egress import Egress


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--image',required=True);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();match(args.image,'sha256:[a-f0-9]{64}')
    root=Path(__file__).resolve().parent
    with tempfile.TemporaryDirectory(prefix='browser-22051-test-',dir='/tmp') as directory:
        folder=Path(directory);folder.chmod(0o755)
        proxy=Egress(folder/'egress.sock',time.time()+50)
        worker='godcrm-browser-test-'+str(uuid.uuid4());start=time.monotonic();result={}
        try:
            cmd=['/usr/bin/docker','run','--name',worker,'--label','godcrm.browser.preparation=22051',
                 '--network=none','--user=65534:65534','--cap-drop=ALL','--security-opt=no-new-privileges',
                 '--security-opt=seccomp='+str(root.parent/'ops-runner/browser-seccomp.json'),
                 '--read-only','--pids-limit=256','--memory=1g','--cpus=1','--init','--ipc=private','--shm-size=256m',
                 '--tmpfs=/tmp:rw,nosuid,nodev,size=128m,uid=65534,gid=65534','--env=HOME=/tmp',
                 '--mount','type=bind,src='+str(folder/'egress.sock')+',dst=/egress.sock,readonly',
                 '--mount','type=bind,src='+str(root/'container-check.mjs')+',dst=/worker/container-check.mjs,readonly',
                 '--entrypoint=node',args.image,'/worker/container-check.mjs']
            completed=subprocess.run(cmd,capture_output=True,timeout=50)
            result=json.loads(completed.stdout) if completed.stdout else {'status':'BLOCKED','reason':'no_container_report'}
            result.update(image=args.image,exit=completed.returncode,test_digest=digest((root/'container-check.mjs').read_bytes()))
        finally:
            at=time.monotonic()
            subprocess.run(['/usr/bin/docker','rm','-f',worker],capture_output=True,check=True,timeout=5)
            left=subprocess.run(['/usr/bin/docker','container','ls','-aq','--filter','name=^/'+worker+'$'],capture_output=True,check=True,timeout=2)
            proxy.close()
            result['proxy_denials']=proxy.denials
            result['cleanup_ms']=round((time.monotonic()-at)*1000);result['cleaned']=not left.stdout.strip()
            result['duration_ms']=round((time.monotonic()-start)*1000)
            args.output.write_text(json.dumps(result,indent=2)+'\n')
            print(json.dumps(result))


if __name__=='__main__':main()
