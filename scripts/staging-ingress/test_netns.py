"""Real nft, ss, nginx and HTTP/SSE/WebSocket tests in a fresh network namespace.

Run only with `unshare -n python3 scripts/staging-ingress/test_netns.py`.
No host network, staging SSH, database, PM2 or systemd operation.
"""
import http.client
import http.server
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import time
import unittest

import control

HOSTS = ["dev.godcrm.ai", "devcrm.hltrn.cc", "crm.hltrn.cc", "godcrm.ai",
         "www.godcrm.ai", "hltrn.cc", "www.hltrn.cc"]


class Backend(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_):
        pass

    def do_GET(self):
        if self.path in ("/sse", "/ws"):
            if self.path == "/ws":
                self.send_response(101)
                self.send_header("Upgrade", "websocket")
                self.send_header("Connection", "Upgrade")
            else:
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
            if self.path == "/sse":
                self.wfile.write(b"data: ready\n\n")
                self.wfile.flush()
            try:
                while self.connection.recv(1024):
                    pass
            except OSError:
                pass
        else:
            self.send_response(200)
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"OK")


class Server(http.server.ThreadingHTTPServer):
    address_family = socket.AF_INET6
    daemon_threads = True


def request(path, host="dev.godcrm.ai"):
    connection = http.client.HTTPConnection("127.0.0.1", 8080, timeout=3)
    try:
        connection.request("GET", path, headers={"Host": host})
        response = connection.getresponse()
        response.read()
        return response.status
    finally:
        connection.close()


def stream(path, prefix=""):
    connection = socket.create_connection(("127.0.0.1", 8080), timeout=3)
    connection.sendall((f"GET {prefix}{path} HTTP/1.1\r\nHost: dev.godcrm.ai\r\n"
                        "Connection: Upgrade\r\nUpgrade: websocket\r\n\r\n").encode())
    header = b""
    while b"\r\n\r\n" not in header:
        header += connection.recv(4096)
    if not (b" 200 " in header or b" 101 " in header):
        raise RuntimeError(header)
    return connection


