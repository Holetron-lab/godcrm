# Proposed cleanup quarantine — conversation 3660

Status: PROPOSED, NOT APPLIED. Preparation authorization does not approve this
baseline change. No blanket allowance for failed services is implemented.
The current adapter still requires cleanup service `inactive` in quiet checks.

The previous observed staging cleanup script selected and SIGKILLed its own
bash process; service=failed, Result=signal, status=9, MainPID=0, timer active.
That snapshot is historical, not an assertion about today's runtime.

Proposed exact scope is `cleanup-orphaned-nodes.timer` and its service on .72.
Do not change, restart, reset-failed, kill, or repair the script during diagnosis.
Do not use this proposal to authorize other failed services or production work.

Before an administrator applies quarantine:

1. Reserve the operation and verify .72 / machine ID, current timestamp and
   present unit definitions (including drop-ins), script digest, invocation ID,
   ActiveState/SubState, Result, ExecMainCode/Status, MainPID, ControlPID, cgroup
   and timer state. Save journal evidence and unit/script bytes under a private
   `/root/backups/temp/` directory, fsync and verify checksums.
2. Explicit owner decision must name these units, quarantine duration/owner,
   reason, restoration policy and a separate re-enable criterion. Save that
   approval reference in the sealed baseline. A generic failed-service waiver
   or this document's presence is insufficient.
3. Stop/disable only the timer through the authorized administrative channel;
   do not stop a running cleanup invocation. If a PID, control PID, queued job
   or populated cgroup exists, stop the procedure for attribution. Confirm
   timer inactive+disabled, no pending jobs or processes across its former
   trigger boundary; preserve service failed state and failed-evidence.
4. Decide explicitly whether persistent masking is required to prevent manual
   or dependency starts; back up and record mask/drop-in state if authorized.
   A stopped timer alone does not exclude a privileged manual writer.
5. Regenerate the controls baseline with cleanup timer `inactive` and a signed
   or otherwise approval-linked, hash-pinned quarantine receipt. Exclude the
   retired .205 cron line independently using its exact retirement receipt.
   Never restore an old crontab or timer baseline generically.

A later implementation may accept ONLY the exact approved, pinned failed
invocation with zero PIDs, empty cgroup, no queued job, unchanged unit/script
hashes and disabled/quarantined timer. Unknown state, new invocation, drift,
missing receipt or expired approval must refuse. It must never issue
reset-failed or start the quarantined timer during recovery. New positive and
negative tests are required before enabling that exception.

Re-enable is a separate task: fix and review the process selector, demonstrate
it cannot target itself/CRM workers, obtain acceptance, remove quarantine via
the authorized channel, then reseal a new baseline. None of those actions is
performed by this package.
