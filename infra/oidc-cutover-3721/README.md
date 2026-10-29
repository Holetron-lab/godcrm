# OIDC cutover / Forgejo — review package, conversation 3721

Prepared by @sysadmin on 2026-10-07; revised after GERATRON’s domain correction in conversation 3721. **NOT AUTHORIZED FOR INSTALLATION.**
This commit contains documentation only, not a deployable backend release.
Owner approval of the exact package SHA is required before execution; main
integration remains GERATRON-only. ADR-179 (widget 218 / doc 198825) is draft.
Coordination basis: widget 218 / doc 242364. No live/NL configuration was changed.

## Owner-selected domain (supersedes the earlier proposal)

GERATRON confirmed **https://id.godcrm.ai** in conversation 3660 on
2026-10-07. This supersedes the app.godcrm.ai choice in package `6bbd44f1`.
The exact issuer has no trailing slash; discovery is
`https://id.godcrm.ai/.well-known/openid-configuration`. Authorization, token,
userinfo and JWKS use the same id origin. Historical observations below and in
inventory.md are not desired configuration. The activation runbook in this
candidate takes precedence over earlier domain instructions.

Forgejo stays at `https://godcrm.ai/git/`; its registered callback remains
`https://godcrm.ai/git/user/oauth2/GOD%20CRM/callback`. The owner’s domain choice
does not move Forgejo, authorize NL changes or activate the new issuer.

## Package and ownership

- [Observed inventory and limitations](inventory.md)
- [Proposed configuration, window, acceptance and rollback](runbook.md)
- [Exact backend dependencies](backend-blockers.md)
- Preparation: @sysadmin; coordination: @orchestrator.
- Proposed named installation executor: **GERATRON (user_id 1)** through his own
  administrative access; he has not yet accepted a window or this package.
  Ring 0 activation/restart: owner or existing separate deploy-bot under owner
  control. @sysadmin must not restart its own runtime.
- @deployment-executor: subsequent package/evidence review, not an installation
  channel. `ops_grant_info` returned `ops_denied/no_gate_token` in this run.
  No agent shell substitution for the missing installation channel.
- No ticket assigned in this handoff; source conversation is **3721**.

## Decision required before scheduling

The two Penpot instances authenticate against **different identity masters**.
Moving B users to A is an identity migration, not just replacing a URL. Do not
approve a simultaneous blind switch of both clients. Proposed sequence is A
issuer + A Penpot first, B only after an owner-approved identity mapping and a
separate NL authorization. WorkAdventure must be recovered/identified or explicitly
excluded by the owner; its active registry row is not proof of a running service.
Until these conditions are resolved, the requested whole-fleet switch is blocked.

Forgejo registration and configuration follow issuer verification and acceptance
of the existing in-scope clients. No SQL client insertion from an agent shell.

## Evidence and validation

Base/index SHA: `755f516a85f9c7c9023292b158dd9e706d5decb3`.
Worktree: `/root/wt-codex-job-21327-1f1f62f6-7f02-41a8-aa69-c1c43e92b260-sysadmin`.
Branch: `feat/codex-job-21327-1f1f62f6-7f02-41a8-aa69-c1c43e92b260-sysadmin/work`.
The package commit SHA is supplied in the final handoff; obtain it with
`git log -1 --format=%H -- infra/oidc-cutover-3721`. It is not a live release SHA.

This revision imports the four review documents from committed package
`b8b1740d378f5f33ee696c11c19b8e82c9a6e005` into the allocated clean worktree.
Host `.128` and the current matching GitNexus base/index were verified.
No shared checkout or another executor’s worktree was edited.
Pre-edit target absence and original document hashes are recorded in the verified
backup `/root/backups/temp/oidc-app-21327-3721/manifest.json`.
This documentation backup is not a production rollback snapshot. Original live
observations and channel blockers are historical evidence from the source package;
installation must recheck them and active write reservations before any live work.

Validation for this documentation commit: relative links, no secret values,
`git diff --check`, explicit-file staging/staged diff, GitNexus detect_changes
with this worktree (all and compare/main). No functions/classes changed, so there
is no symbol edit requiring impact. Build/gate 1/runtime smoke/E2E are **not run**:
application code and configuration are unchanged. They remain release gates for
any later implementation; documentation validation does not satisfy them.

## Public discovery check after the domain decision

A fresh unauthenticated HTTPS request to
`https://app.godcrm.ai/.well-known/openid-configuration` on 2026-10-07 passed
normal TLS verification. Its issuer and auth/token/userinfo/JWKS endpoints still
advertise `https://crm.hltrn.cc`. Therefore the app-domain target is selected but
not active. No cookies, tokens or credentials were supplied for this check.

## Handling the observed secret exposure

A diagnostic read of the live Penpot compose included secret values in tool output.
They are deliberately absent from this package. Owner must restrict/redact that
diagnostic record where possible and arrange rotation of the Penpot OIDC client
secret, database password and application secret key through authorized channels.
First determine whether B shares credentials; do not copy them or assume equality.
Application-key rotation needs Penpot-version-specific session/data impact review
and backup; do not blindly replace it during an issuer-only cutover.

## Completion

Status: **REVIEW / BLOCKED_DEPENDENCY / BLOCKED_CHANNEL**. A committed review
package is not approval, installation, or successful login. Close the task only
after real Forgejo login returns to `/git/explore/repos`, previous users retain
their access, and the agreed client regression checks pass.
