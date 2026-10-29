#!/usr/bin/env python3
"""Gate-checked launcher for the home Blender MCP (crm.hltrn.cc → home tunnel).

Registered with the Claude CLI as user MCP `blender`, so every agent turn
starts it. It opens the upstream (ssh over the pinned reverse tunnel) only
when the CRM says so:

  * the CLI provider mints GODCRM_MCP_GATE_TOKEN_BLENDER_MCP into the child
    env solely for the agent/space pinned on the server while the space's
    Blender MCP connector is enabled — no token, no upstream, zero tools;
  * every tools/call re-asks GODCRM_MCP_GATE_URL with that token, so turning
    the connector off in Settings → Connectors cuts sessions already open.

Any gate failure (unreachable, non-200, malformed) is a denial. This is a
routing guard, not an OS security boundary: CRM workers share a uid.

BLENDER_MCP_UPSTREAM_JSON (a JSON argv) replaces the ssh command; it exists
for the test-suite, which drives this file against a fake MCP server.
"""
import json
import os
import subprocess
import sys
import threading
import urllib.request

UPSTREAM = [
    "/usr/bin/ssh", "-F", "/dev/null", "-T",
    "-i", "/var/lib/godcrm-blender-mcp/client_ed25519",
    "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=yes",
    "-o", "UserKnownHostsFile=/var/lib/godcrm-blender-mcp/known_hosts",
    "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=3", "-p", "27809",
    "geravikatron@127.0.0.1", "/home/geravikatron/.local/bin/blender-mcp",
]
if os.environ.get("BLENDER_MCP_UPSTREAM_JSON"):
    UPSTREAM = json.loads(os.environ["BLENDER_MCP_UPSTREAM_JSON"])

GATE_URL = os.environ.get("GODCRM_MCP_GATE_URL")
GATE_TOKEN = os.environ.get("GODCRM_MCP_GATE_TOKEN_BLENDER_MCP")


def gate_allowed():
    """Ask the CRM. Returns (allowed, reason); anything unexpected is a denial."""
    if not GATE_URL or not GATE_TOKEN:
        return False, "no_gate_token"
    try:
        req = urllib.request.Request(GATE_URL, headers={"Authorization": "Bearer " + GATE_TOKEN})
        with urllib.request.urlopen(req, timeout=5) as resp:
            body = json.loads(resp.read().decode("utf-8"))
        data = body.get("data", body) if isinstance(body, dict) else {}
        return bool(data.get("allowed")), str(data.get("reason") or "gate")
    except Exception as exc:  # noqa: BLE001 — fail closed on any error
        return False, "gate_unreachable:%s" % exc.__class__.__name__


def write(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def inactive_reply(request, reason):
    """Answer as a valid MCP server with no tools (keeps the CLI happy)."""
    method = request.get("method")
    response = {"jsonrpc": "2.0", "id": request["id"]}
    if method == "initialize":
        response["result"] = {
            "protocolVersion": request.get("params", {}).get("protocolVersion", "2024-11-05"),
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "blender-scope-inactive", "version": "2.0.0", "reason": reason},
        }
    elif method == "tools/list":
        response["result"] = {"tools": []}
    elif method == "ping":
        response["result"] = {}
    else:
        response["error"] = {"code": -32601, "message": "Blender tools are unavailable in this agent/space (%s)" % reason}
    write(response)


def pump(upstream):
    for line in upstream.stdout:
        sys.stdout.write(line)
        sys.stdout.flush()


def main():
    upstream = None
    reason = "not_initialized"
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except ValueError:
            continue
        if not isinstance(request, dict):
            continue
        method = request.get("method")

        if upstream is None:
            if method == "initialize":
                allowed, reason = gate_allowed()
                if allowed:
                    upstream = subprocess.Popen(
                        UPSTREAM, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1
                    )
                    threading.Thread(target=pump, args=(upstream,), daemon=True).start()
                    upstream.stdin.write(line + "\n")
                    upstream.stdin.flush()
                    continue
            if "id" in request:
                inactive_reply(request, reason)
            continue

        if method == "tools/call":
            allowed, reason = gate_allowed()
            if not allowed:
                write({
                    "jsonrpc": "2.0",
                    "id": request.get("id"),
                    "error": {"code": -32001, "message": "Blender MCP is switched off in the CRM (%s)" % reason},
                })
                continue
        upstream.stdin.write(line + "\n")
        upstream.stdin.flush()

    if upstream is not None:
        try:
            upstream.stdin.close()
            upstream.wait(timeout=10)
        except Exception:  # noqa: BLE001
            upstream.kill()


if __name__ == "__main__":
    main()
