"""Read-only acceptance check. Never print the Bearer token or follow redirects."""
import argparse
import asyncio
import json
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from bridge import load_config


async def check(url: str, config_path: Path):
    parsed = urlsplit(url)
    if (parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname == "127.0.0.1")) or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path != "/mcp":
        raise ValueError("Use the local default or a public HTTPS /mcp URL without credentials/query/fragment")
    config = load_config(config_path)
    async with httpx.AsyncClient(timeout=12, trust_env=False, follow_redirects=False) as client:
        for headers in ({}, {"Authorization": "Bearer wrong"}):
            response = await client.post(url, headers=headers, content=b"invalid-json")
            if response.status_code != 401:
                raise RuntimeError(f"Auth gate failed: expected 401, got {response.status_code}")
    async with httpx.AsyncClient(headers={"Authorization": "Bearer " + config.token},
                                 timeout=12, trust_env=False, follow_redirects=False) as client:
        async with streamable_http_client(url, http_client=client) as (read, write, _):
            async with ClientSession(read, write) as session:
                await session.initialize()
                listing = await session.list_tools()
                if {t.name for t in listing.tools} != {"get_scene_info", "execute_blender_code"}:
                    raise RuntimeError("Unexpected tool list")
                result = await session.call_tool("get_scene_info", {})
                if result.isError:
                    raise RuntimeError("Scene read failed: " + str(result.content))
                scene = json.loads(result.content[0].text)
                if Path(scene["file"]).resolve() != Path(config.blend_file).resolve():
                    raise RuntimeError("Unexpected Blender file")
                print("PASS: missing/wrong token rejected; MCP initialized; tools listed; scene read")
                print(json.dumps(scene, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8765/mcp")
    parser.add_argument("--config", type=Path, default=Path(__file__).with_name("config.json"))
    options = parser.parse_args()
    asyncio.run(check(options.url, options.config))