class NetworkTest(unittest.TestCase):
    def test_real_transport_and_drain(self):
        if os.readlink("/proc/self/ns/net") == os.readlink("/proc/1/ns/net"):
            self.fail("must run in a new network namespace")
        interfaces = json.loads(control.command(["ip", "-j", "link", "show"]))
        if {item["ifname"] for item in interfaces} != {"lo"}:
            self.fail("requires fresh namespace with loopback only")
        control.command(["ip", "link", "set", "lo", "up"])
        peer = subprocess.Popen(["unshare", "-n", "sleep", "300"])
        self.addCleanup(peer.wait)
        self.addCleanup(peer.terminate)
        for _ in range(100):
            if os.readlink(f"/proc/{peer.pid}/ns/net") != os.readlink("/proc/self/ns/net"):
                break
            time.sleep(.01)
        else:
            self.fail("peer namespace not created")
        ns = ["nsenter", "-t", str(peer.pid), "-n"]
        control.command(["ip", "link", "add", "test0", "type", "veth", "peer", "name", "test1"])
        control.command(["ip", "link", "set", "test1", "netns", str(peer.pid)])
        control.command(["ip", "addr", "add", "192.0.2.1/24", "dev", "test0"])
        control.command(["ip", "-6", "addr", "add", "2001:db8::1/64", "dev", "test0", "nodad"])
        control.command(["ip", "link", "set", "test0", "up"])
        control.command(ns + ["ip", "addr", "add", "192.0.2.2/24", "dev", "test1"])
        control.command(ns + ["ip", "-6", "addr", "add", "2001:db8::2/64", "dev", "test1", "nodad"])
        control.command(ns + ["ip", "link", "set", "test1", "up"])
        control.command(ns + ["ip", "link", "set", "lo", "up"])
        for port in [5000, 5001]:
            server = Server(("::", port), Backend)
            threading.Thread(target=server.serve_forever, daemon=True).start()
            self.addCleanup(server.server_close)
            self.addCleanup(server.shutdown)
        directory = Path(tempfile.mkdtemp(prefix="staging-ingress-netns-"))
        os.chmod(directory, 0o755)
        config = f'''user www-data;
pid {directory}/nginx.pid;
error_log {directory}/error.log;
events {{ worker_connections 128; }}
http {{
 access_log off;
 server {{
  listen 8080;
  server_name {' '.join(HOSTS)};
  location = / {{ return 200 'STATIC'; }}
  location /assets/ {{ return 200 'ASSET'; }}
  location /.well-known/acme-challenge/ {{ return 200 'ACME'; }}
  location /other/ {{ proxy_pass http://127.0.0.1:5001/;
    proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection upgrade; proxy_buffering off; }}
  location /v6/ {{ proxy_pass http://[::1]:5000/; }}
  location / {{ proxy_pass http://127.0.0.1:5000;
    proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection upgrade; proxy_buffering off; }}
 }}
}}
'''
        (directory / "nginx.conf").write_text(config)
        nginx = subprocess.Popen(["nginx", "-c", str(directory / "nginx.conf"), "-g", "daemon off;"],
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.addCleanup(nginx.wait)
        self.addCleanup(nginx.terminate)
        for _ in range(100):
            try:
                if request("/") == 200:
                    break
            except OSError:
                time.sleep(.02)
        else:
            self.fail("isolated nginx unavailable")
        for host in HOSTS:
            self.assertEqual(request("/api/health", host), 200)
        keepalive = http.client.HTTPConnection("127.0.0.1", 8080, timeout=3)
        self.addCleanup(keepalive.close)
        keepalive.request("GET", "/api/health")
        self.assertEqual(keepalive.getresponse().read(), b"OK")
        streams = [stream("/sse"), stream("/ws")]
        other = stream("/ws", "/other")
        self.addCleanup(other.close)
        for s in streams:
            self.addCleanup(s.close)
        # Remote direct clients block in recv until kernel destroys server side.
        directs = []
        for address in ["192.0.2.1", "2001:db8::1"]:
            code = ("import socket; s=socket.create_connection((" + repr(address) +
                    ",5000),3); print('READY',flush=True); "
                    "\ntry:\n print(repr(s.recv(100)),flush=True)\nexcept OSError:\n print('RESET',flush=True)\n")
            proc = subprocess.Popen(ns + ["python3", "-u", "-c", code], stdout=subprocess.PIPE, text=True)
            self.addCleanup(proc.wait)
            self.addCleanup(proc.terminate)
            self.assertEqual(proc.stdout.readline().strip(), "READY")
            directs.append(proc)
        installed = control.close_transport(33)
        control.drain()
        self.assertEqual(control.snapshot(), installed)
        keepalive.request("GET", "/api/health")
        response = keepalive.getresponse()
        response.read()
        self.assertEqual(response.status, 502)
        for s in streams:
            ended = False
            try:
                while s.recv(4096):
                    pass
                ended = True
            except ConnectionResetError:
                ended = True
            self.assertTrue(ended, "SSE/WS not ended")
        for proc in directs:
            output, _ = proc.communicate(timeout=3)
            self.assertIn(output.strip(), ["RESET", "b''"])
        for host in HOSTS:
            for path in ["/api/health", "/socket.io/", "/sse", "/ws", "/v6/api"]:
                with self.subTest(host=host, path=path):
                    self.assertEqual(request(path, host), 502)
            for path in ["/", "/assets/app.js", "/.well-known/acme-challenge/probe", "/other/health"]:
                self.assertEqual(request(path, host), 200)
        other.sendall(b"still-open")
        other.settimeout(.1)
        with self.assertRaises(socket.timeout):
            other.recv(1)
        for address in ["127.0.0.1", "::1"]:
            with socket.create_connection((address, 5000), timeout=2) as s:
                s.sendall(b"GET /accept HTTP/1.1\r\nHost: local\r\nConnection: close\r\n\r\n")
                self.assertIn(b" 200 ", s.recv(1024))
        for address in ["192.0.2.1", "2001:db8::1"]:
            code = f"import socket; socket.create_connection(({address!r},5000),1)"
            proc = subprocess.run(ns + ["python3", "-c", code], capture_output=True)
            self.assertNotEqual(proc.returncode, 0)
        # Unrelated rules survive release, while altered owned rules refuse it.
        control.command(["nft", "add", "table", "inet", "unrelated_test"])
        control.command(["nft", "add", "chain", "inet", control.TABLE, "unexpected"])
        with self.assertRaisesRegex(RuntimeError, "drift"):
            control.open_transport(installed)
        control.command(["nft", "delete", "chain", "inet", control.TABLE, "unexpected"])
        control.open_transport(installed)
        control.open_transport(installed)
        self.assertIn("unrelated_test", control.command(["nft", "list", "tables"]))
        self.assertEqual(request("/api/health"), 200)
        print("REAL_NETNS_PASS: 7 hosts, IPv4/IPv6, direct idle sockets, SSE, WebSocket, localhost acceptance, static/ACME/unrelated WS, drift/retry")


if __name__ == "__main__":
    unittest.main(verbosity=2)
