# Observed inventory — 2026-10-07, approximately 11:00–11:08 UTC

Historical audit retained from package `b8b1740d378f5f33ee696c11c19b8e82c9a6e005`;
the owner-confirmed target is `https://id.godcrm.ai` (conversation 3660). References to the id
host below describe observations, not the target configuration.

Read-only host/container inspection, SQL READ ONLY transactions with safe column
projection, and unauthenticated public HTTPS requests. No user tokens minted or
copied. Counts describe stored profiles, not recent activity or successful login.

| Instance | Runtime / identity master | Observed configuration | User-binding evidence |
|---|---|---|---|
| `design.godcrm.ai` | `.128`, running Penpot; master A | client `penpot`; base `https://godcrm.ai`; auth `https://app.godcrm.ai/oauth/authorize`; token/userinfo on `https://godcrm.ai/oauth/*`; explicit endpoints | 3 `oidc`, 2 `penpot` profiles; OIDC props contain `oidc/sub`, `oidc/provider-id`; actual relinking behavior and ownership not proven |
| `design.hltrn.cc` | `.53`, running Penpot; master B | client `penpot`; base/auth/token/userinfo all `https://crm.hltrn.cc` | 5 `oidc`, 1 `penpot` profiles; B→A identity mapping absent |
| `design-test.godcrm.ai` | `.128`, frontend/PG running; backend/Redis/exporter exited | client `penpot`; base/auth/token/userinfo `https://dev.godcrm.ai` | Separate test deployment; not a healthy canary; its callback is absent from A registry |
| WorkAdventure | No containers on A/B; legacy `.72` nginx proxies `wa.hltrn.cc` to `.205:3180` | `.72:/opt/workadventure` contains compose/env/maps; `.205` has no Docker containers and no listener on 3180; public `wa.hltrn.cc` does not resolve | Actual issuer, current callback and user binding UNKNOWN; cannot report regression PASS |
| Forgejo | `.128`, container `forgejo`; version 9.0.3 recorded in previous run | ROOT_URL `https://godcrm.ai/git/`; proposed `forgejo` client is rejected as `invalid_client` on A | New provider; linking/registration policy must be tested; no E2E performed |

Master A and B each have exactly two rows in standalone `oidc_clients`:

| client_id | is_active | Exact redirect_uris | allowed_scopes |
|---|---|---|---|
| `penpot` | 1 | `https://design.hltrn.cc/api/auth/oidc/callback`, `https://design.godcrm.ai/api/auth/oidc/callback` | `openid`, `profile`, `email` |
| `workadventure` | 1 | `https://play.workadventure.localhost/oauth/callback` | `openid`, `profile`, `email` |

Both A rows use `client_secret_post`, have a legacy secret and no `secret_ref`.
B secret values and modes were not queried. Duplicate callbacks across independent
masters do not establish common users. Test/master C registry was not inspected.

## Issuer, TLS, runtime evidence

- `id.godcrm.ai`, `godcrm.ai`, `app.godcrm.ai` resolve to `<PROD_IP>`.
- `id.godcrm.ai` nginx proxies all paths (including login UI/assets) to `:5000`.
- HTTPS discovery on id/apex passes TLS, but returns issuer and all OIDC endpoints
  `https://crm.hltrn.cc`. The registration endpoint is null.
- A public JWKS publishes RSA/RS256 key `godcrm-oidc-key-1`.
- Unauthenticated A `/oauth/authorize` with each registered exact callback returns
  302 to `/auth/login`; Forgejo returns 400 `invalid_client`. This checks client
  lookup only, not secret resolution, token validity or login.
- `crm.hltrn.cc` resolves to `.53`; ordinary HTTPS verification returned expired
  certificate. Verification was not disabled. NL baseline E2E is blocked already.
- PM2 saved configuration identifies `/srv/godcrm/live/backend/server.js` for A.
  Three files there match the base SHA source byte-for-byte (does not prove the
  entire release or the files loaded by a running process):

| File under backend | Live SHA-256 |
|---|---|
| `config/oidc.config.js` | `30a0a30964bdeb7d2dda8e9ac3ea3225aeac17ded61112b082a12433b3bad7de` |
| `routes/oauth/index.js` | `009222809e1357e62d19567049af92f93f4e8eb9a5759e0006ae505fc6de3b15` |
| `services/oidc/clientRegistry.js` | `7f399b7dba3503ef1ed3f166f2178e01282ea614fa8eb6e787a9c048dd1cff79` |

Reader supports `secret_ref` through `getSecret()` with legacy fallback. This
corrects the earlier uncertainty in the Forgejo-only package. It does not prove
vault provisioning, permissions or an authorized registration API exists.

## Image pins

Read from local image RepoDigests on A; no image pulls/upgrades were performed.

- Forgejo: `codeberg.org/forgejo/forgejo@sha256:3c34f11fe8b9983096eef3f8f25c2d2c21c4ae7504960cb203f0b075d1d8ed73`
- A Penpot backend: `penpotapp/backend@sha256:536fc9eea45e315ebd8d089f3e04655c56998198280d3d754c8d82c1d3de9bda`
- A Penpot frontend: `penpotapp/frontend@sha256:97dfcd855d56c2925307e3accce77e7d7999af132300d8a137aea7ffbadb8d99`
- B backend local image ID: `sha256:6c8e3851f3734e98e48d5a4a68e2c64485f6bd67a1ffec809aa9f1847d90a646`.
  B frontend local image ID: `sha256:4725b4698d8d1bd25ee1666e0d900d20da8937fea845c6a088f76cd69293560b`.
  These B IDs are not registry pull pins; resolve RepoDigests before any future B rollout.

## Identity acceptance still required

IdP code uses stringified local `users.id` as `sub`. For each existing OIDC profile,
owner must approve a protected mapping of old master/issuer/sub → target A
issuer/sub → existing application profile, with team/project rights before/after.
Do not put personal mappings in this repository. An equal numeric ID or email on
A and B is not proof. Preserve account IDs; require explicit authenticated linking
when necessary. Confirm no new duplicate profile or unexpected access after login.
OIDC defines stable identity by issuer plus subject, not email:
[OpenID Connect Core §5.7](https://openid.net/specs/openid-connect-core-1_0.html#ClaimStability).

No proof of subject mapping, full token validation or existing-user login was
obtained in this preparation. These remain hard execution gates.
