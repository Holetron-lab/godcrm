# Chat 3496 → existing space 44 «Играемся» — ticket 246779 / conversation 2068

Operator-run migration. Coding agents do not apply production data or restart
Ring 0. Deploy-bot installation/activation and release gates remain separate.
Use the exact SHA and checksums in the accompanying HANDOFF, never arbitrary HEAD.

## Pinned inputs

Input directory: /root/backups/temp/chat3496-space44-246779-20261010-developer-ralph/inputs

- conversation-3496.json: 73bcdbdb46f43af1f7858642d4f1b82051f1c6484d371f6b4956b416620847b3
- file-map.json: 8022fd45435cc534a7028352b6e2aba65a88815a6a42d7cacbed9084c6f61cc7
- related-data.json: 8ddbe26481097b750d0525b64c29959b56d0e5acc34a7fc4889432ce0dcd6e68
- files.tar remains at /root/backups/temp/ring1-chat2068-export-20261007-sysadmin/package/files.tar.
  Installer hard-links it into its sealed inputs; never substitute candidate paths.
- archived-only-messages.json preserves old message 687540, absent from the fresh
  snapshot. It is separate evidence, not one of the imported 6061 messages.

Expected: 6061 messages, 334 available uploads, 21 missing exact upload paths;
2 ClipForge tables, 37 columns, 8 jobs and 42 publications. The source table IDs
100371/100372 and project 8432 are provenance, never destination identities.
Seven source agent references remain inert; this does not install agents or
copy unrelated old-space projects, passwords, dashboards or automation settings.
Raw ClipForge server paths in row text remain source references, not promises
that executables, working directories or original MKV sources were restored.

## Destination and preservation

Target is Ring 0, local godcrm_prod; user 17 and existing space ID 44 with exact
name Играемся. Owner verified by source verified human email. Personal-space
ACL must have no extra grants, visibility private/internal. No space settings,
existing projects/tables/rows/messages/files or permissions are changed.
The importer aborts if identity/schema/ACL differs; never relax the checks to run.

New conversation and a new ClipForge archive project with two tables are created
atomically using new IDs. Reports return project/table/column/row/message/file
maps. Job relations, known row chips and upload URLs are remapped. Original rows,
columns, authors, dates and messages remain in provenance. Historical commands,
tool records and mentions do not dispatch work. Source grants/public flags are
not activated. Stage/retry operations rehash exact files before use.

Before execution: review updated importer pin and compatibility document, Node
20 + pinned installed dependencies, actual local DB/schema and parent index;
fresh backup AND matching isolated restore; deployed SHA and serving guards;
staging gate 1/smoke; persistent uploads path/permissions/space/HTTP ACL.
The pinned harmless document provenance trigger is checked byte-for-byte.
Unknown triggers and incompatible schema stop before writes.

## Commands through installed channel

Use ACTIVATION.md in the handoff. Installation prepares a disabled sealed copy;
only the independent deploy-bot owner enables and runs it. The fixed CLI args
include --target-space 44 --target-name Играемся --related-data and its SHA.
No Telegram-supplied path, SQL or shell argument is accepted.

Owner privately sends to @Godcrmdeploybot:

    /history3496 status
    /history3496 dry-run
    /history3496 status

Dry-run validates archive/files/related schema, but does not attest production
DB, ACL, index or release readiness. After actual prerequisites and current
operator receipts: /history3496 apply, poll status, then /history3496 verify.
All receipts must describe real checks. No developer-generated grant or fake
readiness attestation is supplied. No CRM restart is part of this importer.

CLI remains scripts/import-historical-chat.mjs, defaults to dry-run and requires
explicit pinned input digests, counts, destination and uploads root. Authorized
operators use a single flock /tmp/godcrm-history3496.lock. Every report uses a
new private path. Never retry an ambiguous write without journal reconciliation.

## Test and acceptance

Run targeted historical-*.test.js plus deploy-bot/history3496.test.mjs. The full
cycle must use backend/test/setup.js and the actual loopback godcrm_test.
Temporary test uploads belong to /tmp, never production uploads. Run
scripts/qa/historical-chat-smoke.mjs with apply report, test uploads and new report
path: it reads all messages/files via HTTP, verifies table counts, outsider
rejection, agent membership via MCP, history loader and no new agent jobs.

Production acceptance remains open until Joel opens the actual returned
https://app.godcrm.ai/spaces/44?chat=NEW_ID, sees the history and both tables,
and plays a copied video. Check the explicitly invited agent can read history.
Verify 6061/334/21 and 8+42, exact schema/maps, unchanged pre-existing space data,
source isolation and no historical replay. A test URL is not a production link.

## Rollback

Explicit owner action /history3496 rollback first verifies all messages/files and
related objects. Changed rows, new rows/tables/dashboards or new participants
block deletion for review. Only this import's objects are deleted. Existing
space 44 and prior data survive. Physical digest-scoped uploads are retained for
reviewed cleanup; never remove a shared uploads directory. Shared parent index
remains. Once the owner continues work, use a separately reviewed recovery plan.

Sources: [Zod 3](https://v3.zod.dev/),
[PostgreSQL 16 locking](https://www.postgresql.org/docs/16/explicit-locking.html),
[Node 20 filesystem](https://nodejs.org/docs/latest-v20.x/api/fs.html).
