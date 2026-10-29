"""No DNS, generic forwarding, plain HTTP or alternative CONNECT targets.

Browser network namespace has only loopback. A mounted per-run Unix socket is
its only outbound channel. TLS remains end-to-end and Chromium verifies certs.
"""
import select
import socket
import ssl
import struct
import threading
import time

HOST = 'dev.godcrm.ai'
ADDRESS = '<DEV_IP>'


def authority(header):
    if len(header) > 4096 or not header.endswith(b'\r\n\r\n'):
        raise ValueError('proxy_header')
    lines = header.decode('ascii').split('\r\n')
    if lines[0] != 'CONNECT dev.godcrm.ai:443 HTTP/1.1':
        raise ValueError('egress_denied')
    hosts = []
    for line in lines[1:-2]:
        key, value = line.split(':', 1)
        if key.lower() not in {'host', 'proxy-connection', 'user-agent'}:
            raise ValueError('proxy_header')
        if key.lower() == 'host':
            hosts.append(value.strip())
    if hosts != ['dev.godcrm.ai:443']:
        raise ValueError('proxy_host')


def client_hello(data):
    """Require one bounded, complete TLS ClientHello with exactly the fixed SNI.

    Fragmented TCP is reassembled by caller. Fragmented TLS records, ECH and
    malformed/duplicate SNI are rejected; no permissive fallback.
    """
    if len(data) < 5 or data[0] != 22 or data[1] != 3:
        raise ValueError('tls_record')
    size = int.from_bytes(data[3:5], 'big')
    if size > 16384 or len(data) != size + 5 or data[5] != 1:
        raise ValueError('client_hello')
    b = memoryview(data)[5:]
    if len(b) < 42 or int.from_bytes(b[1:4], 'big') != len(b) - 4:
        raise ValueError('hello_length')
    pos = 38
    pos += 1 + b[pos]
    pos += 2 + int.from_bytes(b[pos:pos+2], 'big')
    pos += 1 + b[pos]
    end = pos + 2 + int.from_bytes(b[pos:pos+2], 'big')
    pos += 2
    if end != len(b):
        raise ValueError('extensions')
    names = []
    seen = set()
    while pos < end:
        kind = int.from_bytes(b[pos:pos+2], 'big')
        length = int.from_bytes(b[pos+2:pos+4], 'big')
        pos += 4
        extension = bytes(b[pos:pos+length])
        if kind in seen or len(extension) != length or kind == 0xfe0d:
            raise ValueError('extension')
        seen.add(kind)
        pos += length
        if kind == 0:
            expected = (len(HOST) + 3).to_bytes(2, 'big') + b'\x00' + len(HOST).to_bytes(2, 'big') + HOST.encode()
            if extension != expected:
                raise ValueError('tls_sni')
            names.append(HOST)
    if pos != end or names != [HOST]:
        raise ValueError('tls_sni')


def tls_probe():
    with socket.create_connection((ADDRESS, 443), timeout=2) as raw:
        with ssl.create_default_context().wrap_socket(raw, server_hostname=HOST) as peer:
            return peer.version() in ('TLSv1.2', 'TLSv1.3')


class Egress:
    def __init__(self, path, deadline):
        import os
        self.path, self.deadline = path, deadline
        self.stop = threading.Event()
        self.peers = set()
        self.denials = []
        self.lock = threading.Lock()
        self.server = socket.socket(socket.AF_UNIX)
        self.server.bind(str(path))
        os.chown(path, 0, 65534)
        os.chmod(path, 0o660)
        self.server.listen(32)
        self.server.settimeout(0.2)
        self.thread = threading.Thread(target=self.serve, daemon=True)
        self.thread.start()

    def serve(self):
        while not self.stop.is_set() and time.time() < self.deadline:
            try:
                peer, _ = self.server.accept()
                _, uid, _ = struct.unpack('3i', peer.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
                with self.lock:
                    if uid != 65534 or len(self.peers) >= 64:
                        peer.close()
                        continue
                    self.peers.add(peer)
                threading.Thread(target=self.forward, args=(peer,), daemon=True).start()
            except socket.timeout:
                continue
            except OSError:
                break

    def forward(self, peer):
        upstream = None
        try:
            peer.settimeout(2)
            header = bytearray()
            while not header.endswith(b'\r\n\r\n') and len(header) <= 4096:
                chunk = peer.recv(1)
                if not chunk:
                    return
                header.extend(chunk)
            authority(bytes(header))
            peer.sendall(b'HTTP/1.1 200 Connection Established\r\n\r\n')
            data = bytearray()
            while len(data) < 5:
                chunk = peer.recv(5 - len(data))
                if not chunk:
                    return
                data.extend(chunk)
            size = int.from_bytes(data[3:5], 'big') + 5
            if size > 16389:
                raise ValueError('hello_size')
            while len(data) < size:
                chunk = peer.recv(size - len(data))
                if not chunk:
                    return
                data.extend(chunk)
            client_hello(bytes(data))
            upstream = socket.create_connection((ADDRESS, 443), timeout=2)
            with self.lock:
                self.peers.add(upstream)
            upstream.sendall(data)
            while not self.stop.is_set() and time.time() < self.deadline:
                readable, _, _ = select.select([peer, upstream], [], [], 0.2)
                for source in readable:
                    chunk = source.recv(65536)
                    if not chunk:
                        return
                    (upstream if source is peer else peer).sendall(chunk)
        except (OSError, ValueError, IndexError) as error:
            code = str(error) if isinstance(error, ValueError) else type(error).__name__
            if code not in {"proxy_header", "egress_denied", "proxy_host", "tls_record", "client_hello", "hello_length", "extensions", "extension", "tls_sni", "hello_size", "TimeoutError", "OSError", "IndexError", "ConnectionResetError"}:
                code = "transport_error"
            if len(self.denials) < 64:
                self.denials.append(code)  # Never publish raw TLS, addresses, headers or errors.
        finally:
            with self.lock:
                for stream in (peer, upstream):
                    if stream:
                        self.peers.discard(stream)
                        stream.close()

    def close(self):
        self.stop.set()
        self.server.close()
        with self.lock:
            for peer in self.peers:
                try:
                    peer.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                peer.close()
            self.peers.clear()
        self.thread.join(timeout=0.5)
