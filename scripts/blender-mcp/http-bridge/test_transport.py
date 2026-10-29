import asyncio
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import httpx
from mcp.server.fastmcp.exceptions import ToolError

from bridge import BridgeConfig, REPLY_LIMIT, blender_execute, create_app, load_config


class TransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_malformed_error_truncated_and_oversized_replies(self):
        responses = [b'[]', b'{}', b'{"status":"success","result":{"executed":true,"result":42}}',
                     b'{"status":"error","message":"fixture error"}', b'{"status":', b'x' * (REPLY_LIMIT + 1)]
        for payload in responses:
            with self.subTest(payload=payload[:80]):
                async def respond(reader, writer):
                    await reader.read(65536)
                    writer.write(payload)
                    await writer.drain()
                    writer.close()
                    await writer.wait_closed()
                server = await asyncio.start_server(respond, "127.0.0.1", 0)
                async with server:
                    config = BridgeConfig(token="a" * 64, blend_file="/tmp/test.blend", blender_port=server.sockets[0].getsockname()[1])
                    with self.assertRaises(ToolError):
                        await blender_execute(config, "print('test')")

    async def test_absolute_timeout_and_no_retry(self):
        calls = []
        finished = asyncio.Event()
        async def silent(reader, writer):
            calls.append(1)
            await reader.read(65536)
            await reader.read()  # Bridge closes its own socket on timeout.
            writer.close()
            await writer.wait_closed()
            finished.set()
        server = await asyncio.start_server(silent, "127.0.0.1", 0)
        async with server:
            config = BridgeConfig(token="a" * 64, blend_file="/tmp/test.blend", blender_port=server.sockets[0].getsockname()[1])
            with self.assertRaisesRegex(ToolError, "may still finish"):
                await blender_execute(config, "print('test')")
            await asyncio.wait_for(finished.wait(), 2)
        self.assertEqual(calls, [1])

    async def test_concurrent_call_fails_busy(self):
        entered, release = asyncio.Event(), asyncio.Event()
        async def blocked(*args):
            entered.set()
            await release.wait()
            return "done"
        config = BridgeConfig(token="a" * 64, blend_file="/tmp/test.blend")
        app = create_app(config)
        request = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "get_scene_info", "arguments": {}}}
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1:8765",
                                         headers={"Authorization": "Bearer " + config.token, "Accept": "application/json, text/event-stream"}) as client:
                with patch("bridge.blender_execute", side_effect=blocked):
                    first = asyncio.create_task(client.post("/mcp", json=request))
                    await asyncio.wait_for(entered.wait(), 2)
                    try:
                        second = await client.post("/mcp", json=request)
                        result = second.json()["result"]
                        self.assertTrue(result["isError"])
                        self.assertIn("busy", result["content"][0]["text"])
                    finally:
                        release.set()
                        await first

    async def test_config_missing_or_public_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            with self.assertRaises(FileNotFoundError):
                load_config(path)
            path.write_text(json.dumps({"token": "a" * 64, "blend_file": "/tmp/test.blend"}))
            path.chmod(0o644)
            with self.assertRaisesRegex(ValueError, "private"):
                load_config(path)


if __name__ == "__main__":
    unittest.main()
