# GitNexus freshness on .128

The MCP repository alias is `godcrm-private`, canonical source
`/root/production/business-crm`. The task worktree remains the only source-edit
location. Updating the canonical derived index requires a scoped host approval;
it is not an action in diagnostics/local-qa.

## Heap cap — read before running the analyzer

gitnexus 1.6.x re-execs `analyze` with `--max-old-space-size=max(16384, 0.75×RAM)`.
.128 has 15 GiB of RAM, so the floor is above physical memory: on 2026-10-16 the
indexer segfaulted and left a 30 GiB core dump that filled `/` (conversation 3721).

Always run the analyzer through the wrapper, which caps the re-exec heap at
8192 MB via `GITNEXUS_TEST_RESPAWN_HEAP_MB` and takes the analyzer lock:

```sh
gitnexus-analyze                      # canonical checkout, --index-only --workers 2
gitnexus-analyze /path/to/repo --pdg  # other repo / extra flags
```

Source: `scripts/ops-runner/gitnexus-analyze.sh`; installed copy
`/usr/local/bin/gitnexus-analyze`. The same cap is exported for login shells by
`/etc/profile.d/gitnexus-heap.sh` and for PM2 children via `.env`
(`GITNEXUS_TEST_RESPAWN_HEAP_MB=8192`), so a bare `gitnexus analyze` is also
bounded in most contexts — but do not rely on that; use the wrapper. Never pass
`--max-old-space-size` ≥ 8192 by hand. Core dumps are disabled on the box
(`kernel.core_pattern=|/bin/false`, apport masked), so an OOM now exits cleanly
instead of writing a dump.

## Refresh after integration

1. Serialize with the existing main integration/deploy reservation. Check
   `git status --short` and `git rev-parse HEAD` in the canonical checkout.
   Source changes outside committed HEAD invalidate an exact-SHA claim; stop
   until the source owner resolves them. Local `.mcp.json`, AGENTS.md and
   CLAUDE.md customizations must be preserved, not reset.
2. From the canonical checkout, use the installed wrapper (no package download):

   ```sh
   gitnexus-analyze /root/production/business-crm
   ```

   This expands to `flock -n /tmp/godcrm-gitnexus-analyze.lock gitnexus analyze
   <repo> --index-only --workers 2` with the heap cap above. `--index-only` skips
   generated instructions/skills; no embeddings requested. The lock prevents a
   second analyzer. It does not reserve Git: retain the integration reservation
   across analysis and the final HEAD check. For an ad-hoc refresh, compare
   HEAD/status before and after and invalidate/retry if they changed. Do not kill
   shared MCP or application processes to refresh.
3. Require analyzer exit 0. Verify canonical HEAD and tracked-file status did
   not change. Call MCP `list_repos()` and require `lastCommit` to equal that
   HEAD. Then `context()` a symbol added since the previous index (e.g.
   `buildOpsGateEnv` or `evaluateMcpAccess`) and check file/callers.
4. If the MCP process still returns old metadata, treat freshness as unresolved;
   arrange an MCP-only reload through its operator, never an app restart.
   Missing symbols remain UNKNOWN, never zero-impact evidence.

Use `detect_changes({repo:"godcrm-private",scope:"all",worktree:"<absolute task path>"})`
before committing; compare against main for regression review. New, unmerged
symbols may still be absent in a current main index. Review their source and
tests explicitly. Never register a task worktree with the canonical alias.

## Verified 2026-09-29, job 20469

Previous index: `1dd9062e`, 2026-09-22, 84 commits behind (the earlier September 1
date in handoffs was stale). Refreshed to `f7dd6c2263e3684e0cbaf5b52f077dbf56fd576c`:
28,989 nodes, 62,688 edges, 300 flows. MCP resolved `buildOpsGateEnv`, including
both CLI callers, without restarting a runtime. These numbers are evidence of
this run, not persistent freshness assertions.
