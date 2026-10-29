/**
 * Neo16 W2-S5 — client-side mirror of the server command envelope
 * (backend/modules/neo16/routes.js, README §W2-S3 / §W2-S4). Nothing here is
 * authoritative: every value the panel renders comes from a server reply.
 */

export type Command = 'start_session' | 'say' | 'abandon_session';

export interface Envelope {
  widget_id: number;
  session_id?: number | null;
  request_id?: string;
  expected_version?: number | null;
  command: Command;
  payload: Record<string, unknown>;
}

export interface FeedbackItem {
  type: 'grammar' | 'vocabulary' | 'pragmatics' | 'praise';
  message: string;
}
export interface GrammarError { original: string; corrected: string; rule: string }
export interface VocabularyItem { term: string; meaning: string }

export interface Evaluation {
  intent: { name: string; confidence: number };
  feedback: FeedbackItem[];
  grammar_errors: GrammarError[];
  vocabulary: VocabularyItem[];
  evaluator_version?: string;
  goal_completed?: string | null;
}

/** Provenance the server lets a client see (contract §7). */
export interface PublicExecution {
  agent_row_id?: number | null;
  provider?: string | null;
  requested_model?: string | null;
  resolved_model?: string | null;
  model_source?: string | null;
  exit?: string | null;
  attempt?: number | null;
}

export type TurnStatus = 'processing' | 'applied' | 'failed' | 'cancelled';

export interface PublicTurn {
  id: number;
  input_number: number;
  command: Command;
  npc_key: string | null;
  text: string | null;
  processing_status: TurnStatus;
  attempt?: number;
  applied_version: number | null;
  npc_response: string | null;
  evaluation: Evaluation | null;
  execution: PublicExecution | null;
}

export interface QuestNpc { key: string; name: string; role: string; persona?: string }
export interface QuestGoal { key: string; intent: string; npc: string; title: string; requires: string[] }
export interface QuestPhrase { text: string; note?: string }

export interface Quest {
  id: number;
  key: string;
  version: number;
  title: string;
  xp?: number;
  intro?: string;
  preparation?: { example?: Array<{ speaker: string; text: string }>; phrases?: QuestPhrase[] };
  npcs: QuestNpc[];
  goals: QuestGoal[];
}

export type SessionStatus = 'active' | 'completed' | 'abandoned';

export interface Session {
  id: number;
  status: SessionStatus;
  state_version: number;
  goals_done: string[];
  quest_key?: string;
  content_version?: number;
}

export interface Progress {
  id: number;
  status: string;
  xp: number;
  attempts?: number;
}

export interface SessionState {
  session: Session;
  quest: Quest;
  turns: PublicTurn[];
  progress: Progress | null;
}

export interface StartResult {
  session_id: number;
  world_id: number;
  resumed: boolean;
  progress_id: number | null;
  state: SessionState;
}

export interface AppliedSay {
  status: 'applied';
  turn: { id: number; npc_response: string; evaluation: Evaluation };
  session: { id: number; state_version: number; goals_done: string[]; status: SessionStatus };
  quest_completed: boolean;
  xp_awarded: number;
  progress: Progress | null;
}
export interface DuplicateResult { status: 'duplicate'; turn: PublicTurn }
export interface ProcessingResult { status: 'processing'; turn: { id: number; lease_until: number } }
export interface StaleResult { status: 'stale'; turn: { id: number; processing_status: TurnStatus | null } }
export interface AppliedAbandon {
  status: 'applied';
  turn: { id: number; input_number: number; applied_version: number };
  session: { id: number; status: 'abandoned'; state_version: number; goals_done: string[] };
  cancelled_turns: Array<{ id: number; execution: PublicExecution | null }>;
}

export type CommandResult = AppliedSay | AppliedAbandon | DuplicateResult | ProcessingResult | StaleResult;

/** `{ success: false, error: { code, message, details? } }` with the HTTP status attached. */
export class Neo16ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'Neo16ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Binding/policy problems are configuration, shown as such — never a silent fallback. */
export const CONFIG_ERROR_CODES = new Set(['AGENT_BINDING_MISSING', 'AGENT_BINDING_INVALID', 'AGENT_POLICY_UNAVAILABLE']);
/** The session moved under us: re-read state, do NOT resend. */
export const STALE_ERROR_CODES = new Set(['VERSION_CONFLICT', 'SESSION_CLOSED']);

export interface Neo16Transport {
  startSession(env: Envelope): Promise<{ status: number; body: StartResult }>;
  sendCommand(sessionId: number, env: Envelope): Promise<{ status: number; body: CommandResult }>;
  getState(sessionId: number, widgetId: number): Promise<SessionState>;
}
