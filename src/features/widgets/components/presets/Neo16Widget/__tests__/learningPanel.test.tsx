/**
 * Neo16 W2-S5 — conversation/feedback panel against a FAKE transport that behaves
 * like backend/modules/neo16/routes.js + questService.js (receipt by request_id,
 * expected_version gate, stale, binding 409, 502 retryable, abandon).
 *
 * Acceptance W2 "two concurrent tabs serialize correctly" is proven at the
 * component level: two panels, one server, one state_version — the loser gets
 * stale/VERSION_CONFLICT, re-reads state and sends nothing again.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor, act } from '@testing-library/react';
import { LearningPanel } from '../learning/LearningPanel';
import {
  Neo16ApiError,
  type CommandResult,
  type Envelope,
  type Evaluation,
  type Neo16Transport,
  type PublicTurn,
  type SessionState,
  type StartResult,
} from '../learning/types';

// ── fake server ────────────────────────────────────────────────────────────────

const QUEST: SessionState['quest'] = {
  id: 1, key: 'arrange_meeting', version: 1, title: 'Arrange a meeting with Dr. Reed', xp: 50,
  intro: 'Find out when Dr. Reed is free, where to meet, and confirm it.',
  preparation: { phrases: [{ text: 'When is she free?', note: 'availability' }] },
  npcs: [
    { key: 'nora', name: 'Nora Blake', role: 'Receptionist' },
    { key: 'reed', name: 'Dr. Evelyn Reed', role: 'Scientist' },
    { key: 'casey', name: 'Casey Brooks', role: 'Colleague' },
  ],
  goals: [
    { key: 'ask_time', intent: 'ask_time', npc: 'nora', title: 'Find out when Dr. Reed is free', requires: [] },
    { key: 'ask_place', intent: 'ask_place', npc: 'nora', title: 'Find out where to meet her', requires: [] },
    { key: 'confirm', intent: 'confirm_meeting', npc: 'reed', title: 'Confirm the meeting with Dr. Reed', requires: ['ask_time', 'ask_place'] },
  ],
};

type Receipt = { hash: string; result: CommandResult; turn: PublicTurn | null };

interface FakeOptions {
  /** Called per NEW `say`; return an evaluation, throw Neo16ApiError, or return 'processing'. */
  evaluate?: (env: Envelope, attempt: number) => Evaluation | 'processing';
  bindingError?: Neo16ApiError;
}

const okEval = (intent: string, extra: Partial<Evaluation> = {}): Evaluation => ({
  intent: { name: intent, confidence: 0.9 },
  feedback: [], grammar_errors: [], vocabulary: [], ...extra,
});

