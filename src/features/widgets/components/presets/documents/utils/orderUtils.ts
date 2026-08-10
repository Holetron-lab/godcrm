/**
 * Integer-safe `order` math for document items.
 *
 * Why: backend SQL sorts by `(data->>'order')::numeric`, but every fractional
 * insert (e.g. midpoint between two consecutive integers) used to crash the
 * whole document rendering pipeline. Keep all orders as integers, leave a
 * gap of `ORDER_GAP` between rows on insert, and renumber when the gap is
 * exhausted (idea from Geratron).
 */

export const ORDER_GAP = 10;

export interface OrderItem {
  id: number;
  order: number;
}

export type InsertPosition =
  | { kind: 'end' }
  | { kind: 'after'; afterId: number }
  | { kind: 'before'; beforeId: number };

interface ComputedOrder {
  order: number;
  needsRenumber: boolean;
}

function sortedByOrder<T extends OrderItem>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.order - b.order) || (a.id - b.id));
}

function midpoint(a: number, b: number): ComputedOrder {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const mid = Math.floor((lo + hi) / 2);
  // No integer strictly between lo and hi (gap of 0 or 1).
  if (mid <= lo || mid >= hi) {
    return { order: mid, needsRenumber: true };
  }
  return { order: mid, needsRenumber: false };
}

function orderAtEnd(items: OrderItem[]): ComputedOrder {
  if (!items.length) return { order: ORDER_GAP, needsRenumber: false };
  const max = Math.max(...items.map((i) => Math.floor(i.order)));
  return { order: max + ORDER_GAP, needsRenumber: false };
}

function orderAfter(items: OrderItem[], afterId: number): ComputedOrder {
  const idx = items.findIndex((i) => i.id === afterId);
  if (idx < 0) return orderAtEnd(items);
  const a = Math.floor(items[idx].order);
  const next = items[idx + 1];
  if (!next) return { order: a + ORDER_GAP, needsRenumber: false };
  return midpoint(a, Math.floor(next.order));
}

function orderBefore(items: OrderItem[], beforeId: number): ComputedOrder {
  const idx = items.findIndex((i) => i.id === beforeId);
  if (idx < 0) return orderAtEnd(items);
  const b = Math.floor(items[idx].order);
  const prev = items[idx - 1];
  if (!prev) {
    // Insert at top — half the gap below current first item.
    if (b <= 1) return { order: 0, needsRenumber: true };
    return { order: Math.max(0, Math.floor(b / 2)), needsRenumber: false };
  }
  return midpoint(Math.floor(prev.order), b);
}

function computeOrder(items: OrderItem[], position: InsertPosition): ComputedOrder {
  const sorted = sortedByOrder(items);
  switch (position.kind) {
    case 'end':
      return orderAtEnd(sorted);
    case 'after':
      return orderAfter(sorted, position.afterId);
    case 'before':
      return orderBefore(sorted, position.beforeId);
  }
}

/**
 * Reassign every item's `order` to `(idx+1) * ORDER_GAP` (sorted by current
 * order). Skips rows where the new value already matches.
 */
export async function renumberItems(
  items: OrderItem[],
  updateOrder: (id: number, order: number) => Promise<void>,
): Promise<OrderItem[]> {
  const sorted = sortedByOrder(items);
  const next: OrderItem[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    const newOrder = (i + 1) * ORDER_GAP;
    next.push({ ...item, order: newOrder });
    if (item.order !== newOrder) {
      await updateOrder(item.id, newOrder);
    }
  }
  return next;
}

/**
 * Compute an integer order for an insert. If the local gap is exhausted,
 * renumber all rows first, then recompute against the renumbered list.
 */
export async function resolveOrderForInsert(
  items: OrderItem[],
  position: InsertPosition,
  updateOrder: (id: number, order: number) => Promise<void>,
): Promise<number> {
  const first = computeOrder(items, position);
  if (!first.needsRenumber) return first.order;
  const renumbered = await renumberItems(items, updateOrder);
  return computeOrder(renumbered, position).order;
}
