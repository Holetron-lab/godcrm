# Learner world API — conversation 3726, ADR 239900

All routes use the existing authenticated module mount `/api/v3/neo16`.
Actor comes from `req.user`; widget → space permission → active installation →
project table mapping is resolved by the existing `resolveContext`. No client
actor, table ID, player ID, model, or wall clock is accepted.

## Enter and restore

```http
POST /api/v3/neo16/worlds
Content-Type: application/json

{"data":{"widget_id":123}}
```

201 on creation, 200 on resume. Concurrent entry creates one world per learner
per installation. Also used to add the missing learner to old snapshots without
resetting NPCs, sessions, or progress. A repair increments the world version.
Existing `POST /sessions` uses this same world and also ensures the learner exists.

```http
GET /api/v3/neo16/worlds/:world_id?widget_id=123
```

200, read-only; does not provision or tick. Both endpoints return the existing
CRM success envelope `{success:true,data:WorldView,timestamp}`.

```ts
type WorldView = {
  world_id: number;
  state_version: number;
  simulated_at: number | null;
  learner_player_id: string;
  npcs: Array<{ npc_key: string; player_id: string; name: string }>;
  snapshot: {
    worldMap: { width: number; height: number; tileDim: number;
      tileSetUrl: string; tileSetDimX: number; tileSetDimY: number;
      bgTiles: number[][][]; objectTiles: number[][][]; animatedSprites: unknown[] };
    playerDescriptions: Array<{playerId:string; name:string; description:string; character:string}>;
    world: {
      players: Array<{ id:string; human?:string; position:{x:number;y:number};
        facing:{dx:number;dy:number}; speed:number; pathfinding?:unknown;
        activity?:{description:string;until:number} }>;
      agents: Array<{id:string;playerId:string}>;
    };
  };
};
```

Tile arrays are `[layer][x][y]`; `objectTiles != -1` blocks walking.
The map remains the module's synthetic 16×16 town, not the legacy 14×12 office.
No new art is supplied. NPC keys are `nora`, `reed`, `casey`; the returned mapping
connects the rendered player to the existing `say` command's `npc_key`.
The learner's player ID is allocated by the server; never assume a literal ID.

Snapshots exclude conversations, agent persona/operations and internal clock
metadata. No learning transcript, execution record, PID, or lease is included.

## Move and heartbeat

```http
POST /api/v3/neo16/worlds/:world_id/commands
Content-Type: application/json

{"data":{"widget_id":123,"request_id":"uuid","expected_version":0,
 "command":"move","payload":{"destination":{"x":4,"y":1}}}}
```

Destination must be integer map coordinates; blocked/out-of-bounds targets return
422 `DESTINATION_BLOCKED`. `destination:null` stops walking. A route obstructed
by another character uses the ported collision/pathfinding logic, so arrival at
an occupied tile is not guaranteed.

Heartbeat uses the same envelope with `command:"heartbeat", payload:{}`.
Send approximately once per second while visible/active, with one request in
flight per tab. World simulation has no permanent worker and never spawns an LLM.

200 result: `{success:true,data:{status:"applied"|"duplicate",request_id,world:WorldView}}`.
The transaction locks learner → world, checks receipt/version, enqueues the input,
runs `stepWorld`, and commits the snapshot and saved response together. An exception
rolls everything back; retrying the same request is safe. Repeated `request_id` with
the same command/payload returns the saved response without another tick, even if
`expected_version` is now old. Another payload under that ID is 409 `REQUEST_MISMATCH`.
World and session receipt namespaces are separate.

`expected_version` is required and is the WORLD version, not session.state_version.
Two different requests at the same version: one applies, the other gets 409
`VERSION_CONFLICT`. Read the snapshot and reconcile before a new command; don't
blindly repeat old movement. A duplicate returns a historical snapshot: clients
must not replace a newer world version with it.

Other errors use `{success:false,error:{code,message,details?}}`:
401 no actor; 404 `WIDGET_NOT_FOUND` / `WORLD_NOT_FOUND` for absent or unauthorized
objects; 400 `VALIDATION_ERROR`; 409 `WORLD_NOT_READY` (POST /worlds first),
`WORLD_CLOSED`, `WORLD_COMMAND_FAILED`; unexpected failure is 500 `NEO16_INTERNAL`.

## Clock and NPC behavior

`simulated_at` and packed movement-path timestamps are logical simulation time.
After downtime they intentionally lag wall time. A heartbeat advances by at most
1000 ms of server-measured elapsed activity time; a same-time or backwards-clock
request cannot advance into the future. New input is stamped in logical time,
so it does not wait behind hours of catch-up. The durable internal
`snapshot.runtime.last_active_at` clock survives process restart.
Use a local interpolation origin anchored to `simulated_at`; do not compare path
timestamps directly with browser Date.now(). Ported moving paths are arrays of
`[x,y,dx,dy,t]`; pending paths have `state.kind:"needsPath"` or `"waiting"`.

The synchronous activity/wander branch adapts AI Town
`convex/aiTown/agentOperations.ts` at pinned MIT revision
`8e05997f2409275669c8344b84a51692e83f3f33`:
https://github.com/a16z-infra/ai-town/blob/8e05997f2409275669c8344b84a51692e83f3f33/convex/aiTown/agentOperations.ts
NPCs alternate a short authored activity and bounded random walking, using the
ported route and collision engine. Within 1.5 tiles of the learner they stop and
face them. This is the active-client non-LLM simulation subset; autonomous
NPC-to-NPC conversations/memory are not implemented here. Learner dialogue remains
the existing CRM agent-backed `say` lifecycle, outside world transactions.

## Frontend integration and verification boundary

Enter world → render returned map/players → heartbeat + move → pick an NPC using
`npcs[].player_id` and pass its `npc_key` to `say`. `POST /sessions` returns the same
world ID; GET session state restores transcript/goals/XP independently of the world
version. The new API does not add a proximity gate to the existing quest API.
Legacy Socket.IO must not carry these private snapshots or learning dialogue.

Tests cover concurrent entry, backfill, movement, read-only restore, duplicate and
mismatched receipts, two-tab version conflicts, cross-user/space denial, forged
actor/player/time, atomic rollback after receipt insertion, bounded offline resume,
and completing the rule-evaluated quest then restoring XP after a world step.
The deterministic rule binding is fixture-only: these tests do not certify live
Codex policy/model behavior or a browser end-to-end run. Frontend integration and
that full scenario remain the next acceptance gate. No deployment or main merge
is part of this backend handoff. The ADR's generic CRM row-access pilot gate remains.
