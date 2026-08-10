/**
 * ConversationLockService Tests
 *
 * Tests for per-conversation agent queue that prevents message interleaving:
 *   - Sequential execution within same conversation
 *   - Parallel execution across different conversations
 *   - Error in one task doesn't block subsequent tasks
 *   - Lock cleanup after all tasks complete
 */

import { describe, test, expect, beforeEach } from 'vitest';

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Import the class and create fresh instances per test
let lockService;

beforeEach(async () => {
  const mod = await import('../ConversationLockService.js');
  const singleton = mod.default;
  // Create a fresh instance using the same class
  lockService = new singleton.constructor();
});

describe('ConversationLockService', () => {
  test('sequential execution within same conversation', async () => {
    const order = [];

    const task1 = lockService.withLock(1, async () => {
      await delay(50);
      order.push('task1');
      return 'result1';
    });

    const task2 = lockService.withLock(1, async () => {
      order.push('task2');
      return 'result2';
    });

    const [r1, r2] = await Promise.all([task1, task2]);

    // task1 must finish before task2 starts (same conversation)
    expect(order).toEqual(['task1', 'task2']);
    expect(r1).toBe('result1');
    expect(r2).toBe('result2');
  });

  test('parallel execution across different conversations', async () => {
    const order = [];

    const task1 = lockService.withLock(1, async () => {
      await delay(50);
      order.push('conv1');
    });

    const task2 = lockService.withLock(2, async () => {
      // No delay — should run immediately since it's a different conversation
      order.push('conv2');
    });

    await Promise.all([task1, task2]);

    // conv2 should finish first since it runs in parallel with no delay
    expect(order).toEqual(['conv2', 'conv1']);
  });

  test('error in one task does not block subsequent tasks', async () => {
    const order = [];

    const task1 = lockService.withLock(1, async () => {
      order.push('task1');
      throw new Error('task1 failed');
    });

    const task2 = lockService.withLock(1, async () => {
      order.push('task2');
      return 'ok';
    });

    await expect(task1).rejects.toThrow('task1 failed');
    const r2 = await task2;

    expect(order).toEqual(['task1', 'task2']);
    expect(r2).toBe('ok');
  });

  test('lock cleanup after all tasks complete', async () => {
    await lockService.withLock(42, async () => {
      return 'done';
    });

    // Allow microtask for cleanup .then to run
    await delay(0);

    expect(lockService.locks.size).toBe(0);
  });
});
