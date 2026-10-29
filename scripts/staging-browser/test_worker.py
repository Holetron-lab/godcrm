import copy
import json
import os
from pathlib import Path
import socket
import sqlite3
import ssl
import tempfile
import time
import unittest
import uuid
from unittest.mock import patch
from core import canonical, digest, sign, request, artifact
from ledger import Ledger
from egress import authority, client_hello
import runtime

KEY = 'ab' * 32
PINS = {key: ('sha256:' if key == 'image' else '') + 'a' * 64 for key in ['executor','image','dependencies','seccomp','egress','suites','installation']}


def body(op='run'):
    run = str(uuid.uuid4())
    common = dict(v=1, nonce=str(uuid.uuid4()), issued_at=int(time.time()*1000), op=op)
    if op == 'preflight':
        return dict(common, pins=PINS, suite_id='axe-v1', candidate_sha='b'*40, job_id='22051')
    return dict(common, run_id=run, worker_id='godcrm-browser-'+run, job_id='22051', agent_id=1, space_id=11,
                role='sysadmin', repo='/root/wt-browser-sysadmin', candidate_sha='b'*40, pins=PINS,
                suite_id='axe-v1', deadline_at=int(time.time()*1000)+180000, cleanup_ms=10000, writes=False)


def envelope(value):
    return canonical({'body':value, 'sig':sign(KEY,value)})


def hello(host):
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    incoming, outgoing = ssl.MemoryBIO(), ssl.MemoryBIO()
    stream = context.wrap_bio(incoming,outgoing,server_side=False,server_hostname=host)
    try:
        stream.do_handshake()
    except ssl.SSLWantReadError:
        pass
    return outgoing.read()


def sample():
    return {'kind':'axe','checks':[{'target':'table','rule':'axe','passed':True,'count':0}], 'trace':[]}


class ProtocolTests(unittest.TestCase):
    def test_signed_run(self):
        b=body(); self.assertEqual(request(envelope(b),KEY),b)
    def test_preflight(self):
        b=body('preflight'); self.assertEqual(request(envelope(b),KEY),b)
    def test_bad_signature(self):
        with self.assertRaises(ValueError): request(envelope(body()),'cd'*32)
    def test_tamper(self):
        b=body(); e=json.loads(envelope(b));e['body']['role']='admin'
        with self.assertRaises(ValueError): request(canonical(e),KEY)
    def test_duplicate_json_key(self):
        with self.assertRaises(ValueError):request(b'{"body":{},"body":{},"sig":"x"}',KEY)
    def test_extra_fields(self):
        for key in ['url','args','command','image','mounts','credentials']:
            b=body();b[key]='evil'
            with self.subTest(key=key),self.assertRaises(ValueError):request(envelope(b),KEY)
    def test_expired_and_future(self):
        for offset in [-5001,1001]:
            b=body();now=b['issued_at'];b['issued_at']+=offset
            with self.subTest(offset=offset),self.assertRaises(ValueError):request(envelope(b),KEY,now)
    def test_bounds(self):
        for key,value in [('deadline_at',int(time.time()*1000)+300001),('space_id',1),('space_id',True),('agent_id',False),('cleanup_ms',True),('cleanup_ms',10001),('writes',True),('role','admin'),('repo','/root/wt-x/../production'),('suite_id','shell'),('job_id','1;sh'),('worker_id','godcrm')]:
            b=body();b[key]=value
            with self.subTest(key=key,value=value),self.assertRaises(ValueError):request(envelope(b),KEY,b['issued_at'])
    def test_pin_shape(self):
        b=body();b['pins']={**PINS,'extra':'x'}
        with self.assertRaises(ValueError):request(envelope(b),KEY)
    def test_artifact_sanitizer(self):
        self.assertEqual(artifact(sample()),sample())
        for extra in ['url','token','headers','screenshot','selector','clipboard']:
            a=sample();a[extra]='secret'
            with self.subTest(extra=extra),self.assertRaises(ValueError):artifact(a)
    def test_nonfinite_and_pii(self):
        for key,value in [('value',float('nan')),('value',-1),('count',1.5),('target','person@example.org'),('rule','secret')]:
            a=sample();a['checks'][0][key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):artifact(a)
    def test_empty_checks_fail(self):
        a=sample();a['checks']=[]
        with self.assertRaises(ValueError):artifact(a)
    def test_output_limit(self):
        with self.assertRaises(ValueError):request(b'x'*16385,KEY)


