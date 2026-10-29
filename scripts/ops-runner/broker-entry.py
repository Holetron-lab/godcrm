#!/usr/bin/env python3
"""Trusted broker entrypoint for profiles.run_check — not an agent-callable script.

The Node broker (backend/services/ops/opsBroker.js) spawns this file from the
installed, root-owned executor root and writes ONE JSON line on stdin:

    {"request": {...}, "grant": {...}, "context": {...}}

Authorization lasts exactly as long as the broker keeps stdin open. A line
`revoke` or EOF (the broker died or decided to stop) flips still_authorized()
to False; the library then stops the container and reports exit_code 124.
Nothing from the agent reaches this process except the small `request`, which
profiles.validate re-checks against the server-owned grant and context.

Exit codes: 0 report printed (exit_code inside the report carries the outcome),
3 request denied before any operation (one JSON line `{"denied": reason}`),
2 malformed envelope.
"""
import json
import select
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import profiles  # noqa: E402  (trusted sibling, same installed directory)


def main():
    try:
        envelope = json.loads(sys.stdin.readline())
        request, grant, context = envelope['request'], envelope['grant'], envelope['context']
    except (ValueError, KeyError, TypeError):
        sys.stdout.write(json.dumps({'denied': 'invalid_envelope'}) + '\n')
        return 2

    state = {'ok': True}

    def still_authorized():
        # Drain whatever the broker wrote; EOF or `revoke` is final.
        while state['ok']:
            ready, _, _ = select.select([sys.stdin], [], [], 0)
            if not ready:
                break
            line = sys.stdin.readline()
            if line == '' or line.strip() == 'revoke':
                state['ok'] = False
        return state['ok']

    try:
        profiles.validate(request, grant, context)
    except ValueError as error:
        sys.stdout.write(json.dumps({'denied': str(error)}) + '\n')
        return 3
    report = profiles.run_check(request, grant, context, still_authorized)
    sys.stdout.write(json.dumps(report) + '\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
