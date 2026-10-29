# Penpot credential rotation — conversation 3660 / job 21489

Backend prerequisite for `/tmp/oidc-21488/HANDOFF.md`. No migration, dependency,
frontend, runtime configuration or production data changes in this package.
The exact committed SHA and evidence digests are in the accompanying handoff.

## Owner API

`POST https://app.godcrm.ai/oauth/admin/penpot`, with the current space-11 owner's
legitimate Bearer JWT session. No minted owner tokens; no API keys, query tokens
or cookie-only authentication. Roles/actor/client settings in the body are rejected.
The owner is checked against the current `spaces.owner_id` inside the transaction.

First inspect (no data writes or backups):

```json
{"data":{"action":"inspect"}}
```

The nonsecret response includes `client_id`, `is_active`, `redirect_uris`,
`allowed_scopes`, `secret_ref`, `has_legacy_secret`, and opaque `revision`.
The registered A callback must include the exact
`https://design.godcrm.ai/api/auth/oidc/callback`. Existing callbacks (including
legacy registrations), scopes, name, bindings and authentication method are preserved.
Missing/duplicate clients, unknown vault references, public-client mode and schema
drift fail closed. This operation never creates a new Penpot client.

For a mutation, generate one UUID, retain it with the inspected revision and send:

```json
{"data":{"action":"rotate","request_id":"<UUID>","expected_revision":"<inspected revision>"}}
```

Actions: `rotate`, `disable`, `enable`. Same UUID + same action/revision is a retry:
`changed=false, replayed=true`, returning current metadata without applying the
old command again. Reusing that UUID for different input is 409. Concurrent
new requests with the same old revision cannot both rotate; the loser receives
409 `REVISION_CONFLICT`. Inspect again before each intentionally new operation.
After uncertain delivery, retry the identical payload; do not generate another UUID.

Rotate generates 32 random bytes encoded as base64url. It stores the encrypted
secret in space 11 under `oidc_penpot_<UUID without hyphens>`, updates `secret_ref`
and clears `client_secret` in the same transaction as the audit receipt. A new
reference for every rotation prevents old vault cache entries from authenticating
new requests. Existing encrypted versions remain unreferenced; no unrelated secrets
are deleted. The active flag is preserved, including when already disabled.

Mutation responses contain identifiers, active flag, change/replay state and a
backup path/digest, never secret values. Run a fresh inspect for the next revision.
The existing audited `POST /api/v3/secrets/<returned secret_ref>/reveal?space_id=11`
is the private retrieval channel. Transfer the revealed value directly to protected
Penpot configuration; never output it to chat, logs, shell argv or evidence files.

## Environment, atomicity and backup

Runtime requires local interface `.128` and actual `godcrm_prod` connection
on loopback or `.128`. EDIT, staging and master B are refused. The issuer is
intentionally not a precondition: this prerequisite must work BEFORE issuer cutover.
There is no environment bypass in shipped code.

Registry/vault table locks serialize mutations, including Forgejo provisioning.
Actual schema types and mandatory inserted columns are checked before writes.
`withTransactionAsync` rolls back registry, vault and audit together on failure.

The runtime user must own `/root/backups/temp/oidc-penpot`, mode 0700. Each mutation
creates an exclusive 0600 prechange snapshot, fsyncs it, reopens and verifies SHA-256
before the first mutation. It contains the selected client, previous encrypted
vault entry and schema; **a legacy client snapshot contains its old plaintext
credential**. It is confidential recovery evidence, never a release artifact.
Do not upload/read it into chat or reactivate an exposed credential from it.
Failed transactions may leave such a snapshot; a retry still requires a new verified
snapshot unless the original transaction committed. Directory/backup failures stop writes.

## Execution and recovery

1. Integrate this committed candidate through the normal reservation. Stage it,
   run Gate 1 and smoke; record the resulting SHA. The staging endpoint must
   reject its actual test DB. Functional mutation tests simulate only target
   identity/backup path over private tables in actual `godcrm_test`.
2. Separate deploy-bot/owner publishes the verified exact SHA. Refresh service
   backup/recovery evidence and preserve emergency local logins. No agent restarts
   its own runtime. No new blanket approval is requested by this package.
3. Owner inspects the production client through the API, confirms existing
   callbacks and status, then rotates once during coordinated Penpot cutover.
4. Privately reveal/install the returned secret, rotate Penpot DB/master keys via
   the separate sysadmin procedure, then activate issuer/CORS and Penpot endpoints.
   New Penpot accounts are permitted; deleting database/assets is not required.
5. Verify old credential refusal/new credential acceptance, exact callback,
   fresh/repeat OIDC and local login, issuer/JWKS and application rights. No secrets
   in evidence. Continue Forgejo provisioning using its separate API/client.

Recovery: use `disable` with a fresh UUID/revision to stop new Penpot authorizations
and code exchanges. It works without a healthy vault. It does not revoke existing
JWTs or Penpot sessions. Repair component configuration privately, rotate again if
necessary, and explicitly `enable`; enable refuses legacy fallback or an unreadable
vault secret. No full identity DB restore and no routine rollback to exposed secrets.
Old request replay cannot undo a later disable. Never touch master B/NL.

## Validation and sources

Tests cover authorization, malformed payloads, actual target guards, schema drift,
backup failures/permissions, real PostgreSQL concurrency/rollback, secret cache
behavior, callback strictness, disabled recovery, HTTP token exchange and Forgejo
regression. Production rotation, deployment, staging gate and real app login are
separate acceptance steps, not established by these tests.

Detected lockfile: Express 4.22.1, Zod 3.25.76, pg 8.18.0. Existing APIs reused:
[Express 4 router](https://expressjs.com/en/4x/api/#router.use),
[PostgreSQL table locks](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-TABLES),
[Node file handles](https://nodejs.org/api/fs.html#fspromisesopenpath-flags-mode).
Security review: parameterized SQL; Zod boundary; atomic transactions;
`connection.js`; safe logger fields; no new dependencies or frontend changes.
