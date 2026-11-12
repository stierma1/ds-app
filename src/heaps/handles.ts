/**
 * Opaque reference to one element of a PairingHeap or FibonacciHeap, returned by `push`. It stays
 * valid while the element is in the heap, including after its heap is melded into another heap of
 * the same class (it then refers to the receiving heap). It is not serialized.
 */
export interface HeapHandle<T> {
  /** The element's current value. */
  readonly value: T;
}

/** Brand carried by every PairingHeap/FibonacciHeap node, so a handle is never mistaken for a value. */
export const handleBrand: unique symbol = Symbol("ds-app.heapHandle");

/** O(1): true for a handle of any heap class in this module. */
export function isHeapHandle(value: unknown): boolean {
  return typeof value === "object" && value !== null && handleBrand in value;
}

/**
 * Ownership token of a meldable heap. Melding unions the two tokens (union by rank, path
 * compression), so resolving a handle's heap is O(α(n)) amortized, effectively O(1). `clear` and
 * `build` retire a heap's token (`dead`) and issue a new one, which makes every earlier handle stale.
 */
export interface HeapOwner {
  parent: HeapOwner | null;
  rank: number;
  dead: boolean;
}

export function createOwner(): HeapOwner {
  return { parent: null, rank: 0, dead: false };
}

/** O(α(n)) amortized: the root token, compressing the path behind it. */
export function findOwner(owner: HeapOwner): HeapOwner {
  let root = owner;
  while (root.parent !== null) {
    root = root.parent;
  }
  let current = owner;
  while (current.parent !== null && current.parent !== root) {
    const next: HeapOwner = current.parent;
    current.parent = root;
    current = next;
  }
  return root;
}

/** O(1): links two root tokens by rank and returns the surviving root. */
export function unionOwners(a: HeapOwner, b: HeapOwner): HeapOwner {
  if (a === b) {
    return a;
  }
  if (a.rank < b.rank) {
    a.parent = b;
    return b;
  }
  b.parent = a;
  if (a.rank === b.rank) {
    a.rank++;
  }
  return a;
}

/** Fields a node needs to sit on a heap's push-order list. */
export interface PushOrdered<N> {
  pushedBefore: N | null;
  pushedAfter: N | null;
}

/**
 * Doubly linked list of a heap's nodes in push order (older first). Append, unlink, and concat
 * are O(1); it lets the value index be built lazily in O(n) with the "most recently pushed" order.
 */
export class PushOrder<N extends PushOrdered<N>> {
  first: N | null = null;
  last: N | null = null;

  append(node: N): void {
    node.pushedAfter = null;
    node.pushedBefore = this.last;
    if (this.last === null) {
      this.first = node;
    } else {
      this.last.pushedAfter = node;
    }
    this.last = node;
  }

  unlink(node: N): void {
    if (node.pushedBefore === null) {
      this.first = node.pushedAfter;
    } else {
      node.pushedBefore.pushedAfter = node.pushedAfter;
    }
    if (node.pushedAfter === null) {
      this.last = node.pushedBefore;
    } else {
      node.pushedAfter.pushedBefore = node.pushedBefore;
    }
    node.pushedBefore = null;
    node.pushedAfter = null;
  }

  /** O(1): appends every node of `other` (they rank as more recently pushed) and empties it. */
  concat(other: PushOrder<N>): void {
    if (other.first === null) {
      return;
    }
    if (this.last === null) {
      this.first = other.first;
    } else {
      this.last.pushedAfter = other.first;
      other.first.pushedBefore = this.last;
    }
    this.last = other.last;
    other.first = null;
    other.last = null;
  }

  /** O(n): checks the links and returns the node count, or a problem string. */
  check(): number | string {
    let count = 0;
    let previous: N | null = null;
    for (let node = this.first; node !== null; node = node.pushedAfter) {
      if (node.pushedBefore !== previous) {
        return "push-order back-link is inconsistent";
      }
      previous = node;
      count++;
    }
    return previous === this.last ? count : "push-order tail is inconsistent";
  }
}
