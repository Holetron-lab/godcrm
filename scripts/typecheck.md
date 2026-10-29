# TypeScript checks in sandboxed worktrees

Run `npm run typecheck` from the worktree being checked. The command uses the
same `tsc --noEmit` configuration, diagnostics and numeric exit status as before.
It creates a private, unique `godcrm-typecheck-*` directory in the OS temporary
directory (`/tmp` on this host), writes composite metadata there, and removes it
after success or failure. Concurrent checks never share the default cache.
No cache is reused between invocations; checks do not need write access to the
worktree. Set `TMPDIR` to a writable directory if the OS default is restricted.

Extra compiler arguments still work:

```sh
npm run typecheck -- --project tsconfig.json
```

An explicit `--tsBuildInfoFile /path/to/cache.tsbuildinfo` overrides the temporary
file. That caller-owned file is retained; the caller must choose a writable,
isolated path. Direct `npx tsc` calls bypass this wrapper.

Before this commit is integrated, another worktree can use the wrapper directly
without switching branches (the current directory selects the project):

```sh
node /root/wt-tsbuildinfo-sandbox-sysadmin/scripts/typecheck.mjs
```
