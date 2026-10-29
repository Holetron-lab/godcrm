// Bugs 1552/228710 — hidden steps of agent B between two visible messages
// were folded into the same step group as agent A's steps, so B's work
// "disappeared" into A's bubble counter. buildStepGroups must open a new
// group whenever the agent changes, not only when thinking/tools alternates.

import { describe, it, expect } from 'vitest';
import { buildStepGroups } from '../stepGroups.js';

const step = (id, content_type, agent = {}) => ({ id, content_type, preview: null, ...agent });
const A = { agent_id: 1, agent_name: 'Architect' };
const B = { agent_id: 2, agent_name: 'Frontend QA' };

describe('buildStepGroups', () => {
  it('returns [] for no steps', () => {
    expect(buildStepGroups([])).toEqual([]);
  });

  it('single agent: groups alternate by thinking/tools only (pre-fix behaviour kept)', () => {
    const groups = buildStepGroups([
      step(1, 'thinking', A), step(2, 'tool_call', A), step(3, 'tool_result', A), step(4, 'thinking', A),
    ]);
    expect(groups.map(g => [g.type, g.count])).toEqual([['thinking', 1], ['tools', 2], ['thinking', 1]]);
    expect(groups[1]).toMatchObject({ first_id: 2, last_id: 3, agent_id: 1, agent_name: 'Architect' });
  });

  it('splits a run of same-type steps when the agent changes', () => {
    const groups = buildStepGroups([
      step(10, 'tool_call', A), step(11, 'tool_result', A),
      step(12, 'tool_call', B), step(13, 'tool_result', B), step(14, 'tool_call', B),
      step(15, 'tool_call', A),
    ]);
    expect(groups.map(g => [g.type, g.count, g.agent_name])).toEqual([
      ['tools', 2, 'Architect'], ['tools', 3, 'Frontend QA'], ['tools', 1, 'Architect'],
    ]);
  });

  it('keys on agent_id first; falls back to agent_name when agent_id is missing', () => {
    const groups = buildStepGroups([
      step(1, 'thinking', { agent_id: null, agent_name: 'X' }),
      step(2, 'thinking', { agent_id: null, agent_name: 'Y' }),
      step(3, 'thinking', { agent_id: 7, agent_name: 'Y' }),
      step(4, 'thinking', { agent_id: 7, agent_name: 'Y renamed' }),
    ]);
    expect(groups.map(g => g.count)).toEqual([1, 1, 2]);
  });

  it('concatenates thinking previews within a group, first three only', () => {
    const groups = buildStepGroups([
      { id: 1, content_type: 'thinking', preview: 'a', ...A },
      { id: 2, content_type: 'thinking', preview: 'b', ...A },
      { id: 3, content_type: 'thinking', preview: 'c', ...A },
      { id: 4, content_type: 'thinking', preview: 'd', ...A },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].preview).toBe('a\nb\nc');
  });

  it('carries first_at / last_at from the first and last step of each group', () => {
    const groups = buildStepGroups([
      { ...step(1, 'thinking', A), created_at: '2026-09-10T15:51:25.000Z' },
      { ...step(2, 'tool_call', A), created_at: '2026-09-10T15:52:00.000Z' },
      { ...step(3, 'tool_result', A), created_at: '2026-09-10T15:54:10.000Z' },
    ]);
    expect(groups.map(g => [g.first_at, g.last_at])).toEqual([
      ['2026-09-10T15:51:25.000Z', '2026-09-10T15:51:25.000Z'],
      ['2026-09-10T15:52:00.000Z', '2026-09-10T15:54:10.000Z'],
    ]);
  });

  it('omits first_at / last_at when steps carry no created_at', () => {
    const [group] = buildStepGroups([step(1, 'thinking', A)]);
    expect(group).not.toHaveProperty('first_at');
    expect(group).not.toHaveProperty('last_at');
  });
});
