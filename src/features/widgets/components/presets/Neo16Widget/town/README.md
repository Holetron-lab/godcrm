# Neo16 town client — conversation 3726 / ADR 239900

Based on backend commit `9e761a11bd44c2bf04ab7123421edb2e067c2e60`.
The module registrar and public entry select the HTTP town for installed widgets
(`config.__module`); uninstalled legacy rows keep their original office.
Installed towns never mount `useMultiplayer` or the legacy local game loop.

The view renders the returned map's `[layer][x][y]` object grid and server player
IDs. Select a tile (or use arrow keys + Enter) to walk; select a distant resident
to approach and a nearby resident to open the existing quest panel. The NPC key
comes only from `world.npcs[].player_id`. The quest API itself permits choosing
any quest NPC, as before; proximity is an interaction affordance, not authorization.
No new artwork, renderer dependency, or client simulation authority is introduced.

World commands use a single in-flight lane, world versions and a persistent
in-memory receipt on uncertain failures. Explicit Retry reuses the same envelope;
a version conflict reloads the snapshot without replaying movement. Historical
replays cannot replace a newer snapshot. Heartbeats run every second only while
visible. Visual path prediction uses `simulated_at` + local monotonic elapsed
time capped to one heartbeat; interaction uses the authoritative server position.

Quest versions remain independent. This tab stores only a session ID under its
widget/quest/version key in sessionStorage; all transcript, goals and XP are read
through the authorized session API. A completed session survives reload without
starting a new attempt. A 404 discards an inaccessible pointer. Storage-disabled
browsers can still play, but completed-session restoration needs that tab pointer.
The native dialog preserves drafts and active requests when closed and supports
keyboard focus containment and Escape.

## Verification

From the isolated task worktree:

```sh
npm test -- src/features/widgets/components/presets/Neo16Widget --maxWorkers=2
npm run typecheck
npm run build
node src/features/widgets/components/presets/Neo16Widget/__tests__/browser-smoke.mjs
flock -n /tmp/godcrm-baseline.lock npm run test:baseline -- --maxWorkers=3
```

The browser smoke boots the real module HTTP routes on loopback, verifies actual
`godcrm_test`/loopback before fixture creation, installs an ephemeral module, reads
the content-table schema via API before inserting a rules binding via API, and
cleans up through the module installer and workspace fixture. It uses Chromium,
blocks off-origin requests, and rejects legacy Socket.IO. It tests movement,
approaching Nora, dialogue, quest completion, reload with 3 turns and 50 XP,
390px layout, dialog Escape/focus restoration, accessible button names, and
console/network errors. Artifacts are written to `/tmp/neo16-town-browser-*`.

Successful run: `/tmp/neo16-town-browser-FgImm3/summary.json`; screenshots:
`desktop-completed.png`, `mobile-town.png`, `mobile-completed.png` in that directory.
UI unit suite: 30 passing tests. Build, typecheck and scoped ESLint passed.
Full baseline: 0 failures / 0 known failures; report `/tmp/vitest-baseline-acAqMk/report.json`.
Axe WCAG 2 A/AA and 2.1 AA: zero violations on both town and quest dialog;
reports `town-accessibility.json` and `dialog-accessibility.json` in the artifact directory. New town symbols
are absent from the canonical main GitNexus index; their impact is UNKNOWN and
source/test reviewed, while existing changed-symbol impact is LOW.

The browser fixture uses the deterministic **rules evaluator**, not live Codex.
It certifies browser/API persistence, not model behavior, deployed staging, or
production. This frontend-only delta qualifies for Gate 1 fast lane (build +
smoke); deploying the combined backend/frontend package still needs the backend
release lane and the authorized executor. No main integration or deployment is
performed by this task.
