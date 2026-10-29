# Ring 0 isolated build inputs

The Ring 0 handler installs the selected revision's lockfile in its disposable
build worktree. It never links or repairs the edit checkout's `node_modules`.
An occupied deployment worktree is an error; the owner must investigate it.
The handler resolves the requested revision once, checks the materialized SHA,
and fails before migration/promotion if installation, input verification or build
fails. DEV and Ring 1 handlers are outside this change.

Ring 0 materializes with command-scoped `git -c core.hooksPath=/dev/null`.
This prevents the edit checkout's post-checkout hook from linking shared modules;
it does not change repository/global hook configuration or weaken the pre-install
directory/symlink guard. Subsequent ordinary Git commands still use their hooks.
Only Ring 0 opts into `buildIsolated(..., { productionFrontend: true })` as the
fourth argument: its build command receives `VITE_USER_NODE_ENV=production`.
The install/rebuild commands and other helper callers keep their previous inputs.
This reproduces the accepted staging frontend input without copying environment
files or secrets. The explicit value overrides an inherited Vite value for the
build subprocess only.

The install recipe is `npm ci --include=dev --ignore-scripts --no-audit --no-fund`,
then an explicit rebuild of better-sqlite3, bcrypt and esbuild. Electron binary
installation is not part of this web release. Both Vite mountpoints are created.
`node deploy-bot/build-inputs.mjs <build-root>` checks actual package manifests,
rejects escaping symlinks, lists every omitted platform/optional package and
fails on mismatched versions or missing required packages. `npm ls --depth=0`
and the build must also pass. Optional omissions remain reviewable evidence;
this is not proof of every optional integration's availability.

## Activation and evidence

This source change is not runtime activation. Before use, an authorized
administrator must integrate the reviewed change, back up the bot and runtime
configuration, reserve the deployment lane and activate the updated bot using
the approved administrative process. The helper must exist on PROD_HOST at
PROD_CODE/deploy-bot/build-inputs.mjs. The agent must not operate live runtimes.

Provision an administrator-owned directory on PROD_HOST, default
`/var/lib/godcrm/deploy-evidence` (override `DEPLOY_EVIDENCE_ROOT`). It must exist
outside the disposable worktree, with access restricted to the administrator.
Commands run as the bot user; these file permissions do not isolate evidence
from trusted build scripts running under that same user.
The bot creates an exclusive mode-0700 directory per timestamp/random run ID.
`release-evidence.mjs` stores full sanitized stdout/stderr (mode 0600) and
command/exit/signal/timeout records, including install, rebuild, input inspection,
npm ls, build, lock fingerprints and every built dist file's SHA256. Node/npm
versions are recorded before installation. `run.json` includes app SHA and bot/
helper source digests; `outcome.json` and `SHA256SUMS` seal the archive before
cleanup. Telegram and SSH return bounded previews only. If sealing fails or a
command record is incomplete, the bot retains the worktree for investigation.

### Independent activation and build-only rehearsal (administrator)

These are future administrative steps, not actions performed by preparing this
patch. Keep the application SHA separate from the bot implementation SHA. For
conversation 3692 the accepted application remains
`fc4cac72b593b456cdd553af3089482b0a89caa8`; use the committed bot SHA and file
digests from the accompanying handoff. Do not select HEAD implicitly after bot
integration and thereby silently change the application under acceptance.

1. With a fresh exclusive lane and separate authorization, integrate the reviewed
   bot commit through the normal reservation flow. Check the integrated bot.js,
   build-inputs.mjs and release-evidence.mjs against the handoff digests; record
   both the integration SHA and original bot commit. Do not edit live artifacts.
2. Verify the actual bot script/cwd and remote PROD_CODE helper paths. Back up the
   current bot sources and private configuration, verify their hashes, preserve
   .env and ecosystem settings. Record the old process start time and source pins.
   The authorized administrator activates only deploy-bot through the established
   PM2 procedure, then records its new PID/start time, script path, sanitized
   startup log and on-disk pins. Do not restart godcrm or issue a deploy command.
   On-disk hashes alone do not attest loaded code. Freeze helper files during use.
3. On the build host, under the same Node/npm/toolchain identity but without
   application/Telegram credentials, reserve a new administrator-owned disposable
   path. Materialize the exact app SHA using the same command-scoped hook override
   and occupied-path checks as the Ring 0 handler. Verify HEAD, absence of env
   files/shared modules, Node/npm versions and the committed package-lock hash.
   Do not reuse the bot's active deployment path or borrowed dependencies.
