# Proposed coordinated runbook — do not execute without approval

Owner-selected target: `https://id.godcrm.ai` (conversation 3660, 2026-10-07).
Forgejo remains on `https://godcrm.ai/git/` with its existing proposed callback.
These are review deltas, not confirmation of a live switch.

## Entry gates and proposed window

GERATRON approves package SHA, client scope, identity mapping, executor and exact
UTC start. Proposed reservation: 60 minutes plus 30 minutes monitoring; **no date
booked**. Minutes 0–10 final preflight/backups, 10–25 A change and smoke, 25–40
existing-client acceptance, 40–60 Forgejo (only if all dependencies are green).
Start rollback by minute 40 if the existing-client phase is not green; do not
squeeze Forgejo into an unverified window. B migration requires a separately
authorized window after identity work. Never describe this as zero downtime.

Before any mutation executor must:

1. Recheck active reservations, actual host/DB, exact committed release SHA and
   effective process configuration. A doc-only SHA cannot stand in for a release.
2. Verify independent local emergency logins to CRM, Penpot and Forgejo, including
   2FA. Confirm backups can be restored in isolation. Preserve signing keys.
3. Take current consistent backups under `/root/backups/temp/` of A provider
   configuration/keys and necessary identity data, Penpot config/DB/assets,
   Forgejo app.ini/auth-source state/SQLite. Restrict permissions; record hashes,
   consistency method and isolated restore results without copying secrets into
   evidence. Previous `forgejo-oidc-21315-3721` snapshot is insufficient by itself.
4. Confirm user mapping, B decision and WorkAdventure decision. If B remains on B,
   owner must explicitly approve phased scope; leave NL entirely unchanged.
   No active unknown client may be silently declared retired.
5. Resolve secret-exposure response and [backend blockers](backend-blockers.md).
   Freeze new provider registration/linking during change. Allow in-flight OIDC
   attempts to finish; announce that restart can invalidate pending codes.

## Proposed configuration deltas (safe projection, not deploy files)

| Component | Observed | Proposed |
|---|---|---|
| Ring 0 `OIDC_ISSUER` | discovery advertises `https://crm.hltrn.cc`; actual effective env source to recheck | `https://id.godcrm.ai` in executor-managed runtime env |
| A Penpot `PENPOT_OIDC_BASE_URI` | `https://godcrm.ai` | `https://id.godcrm.ai` |
| A Penpot `PENPOT_OIDC_AUTH_URI` | `https://app.godcrm.ai/oauth/authorize` | `https://id.godcrm.ai/oauth/authorize` |
| A Penpot `PENPOT_OIDC_TOKEN_URI` | `https://godcrm.ai/oauth/token` | `https://id.godcrm.ai/oauth/token` |
| A Penpot `PENPOT_OIDC_USER_URI` | `https://godcrm.ai/oauth/userinfo` | `https://id.godcrm.ai/oauth/userinfo` |
| A Penpot `PENPOT_OIDC_JWKS_URI` | configured `https://godcrm.ai/oauth/jwks`; effective value recheck | `https://id.godcrm.ai/oauth/jwks` |
| A Penpot client/public URI/callback | `penpot`, `https://design.godcrm.ai`, `/api/auth/oidc/callback` | retained |
| B Penpot | endpoints on master B | **no immediate diff authorized**; same id-host endpoints only after mapping, separate A client/secret provisioning and NL approval |
| WorkAdventure | stale localhost callback; absent runtime at configured upstream | **no executable diff** until real endpoint/runtime identified |
| Test Penpot | DEV endpoints, stopped backend | outside production flip; repair separately before treating it as canary |

Do not change `COOKIE_DOMAIN` as part of this switch. Authorization and CRM
login run on `id.godcrm.ai`; an app-host cookie is not proof of an id-host
session. Acceptance must prove that
both an existing session and a fresh interactive login return to the pending
authorization without a loop. Preserve state/nonce and the exact registered
callback. Expanding a cookie to all subdomains is a separate security decision.

Append **exactly** `https://id.godcrm.ai` to the existing `CORS_ORIGINS` list;
preserve every approved existing entry. Do not replace the list with the sample
in `.env.example` and do not use `*`, suffix matching or all-subdomain cookies.
The CORS handler intentionally keeps the explicit allowlist/fail-closed policy.
Check the effective PM2 environment as well as the managed env file: inherited
PM2 values can override dotenv. A code-only release does not activate this delta.
Verify `/auth/login` and its module assets with `Origin: https://id.godcrm.ai`,
credentialed login/refresh and preflight; a lookalike origin must remain denied.

## Release blocker found during backend preparation (conversation 3660)

