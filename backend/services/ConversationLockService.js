/**
 * ConversationLockService - ensures agents execute sequentially per conversation
 * Prevents message interleaving when multiple agents respond simultaneously
 */
class ConversationLockService {
  constructor() {
    this.locks = new Map(); // conversationId -> Promise chain
  }

  /**
   * Execute a function with exclusive access to the conversation.
   * Multiple calls queue up and execute in order.
   * @param {number|string} conversationId
   * @param {function} fn - async function to execute under the lock
   * @returns {Promise} resolves with fn's return value
   */
  async withLock(conversationId, fn) {
    const key = String(conversationId);
    const previous = this.locks.get(key) || Promise.resolve();

    // Chain this execution after any pending one
    const current = previous.then(
      () => fn(),
      () => fn() // Execute even if previous failed
    );

    // Store the chain and clean up when it's the last in line
    const cleanup = current.then(
      () => { if (this.locks.get(key) === cleanup) this.locks.delete(key); },
      () => { if (this.locks.get(key) === cleanup) this.locks.delete(key); }
    );
    this.locks.set(key, cleanup);

    return current;
  }
}

export default new ConversationLockService();
