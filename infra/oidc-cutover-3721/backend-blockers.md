# Backend scope required before Forgejo registration

## Verified gap

At base `755f516a85f9c7c9023292b158dd9e706d5decb3`, OAuth routes import
`backend/services/oidc/clientRegistry.js`. `getClient()` reads standalone
`oidc_clients`; `resolveClientSecret()` supports vault resolution with legacy
fallback. Relevant deployed files match source by hash. Master A has no Forgejo
row; unauthenticated authorize confirms `invalid_client`. Discovery registration
endpoint is null. Search of backend routes and scripts found no registration API;
the available MCP definitions also provide no OIDC-client registration operation.
This is a bounded inspection, not a claim that no external administrator tooling exists.

The universal-table API is not an authorized substitute for standalone SQL. An
Admin Space universal row would not be read by this runtime. SQL INSERT from an
agent shell and embedding a secret into a migration are not acceptable workarounds.

## Concrete requested implementation (backend owner, separately assigned)

Provide one owner-only, audited, idempotent provisioning/revoke path, either an
authenticated server API/MCP or a reviewed executor-run migration/provisioning
job with a committed SHA and protected secret input. Do not add anonymous dynamic
registration. Requirements:

- Assert target master A and actual DB before writes; read current schema and
  obtain verified pre-change backup. Never silently provision on NL/DEV.
- Use current reader store or explicitly migrate reader + store together; no
  assumption ADR-179 universal registry is already implemented.
- Provision `forgejo`, name `Forgejo GOD CRM`, active confidential client,
  `client_secret_post`, exact callback
  `https://godcrm.ai/git/user/oauth2/GOD%20CRM/callback`, allowed scopes
  `openid profile email`. Do not infer a service space binding from conversation
  3721; leave it unset unless separately approved.
- Store separate generated secret via confirmed vault API; put its reference in
  `secret_ref`, with no usable plaintext fallback for the new client. Verify
  resolution works in the running provider; do not print the secret or use argv.
- Detect duplicate `client_id` rows and conflicting existing configuration; fail
  closed. Migration 078 supplies an ordinary index, not a uniqueness guarantee.
  Rerun of identical provisioning must not rotate secrets or duplicate rows.
- Audited disable/revoke path must affect only this client; define restoration
  of previous state without replacing whole identity databases.
- Tests: unauthorized registration denied; wrong master rejected; duplicate/conflict
  handling; exact callback; secret-ref resolution; absent/wrong secret rejected;
  repeat-run behavior; revocation; confidential code exchange. Verify actual
  Forgejo login compatibility including nonce handling if the client requests it.

Do not expand this task into all ADR-179 deliverables. Any source change requires
its own worktree reservation, impact analysis, mandatory checks and detect_changes.
Return committed implementation SHA and gate evidence before installing.

## Other prerequisites, not registration work

- A/B Penpot identity mapping is unresolved; same email/numeric subject is not
  authorization. Application-side binding behavior requires verification against
  pinned Penpot versions and the protected user mapping.
- WorkAdventure runtime/configuration is absent at its recorded upstream.
- Master B TLS is already invalid. Repair requires separate owner authorization;
  do not suppress certificate verification to make regression appear green.
- Secret exposure response is listed in README; existing shared credentials must
  be inventoried/rotated separately with service owners.
- Installation channel remains unconfirmed. Review by @deployment-executor
  neither grants root/runtime access nor satisfies the missing provisioning API.
