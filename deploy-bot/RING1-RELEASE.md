# Pinned Ring 1 release

Run the bot on .128. The handler requires a literal `ring1-*` tag and its full
40-character commit SHA. Moving HEAD, branches and abbreviated SHAs are rejected.
`/deploy_ring1_check <tag> <SHA>` performs only read operations: tag resolution,
code/config fingerprint, actual PostgreSQL identity, lock digest and public API health. It does not build,
ship, back up, migrate or certify gate 2. Both commands share one process lock;
the administrator must reserve the deployment lane across other processes and
Ring 0 operations. No distributed deployment lease is claimed.

`/deploy_ring1 <tag> <SHA>` additionally requires a root-owned mode-0600 JSON
receipt in `/var/lib/godcrm/ring1-approvals/<tag>.json`. Its directory must be
root-owned and not writable by group/other. Provision this only through the
owner/admin channel after reviewing evidence. The bot validates binding, expiry,
all required gate statuses and the reviewed dist digest. It does not execute
staging tests or independently verify the meaning of evidence references.
There is no default PASS and no fixed 24-hour timer. A specific owner decision
can waive soak duration; migration rehearsal, smoke and rollback remain gates.

Receipt shape (replace placeholders with verified evidence, never fabricate PASS):

```json
{
  "tag": "ring1-YYYYMMDD-release",
  "sha": "FULL_APPLICATION_SHA",
  "target": "ring1-master-b",
  "targetFingerprint": "FROM_READ_ONLY_CHECK",
  "databaseIdentity": {
    "database": "godcrm_prod",
    "systemIdentifier": "FROM_B_PG_CONTROL_SYSTEM",
    "serverAddress": "FROM_B_INET_SERVER_ADDR",
    "serverPort": 5432,
    "recovery": false,
    "machineIdSha256": "FROM_B_READ_ONLY_CHECK"
  },
  "lockSha256": "LOCK_DIGEST",
  "distManifestSha256": "REVIEWED_BUILD_MANIFEST_DIGEST",
  "approvedBy": "GERATRON / appointed administrator",
  "ownerDecision": "conversation and message reference",
  "expiresAt": "UTC timestamp with short validity",
  "gates": {
    "staging": { "status": "PASS", "evidence": "reference" },
    "ring0Smoke": { "status": "PASS", "evidence": "reference" },
    "ring0Errors": { "status": "PASS", "evidence": "error signatures and 5xx observation" },
    "clientErrors": { "status": "PASS", "evidence": "client error capture" },
    "nlRestoreMigrations": { "status": "PASS", "evidence": "B restore/migration run in godcrm_test, refresh lock" },
    "rollback": { "status": "PASS", "evidence": "matching B code/deps restore and schema compatibility" }
  },
  "soak": { "status": "WAIVED_BY_OWNER", "evidence": "explicit per-release waiver" }
}
```

The full manifest is generated from dist using `find . -type f -print0`, sorted
with `LC_ALL=C sort -z`, then `xargs -0 sha256sum | sha256sum`. Run in `dist` with
pipefail. Record all individual hashes too. Source, dependencies and manifest
must match the reviewed application SHA. The build host must be the bot host.

Build dependencies are installed privately with the existing Ring 0 helper.
Evidence uses the existing recorder and persists outside the disposable worktree.
Before NL changes, the receipt expiry and target fingerprint are rechecked.
Backup is created under `/root/backups/temp` by default, restricted to root:
master B custom dump, complete runtime tree including dependencies/config, and
frontend docroot. Checksums and tar/pg_restore listings must pass before staging.
Listings are format checks; they do not replace a restore rehearsal.

A unique NL stage gets private runtime dependencies. Migration status errors
abort. Migrations use B's dotenv configuration, never A credentials. Live sync
preserves environment, MCP config, uploads, local backend config/token files,
node_modules and snapshots; excludes bot/helpers and derived worktree data.
There is no --delete. Runtime npm ci runs even with identical locks; verification
must pass before process control. Installation failure can interrupt the existing
backend. The bot does not claim atomic recovery or zero downtime.

Health checks use `/api/health` and require JSON `status=ok` plus a connected DB.
`/health` serves the SPA on the observed nginx configuration and is NOT a backend
health check. Frontend is published only after API health; served HTML and entry
script bytes must match before the promoted marker is updated. Full native and
business-flow acceptance still belongs to the administrator after deployment.
A failed backend can break the old frontend too. The old marker is not success.

Recovery is administrator-operated. Preserve the failed run and stage. Stop
acceptance, diagnose failure, and either retry after a fresh receipt/target
fingerprint or restore the full pre-run tree and docroot from this B backup with
permissions intact. Verify API, native modules and business flows before reopening.
Do not deploy an A rollback SHA as a presumed B baseline. Database rollback is a
separate decision: review schema compatibility, rehearse restore, and obtain owner
approval for any lost write delta. Never run migration down automatically.

Activation requires integration of the exact reviewed bot commit, protected
receipt/evidence directories, backup of runtime config and independent bot restart
by the owner/admin. Old bot memory does not update when source changes on disk.
Set RING1_HEALTH to the JSON endpoint if an old override exists. Do not run the
old unpinned command or its mutating `_check` as a shortcut.

## Identity and drift gates

The disk fingerprint includes every regular file under backend/ and modules/
(except node_modules), package/lock, .mcp.json and .env/.env.*. It covers backend
JSON tokens/config and module manifests without publishing their contents.
Symlinks in this scope fail closed. This remains a disk/config fingerprint,
not a full runtime/dependency/docroot attestation or a database snapshot.

The read-only check queries the actual PostgreSQL system identifier, endpoint,
database and recovery state and hashes the machine identity on .53. The admin
must independently verify this is B before approving these pins; copying pins
from an unverified connection does not establish provenance. The receipt binds
all these values. pg_control_system permission is required; failures stop release.
Only the chosen B env supplies connection variables: inherited POSTGRES_/PG*
variables are discarded. Migration connections use the candidate knexfile and
an afterCreate guard on every pool connection, including reconnections. A wrong
cluster with the same database name is rejected before migration writes. The
dump uses the observed numeric endpoint; as a separate libpq session it still
requires network/endpoint stability during the backup. No credential is logged.

Before approving nlRestoreMigrations, compare completed migration names with the
candidate migration directories. Include B-only 088 and modules in the rehearsed
candidate through a reviewed commit; do not silently copy unreviewed live code
into stage. Missing migration files stop Knex; never disable list validation.
Rehearsal/restore into godcrm_test uses the separately authorized test procedure,
not this production-only helper. Hold the scheduled refresh lock throughout.
