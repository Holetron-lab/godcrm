/**
 * Bubble-based pagination utility for chat messages.
 *
 * A "bubble" represents what the user sees in the UI:
 *  - 1 user message (role='user')  =  1 bubble
 *  - A contiguous sequence of assistant messages (thinking, tool_call,
 *    tool_result, text) between two user messages  =  1 bubble
 *  - Standalone assistant text  =  1 bubble
 *  - System messages (role='system')  =  don't count
 */

export const BUBBLE_PAGE_SIZE = 50;

/**
 * Count how many bubbles are in a message array.
 * Messages can be in any order (ASC or DESC) — the function normalises to ASC
 * internally so the grouping logic is consistent.
 *
 * @param {Array} messages - Array of message objects with at least a `role` field.
 * @returns {number} The number of visible bubbles.
 */
export function countBubbles(messages) {
  if (!messages || messages.length === 0) return 0;

  let bubbles = 0;
  let inAssistantGroup = false;

  for (const msg of messages) {
    const role = msg.role;

    // System messages are invisible — skip
    if (role === 'system') continue;

    if (role === 'user') {
      // If we were accumulating an assistant group, close it first
      if (inAssistantGroup) {
        inAssistantGroup = false;
      }
      bubbles += 1;
    } else {
      // assistant / tool_call / tool_result / thinking — all part of assistant group
      if (!inAssistantGroup) {
        bubbles += 1;
        inAssistantGroup = true;
      }
      // else: still inside the same assistant bubble, don't count again
    }
  }

  return bubbles;
}

/**
 * Count bubbles in a message array and return pagination info.
 *
 * @param {Array}  messages    - Raw messages from DB, ordered by created_at DESC, id DESC (newest first).
 * @param {number} bubbleLimit - How many bubbles to return (default 50).
 * @returns {{
 *   messages:    Array,
 *   hasMore:     boolean,
 *   nextCursor:  number|null,
 *   bubbleCount: number
 * }}
 */
export function paginateByBubbles(messages, bubbleLimit = BUBBLE_PAGE_SIZE) {
  if (!messages || messages.length === 0) {
    return { messages: [], hasMore: false, nextCursor: null, bubbleCount: 0 };
  }

  // Messages arrive DESC (newest first).
  // We walk from index 0 (newest) towards the end (oldest), collecting
  // bubbles until we reach bubbleLimit.

  let bubbleCount = 0;
  let inAssistantGroup = false;
  let cutoffIndex = messages.length; // will hold the exclusive end of collected messages

  for (let i = 0; i < messages.length; i++) {
    const role = messages[i].role;

    // System messages are invisible — always include but don't count
    if (role === 'system') continue;

    if (role === 'user') {
      // Close any open assistant group first
      if (inAssistantGroup) {
        inAssistantGroup = false;
      }

      // This user message is a new bubble
      if (bubbleCount >= bubbleLimit) {
        // We've already collected enough bubbles; stop here
        cutoffIndex = i;
        break;
      }
      bubbleCount += 1;
    } else {
      // assistant / tool / thinking
      if (!inAssistantGroup) {
        // Starting a new assistant group — that's a new bubble
        if (bubbleCount >= bubbleLimit) {
          cutoffIndex = i;
          break;
        }
        bubbleCount += 1;
        inAssistantGroup = true;
      }
      // If already in a group, it's still the same bubble
    }
  }

  const collected = messages.slice(0, cutoffIndex);
  const hasMore = cutoffIndex < messages.length;

  // Reverse to ASC for display (chronological order)
  collected.reverse();

  // nextCursor = ID of the oldest message we're returning (first after reverse)
  const nextCursor = hasMore && collected.length > 0 ? collected[0].id : null;

  return {
    messages: collected,
    hasMore,
    nextCursor,
    bubbleCount,
  };
}