function createFakeServer(opts: FakeOptions = {}) {
  let nextId = 100;
  const sessionId = 7;
  const state: SessionState = {
    session: { id: sessionId, status: 'active', state_version: 0, goals_done: [], quest_key: 'arrange_meeting', content_version: 1 },
    quest: QUEST,
    turns: [],
    progress: { id: 9, status: 'active', xp: 0, attempts: 1 },
  };
  const receipts = new Map<string, Receipt>();
  const attempts = new Map<string, number>();
  const log: Array<{ kind: 'start' | 'command' | 'state'; env?: Envelope }> = [];
  const processing = new Map<number, { env: Envelope; hash: string }>();

  const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  const hashOf = (env: Envelope) => JSON.stringify([env.command, env.payload]);

  function applySay(env: Envelope, turnId: number, ev: Evaluation, hash: string): CommandResult {
    const npcKey = String(env.payload.npc_key);
    const goalsDone = [...state.session.goals_done];
    let goalCompleted: string | null = null;
    const open = QUEST.goals.filter((g) => !goalsDone.includes(g.key) && g.npc === npcKey && g.requires.every((r) => goalsDone.includes(r)));
    const goal = open.find((g) => g.intent === ev.intent.name);
    if (goal && ev.intent.confidence >= 0.6) { goalsDone.push(goal.key); goalCompleted = goal.key; }
    const completed = goalsDone.length === QUEST.goals.length;
    state.session.state_version += 1;
    state.session.goals_done = goalsDone;
    if (completed) state.session.status = 'completed';
    let xp = 0;
    if (completed && state.progress && state.progress.status !== 'completed') {
      xp = QUEST.xp ?? 0;
      state.progress = { ...state.progress, status: 'completed', xp: state.progress.xp + xp };
    }
    const npc_response = `[${npcKey}] reply to "${env.payload.text}"`;
    const turn: PublicTurn = {
      id: turnId, input_number: state.turns.length + 1, command: 'say', npc_key: npcKey, text: String(env.payload.text),
      processing_status: 'applied', applied_version: state.session.state_version, npc_response,
      evaluation: { ...ev, goal_completed: goalCompleted, evaluator_version: 'fake' }, execution: null,
    };
    const idx = state.turns.findIndex((t) => t.id === turnId);
    if (idx >= 0) state.turns[idx] = turn; else state.turns.push(turn);
    const result: CommandResult = {
      status: 'applied',
      turn: { id: turnId, npc_response, evaluation: turn.evaluation as Evaluation },
      session: { id: sessionId, state_version: state.session.state_version, goals_done: goalsDone, status: state.session.status },
      quest_completed: completed, xp_awarded: xp, progress: state.progress,
    };
    receipts.set(env.request_id!, { hash, result, turn });
    return result;
  }

  const transport: Neo16Transport = {
    async startSession(env) {
      log.push({ kind: 'start', env });
      if (state.session.status !== 'active') {
        // a new attempt on the same quest: fresh session row, progress identity kept
        state.session = { id: state.session.id + 1, status: 'active', state_version: 0, goals_done: [], quest_key: 'arrange_meeting', content_version: 1 };
        state.turns = [];
      }
      const body: StartResult = { session_id: state.session.id, world_id: 1, resumed: false, progress_id: 9, state: clone(state) };
      return { status: 201, body };
    },
    async getState() {
      log.push({ kind: 'state' });
      return clone(state);
    },
    async sendCommand(sid, env) {
      log.push({ kind: 'command', env });
      if (sid !== state.session.id) throw new Neo16ApiError(404, 'SESSION_NOT_FOUND', 'not found');
      if (!env.request_id) throw new Neo16ApiError(400, 'REQUEST_ID_REQUIRED', 'request_id required');
      const hash = hashOf(env);
      const rec = receipts.get(env.request_id);
      if (rec) {
        if (rec.hash !== hash) throw new Neo16ApiError(409, 'REQUEST_MISMATCH', 'other payload');
        return { status: 200, body: rec.turn ? { status: 'duplicate', turn: clone(rec.turn) } : rec.result };
      }
      // in-flight receipt from a previous 'processing' answer for this id?
      const inflight = [...processing.entries()].find(([, p]) => p.env.request_id === env.request_id);
      const isNew = !inflight;
      if (isNew) {
        if (state.session.status !== 'active') throw new Neo16ApiError(409, 'SESSION_CLOSED', `session is ${state.session.status}`);
        if (env.expected_version != null && env.expected_version !== state.session.state_version) {
          throw new Neo16ApiError(409, 'VERSION_CONFLICT', `at ${state.session.state_version}, expected ${env.expected_version}`);
        }
      }
      if (env.command === 'abandon_session') {
        state.session.state_version += 1;
        state.session.status = 'abandoned';
        const turnId = nextId++;
        state.turns.push({ id: turnId, input_number: state.turns.length + 1, command: 'abandon_session', npc_key: null, text: null, processing_status: 'applied', applied_version: state.session.state_version, npc_response: null, evaluation: null, execution: null });
        const result: CommandResult = {
          status: 'applied', turn: { id: turnId, input_number: state.turns.length, applied_version: state.session.state_version },
          session: { id: sid, status: 'abandoned', state_version: state.session.state_version, goals_done: state.session.goals_done }, cancelled_turns: [],
        };
        receipts.set(env.request_id, { hash, result, turn: null });
        return { status: 200, body: result };
      }
      if (opts.bindingError) throw opts.bindingError;
      const n = (attempts.get(env.request_id) ?? 0) + 1;
      attempts.set(env.request_id, n);
      const turnId = inflight ? inflight[0] : nextId++;
      let ev: Evaluation | 'processing';
      try {
        ev = opts.evaluate ? opts.evaluate(env, n) : okEval('small_talk');
      } catch (err) {
        // failed receipt: retryable with the same id
        state.turns = state.turns.filter((t) => t.id !== turnId);
        state.turns.push({ id: turnId, input_number: state.turns.length + 1, command: 'say', npc_key: String(env.payload.npc_key), text: String(env.payload.text), processing_status: 'failed', applied_version: null, npc_response: null, evaluation: null, execution: null });
        processing.set(turnId, { env, hash });
        throw err;
      }
      if (ev === 'processing') {
        processing.set(turnId, { env, hash });
        if (!state.turns.some((t) => t.id === turnId)) {
          state.turns.push({ id: turnId, input_number: state.turns.length + 1, command: 'say', npc_key: String(env.payload.npc_key), text: String(env.payload.text), processing_status: 'processing', applied_version: null, npc_response: null, evaluation: null, execution: null });
        }
        return { status: 202, body: { status: 'processing', turn: { id: turnId, lease_until: Date.now() + 100_000 } } };
      }
      processing.delete(turnId);
      return { status: 200, body: applySay(env, turnId, ev, hash) };
    },
  };

  /** Server-side: settle a `processing` turn as the real Phase C would. */
  function settle(turnId: number, ev: Evaluation) {
    const p = processing.get(turnId);
    if (!p) throw new Error(`turn ${turnId} is not processing`);
    processing.delete(turnId);
    applySay(p.env, turnId, ev, p.hash);
  }

  const commands = () => log.filter((l) => l.kind === 'command').map((l) => l.env!);
  const says = () => commands().filter((e) => e.command === 'say');
  return { transport, state, log, commands, says, settle, attempts };
}

