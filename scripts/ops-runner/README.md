# Operations runner

Host entry point for approved operations on Ring 0. Run it through the normal
executor/approval mechanism. It does not grant sandbox access to Docker or PM2,
install a privileged listener, or change agent permission rules.

The new task-scoped diagnostics/local-QA broker library lives alongside this
manual runner. See [INTEGRATION.md](INTEGRATION.md) for its trust boundary,
implemented actions, installation and activation requirements.

## Install

On .128, from the reviewed checkout:

```sh
docker build -t godcrm-ops-runner:1 scripts/ops-runner
```

Prerequisites: Python 3.12+, Docker, and the checkout's installed node_modules
compatible with Linux/glibc and Node 20. `npm ci` prepares the Vite mountpoint
directories `.vite` and `.vite-temp` through the root postinstall hook. After
`npm ci --ignore-scripts`, the dependency installer must run `npm run qa:prepare`
before publishing dependencies read-only or running container QA. For a separate
installation use `node scripts/qa/prepare-container-mounts.mjs /real/path/node_modules`.
Preparation is idempotent, preserves cache contents and rejects symlinks/files.
Worktrees using a shared node_modules symlink must have its owner prepare the
real installation; the QA worker does not write to the shared dependencies.
The image includes rsync.
No app deployment or service restart is needed to use the runner.

## Run

Use `--repo` BEFORE the action. Only the selected repository's committed HEAD
is tested; commit WIP on your isolated branch first. Uncommitted edits are not
included. Existing symlinks (including tracked symlinks) are omitted.

```sh
python3 scripts/ops-runner.py --repo /root/wt-TASK-sysadmin-RUN node-test deploy-bot/mcp-preservation.test.cjs
python3 scripts/ops-runner.py --repo /root/wt-TASK-sysadmin-RUN vitest src/features/ai-chat/components/__tests__/MentionInput.test.tsx
python3 scripts/ops-runner.py --repo /root/wt-TASK-sysadmin-RUN build
python3 scripts/ops-runner.py pm2-status
```

`restart-deploy-bot` is the only PM2 mutation. Use it only when that restart is
authorized for the task. There is no action for restarting godcrm or all PM2
processes. Production promotes remain owner-triggered through the deploy-bot.
PM2 actions execute on the host; test/build actions execute in a fresh container.
Do not approve a blanket `python3` prefix or grant agents Docker socket access.

Tests run as UID 65534 with no network, capabilities, Docker/PM2 socket, inherited
host environment or local `.env*`, `*.local.env`, `.mcp.json`. Only trusted tracked
source and read-only dependencies are mounted. Vite caches are ephemeral tmpfs.
Limits: 2 CPUs, 2 GiB RAM for tests / 4 GiB for builds (no extra swap),
256 PIDs, 15 minutes. Build Node heap is capped at 3 GiB. Test files must be
explicit; arbitrary shell commands and test-runner switches are not accepted.

Every container run prints `/tmp/godcrm-ops-*` containing `result.json` (SHA,
image ID, action, timestamps, exit code), `output.log`, and the disposable `work`
snapshot. Build output is under `work/dist`. Remove that specific artifact
folder after review; there is no automatic deletion of evidence. Concurrent
jobs have unique directories and container names. Dependencies are shared
read-only: do not reinstall them while jobs run. Exit 124 means timeout.

This runner covers offline Node/Vitest suites and builds. Integration suites
requiring a DB and browser suites need their own configured test contour;
never enable host networking or pass production credentials to make them pass.

## Verification

```sh
python3 -m unittest discover -s scripts/ops-runner -p 'test_*.py' -v
python3 scripts/ops-runner.py node-test scripts/ops-runner/isolation.test.cjs
```

The isolation test checks actual UID, networking, secrets/socket absence and
read-only mounts. Restart routing is unit-tested without restarting services.
Rollback: stop using the script; no production configuration was changed.

## Required aggregate gate

`npm test` and `npm run test:baseline` collect
`scripts/__tests__/node-container.wrapper.test.mjs`. It runs all three
`node:test` suites (MCP preservation, public router, isolation) together via
this container runner. The original files are routed away from Vitest
collection, not removed from the gate. Docker, the installed runner image and
readable dependencies are required; unavailable infrastructure fails the gate.
Commit the isolated worktree before running: the container records and tests
its committed HEAD, while Vitest reads the working tree. Run the final gate
only on a clean checkout of the final integrated SHA. Do not execute isolation
directly on the host.

When sharing `godcrm_test`, serialize the whole aggregate invocation with the
same lock used by other executors, for example:

```sh
flock -n /tmp/godcrm-test.lock npm run test:baseline -- --maxWorkers=1
```

`-n` refuses immediately (exit 1) when another executor holds the lock instead
of queueing behind it. `--maxWorkers=1` is the G9 gate configuration
(ADR-203-A1): the baseline is recorded serial, and `test-baseline.mjs` exits 2
on a `workers` mismatch — any other worker count is not a gate verdict.
The lock is cooperative: coordinate with existing runs that did not acquire it.
A filtered Vitest run may omit this wrapper; it is not aggregate acceptance.
