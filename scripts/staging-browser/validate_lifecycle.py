#!/usr/bin/env python3
"""Preparation-only independent reaper test with real network=none containers."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from core import match
from test_worker import body
from ledger import Ledger
import runtime


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--image',required=True);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    match(args.image,'sha256:[a-f0-9]{64}')
    with tempfile.TemporaryDirectory(prefix='browser-22051-lifecycle-') as directory:
        root=Path(directory);state=root/'state';run=root/'run';state.mkdir(mode=0o700);run.mkdir(mode=0o700)
        ledger=Ledger(state/'ledger.sqlite');target=body();survivor=body();survivor['job_id']='22052'
        for b in [target,survivor]:
            ledger.register(b)
            subprocess.run(['/usr/bin/docker','run','-d','--name',b['worker_id'],'--network=none','--user=65534:65534',
                '--label','godcrm.browser.run='+b['run_id'],'--label','godcrm.browser.job='+b['job_id'],
                '--cap-drop=ALL','--security-opt=no-new-privileges','--read-only','--entrypoint=/bin/sleep',args.image,'40'],capture_output=True,check=True,timeout=4)
        result={};reaper=None
        try:
            # Boot reconciliation is independently covered by unit tests; this
            # process tests a later dead worker while another live job remains.
            code='''import sys,time
from pathlib import Path
sys.path.insert(0,sys.argv[1])
import runtime,reaper
from ledger import Ledger
runtime.STATE=reaper.STATE=Path(sys.argv[2]);runtime.RUN=Path(sys.argv[3])
ledger=Ledger(runtime.STATE/'ledger.sqlite')
for _ in range(32):
 for body in ledger.expired(): reaper.reap(body)
 ledger.reaper_beat();time.sleep(.25)
'''
            reaper=subprocess.Popen([sys.executable,'-B','-c',code,str(Path(__file__).parent.resolve()),str(state),str(run)],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
            at=time.monotonic();clean=False
            while time.monotonic()-at < 8:
                ledger.beat(survivor['run_id'])
                if ledger.get(target['run_id'],target['worker_id'])[1]=='cleaned':clean=True;break
                time.sleep(.15)
            alive=subprocess.check_output(['/usr/bin/docker','inspect','-f','{{.State.Running}}',survivor['worker_id']],timeout=2).strip()==b'true'
            result={'stale_worker_cleaned':clean,'unrelated_worker_alive':alive,'cleanup_after_heartbeat_ms':round((time.monotonic()-at)*1000),'status':'PASS' if clean and alive else 'FAIL'}
        finally:
            if reaper:
                reaper.terminate();reaper.wait(timeout=2)
            for b in [target,survivor]:
                subprocess.run(['/usr/bin/docker','rm','-f',b['worker_id']],capture_output=True,timeout=3,check=True)
            result['all_test_containers_removed']=all(not subprocess.check_output(['/usr/bin/docker','container','ls','-aq','--filter','name=^/'+b['worker_id']+'$'],timeout=2).strip() for b in [target,survivor])
            ledger.db.close();args.output.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))


if __name__=='__main__':main()
