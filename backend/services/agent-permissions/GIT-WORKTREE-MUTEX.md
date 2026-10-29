# Git reservation scope (ADR-0181-A)

Git write reservations use `::git-index:::<canonical absolute Git directory>`.
Linked worktrees have distinct Git directories/indexes/HEADs, so their normal
`git add` and `git commit` operations no longer wait for another worktree's TTL.
Two sessions targeting the same checkout still contend, including merges into
main invoked with `git -C /root/production/business-crm merge ...`.
Git's own ref/index locks remain authoritative; these reservations are advisory.
File-edit reservations, TTLs, session release and fail-open behavior are unchanged.

The permission hook passes its invocation `cwd` through `/check`. The resolver
also honors an explicit tool `cwd`/`workdir`, literal `cd ... && git ...`, quoted
paths and repeated `git -C`. Symlinks and subdirectories resolve to the same key.
A command with multiple Git targets acquires each key in sorted order.

Use literal paths for scoped reservations. Unsupported shell forms (variables,
wrappers, pipelines, global repository overrides), absent cwd, or failed Git
resolution retain the legacy `::git-index::` key. This legacy bucket does not
coordinate with scoped keys; as before, this advisory guard is not a correctness
barrier. Unknown shell commands are never evaluated by the resolver.

## Validation and rollout

Run `npx vitest run backend/services/agent-permissions/__tests__` against the
repository's guarded `godcrm_test` contour. The worktree suite uses temporary
Git repositories and a mocked reservation store; existing tests cover actual
DB acquisition/release/expiry. No production DB migration is required.

Deploy backend and hook together through staging and the deploy-bot. Existing
processes adopt backend resolution after the executor restarts Ring 0; do not
restart it from an agent. Unscoped reservations left by the previous version
expire normally. Rollback is the previous source SHA through the same executor.
Frontend source is unchanged by this fix.
