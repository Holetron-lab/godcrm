# Diagnostics / local QA executor — stage 1

This directory is a **broker library**, not a new permission for agent shell.
`profiles.run_check(request, grant, context, still_authorized)` accepts the small
untrusted request below. All other arguments must originate in the trusted
launcher/broker. Do not expose them as MCP arguments, environment variables
controlled by an agent, or files in an agent-writable directory.

```json
{"action":"host.identity","job_id":"20457","candidate_sha":"<40 hex SHA>"}
```

For local QA add `suite_id`. Actions: `node-test`, `vitest`, `build`,
`browser-test`. Suites map IDs to fixed action/files in a server-owned grant.
The executor does not accept shell commands, URLs, files, mounts, env, image,
roles, profiles or SSH targets in the request.

## Installation and broker connection

1. Integrate the reviewed commit through the existing reservation flow. Install
   `scripts/ops-runner.py` and this directory into a versioned root-owned path
   outside **all** agent writable roots (including shared checkouts). The
   deployment executor owns updates. Never approve Python, Docker, Node or the
   worktree script as a blanket prefix. Do not publish this library as a
   setuid/sudo script, unauthenticated HTTP listener or agent-controlled import.
2. Install the offline Node image and browser image, using their Dockerfiles.
   Pin the resulting `sha256:...` image IDs in server-side grants; build/pull is
   a separate operation. Host Python requires 3.12+ (`tarfile` data filter).
   PM2 helper uses the fixed system PM2 installation and its existing RPC socket.
   Install `browser-seccomp.json` with the trusted executor; its path is fixed.
3. Provide a trusted, immutable dependency directory. Agents receive no access
   to its writes or the Docker socket. Verify dependency lockfile compatibility
   with each candidate. The broker may resolve the current shared node_modules
   for a controlled pilot; it must serialize dependency updates against jobs.
   Before publishing the installation read-only, run `npm run qa:prepare` if
   npm lifecycle scripts were disabled. Normal `npm ci` runs it automatically
   through postinstall. It creates only `.vite`/`.vite-temp` mountpoints; actual
   container caches remain private tmpfs. Run preparation against the real
   dependency directory, never a worktree's shared node_modules symlink.
4. The launcher resolves role, agent, space, job and its allocated worktree from
   server state, pins committed HEAD and stores an expiring/revocable grant.
   Validate caller identity at every tool call. The request cannot supply or
   select the grant, context, callback, repo or executor path.
5. Expose `run_check` only through that authenticated broker transport. Supply
   `still_authorized()` that checks the current grant/revocation/job state;
   errors must fail closed. Container jobs poll it every 200 ms and stop on
   expiration, revocation, output limit or the 15-minute execution deadline.
   Broker crash recovery must reap its recorded `godcrm-profile-*` workers.
6. Start with one sysadmin job. Run the acceptance below before widening access.
   Agent Smith assigns the resulting **tool**, not general shell/network access.

Grant/context shape (server-only, example):

```python
context = dict(job_id='20457', agent_id=123, space_id=11, role='sysadmin',
               repo='/root/wt-TASK-sysadmin', candidate_sha='<40 hex SHA>')
grant = dict(context, profile='local-qa', issued_at=now, expires_at=now+3600,
             actions=['node-test'], image='sha256:<64 hex>',
             modules='/trusted/dependencies',
             suites={'isolation': dict(action='node-test',
                     files=['scripts/ops-runner/isolation.test.cjs'])})
# For diagnostics: profile='diagnostics', actions=[...]; no suites/image/modules.
```

`diagnostics`: sysadmin only. `local-qa`: sysadmin, developer, developer-ralph,
frontend-developer, frontend-qa. Other roles, summary calls, mismatched context,
unknown actions and extended request fields fail before any operation.

## Implemented operations

- `host.identity`: checks `.128`, returns hostname and match flag.
- `disk.status`: free/total bytes on the fixed `/srv/godcrm` filesystem.
- `runtime.status`: direct read-only PM2 RPC, only three named services and
  name/PID/status/start/restart counters. No daemon startup, env or raw logs.
- `ring0.health`, `staging.health`: fixed HTTPS paths, enum-only health/DB fields.
- `ring0.release`, `staging.release`: SHA256 of the served index JS asset.
  `commit_sha` is null: an asset hash does not prove the backend's Git SHA.
- Local QA: committed snapshot, filtered env/config files, no symlinks/devices,
  non-root, read-only dependencies/root, network=none, CPU/RAM/PID limits.
  Chromium and fixtures share the container loopback. Chromium smoke explicitly
  enables its sandbox; no fallback flags or host network are added.

Browser suites use a dedicated seccomp policy based on
[Playwright v1.58.2](https://github.com/microsoft/playwright/blob/v1.58.2/utils/docker/seccomp_profile.json)
(upstream SHA256 `cc3e61cabda6bbc1e53e54d27ba4d55a9d3be829b6dd1a596f4a7b31b1cc7849`,
Apache-2.0; [license](LICENSE.playwright)). Local modification: allow `chroot`
without Docker's capability filter, so Chromium can use it inside its own user
namespace with all outer capabilities dropped. Kernel permission checks still
apply. Default syscall action remains ERRNO; privileged mount/BPF/module/reboot
calls are not unconditionally allowed. No daemon, sysctl or AppArmor changes.
The policy is used only for granted browser suites. See
[Playwright Docker guidance](https://playwright.dev/docs/docker) for namespaces.

HTTP redirects fail, TLS verification stays enabled, responses are bounded.
No schema/SQL/SSH operation is enabled: those require dedicated read-only
credentials and a separate reviewed implementation. No staging writes,
production deployment, restart, main merge or Ring 1 operations are included.

## Evidence and error contract

Validation failure raises `ValueError` before execution; map to tool DENY.
Operational failures return `exit_code=125` and exception class only; no raw
exception/HTTP body/child environment. `124` = timeout/expiry/revocation;
`122` = log limit. Nonzero must never be displayed as PASS.

The result includes job/agent/space/profile/action/candidate SHA, executor hash,
timestamps and, for QA, image ID, exact container name, artifact path and log
hash. Diagnostic results are filtered. Artifacts are private to the executor:
only deliver bounded, reviewed files to the requesting job after authorization.
Do not recursively publish/follow output symlinks from untrusted test code.
The broker must persist reports, enforce per-job concurrency and storage quotas,
reap abandoned containers and remove expired artifact directories. Raw QA logs
are not returned as tool text. No production credentials are mounted.

## Acceptance / rollback

```sh
python3 -m unittest discover -s scripts/ops-runner -p 'test_*.py' -v
```

Broker pilot: three successive calls per enabled action without escalations;
foreign identity/job/scope/role/SHA, expiration, revocation, unknown suite,
custom URL/shell/path and modified worktree executor all DENY. Verify timeout,
revocation and broker-death cleanup; ensure diagnostic records contain no env.

Run `isolation.test.cjs` as node-test and `browser-isolation.test.cjs` as
browser-test on committed source through the library. The latter must show a
working browser sandbox. If host kernel/AppArmor/seccomp denies it, keep
browser-test disabled until a reviewed host policy permits the required
namespaces. Do not silently use `--no-sandbox` or `seccomp=unconfined`.

Rollback: stop issuing/revoke grants, stop only their recorded workers, preserve
evidence and use existing scoped approvals. Do not restart agent runtime.

**Activation is separate:** this commit does not modify launcher, role/tool rows,
host policy or runtime configuration. It supplies the executor and its tests.
The original design and deferred staging profile are in [PROFILES.md](PROFILES.md).
