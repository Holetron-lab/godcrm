#!/usr/bin/env python3
"""Independent service: reconcile boot, stale heartbeat, deadlines and TTL.
No CRM dependency and no host-wide kill or cleanup command.
"""
import concurrent.futures
import time
from core import STATE, trusted
from ledger import Ledger
from runtime import cleanup


def reap(body):
    ledger = Ledger(STATE / 'ledger.sqlite')
    try:
        cleanup(body, ledger)
    except Exception:
        pass  # Remains cleanup_pending; the next sweep retries exact identity.
    finally:
        ledger.db.close()


def main():
    trusted(STATE, True)
    ledger = Ledger(STATE / 'ledger.sqlite')
    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:
        list(pool.map(reap, ledger.pending()))  # Before advertising readiness.
        while True:
            list(pool.map(reap, ledger.expired()))
            ledger.purge()
            ledger.reaper_beat()
            time.sleep(0.25)


if __name__ == '__main__':
    main()
