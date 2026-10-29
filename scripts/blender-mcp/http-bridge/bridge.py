"""Authenticated, loopback-only MCP Streamable HTTP bridge for Blender."""
import argparse
import asyncio
import json
import logging
import os
from pathlib import Path
import secrets
from typing import Annotated, Literal

from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations
from pydantic import BaseModel, ConfigDict, Field, StrictStr
from starlette.datastructures import Headers
from starlette.responses import PlainTextResponse
import uvicorn

logger = logging.getLogger("blender_bridge")
REPLY_LIMIT = 128 * 1024  # Leaves room for JSON escaping within CRM's 1 MiB limit.


class BridgeConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, hide_input_in_errors=True)
    token: str = Field(pattern=r"^[a-f0-9]{64}$", repr=False)
    blend_file: str = Field(pattern=r"^/.+\.blend$")
    blender_port: int = Field(default=9877, ge=1, le=65535)


class ExecutionResult(BaseModel):
    executed: Literal[True]
    result: StrictStr


class BlenderReply(BaseModel):
    status: Literal["success", "error"]
    result: ExecutionResult | None = None
    message: StrictStr | None = None


class BearerMiddleware:
    def __init__(self, app, token):
        self.app = app
        self.expected = ("Bearer " + token).encode("ascii")

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            values = Headers(scope=scope).getlist("authorization")
            if len(values) != 1 or not secrets.compare_digest(values[0].encode("latin-1"), self.expected):
                await PlainTextResponse("Unauthorized", 401, headers={"WWW-Authenticate": "Bearer"})(scope, receive, send)
                return
            if "origin" in Headers(scope=scope):
                await PlainTextResponse("Browser origins are not supported", 403)(scope, receive, send)
                return
        await self.app(scope, receive, send)


async def blender_execute(config: BridgeConfig, code: str) -> str:
    # The guard and user code execute in ONE Blender main-thread callback.
    # This prevents accidental wrong-project edits; it is not a Python sandbox.
    guarded = (
        "import bpy, os as _bridge_os\n"
        f"if not bpy.data.filepath or _bridge_os.path.realpath(bpy.data.filepath) != _bridge_os.path.realpath({config.blend_file!r}):\n"
        "    raise RuntimeError('Blender file mismatch; open the configured copy')\n"
        f"exec(compile({code!r}, '<crm-blender>', 'exec'))\n"
    )
    try:
        async with asyncio.timeout(10):
            reader, writer = await asyncio.open_connection("127.0.0.1", config.blender_port)
            try:
                writer.write(json.dumps({"type": "execute_code", "params": {"code": guarded}}).encode())
                await writer.drain()
                data = bytearray()
                while len(data) <= REPLY_LIMIT:
                    chunk = await reader.read(min(65536, REPLY_LIMIT + 1 - len(data)))
                    if not chunk:
                        raise ToolError("Blender closed the connection before a complete response")
                    data.extend(chunk)
                    if len(data) > REPLY_LIMIT:
                        raise ToolError("Blender response exceeds 128 KiB; request less output")
                    try:
                        payload = json.loads(data)
                    except (ValueError, UnicodeDecodeError):
                        continue
                    reply = BlenderReply.model_validate(payload)
                    if reply.status == "error":
                        raise ToolError(reply.message or "Blender execution failed")
                    if reply.result is None:
                        raise ToolError("Blender returned no execution result")
                    return reply.result.result
            finally:
                writer.close()
                await writer.wait_closed()
    except TimeoutError as error:
        raise ToolError("Blender timed out; execution may still finish. Inspect scene before retrying") from error
    except (OSError, ValueError) as error:
        raise ToolError("Blender unavailable or invalid response") from error


def create_app(config: BridgeConfig):
    mcp = FastMCP(
        "godcrm-blender-http", stateless_http=True, json_response=True,
        log_level="WARNING", max_request_body_size=512 * 1024,
        transport_security=TransportSecuritySettings(
            allowed_hosts=["127.0.0.1:*", "localhost:*"], allowed_origins=[]),
    )
    busy = asyncio.Lock()

    async def execute(code: str) -> str:
        if busy.locked():
            raise ToolError("Blender is busy; wait for the active request")
        async with busy:
            return await blender_execute(config, code)

    @mcp.tool(annotations=ToolAnnotations(readOnlyHint=True, openWorldHint=False))
    async def get_scene_info() -> str:
        """Read scene name, Blender version, file, counts and first ten objects of the configured copy."""
        return await execute(
            "import json\n"
            "print(json.dumps({'name': bpy.context.scene.name, 'file': bpy.data.filepath, "
            "'version': bpy.app.version_string, 'object_count': len(bpy.data.objects), "
            "'materials_count': len(bpy.data.materials), 'objects': "
            "[{'name': o.name, 'type': o.type, 'location': list(o.location)} "
            "for o in list(bpy.data.objects)[:10]]}, ensure_ascii=False))"
        )

    @mcp.tool(annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True, idempotentHint=False, openWorldHint=True))
    async def execute_blender_code(code: Annotated[str, Field(strict=True, min_length=1, max_length=65536)]) -> str:
        """Execute trusted Python in Blender after checking the open file. Full Mac-user privileges, not sandboxed.

        Keep calls under 10 seconds. Do not run synchronous renders, open other files, or save without permission.
        On timeout, inspect Blender before retrying: code may still be running.
        """
        return await execute(code)

    app = mcp.streamable_http_app()
    app.add_middleware(BearerMiddleware, token=config.token)
    return app


def load_config(path: Path) -> BridgeConfig:
    if path.stat().st_mode & 0o077:
        raise ValueError("Config must be private: chmod 600 config.json")
    return BridgeConfig.model_validate_json(path.read_text())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path(__file__).with_name("config.json"))
    parser.add_argument("--init", metavar="BLEND_FILE", help="Create private config with a new token; never overwrite")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    if args.init:
        path = Path(args.init).resolve(strict=True)
        config = BridgeConfig(token=secrets.token_hex(32), blend_file=str(path))
        with os.fdopen(os.open(args.config, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as output:
            output.write(config.model_dump_json(indent=2) + "\n")
        logger.info("Private config created. Token is not printed; copy it locally into CRM.")
        return
    config = load_config(args.config)
    uvicorn.run(create_app(config), host="127.0.0.1", port=8765, access_log=False, proxy_headers=False)


if __name__ == "__main__":
    main()
