# Worktree Git and Vitest in the agent sandbox

Use the allocated linked worktree. No write access to shared `packed-refs`,
`main`, sibling refs, or the shared checkout is required.

```sh
node scripts/worktree-git.mjs cherry-pick <sha>
node scripts/worktree-git.mjs commit -m 'fix: describe the change'
npm test -- --maxWorkers=1 <suite>
npm run test:baseline -- --maxWorkers=1 <suite>
node node_modules/vitest/vitest.mjs run --configLoader runner --maxWorkers=1 <suite>
```

Vitest uses `<worktree>/.cache/vitest/` and the runner config loader. Both are
necessary: `cacheDir` alone does not prevent Vite's config bundler from writing
`node_modules/.vite-temp`. Boot guards and existing suite exclusions remain intact.
A filtered baseline is only a regression check of those suites, not a full gate.

## Git 2.43 cleanup limitation

Native Git can successfully commit, then fail to remove `CHERRY_PICK_HEAD` or
`REVERT_HEAD`: its files backend takes a common `packed-refs.lock` for deletion,
even for worktree-local pseudorefs. The command can return zero while the marker
remains. A later commit can inherit the stale cherry-pick author/message context.
Disabling automatic maintenance does not fix this path.

Pass one SHA per cherry-pick call. A range or multi-SHA call can generate multiple
cleanup failures and is deliberately treated as uncertain; inspect HEAD before retrying.
The wrapper runs native Git with its original arguments. It repairs only the exact
shared-lock EROFS diagnostic after exit 0, a changed HEAD, no unmerged entries,
and no sequencer/rebase/merge state. It validates all remaining pseudorefs before
unlinking them in this worktree, and reports the repair. Other stderr is preserved.
Failures, conflicts, cancellation and uncertain cleanup retain their state.
Uncertain cleanup returns 2 even if Git already created a commit: inspect HEAD
before retrying, to avoid a duplicate commit. Conflict resolution uses the usual
edit/add sequence followed by `node scripts/worktree-git.mjs cherry-pick --continue`.

This is a command-level workaround, not a change to native Git or sandbox grants.
Native `git commit` / `git cherry-pick` still have the underlying limitation.
The wrapper's per-worktree lock only serializes wrapper calls; never mix concurrent
raw Git writes. An interrupted wrapper may leave `godcrm-worktree-git.lock` in
its Git directory; confirm the owning operation is finished before removing it.
It does not automatically repair stale state in other agents' existing worktrees.

Deployment: integrate the Vitest changes and wrapper/launcher instructions together.
Deploy the reservation-parser changes before adopting the helper across executors;
the old running parser does not recognize it. Existing executors then incorporate
these commits in their own branch. Future launcher instructions take effect after
the normal runtime deploy.
No runtime restart, main merge, or global Git/config change is part of this fix.

Source: Git v2.43.0 `refs/files-backend.c`, `files_transaction_prepare`:
https://github.com/git/git/blob/v2.43.0/refs/files-backend.c#L2606-L2637
