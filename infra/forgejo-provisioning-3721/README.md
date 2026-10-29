# Forgejo provisioning — conversation 3721

Backend implementation for master A; candidate rebased on `a31430f85430c8b4689ae535774a78f32441e655`.
Conversation 3660 selects `https://id.godcrm.ai`; earlier app-issuer instructions are superseded.
The final committed SHA is supplied in the handoff; verify this directory's
`SHA256SUMS` from the repository root. No dependency or database migration added.
This package does not activate an issuer, register a production client, install
Forgejo configuration, or authorize a CRM restart.

## Contract

`POST https://app.godcrm.ai/oauth/admin/forgejo`

Authenticate with the current space-11 owner's **Bearer JWT session**.
API keys (including an owner's scoped key) and cookie-only requests are refused.
The owner's identity is read from `spaces`, not trusted from a role claim.

```json
{"data":{"action":"provision"}}
```

Actions: `provision`, `disable`, `enable`. No caller-supplied client settings or
secret input. Success returns `success`, with `data.client_id`, `is_active`,
`secret_ref`, `changed`, and `backup` (`file`, `sha256`). Never returns plaintext.

Pinned client: `forgejo`, `Forgejo GOD CRM`, `client_secret_post`, scopes
`openid profile email`, exact callback
`https://godcrm.ai/git/user/oauth2/GOD%20CRM/callback`. Service space/assistant/chat
bindings remain NULL. Vault storage uses space 11, as the existing OIDC reader
does; this is not a Forgejo service-space binding.

The endpoint requires a local interface `<PROD_IP>`, the loaded issuer
`https://id.godcrm.ai`, and an actual connection to `godcrm_prod` on loopback or
that address. DEV/EDIT and master B are refused. There is no test bypass in
production code. Before writes it checks the current column types/required
fields, serializes registry/vault writes, rejects duplicates/configuration
conflicts, and creates a 0600 scoped snapshot in the 0700 directory
`/srv/godcrm/shared/oidc-backups`. It fsyncs and reads back the snapshot, verifying
SHA-256 before mutation. The snapshot contains only the selected client's prior
row and encrypted vault row, plus schema metadata; retain it as confidential.

Client, vault write and `audit_log` entry commit in one transaction. Vault
transaction reads/writes bypass its cache, so rollback cannot leak a secret into
runtime reads. Identical provisioning does not insert or rotate. A disabled
client requires explicit `enable`. Conflicting/orphaned vault entries fail
closed; there is no automatic overwrite. Error responses never echo DB errors.

## Activation by the authorized executor

1. GERATRON approves the exact committed SHA for integration into main. Recheck
   reservation, merged source SHA and digests; normal release build/gate 1 and
   staging smoke remain release prerequisites. The frontend was not changed.
   Integrate the final conversation-3660 candidate from its committed SHA;
   do not replay the original three commits on top of it. Capture the resulting
   release SHA and rerun release checks after any merge changes.
2. Coordinate `OIDC_ISSUER=https://id.godcrm.ai` with Penpot A and other active
   clients using the revised `infra/oidc-cutover-3721/runbook.md` in this candidate. Preserve the
   old issuer/configuration and verified service backups. Do not touch NL.
3. Use the separate deploy-bot/owner to activate the committed CRM code and env.
   An agent must not restart its own CRM runtime. Prepare the snapshot directory
   for the CRM runtime user with mode 0700; do not weaken permissions if it fails.
4. Verify discovery issuer and every advertised endpoint use `https://id.godcrm.ai`;
   `/oauth/jwks` must have the expected RS256 key. Confirm Penpot A login with an
   existing account and unchanged subject mapping before onboarding Forgejo.
5. Owner calls the endpoint above. Record only the non-secret response and audit
   evidence. Repeat once: require `changed=false`, same client and secret ref.
6. Authorized operator obtains the generated secret through the existing audited
   `POST /api/v3/secrets/oidc_forgejo_client_secret/reveal?space_id=11` operation.
   Transfer it directly into Forgejo's protected authentication-source settings,
   never chat, tool output, shell argv, logs, or a committed file. Keep source
   name **GOD CRM** exactly: it determines the URL-encoded callback path.
7. Configure the existing Forgejo 9.0.3 service using discovery at
   `https://id.godcrm.ai/.well-known/openid-configuration`, client ID `forgejo`,
   the generated secret and the exact callback. Keep password recovery login.
   Do not use an upgrade or automatic email-account merge to solve this task.
8. Perform browser acceptance from
   `https://godcrm.ai/git/user/login?redirect_to=%2fgit%2fexplore%2frepos`:
   GOD CRM button, owner login, callback, correct account binding, return to
   `/git/explore/repos`. Check state validation on Forgejo, nonce equality, RS256
   signature/issuer/audience and one-time code exchange without logging tokens.
   Repeat Penpot A smoke. Record this live evidence separately from code tests.

Deployment Executor's current channel is review-only. If OPS is still
`BLOCKED_CHANNEL`/`no_gate_token`, GERATRON or an explicitly authorized deploy-bot
must execute; ordinary agent shell is not a replacement.

## Revoke and rollback

Call the same endpoint with `{"data":{"action":"disable"}}`. It changes only
this client and retains its encrypted secret. New authorizations and exchange of
already-issued codes fail after disable. It does **not** terminate existing
Forgejo browser sessions or revoke already-issued JWTs; those require the
application's session controls (access/ID token TTL is one hour).

After acceptance is restored, explicit `enable` restores access with the same
secret/configuration. Restore the prior active flag recorded in the audit and
snapshot. If the client did not exist before, leave it disabled as an auditable
tombstone; no identity database replacement or secret deletion is required.
If the shared issuer must be reverted, first disable Forgejo, then follow the
coordinated Penpot/issuer rollback in sysadmin's cutover package. Never point the
new client at master B as a fallback.

## Original package evidence and limitations

The 137-test results below belong to the original package. Current candidate
evidence and remaining acceptance blockers are in the conversation-3660 handoff.

- RED reproduced missing nonce, non-exact Forgejo callback, transactional vault
  failure, missing provisioning, nullable-schema drift and scoped-key escalation.
- Final filtered baseline: **137 tests, 10 files, zero failures/regressions**:
  `npm run test:baseline -- --maxWorkers=1 backend/routes/oauth/__tests__ backend/services/oidc/__tests__ backend/services/secrets/__tests__`.
- PostgreSQL integration asserts actual `godcrm_test`, then uses its own schema;
  only the environment guard and backup path are simulated. Concurrent requests
  and audit-failure rollback exercise real SQL, vault encryption and file IO.
- Protocol smoke verifies generated RS256 ID tokens against the provider JWKS,
  issuer/audience/nonce, state round-trip, exact callback, absent/wrong secret,
  disabled clients and code replay. Existing provider/vault regressions pass.
- ESLint: no errors; two pre-existing unused imports in oauth/index.js.
- Full repository baseline, release gate 1/build, staging deployment, live
  Forgejo account binding/redirect and Penpot smoke were not executed here.
  Backend completion is not evidence that production login is installed.
- GitNexus index matches base; new symbols are not indexed until integration.
  Its taint layer is absent. Source review and tests cover the new paths.
  Pre-commit `all` and base-SHA comparison: LOW, only expected OIDC/vault/docs.
  Comparison with moving main: MEDIUM, including incoming chat/file changes;
  git log and file lists confirm those changes are outside this patch.
- Security review: parameterized values; Zod at the new boundary; atomic
  `withTransactionAsync`; `connection.js`; logger without secret/error payloads;
  no new dependencies, plaintext secret fallback or frontend/accessibility changes.

## Official references

- [OIDC Core — nonce and code flow](https://openid.net/specs/openid-connect-core-1_0.html#AuthRequest)
- [PostgreSQL — table lock conflicts](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-TABLES)
- [Express 4 — router middleware](https://expressjs.com/en/4x/api/#router.use)
- [Forgejo 9 — authentication source administration](https://forgejo.org/docs/v9.0/admin/command-line/#admin-auth-add-oauth)