class EgressTests(unittest.TestCase):
    def test_authorized_connect(self):
        authority(b'CONNECT dev.godcrm.ai:443 HTTP/1.1\r\nHost: dev.godcrm.ai:443\r\n\r\n')
    def test_negative_destinations(self):
        for host in ['app.godcrm.ai','crm.hltrn.cc','<PROD_IP>','<RING1_IP>','<DEV_IP>','127.0.0.1','[::1]','169.254.169.254','example.com','dev.godcrm.ai.evil.test','dev.godcrm.ai.','DEV.GODCRM.AI','2130706433','0x7f000001','dev.godcrm.ai@evil.test']:
            with self.subTest(host=host),self.assertRaises(ValueError):
                authority(f'CONNECT {host}:443 HTTP/1.1\r\nHost: {host}:443\r\n\r\n'.encode())
    def test_http_websocket_and_smuggling(self):
        for raw in [b'GET http://dev.godcrm.ai/ HTTP/1.1\r\nHost: dev.godcrm.ai\r\n\r\n', b'GET ws://dev.godcrm.ai/ HTTP/1.1\r\n\r\n', b'CONNECT dev.godcrm.ai:443 HTTP/1.1\r\nHost: dev.godcrm.ai:443\r\nHost: evil\r\n\r\n',b'CONNECT dev.godcrm.ai:443 HTTP/1.1\r\nHost: dev.godcrm.ai:443\r\nContent-Length: 10\r\n\r\n']:
            with self.subTest(raw=raw),self.assertRaises(ValueError):authority(raw)
    def test_real_tls_clienthello(self):
        client_hello(hello('dev.godcrm.ai'))
    def test_sni_bypass(self):
        for host in ['app.godcrm.ai','crm.hltrn.cc','example.com','<DEV_IP>','localhost','dev.godcrm.ai.evil.test']:
            with self.subTest(host=host),self.assertRaises((ValueError,IndexError)):client_hello(hello(host))
    def test_truncation_and_oversize(self):
        data=hello('dev.godcrm.ai')
        for size in range(0,len(data),7):
            with self.subTest(size=size),self.assertRaises((ValueError,IndexError)):client_hello(data[:size])


class LedgerTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.path=Path(self.temp.name)/'db';self.ledger=Ledger(self.path)
    def tearDown(self):
        self.ledger.db.close();self.temp.cleanup()
    def test_durable_replay(self):
        nonce=str(uuid.uuid4());self.ledger.nonce(nonce);other=Ledger(self.path)
        with self.assertRaises(sqlite3.IntegrityError):other.nonce(nonce)
        other.db.close()
    def test_register_before_launch_unique_job(self):
        b=body();self.ledger.register(b)
        with self.assertRaises(sqlite3.IntegrityError):self.ledger.register(body())
        self.assertEqual(self.ledger.pending(),[b])
    def test_worker_identity(self):
        b=body();self.ledger.register(b)
        with self.assertRaises(ValueError):self.ledger.get(b['run_id'],'godcrm')
    def test_expiry_and_heartbeat(self):
        b=body();self.ledger.register(b);self.assertEqual(self.ledger.expired(),[])
        self.ledger.db.execute('UPDATE runs SET heartbeat=?',(time.time()-3,));self.assertEqual(self.ledger.expired(),[b])
    def test_deadline(self):
        b=body();b['deadline_at']=0;self.ledger.register(b);self.assertEqual(self.ledger.expired(),[b])
    def test_artifact_ownership_and_expiry(self):
        b=body();self.ledger.register(b);d=self.ledger.save_artifact(b,sample());req={**b,'artifact_id':d['id']}
        with self.assertRaises(ValueError):self.ledger.fetch(req)
        self.ledger.mark(b['run_id'],'cleaned');self.assertEqual(self.ledger.fetch(req),sample())
        with self.assertRaises(ValueError):self.ledger.fetch({**req,'job_id':'99'})
        with self.assertRaises(ValueError):self.ledger.fetch({**req,'pins':{}})
        self.ledger.db.execute('UPDATE artifacts SET expires=0');self.ledger.purge()
        with self.assertRaises(ValueError):self.ledger.fetch(req)
    def test_job_lifetime_limit(self):
        for _ in range(20):
            b=body();self.ledger.register(b);self.ledger.mark(b['run_id'],'cleaned')
        with self.assertRaises(ValueError):self.ledger.register(body())
    def test_reaper_liveness(self):
        self.assertFalse(self.ledger.reaper_ready());self.ledger.reaper_beat();self.assertTrue(self.ledger.reaper_ready())
        self.ledger.db.execute('UPDATE health SET at=0');self.assertFalse(self.ledger.reaper_ready())
    def test_cleanup_absent_container_is_idempotent(self):
        b=body();self.ledger.register(b)
        with patch.object(runtime,'STATE',Path(self.temp.name)),patch.object(runtime,'RUN',Path(self.temp.name)),patch.object(runtime,'command',return_value=b''):
            self.assertTrue(runtime.cleanup(b,self.ledger)['cleaned']);self.assertTrue(runtime.cleanup(b,self.ledger)['cleaned'])
    def test_cleanup_daemon_failure_not_success(self):
        b=body();self.ledger.register(b)
        with patch.object(runtime,'STATE',Path(self.temp.name)),patch.object(runtime,'command',side_effect=TimeoutError):
            with self.assertRaises(TimeoutError):runtime.cleanup(b,self.ledger)
        self.assertEqual(self.ledger.get(b['run_id'],b['worker_id'])[1],'cleaning')
    def test_foreign_container_never_removed(self):
        b=body();self.ledger.register(b)
        with patch.object(runtime,'STATE',Path(self.temp.name)),patch.object(runtime,'command',side_effect=[b'container',json.dumps([{'Config':{'Labels':{'godcrm.browser.run':'foreign'}}}]).encode()]) as cmd:
            with self.assertRaises(ValueError):runtime.cleanup(b,self.ledger)
            self.assertFalse(any('rm' in call.args[0] for call in cmd.call_args_list))


if __name__=='__main__':unittest.main()
