/** A heap node that can be threaded onto a {@link ValueIndex} chain. */
export interface IndexedNode<T> {
  value: T;
  /** Previously indexed node holding the same value (SameValueZero), or null. */
  older: IndexedNode<T> | null;
  /** Later indexed node holding the same value, or null. */
  newer: IndexedNode<T> | null;
}

interface Chain<N> {
  oldest: N;
  newest: N;
}

function sameValueZero(a: unknown, b: unknown): boolean {
  return a === b || (a !== a && b !== b);
}

/**
 * Value-to-nodes index for decreaseKey(value, newValue) on heaps that allow duplicates. Each
 * distinct value (Map/SameValueZero identity) maps to an intrusive doubly linked chain of every
 * node currently holding it, oldest to newest, so add/remove/newest are O(1) and a node holding a
 * duplicate never loses its index entry when another node with that value leaves the heap.
 */
export class ValueIndex<T, N extends IndexedNode<T>> {
  private _chains = new Map<T, Chain<N>>();

  /** O(1): the most recently indexed node holding `value`. */
  newest(value: T): N | undefined {
    return this._chains.get(value)?.newest;
  }

  /** O(1): appends `node` as the newest holder of `node.value`. */
  add(node: N): void {
    node.newer = null;
    const chain = this._chains.get(node.value);
    if (chain === undefined) {
      node.older = null;
      this._chains.set(node.value, { oldest: node, newest: node });
      return;
    }
    node.older = chain.newest;
    chain.newest.newer = node;
    chain.newest = node;
  }

  /** O(1): unthreads `node`; it must currently be indexed under `node.value`. */
  remove(node: N): void {
    const chain = this._chains.get(node.value) as Chain<N>;
    const older = node.older as N | null;
    const newer = node.newer as N | null;
    if (older === null && newer === null) {
      this._chains.delete(node.value);
    } else {
      if (older === null) {
        chain.oldest = newer as N;
      } else {
        older.newer = newer;
      }
      if (newer === null) {
        chain.newest = older as N;
      } else {
        newer.older = older;
      }
    }
    node.older = null;
    node.newer = null;
  }

  /**
   * O(min(d1, d2)) for d distinct values: moves every chain of `other` into this index, with
   * `other`'s nodes ranked newer. The smaller map is folded into the larger one.
   */
  absorb(other: ValueIndex<T, N>): void {
    if (other === this) {
      return;
    }
    let base = this._chains;
    let incoming = other._chains;
    let incomingIsNewer = true;
    if (incoming.size > base.size) {
      [base, incoming] = [incoming, base];
      incomingIsNewer = false;
    }
    for (const [value, chain] of incoming) {
      const existing = base.get(value);
      if (existing === undefined) {
        base.set(value, chain);
        continue;
      }
      const older = incomingIsNewer ? existing : chain;
      const newer = incomingIsNewer ? chain : existing;
      older.newest.newer = newer.oldest;
      newer.oldest.older = older.newest;
      existing.oldest = older.oldest;
      existing.newest = newer.newest;
    }
    this._chains = base;
    other._chains = new Map();
  }

  /** O(1): drops every chain. */
  clear(): void {
    this._chains = new Map();
  }

  /**
   * O(n): checks that every chain is well linked, holds only nodes in `live` whose value matches
   * the key, and that the chains cover exactly `expected` nodes.
   */
  check(live: ReadonlySet<N>, expected: number): true | string {
    let count = 0;
    for (const [value, chain] of this._chains) {
      if (chain.oldest.older !== null || chain.newest.newer !== null) {
        return "index chain has dangling ends";
      }
      let previous: N | null = null;
      for (let node: N | null = chain.oldest; node !== null; node = node.newer as N | null) {
        if (node.older !== previous) {
          return "index chain back-link is inconsistent";
        }
        if (!live.has(node)) {
          return "index points to a node outside the heap";
        }
        if (!sameValueZero(node.value, value)) {
          return "index key does not match the node value";
        }
        count++;
        if (count > expected) {
          return "index holds more nodes than the heap";
        }
        previous = node;
      }
      if (previous !== chain.newest) {
        return "index chain tail is inconsistent";
      }
    }
    if (count !== expected) {
      return `index holds ${count} nodes, expected ${expected}`;
    }
    return true;
  }
}

/** O(n): a value index over the nodes of a push-order list (oldest first), so newest() is the last pushed. */
export function indexFromPushOrder<T, N extends IndexedNode<T> & { pushedAfter: N | null }>(pushed: {
  first: N | null;
}): ValueIndex<T, N> {
  const index = new ValueIndex<T, N>();
  for (let node = pushed.first; node !== null; node = node.pushedAfter) {
    index.add(node);
  }
  return index;
}