`src/pages/auth/LoginPage.tsx` applies `decodeURIComponent` after
`URLSearchParams.get('redirect')` already decoded the outer return parameter.
This changes the encoded Forgejo callback and can split state/nonce values at
`&` or turn `+` into spaces. The query redirect also bypasses the safe-return
validation used for location state. A fresh login therefore cannot be accepted
from backend protocol tests alone. Frontend owner must preserve the pending
local authorize URL exactly, reject off-site/unsafe returns, and verify fresh
and returning login in a browser before staging/prod acceptance. Do not weaken
the exact callback guard to hide this error. Backend tests cover the correctly
preserved return URL, with fixture cookies; they do not prove real client login.

## A issuer and existing-client phase

1. Executor updates approved runtime environment and activates through the owner/
   separate deploy-bot. No manual edit in `/srv/godcrm/live`, no agent restart.
   Reuse approved image pins; no unrelated dependency upgrade.
2. Executor applies approved A Penpot env changes from its deployment source
   `/root/penpot/docker-compose.yaml` and recreates only affected client processes.
   Verify effective values/cache refresh; preserve volumes and local password login.
3. Require valid DNS/TLS and exact discovery issuer plus auth/token/userinfo/JWKS
   endpoints under id.godcrm.ai. Fetch JWKS and independently verify a real user
   ID token: signature, exact `iss`, `aud`, expiration and subject binding; verify
   nonce if requested. Keep raw codes/tokens out of logs and handoff.
4. Existing A users (3 OIDC stored profiles at audit) must return to the same
   profiles and teams/projects. First/returning login, logout/re-login, denial,
   wrong state/callback and local emergency access must pass.
5. For B, first repair/accept the existing TLS baseline and reconcile identities
   through its separately approved plan. Do not point A at B or copy B user IDs.
   B acceptance means the same five OIDC profiles/rights survive the agreed move.
6. WorkAdventure acceptance requires actual runtime/callback and existing user
   session/role checks, or an explicit owner decision deferring/decommissioning it.
   Its present dormant state cannot produce an E2E PASS.

## Forgejo phase — only after the preceding gates

1. Backend executor registers a separate confidential client on **master A** via
   the authorized mechanism described in backend-blockers.md. Read current schema
   first; exact callback `https://godcrm.ai/git/user/oauth2/GOD%20CRM/callback`,
   scopes `openid profile email`, `client_secret_post`; no wildcard/admin claims.
2. GERATRON uses Forgejo HTTPS administration to add OAuth2 / OpenID Connect source
   named exactly `GOD CRM`, client ID `forgejo`, discovery
   `https://id.godcrm.ai/.well-known/openid-configuration`, additional scopes
   `email profile`. Supply secret through approved secure handling, not argv/chat.
   Retain local login/2FA; no auto-admin/team mapping or automatic email linking.
3. Existing account linking requires authenticated local ownership. Current
   `DISABLE_REGISTRATION=true` from the prior package must be rechecked. If new
   accounts are in scope, approve external registration policy explicitly before
   enabling it; OIDC does not grant private repository access or main write rights.
4. In an ordinary user browser open
   `https://godcrm.ai/git/user/login?redirect_to=%2Fgit%2Fexplore%2Frepos`.
   Verify visible GOD CRM button, correct IdP, real login, callback and final
   authenticated `/git/explore/repos`. Test first/repeat login, cancellation,
   tampered state/callback, external redirect rejection, repository permissions.
   Never replace the user's login with a generated admin JWT.

## Rollback

Trigger immediately on wrong account/project rights, duplicate profile, wrong
issuer/signature/audience, missing emergency access or repeatable login failure.
Stop new linking/registration. Disable only the newly created Forgejo auth source
and revoke its separate client through the authorized mechanism. Preserve accounts
and repositories; restoring stale SQLite over new records is prohibited.

For A client regression, executor restores captured **A** env/client configuration
and reactivates via the same authorized channel, then checks A user access. The
old A provider advertised B's issuer: restoring that defect is not a generally
safe long-term fallback. Keep new Forgejo disabled. If restoring the old issuer
would misidentify users, leave external login suspended and use verified local
login pending owner recovery decision. Do not switch the identity DB to B.

B changes, if separately approved later, have their own pre-change profile mapping
and reversal record; never roll back A by changing NL. No wholesale identity/DB
snapshot restoration while user writes continue. Replay approved per-job changes
or schedule a controlled restore with reconciliation. Keep audit evidence.

## Evidence handed back

Record package SHA, deployed release SHA, actual env/config hashes, image digests,
named operator/channel, UTC interval, backup/restore evidence, client matrix and
PASS/FAIL per scenario. Include verified issuer/audience and anonymized identity
mapping evidence, not tokens/secrets/emails. Required build/gates/smoke belong to
the actual implementation release. Observe auth errors and user access for the
reserved 30-minute period. Mark completion only after Forgejo final redirect and
all agreed regression tests pass.

References: [OIDC token validation](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation),
[Forgejo 9 settings](https://forgejo.org/docs/v9.0/admin/config-cheat-sheet/).
