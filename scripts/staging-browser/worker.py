#!/usr/bin/env python3
"""Server-only signed Unix IPC. Not an agent-callable launcher."""
import os
import select
import socket
import struct
import threading
import time
from core import ROOT, STATE, ETC, RUN, canonical, request, sign, trusted, read_json, staging_session
from ledger import Ledger
from egress import Egress
from runtime import readiness, execute, cleanup, lock_run


def serve_one(connection, key):
    ledger = Ledger(STATE / 'ledger.sqlite')
    body = None
    try:
        _, uid, _ = struct.unpack('3i', connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        if uid != 0:
            raise ValueError('peer')
        connection.settimeout(2)
        raw = bytearray()
        while not raw.endswith(b'\n') and len(raw) <= 16384:
            chunk = connection.recv(1)
            if not chunk:
                return
            raw.extend(chunk)
        body = request(bytes(raw), key)
        ledger.nonce(body['nonce'])
        if body['op'] == 'preflight':
            result = readiness(body, ledger)
        elif body['op'] == 'cleanup':
            result = cleanup(body, ledger)
        elif body['op'] == 'artifact':
            registered, _ = ledger.get(body['run_id'], body['worker_id'])
            from acceptance import accepted
            accepted(registered)
            result = ledger.fetch(body)
        else:
            result = run(body, ledger, connection)
        reply = {'v': 1, 'nonce': body['nonce'], 'op': body['op'], 'result': result}
        output = canonical({'body': reply, 'sig': sign(key, reply)}) + b'\n'
        if len(output) > 65536:
            raise ValueError('reply_size')
        connection.sendall(output)
    except Exception:
        # No exception strings, payloads, URLs, credentials or worker stdout escape.
        if body:
            reply = {'v': 1, 'nonce': body['nonce'], 'op': body['op'],
                     'result': {'decision': 'BLOCKED', 'reason': 'worker_unavailable'}}
            try:
                connection.sendall(canonical({'body': reply, 'sig': sign(key, reply)}) + b'\n')
            except OSError:
                pass
    finally:
        ledger.db.close()
        connection.close()


def run(body, ledger, connection):
    return execute_run(body, ledger, connection, readiness)


def execute_run(body, ledger, connection, gate):
    """Internal lifecycle; fixed gates are selected by trusted callers, never IPC."""
    ledger.register(body)
    stopping = threading.Event()
    cancelled = threading.Event()
    proxy = None

    def supervise():
        own = Ledger(STATE / 'ledger.sqlite')
        try:
            while not stopping.wait(0.2):
                if select.select([connection], [], [], 0)[0] or time.time() * 1000 >= body['deadline_at']:
                    cancelled.set()
                    if own.get(body['run_id'], body['worker_id'])[1] != 'uncertain':
                        own.mark(body['run_id'], 'cleaning')
                    return
                own.beat(body['run_id'])
        finally:
            own.db.close()

    watchdog = threading.Thread(target=supervise, daemon=True)
    watchdog.start()
    try:
        gate(body, ledger)
        if cancelled.is_set():
            raise ValueError('cancelled')
        fd = lock_run(body)
        try:
            if ledger.get(body['run_id'], body['worker_id'])[1] != 'registered' or cancelled.is_set():
                raise ValueError('cancelled')
            directory = RUN / body['run_id']
            directory.mkdir(mode=0o755)
            session = directory / 'session.json'
            session.write_bytes(canonical(staging_session(read_json(ETC / 'staging-session.json', 32768, private=True), body['deadline_at'])))
            os.chown(session, 65534, 65534)
            session.chmod(0o400)
            proxy = Egress(directory / 'egress.sock', body['deadline_at'] / 1000)
        finally:
            os.close(fd)
        value = execute(body, ledger, connection, proxy.path)
        if cancelled.is_set():
            raise ValueError('cancelled')
        descriptor = ledger.save_artifact(body, value)
        checks = [{key: item for key, item in check.items() if key not in ('target', 'rule')}
                  | {'kind': check['rule']} for check in value['checks']]
        if len(checks) > 100:
            raise ValueError('report_limit')
        return {'run_id': body['run_id'], 'worker_id': body['worker_id'],
                'report': {'passed': all(c['passed'] for c in checks), 'checks': checks, 'artifacts': [descriptor]}}
    finally:
        stopping.set()
        watchdog.join(timeout=0.5)
        if proxy:
            proxy.close()
        cleanup(body, ledger)  # Failure propagates: never return PASS without cleanup.


def main():
    if os.geteuid() != 0:
        raise ValueError('server_identity')
    trusted(ROOT)
    trusted(STATE, True)
    trusted(RUN)
    key = trusted(ETC / 'channel.key', True).read_text().strip()
    from core import match
    match(key, '[a-f0-9]{64}')
    ledger = Ledger(STATE / 'ledger.sqlite')
    if not ledger.reaper_ready() or ledger.pending():
        raise ValueError('reconciliation_pending')
    ledger.db.close()
    path = RUN / 'worker.sock'
    # Startup only; systemd serializes instances. Never unlink arbitrary files.
    if path.exists():
        import stat
        if not stat.S_ISSOCK(trusted(path).stat().st_mode):
            raise ValueError('socket_path')
        path.unlink()
    server = socket.socket(socket.AF_UNIX)
    server.bind(str(path))
    os.chmod(path, 0o600)
    server.listen(8)
    slots = threading.BoundedSemaphore(4)
    while True:
        connection, _ = server.accept()
        if not slots.acquire(blocking=False):
            connection.close()
            continue
        def handle(peer=connection):
            try:
                serve_one(peer, key)
            finally:
                slots.release()
        threading.Thread(target=handle, daemon=True).start()


if __name__ == '__main__':
    main()
