# /history3496 — operator installation, ticket 246779 / conversation 2068

This package adds a fixed-action Telegram adapter for source chat 3496. It does
not install itself, deploy the CRM, create an index or perform a production
migration. The only admitted identity is Telegram user/private chat 423753027
(@Geramon), with bot ID 8601600288 / @Godcrmdeploybot confirmed by getMe.
The owner must have server access or appoint an administrator with that access.

## Installation (owner/admin on <PROD_IP> only)

Use the exact **channel SHA in HANDOFF.md**, not arbitrary main/HEAD. The reviewed
importer pin is fb1e7c10ef927516050fa59ad3b9ba6242aa5911 (see
HISTORY3496-COMPATIBILITY.md); the current deployed
application SHA is read separately from `/srv/godcrm/live/.promoted-sha`.
Never downgrade the app to the old importer SHA.

1. Review the source, handoff hashes and reports. Materialize a clean operator
   worktree from the channel SHA (replace SHA below with the handoff value):

   ```bash
   CHANNEL_SHA=SHA
   git -c core.hooksPath=/dev/null -C /root/production/business-crm worktree add --detach /root/wt-history3496-installer-geramon "$CHANNEL_SHA"
   ln -s /root/production/business-crm/node_modules /root/wt-history3496-installer-geramon/node_modules
   ```

2. Prepare the disabled installation, using Node 20 and existing dependencies:

   ```bash
   /usr/bin/node /root/wt-history3496-installer-geramon/deploy-bot/history3496-install.cjs prepare "$CHANNEL_SHA"
   ```

   This archives committed source into `/opt/godcrm-history3496/releases/SHA`;
   copies installed dependencies and verifies their versions against the pinned
   lockfile (no npm install); seals code/dependency inventory by SHA-256; copies
   snapshot, file map and runbook out of temporary storage. Drifted dependencies
   may be copied from the installed live set only when their versions match the
   committed lock. The known node_modules → itself directory link is skipped;
   other directory links are refused to prevent recursive/foreign copies. No live files are edited. `tar` is required by the importer
   and may exist only in the canonical dependency set.

   The 6 GiB local `files.tar` is hard-linked into the package on the same
   filesystem and made read-only at both names. Its original name/content remain.
   Ring 1 is never contacted. Minimum initial free space: 11 GiB; apply checks
   another 8 GiB are still free. Dependencies consume about 1.8 GiB on this host.

   A private backup of existing bot.js and .env, with a verified restoration
   round-trip, is stored under `/root/backups/temp/history3496-install-SHA-*`.
   It contains secrets: never post it in chat. Failed preparation leaves its
   partial artifact for operator inspection; it never enables the manifest.
   Remove only that failed release/input package after review before retrying.

3. Inspect `/etc/godcrm/history3496.json`: root-owned 0600, `enabled:false`.
   Check all three SHA fields and the inventory. Config/state directories are
   root-owned 0700; code is read-only. No symlink or group/other-writable path is
   accepted. `/tmp` is allowed only as the root-owned sticky ancestor of the lock.
   Existing installations are not overwritten by prepare.

4. Explicit owner activation:

   ```bash
   /usr/bin/node /opt/godcrm-history3496/releases/$CHANNEL_SHA/deploy-bot/history3496-install.cjs enable "$CHANNEL_SHA"
   ```

   This backs up the previous manifest and verifies the sealed inventory. It
   changes no runtime or data. A developer-authored JSON file is not evidence of
   operator consent or of completed production gates.

5. Switch only the independent deploy-bot, as its operator. Read-only inspection
   on 2026-10-09 identified PM2 app `deploy-bot`, script
   `/root/production/business-crm/deploy-bot/bot.js`, cwd the same deploy-bot
   directory. Recheck that identity before executing:

   ```bash
   pm2 stop deploy-bot
   pm2 start /opt/godcrm-history3496/releases/$CHANNEL_SHA/deploy-bot/bot.js --name deploy-bot-history3496 --cwd /root/production/business-crm/deploy-bot
   ```

   Do not run two polling consumers with the same token. Do not restart `godcrm`.
   The old cwd deliberately preserves the existing protected .env; executable
   code comes from the sealed artifact. After successful transport checks, the
   operator may persist this PM2 state with `pm2 save`.

6. @Geramon sends, privately to @Godcrmdeploybot:

   ```text
   /history3496 status
   /history3496 dry-run
   /history3496 status
   ```

   Save actual Telegram receipts. ACCEPTED is not success; use status until the
   durable result is SUCCEEDED. Dry-run reads/checks files only, uses
   `godcrm_test` without DB credentials and does NOT prove destination/index/ACL.

## Production readiness (must describe real checks)