4. Use the pinned build-inputs helper and release-evidence recorder in a standalone
   process, with a new evidence directory outside the disposable tree. Invoke only
   `buildIsolated(evidence.run, appRoot, pinnedVerifier, { productionFrontend: true })`
   and seal the result as `build-only-completed` or `build-only-failed`. This runs
   private npm ci, native rebuild, package verification, npm ls and build; it must
   not call recoverRuntime, migrations, rsync, Telegram or process-control commands.
   Retain full sanitized command records and the built artifact. A helper rehearsal
   is not evidence that the running bot executed a release.
5. Compare the complete set of relative dist paths AND every SHA256 against the
   reviewed job20618 artifact-manifest.json (104 entries), not only index.html or
   bundle names. Record missing, extra and differing files; any difference keeps
   HOLD. Record native dependency smoke and lock hash before/after. No fresh
   application build or native-install success is asserted by the fixture tests.
6. Return activation and rehearsal evidence to the coordinator. The actual bot
   command still requires a separate release decision after QA/recovery review.
   On a later authorized run, capture sealed evidence with the exact app SHA and
   the same bot/helper pins, then compare the built and served artifacts again.

Activation rollback is administrator restoration of the previously verified bot
sources/configuration and reactivation of that bot only, with recorded pins/start
time. The previous bot still has the checkout-hook defect and is not release-ready.
This is independent of application rollback and does not prove data restoration.

The bot source digest fingerprints the file on disk, not an attestation of
already-loaded code: administrator activation evidence is still required. Do
not mutate bot/helpers during a reserved run. Preserve full archives in release
storage; this implementation does not provide remote backup or a retention job.
Redaction covers known secret environment values, credential-bearing HTTP URLs,
Bearer headers and named token/password/secret assignments. It is not proof
that arbitrary application output contains no sensitive data; restrict archive
access and review it before export. Raw command output is never stored by this
recorder. Interrupted recorder processes can leave incomplete command records.

Keep native smoke, build and gate results and the built/served bytes digests in
the release record. The bot's bundle-name comparison is not HTTP health or
runtime acceptance. Telegram's short progress report is not the full archive.
Changing source or inputs requires renewed checks. A successful build does not
waive lint/security policy or authorize production deployment.

## Pinned release and rollback

After activation and release approval, the owner can request
`/deploy_prod <full 40-character commit SHA>`. Omitting the SHA resolves committed
HEAD once. Branch names, abbreviated hashes and extra arguments are rejected.
The same isolated install uses the selected revision's own lockfile, including
for rollback to `e6afa22e9f3c31d7832d347d8dbd0fc07daed472`.

That rollback's frontend can be rehearsed from a git archive with private
dependencies; this does not rehearse live promotion or database recovery. In the
e044a419-to-e6afa22e delta there are no migrations. A different target requires
its own schema review. The old revision reintroduces known dependency risks and
is an emergency regression target, not a secure long-term release.

Every promotion now runs `npm ci --omit=dev --no-audit --no-fund` on runtime
dependencies, even with equal lock hashes. It then checks actual production
package manifests, containment, `npm ls --omit=dev --depth=0`, and unchanged
lock SHA256. Only successful verification permits stamping and PM2 restart.
This deliberately adds install time on same-lock deployments. Optional omissions
are listed, not guaranteed working; required integration/native smoke remains
part of application acceptance. A dependency failure leaves promotion incomplete.

Recovery procedure for the authorized administrator, after reserving the lane:
1. Hold traffic/release acceptance as appropriate and inspect the full failed run
   archive. Do not infer readiness from the copied lock or existing SHA marker.
2. Resolve the install cause (disk, registry access, native toolchain, lifecycle)
   without floating dependency updates; preserve the intended committed lock.
3. Retry the same full app SHA through the activated reviewed bot. The runtime
   install and manifest checks run again regardless of equal lock hashes. If
   rollback is required, select the reviewed rollback SHA and its own lock.
4. Verify actual runtime/native integrations, health, process identity, served
   bytes and schema compatibility after restart. Keep HOLD until those pass.
   Interrupted evidence may require administrator investigation before cleanup.

The offline recovery test executes real npm ci with a local tarball, forces a
lifecycle failure that removes a package, then retries the identical lock and
loads the restored module. It proves retry mechanics; it does not rehearse a
production outage, application-native dependencies or database restoration.
Runtime refresh/promotion/restart can interrupt service. Do not claim atomic
rollback or zero downtime.

Tests: `npm test -- --maxWorkers=1 deploy-bot/build-inputs.test.mjs deploy-bot/release-evidence.test.mjs` and
`node --test deploy-bot/mcp-preservation.test.cjs`. The handler tests use fake
Telegram and shell transports; they never issue deployment commands.
