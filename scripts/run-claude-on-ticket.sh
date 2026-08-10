#!/usr/bin/env bash
# ADR-0030 Phase 4 — claude --print runner.
#
# Reads the prompt from stdin, runs `claude --print --model opus` inside the
# given workspace, and emits NDJSON events on stdout for the dispatcher's
# stream handler to consume.
#
# Args:
#   --ticket-id <N>       Numeric ticket id (required)
#   --workspace <path>    Absolute workspace dir (required, must exist)
#   --agent-id <id>       Agent row id from table 1784 (optional, informational)
#
# Stdout (NDJSON, one event per line):
#   {"type":"info","message":"runner_starting", ...}
#   {"type":"output","content":<json-encoded text>,"status":"success|failed","exit":<n>}
#   {"type":"result","status":"success|failed","ticket_id":<n>,"exit":<n>}
#
# Exit codes:
#   0  success                    (claude --print returned 0)
#   1  claude --print non-zero    (model output still emitted)
#   2  invalid args
#   3  workspace missing
#   4  empty prompt on stdin

set -uo pipefail

TICKET_ID=""
WORKSPACE=""
AGENT_ID=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ticket-id) TICKET_ID="${2:-}"; shift 2 ;;
    --workspace) WORKSPACE="${2:-}"; shift 2 ;;
    --agent-id)  AGENT_ID="${2:-}";  shift 2 ;;
    *)
      printf '{"type":"error","message":"unknown_arg","arg":"%s"}\n' "$1"
      exit 2
      ;;
  esac
done

# Validate
if ! [[ "${TICKET_ID}" =~ ^[0-9]+$ ]]; then
  printf '{"type":"error","message":"invalid_ticket_id","value":"%s"}\n' "${TICKET_ID}"
  exit 2
fi
if [[ -z "${WORKSPACE}" || ! -d "${WORKSPACE}" ]]; then
  printf '{"type":"error","message":"workspace_missing","path":"%s"}\n' "${WORKSPACE}"
  exit 3
fi

# Emit start event so the stream handler sees activity immediately.
printf '{"type":"info","message":"runner_starting","ticket_id":%s,"workspace":"%s","agent_id":"%s"}\n' \
  "${TICKET_ID}" "${WORKSPACE}" "${AGENT_ID}"

# Read prompt from stdin (blocking until EOF).
PROMPT="$(cat)"
if [[ -z "${PROMPT}" ]]; then
  printf '{"type":"error","message":"empty_prompt"}\n'
  exit 4
fi

cd "${WORKSPACE}"

# Capture model output to a temp file so we can re-emit it as a single
# {type:output} event AND propagate it back to the chat layer via the
# dispatcher.
OUTPUT_FILE="$(mktemp)"
trap 'rm -f "${OUTPUT_FILE}"' EXIT

# Phase 4 keeps it simple: text output, single result event. Phase 10 may
# upgrade to --output-format=stream-json for richer per-event streaming.
# stdin = prompt; stderr is folded into stdout via 2>&1 so errors land in
# the captured output (model output + diagnostics together).
if printf '%s' "${PROMPT}" | claude --print --model opus > "${OUTPUT_FILE}" 2>&1; then
  STATUS="success"
  EXIT=0
else
  EXIT=$?
  STATUS="failed"
fi

# JSON-encode the output content. Prefer jq (always available on PROD/DEV);
# fall back to a simple python one-liner if jq is missing.
if command -v jq >/dev/null 2>&1; then
  CONTENT="$(jq -Rs . < "${OUTPUT_FILE}")"
elif command -v python3 >/dev/null 2>&1; then
  CONTENT="$(python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' < "${OUTPUT_FILE}")"
else
  CONTENT='"<unable to encode output: no jq/python3>"'
fi

printf '{"type":"output","content":%s,"status":"%s","exit":%s}\n' "${CONTENT}" "${STATUS}" "${EXIT}"
printf '{"type":"result","status":"%s","ticket_id":%s,"exit":%s}\n' "${STATUS}" "${TICKET_ID}" "${EXIT}"

exit "${EXIT}"