const sayAs = async (root: HTMLElement, npc: string, text: string) => {
  const panel = within(root);
  await waitFor(() => expect(panel.getByLabelText('Your message')).not.toBeDisabled());
  fireEvent.change(panel.getByLabelText('Talk to'), { target: { value: npc } });
  fireEvent.change(panel.getByLabelText('Your message'), { target: { value: text } });
  fireEvent.submit(panel.getByLabelText('Your message').closest('form')!);
};

// ── tests ──────────────────────────────────────────────────────────────────────

describe('Neo16 LearningPanel (W2-S5)', () => {
  it('starts a session on mount and renders quest, goals, XP and the empty transcript', async () => {
    const srv = createFakeServer();
    render(<LearningPanel widgetId={42} transport={srv.transport} />);

    expect(await screen.findByText(/Arrange a meeting with Dr. Reed/)).toBeInTheDocument();
    expect(screen.getByTestId('xp')).toHaveTextContent('0 XP');
    expect(screen.getByTestId('goal-ask_time')).toHaveAttribute('data-done', 'false');
    expect(screen.getByTestId('session-status')).toHaveTextContent('session #7 · active · v0');
    expect(srv.log[0]).toMatchObject({ kind: 'start', env: { widget_id: 42, command: 'start_session', payload: { quest_key: 'arrange_meeting', content_version: 1 } } });
    expect(srv.log[0].env?.request_id).toBeTruthy();
  });

  it('say → applied: renders npc_response, feedback, grammar, vocabulary, goal and progress from the reply', async () => {
    const srv = createFakeServer({
      evaluate: () => okEval('ask_time', {
        feedback: [{ type: 'grammar', message: 'use the base form after did' }, { type: 'praise', message: 'clear question' }],
        grammar_errors: [{ original: "didn't went", corrected: "didn't go", rule: 'base form after did' }],
        vocabulary: [{ term: 'available', meaning: 'free to meet' }],
      }),
    });
    render(<LearningPanel widgetId={42} transport={srv.transport} />);
    await sayAs(document.body, 'nora', "When is Dr. Reed free? I didn't went yesterday");

    const turn = await screen.findByTestId('turn-100');
    expect(turn).toHaveAttribute('data-status', 'applied');
    expect(within(turn).getByText(/\[nora\] reply to/)).toBeInTheDocument();
    expect(within(turn).getByLabelText('Feedback')).toHaveTextContent('[grammar] use the base form after did');
    expect(within(turn).getByLabelText('Feedback')).toHaveTextContent('[praise] clear question');
    expect(within(turn).getByLabelText('Grammar')).toHaveTextContent("didn't went → didn't go · base form after did");
    expect(within(turn).getByLabelText('Vocabulary')).toHaveTextContent('available — free to meet');
    expect(within(turn).getByText(/✓ Goal: Find out when Dr. Reed is free/)).toBeInTheDocument();
    expect(screen.getByTestId('goal-ask_time')).toHaveAttribute('data-done', 'true');
    expect(screen.getByTestId('session-status')).toHaveTextContent('v1');

    const env = srv.says()[0];
    expect(env).toMatchObject({ widget_id: 42, session_id: 7, expected_version: 0, command: 'say', payload: { npc_key: 'nora' } });
    expect(typeof env.request_id).toBe('string');
    // composer cleared after the turn applied
    expect(screen.getByLabelText('Your message')).toHaveValue('');
  });

  it('completing the last goal shows XP exactly as the server awarded it and closes the session', async () => {
    const srv = createFakeServer({
      evaluate: (env) => okEval(env.payload.npc_key === 'reed' ? 'confirm_meeting' : String(env.payload.text).includes('where') ? 'ask_place' : 'ask_time'),
    });
    render(<LearningPanel widgetId={42} transport={srv.transport} />);
    await sayAs(document.body, 'nora', 'when is she free');
    await screen.findByTestId('turn-100');
    await sayAs(document.body, 'nora', 'where should I meet her');
    await screen.findByTestId('turn-101');
    await sayAs(document.body, 'reed', 'Thursday at two works for me');
    await screen.findByTestId('turn-102');

    expect(await screen.findByTestId('notice-completed')).toHaveTextContent('+50 XP');
    expect(screen.getByTestId('xp')).toHaveTextContent('50 XP');
    expect(screen.getByTestId('session-status')).toHaveTextContent('completed');
    expect(screen.getByLabelText('Your message')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Start new attempt' })).toBeInTheDocument();
  });

  it('502 EVALUATION_FAILED is retried with the SAME request_id, and the server applies once', async () => {
    const srv = createFakeServer({
      evaluate: (_env, attempt) => {
        if (attempt === 1) throw new Neo16ApiError(502, 'EVALUATION_FAILED', 'model said prose');
        return okEval('small_talk');
      },
    });
    render(<LearningPanel widgetId={42} transport={srv.transport} />);
    await sayAs(document.body, 'casey', 'hello there');

    const turn = await screen.findByTestId('turn-100');
    expect(turn).toHaveAttribute('data-status', 'applied');
    const ids = srv.says().map((e) => e.request_id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(1);
    expect(srv.state.turns).toHaveLength(1);
  });

  it('after exhausting automatic retries the Retry button replays the same request_id', async () => {
    let fail = true;
    const srv = createFakeServer({
      evaluate: () => { if (fail) throw new Neo16ApiError(502, 'EVALUATION_FAILED', 'down'); return okEval('small_talk'); },
    });
    render(<LearningPanel widgetId={42} transport={srv.transport} />);
    await sayAs(document.body, 'casey', 'hello');

    const notice = await screen.findByTestId('notice-retryable');
    expect(srv.says()).toHaveLength(3); // 1 + AUTO_RETRIES
    fail = false;
    fireEvent.click(within(notice).getByRole('button', { name: 'Retry' }));
    await screen.findByTestId('turn-100');
    const ids = new Set(srv.says().map((e) => e.request_id));
    expect(ids.size).toBe(1);
    expect(srv.says()).toHaveLength(4);
  });

  it('202 processing → polls GET state until the turn is applied (no second send)', async () => {
    const srv = createFakeServer({ evaluate: () => 'processing' });
    render(<LearningPanel widgetId={42} transport={srv.transport} pollIntervalMs={5} />);
    await sayAs(document.body, 'nora', 'when is she free');

    await screen.findByTestId('notice-processing');
    await waitFor(() => expect(srv.log.filter((l) => l.kind === 'state').length).toBeGreaterThan(1));
    act(() => srv.settle(100, okEval('ask_time')));

    await waitFor(() => expect(screen.getByTestId('turn-100')).toHaveAttribute('data-status', 'applied'));
    expect(screen.getByTestId('goal-ask_time')).toHaveAttribute('data-done', 'true');
    expect(srv.says()).toHaveLength(1);
    expect(screen.queryByTestId('notice-processing')).not.toBeInTheDocument();
  });

  it('409 AGENT_BINDING_MISSING is an explicit configuration error — nothing is retried or faked', async () => {
    const srv = createFakeServer({ bindingError: new Neo16ApiError(409, 'AGENT_BINDING_MISSING', 'no binding', { npc_key: 'nora' }) });
    render(<LearningPanel widgetId={42} transport={srv.transport} />);
    await sayAs(document.body, 'nora', 'hi');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('AGENT_BINDING_MISSING');
    expect(alert).toHaveTextContent(/Bind an agent row/);
    expect(srv.says()).toHaveLength(1);
    expect(srv.state.turns).toHaveLength(0);
    expect(screen.queryByTestId(/^turn-/)).not.toBeInTheDocument();
    // the learner's text is kept for a deliberate resend
    expect(screen.getByLabelText('Your message')).toHaveValue('hi');
  });

  it('abandon session sends the command with expected_version and renders the closed state', async () => {
    const srv = createFakeServer();
    render(<LearningPanel widgetId={42} transport={srv.transport} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Abandon session' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Abandon session' }));

    await waitFor(() => expect(screen.getByTestId('session-status')).toHaveTextContent('abandoned'));
    const env = srv.commands()[0];
    expect(env).toMatchObject({ command: 'abandon_session', expected_version: 0, payload: {} });
    expect(env.request_id).toBeTruthy();
    expect(screen.getByText('— session abandoned —')).toBeInTheDocument();
    expect(screen.getByLabelText('Your message')).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Start new attempt' }));
    await waitFor(() => expect(screen.getByTestId('session-status')).toHaveTextContent('session #8 · active · v0'));
  });

  it('two tabs, one expected_version: the loser gets stale, re-reads state and does NOT resend', async () => {
    const srv = createFakeServer({ evaluate: () => okEval('ask_time') });
    const a = render(<LearningPanel widgetId={42} transport={srv.transport} />);
    const b = render(<LearningPanel widgetId={42} transport={srv.transport} />);
    const [rootA, rootB] = [a.container, b.container];

    await waitFor(() => expect(within(rootA).getByTestId('session-status')).toHaveTextContent('v0'));
    await waitFor(() => expect(within(rootB).getByTestId('session-status')).toHaveTextContent('v0'));

    // Tab A wins the race: version 0 → 1.
    await sayAs(rootA, 'nora', 'when is Dr. Reed free?');
    await waitFor(() => expect(within(rootA).getByTestId('session-status')).toHaveTextContent('v1'));

    // Tab B still believes v0 and sends with expected_version 0.
    await sayAs(rootB, 'nora', 'what day is she available?');
    const stale = await within(rootB).findByTestId('notice-stale');
    expect(stale).toHaveTextContent(/changed in another tab/);

    // B re-read the state (sees A's turn and v1) and did not resend.
    await waitFor(() => expect(within(rootB).getByTestId('session-status')).toHaveTextContent('v1'));
    expect(within(rootB).getByTestId('turn-100')).toBeInTheDocument();
    expect(within(rootB).getByLabelText('Your message')).toHaveValue('what day is she available?');

    const sent = srv.says();
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ expected_version: 0, payload: { text: 'when is Dr. Reed free?' } });
    expect(sent[1]).toMatchObject({ expected_version: 0, payload: { text: 'what day is she available?' } });
    expect(srv.state.turns).toHaveLength(1);
    expect(srv.state.session.state_version).toBe(1);
  });

  it('server `stale` result (HTTP 409 success envelope) reloads state and keeps the text', async () => {
    const srv = createFakeServer();
    const transport: Neo16Transport = {
      ...srv.transport,
      sendCommand: vi.fn(async () => ({ status: 409, body: { status: 'stale' as const, turn: { id: 55, processing_status: 'applied' as const } } })),
    };
    render(<LearningPanel widgetId={42} transport={transport} />);
    await sayAs(document.body, 'nora', 'hello?');
    await screen.findByTestId('notice-stale');
    expect(transport.sendCommand).toHaveBeenCalledTimes(1);
    expect(srv.log.filter((l) => l.kind === 'state')).toHaveLength(1);
    expect(screen.getByLabelText('Your message')).toHaveValue('hello?');
  });
});
