import { describe, expect, it } from 'vitest';
import { lockedAgentsForManagement } from '../agentVisibility';

const visible = [{ id: 1, is_active: true, visibility: 'default' }];
const all = [
  { id: 1, is_active: true, visibility: 'default' },
  { id: 2, is_active: true, visibility: 'locked' },
  { id: 3, is_active: false, visibility: 'locked' },
  { id: 4, is_active: true, visibility: 'unlocked' },
];

describe('lockedAgentsForManagement', () => {
  it('returns only active locked bindings that the invocation list already dropped', () => {
    expect(lockedAgentsForManagement(visible, all).map(a => a.id)).toEqual([2]);
  });

  it('never duplicates a locked agent the visible list already carries', () => {
    expect(lockedAgentsForManagement(all, all)).toEqual([]);
  });
});
