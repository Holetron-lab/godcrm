#!/usr/bin/env python3
"""Foreground PTY supervisor. Heartbeats end on terminal HUP/session loss.

Run a holder shell below this process; never nohup/disown it. Watchdog recovery
is separate. On disconnect this process stops heartbeats and DOES NOT kill an
operation holding the gate lock. Deployment recovery remains phase-aware.
"""
import fcntl
import os
from pathlib import Path
import select
import signal
import subprocess
import sys
import time

from recovery import Refused, require, verify_bundle


def supervise(root, seal, state, command):
    root = verify_bundle(root, seal)
    tty = os.open("/dev/tty", os.O_RDWR | os.O_NONBLOCK)
    require(os.isatty(tty), "controlling PTY required")
    require(os.environ.get("STAGING_MAINTENANCE_TOKEN"), "holder token required")
    session = os.getsid(0)
    stopped = False

    def disconnect(_signum, _frame):
        nonlocal stopped
        stopped = True

    for sig in (signal.SIGHUP, signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, disconnect)
    environment = dict(os.environ, STAGING_STATE_DIR=state)
    poller = select.poll()
    poller.register(tty, select.POLLHUP | select.POLLERR | select.POLLNVAL)
    child = None
    try:
        while not stopped:
            if poller.poll(0):
                break
            require(os.getsid(0) == session, "session changed")
            # TIOCGSID fails once the controlling terminal has disconnected.
            fcntl.ioctl(tty, 0x5429, b"\0" * 4)  # Linux TIOCGSID
            verify_bundle(root, seal)
            result = subprocess.run(["/bin/bash", str(root / "gate.sh"), "heartbeat"],
                                    env=environment, timeout=10, stdout=subprocess.DEVNULL,
                                    stderr=subprocess.DEVNULL, check=False)
            require(result.returncode == 0, "heartbeat refused")
            if child is None:
                child = subprocess.Popen(command, env=environment)
            deadline = time.monotonic() + 30
            while not stopped and time.monotonic() < deadline:
                code = child.poll()
                if code is not None:
                    return code
                if poller.poll(100):
                    stopped = True
                    break
        return 75
    finally:
        os.close(tty)
        # No kill of deployment/CRM processes. If a detached child still holds
        # the operation lock, watchdog waits; administrator intervention needed.


if __name__ == "__main__":
    try:
        root, seal, state, *command = sys.argv[1:]
        require(bool(command), "holder command required")
        sys.exit(supervise(root, seal, state, command))
    except (Refused, OSError, ValueError, subprocess.TimeoutExpired) as failure:
        print("SUPERVISOR_BLOCKED: " + str(failure), file=sys.stderr)
        sys.exit(1)
