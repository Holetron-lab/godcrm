"""No real Blender, CRM data, tunnel or credentials used by these tests."""
import asyncio
import contextlib
import io
import json
import socket
import socketserver
import subprocess
import tempfile
import time
from pathlib import Path
import uvicorn
import sys
import threading
import types
import unittest
from unittest.mock import patch

from starlette.testclient import TestClient

from bridge import BridgeConfig, create_app
from smoke import check

TOKEN = "a" * 64
FILE = "/Users/a69/Desktop/Новая папка с объектами/scene_crm_copy.blend"


class FakeBlender(socketserver.BaseRequestHandler):
    def handle(self):
        data = b""
        while True:
            data += self.request.recv(65536)
            try:
                request = json.loads(data)
                break
            except ValueError:
                continue
        self.server.requests.append(request)
        try:
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                exec(request["params"]["code"], {})
            reply = {"status": "success", "result": {"executed": True, "result": output.getvalue()}}
        except Exception as error:
            reply = {"status": "error", "message": str(error)}
        payload = json.dumps(reply, ensure_ascii=False).encode()
        # Deliberately split Unicode and JSON across TCP reads.
        for offset in range(0, len(payload), 7):
            self.request.sendall(payload[offset:offset + 7])


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.bpy = types.SimpleNamespace(
            data=types.SimpleNamespace(filepath=FILE, objects=[types.SimpleNamespace(name="Объект", type="MESH", location=(0, 0, 0))] * 97, materials=[1] * 12),
            app=types.SimpleNamespace(version_string="4.4.3"),
            context=types.SimpleNamespace(scene=types.SimpleNamespace(name="Scene1_ShadowMan")),
        )
        self.modules = patch.dict(sys.modules, {"bpy": self.bpy})
        self.modules.start()
        self.tcp = socketserver.ThreadingTCPServer(("127.0.0.1", 0), FakeBlender)
        self.tcp.requests = []
        self.thread = threading.Thread(target=self.tcp.serve_forever, daemon=True)
        self.thread.start()
        self.config = BridgeConfig(token=TOKEN, blend_file=FILE, blender_port=self.tcp.server_address[1])
        self.client = TestClient(create_app(self.config), base_url="http://127.0.0.1:8765")
        self.client.__enter__()
        self.headers = {"Authorization": "Bearer " + TOKEN, "Accept": "application/json, text/event-stream"}

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.tcp.shutdown()
        self.tcp.server_close()
        self.thread.join()
        self.modules.stop()

    def rpc(self, method, params=None, headers=None):
        return self.client.post("/mcp", headers=self.headers if headers is None else headers,
                                json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}})

    def test_auth_required_on_every_method_before_parsing(self):
        for method in ("GET", "POST", "DELETE", "OPTIONS"):
            for headers in ({}, {"Authorization": "Bearer wrong"}):
                with self.subTest(method=method, headers=headers):
                    response = self.client.request(method, "/mcp", headers=headers, content=b"not-json")
                    self.assertEqual(response.status_code, 401)
        self.assertEqual(self.tcp.requests, [])

    def test_initialize_list_and_scene(self):
        result = self.rpc("initialize", {"protocolVersion": "2025-03-26", "capabilities": {},
                                          "clientInfo": {"name": "test", "version": "1"}})
        self.assertEqual(result.status_code, 200)
        listing = self.rpc("tools/list").json()["result"]
        self.assertEqual({t["name"] for t in listing["tools"]}, {"get_scene_info", "execute_blender_code"})
        result = self.rpc("tools/call", {"name": "get_scene_info", "arguments": {}}).json()["result"]
        self.assertFalse(result.get("isError"))
        scene = json.loads(result["content"][0]["text"])
        self.assertEqual(scene["object_count"], 97)
        self.assertEqual(scene["file"], FILE)
        self.assertEqual(scene["name"], "Scene1_ShadowMan")

    def test_guard_prevents_execution_in_another_file(self):
        self.bpy.data.filepath = "/tmp/another.blend"
        result = self.rpc("tools/call", {"name": "execute_blender_code",
                          "arguments": {"code": "bpy.data.filepath = 'MODIFIED'"}}).json()["result"]
        self.assertTrue(result["isError"])
        self.assertEqual(self.bpy.data.filepath, "/tmp/another.blend")
        self.assertIn("file mismatch", result["content"][0]["text"].lower())

    def test_authorized_execution_and_input_validation(self):
        result = self.rpc("tools/call", {"name": "execute_blender_code",
                          "arguments": {"code": "print('привет')"}}).json()["result"]
        self.assertFalse(result.get("isError"))
        self.assertIn("привет", result["content"][0]["text"])
        count = len(self.tcp.requests)
        for code in ("", "x" * 65537, 42):
            result = self.rpc("tools/call", {"name": "execute_blender_code", "arguments": {"code": code}}).json()["result"]
            self.assertTrue(result["isError"])
        self.assertEqual(len(self.tcp.requests), count)

    def test_browser_origin_rejected_and_tunnel_host_supported(self):
        headers = {**self.headers, "Origin": "https://evil.example"}
        self.assertEqual(self.rpc("tools/list", headers=headers).status_code, 403)
        self.assertEqual(self.rpc("tools/list", headers={**self.headers, "Host": "test.trycloudflare.com"}).status_code, 421)
        self.assertEqual(self.rpc("tools/list", headers={**self.headers, "Host": "127.0.0.1:8765"}).status_code, 200)

    def test_http_body_limit(self):
        response = self.client.post("/mcp", headers={**self.headers, "Content-Type": "application/json"}, content=b"x" * (512 * 1024 + 1))
        self.assertEqual(response.status_code, 413)
        self.assertEqual(self.tcp.requests, [])

    def test_duplicate_authorization_rejected(self):
        response = self.client.get("/mcp", headers=[("Authorization", "Bearer " + TOKEN), ("Authorization", "Bearer " + TOKEN)])
        self.assertEqual(response.status_code, 401)

    def test_real_crm_client(self):
        script = Path(__file__).with_name("verify-crm.mjs")
        if not (script.parents[3] / "backend/services/connectors/remoteMcp.js").exists():
            self.skipTest("CRM source only available in repository checkout")
        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        server = uvicorn.Server(uvicorn.Config(create_app(self.config), log_level="error", access_log=False))
        thread = threading.Thread(target=server.run, kwargs={"sockets": [listener]}, daemon=True)
        thread.start()
        try:
            deadline = time.monotonic() + 5
            while not server.started and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertTrue(server.started)
            url = f"http://127.0.0.1:{listener.getsockname()[1]}/mcp"
            result = subprocess.run(["node", str(script)], input=json.dumps({"url": url, "token": TOKEN}),
                                    capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            with tempfile.TemporaryDirectory() as directory:
                config = Path(directory) / "config.json"
                config.write_text(self.config.model_dump_json())
                config.chmod(0o600)
                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    asyncio.run(check(url, config))
                self.assertIn("PASS:", output.getvalue())
                self.assertNotIn(TOKEN, output.getvalue())
        finally:
            server.should_exit = True
            thread.join(timeout=5)
            listener.close()

    def test_private_config_creation_and_no_overwrite(self):
        script = Path(__file__).with_name("bridge.py")
        with tempfile.TemporaryDirectory() as directory:
            blend = Path(directory) / "копия.blend"
            blend.touch()
            config = Path(directory) / "config.json"
            argv = [sys.executable, str(script), "--config", str(config), "--init", str(blend)]
            result = subprocess.run(argv, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(config.stat().st_mode & 0o777, 0o600)
            original = config.read_bytes()
            self.assertNotIn(json.loads(original)["token"], result.stdout + result.stderr)
            self.assertNotEqual(subprocess.run(argv, capture_output=True).returncode, 0)
            self.assertEqual(config.read_bytes(), original)

    def test_invalid_configuration(self):
        for updates in ({"token": ""}, {"token": "short"}, {"blend_file": "relative.blend"}, {"blender_port": 0}):
            with self.subTest(updates=updates), self.assertRaises(ValueError):
                BridgeConfig(**{**self.config.model_dump(), **updates})


if __name__ == "__main__":
    unittest.main()