Provide protected root-owned 0600 `/etc/godcrm/history3496-db.json`, containing
only POSTGRES_HOST (`127.0.0.1` or `::1`), POSTGRES_PORT (string), POSTGRES_DB
(`godcrm_prod`), POSTGRES_USER and POSTGRES_PASSWORD. No inherited URL, PG*,
NODE_OPTIONS, NODE_PATH or loader environment reaches the runner/CLI. Do not
put credentials in Telegram, command arguments or reports.

Create `/etc/godcrm/history3496-readiness.json`, root-owned 0600, with exactly:

- `operator`, `authorization`: nonempty actual operator and authority references.
- `channel_sha`: installed channel SHA; `deployed_sha`: actual deployed app SHA.
- `checked_at`, `backup_at`, `restore_verified_at`: ISO UTC, within 24 hours;
  restore must follow the backup.
- `backup`: `{ "path": "/root/backups/temp/...", "sha256": "64 hex" }` for the
  real pre-change production backup, or a verified-copy manifest in that tree.
- `restored_backup_sha256`: same digest as backup, identifying the successfully
  restored backup. `restore` references the corresponding restore report.
- `gate1`, `staging_smoke`, `test_cycle`, `http_acl`, `uploads_acl`, `restore`:
  proof objects with the same path/hash structure as backup. Reports must bind
  their checks to the actual deployed SHA, channel SHA and installed dependency
  inventory, and identify the isolated restore target. A hash only proves file
  integrity; the operator must review what the evidence actually establishes.
- `http_acl_verified:true`, `uploads_acl_verified:true`: only after actual checks.
- `guards`: relative filename → SHA-256 for every file in the exported `GUARDS`
  array in history3496-runner.cjs, including compiled dist/index.html and the
  file-access middleware. Runtime rehashes these live files and checks the
  promoted SHA. Receipts must also prove that the serving runtime uses them.

No ready-to-enable receipt template is shipped. Missing/expired receipts block
apply, verify and rollback. No production readiness was attested by the coding
agent. The supporting messages(parent_id) index must be installed through the
separate authorized migration process. The existing importer checks actual
loopback DB, schema, owner identity and index before staging uploads or writing
rows; missing index returns PRECONDITION_INDEX. It never creates the index.

After prerequisite review the owner sends `/history3496 apply`, polls status,
then `/history3496 verify`. Return the actual new URL, deployed SHA and
6045/334/21 reconciliation to conversation 2068. Joel must check history/video;
an explicitly invited continuation agent must read history. Those production
acceptance steps remain open until actually performed.

## Recovery and rollback

Each command claims a durable bot/chat/message ID before spawning; repeats after
restart cannot execute again. The detached runner uses one OS flock shared via
FD 3 with the CLI, so a bot restart cannot release the active import lock. There
is no migration timeout. Reports and fsynced journals are unique, private and
never overwritten, under `/var/lib/godcrm-history3496/runs/`.

PENDING_OR_UNKNOWN / OUTCOME_UNKNOWN means inspect the private journal and run
verify; absence of a report does not prove absence of commit. New writes are
blocked until a later successful verification. If verification cannot find an
import, an authorized operator must reconcile the journal before any retry;
there is no force switch. Never erase an ambiguous journal to make it pass.

`/history3496 rollback` is an explicit owner action. It revalidates the import
and refuses continued/changed conversations (BLOCKED_CHANGED); physical uploads
and the shared parent index remain for separate reviewed cleanup.

To disable/undo the adapter (not the data import):

```bash
/usr/bin/node /opt/godcrm-history3496/releases/$CHANNEL_SHA/deploy-bot/history3496-install.cjs disable "$CHANNEL_SHA"
pm2 stop deploy-bot-history3496
pm2 start deploy-bot
```

An already accepted runner remains independent. Wait for its outcome; do not kill
it or delete its lock/journal. The original bot/config were never replaced. If
config restoration is needed, compare the backup hashes and restore the private
.env from the verified installation backup as the operator. Preserve the new
journal/reports and do not remove uploads or shared directories. Replacing a
channel/app SHA requires disabled, operator-reviewed configuration and fresh
receipts; old receipts cannot authorize a different release.

## Validation and sources

Run `npm test -- --maxWorkers=2 deploy-bot/history3496.test.mjs` for the node
security checks through the repository test runner. They cover authorization,
input, environment, filesystem trust, durable replay prevention, actual flock,
mocked fixed argv, prerequisites, report failure, uncertainty and rollback.
Run the existing historical import/smoke/rollback cycle only on godcrm_test as
specified in scripts/HISTORICAL-CHAT-IMPORT.md. Production transport installation
is deliberately not part of developer tests.

Implementation follows [Node 20 spawn/detached/stdio](https://nodejs.org/download/release/v20.20.2/docs/api/child_process.html),
[Zod 3 boundary validation](https://v3.zod.dev/), and the installed
node-telegram-bot-api 0.66 message/getMe APIs. The module listens only for
`message`, not edited_message/callback_query/channel_post; see the library's
[official usage documentation](https://github.com/yagop/node-telegram-bot-api/blob/master/doc/usage.md).
