export interface Position { x: number; y: number }
export interface WorldPlayer {
  id: string;
  position: Position;
  facing: { dx: number; dy: number };
  speed: number;
  activity?: { description: string; until: number };
  pathfinding?: { state: { kind: string; path?: Array<[number, number, number, number, number]> } };
}
export interface WorldView {
  world_id: number;
  state_version: number;
  simulated_at: number | null;
  learner_player_id: string;
  npcs: Array<{ npc_key: string; player_id: string; name: string }>;
  snapshot: {
    worldMap: { width: number; height: number; tileDim: number; bgTiles: number[][][]; objectTiles: number[][][] };
    playerDescriptions: Array<{ playerId: string; name: string; description: string; character: string }>;
    world: { players: WorldPlayer[]; agents: Array<{ id: string; playerId: string }> };
  };
}
export interface WorldCommand {
  widget_id: number;
  request_id: string;
  expected_version: number;
  command: 'move' | 'heartbeat';
  payload: { destination?: Position | null };
}
export interface WorldTransport {
  enter: (widgetId: number) => Promise<WorldView>;
  read: (worldId: number, widgetId: number) => Promise<WorldView>;
  command: (worldId: number, envelope: WorldCommand) => Promise<{
    status: 'applied' | 'duplicate'; request_id: string; world: WorldView;
  }>;
}
