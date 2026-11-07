import { assertDefined } from "../core/index.ts";
import { deserializeSets, serializeSets } from "./serialization.ts";

interface UnionNode<E> {
  parent: E;
  rank: number;
  size: number;
}

/**
 * Disjoint-set forest over arbitrary values, backed by a Map from value to {parent, rank, size}
 * with Object.is identity.
 *
 * find performs full two-pass path compression (every node on the walked path is re-pointed at the
 * root) and union links by rank, so find/union/connected/sizeOf run in O(alpha(n)) amortized,
 * effectively constant; a single uncompressed find is at most O(log n) thanks to the rank bound.
 * Each step is a Map lookup rather than an array index, so constants are higher than an
 * integer-indexed forest. Siblings: WeightedUnionFind drops compression (O(log n) worst case,
 * non-mutating find), QuickFind has O(1) find but O(n) union, QuickUnion has O(n) worst-case find.
 *
 * There is no element removal and no version tracking: values() is a live Map iterator, not a
 * snapshot, and find mutates parent pointers even though it is a query.
 */
export class UnionFind<E> {
  private _nodes = new Map<E, UnionNode<E>>();
  private _setCount = 0;

  /** O(1). */
  get setCount(): number {
    return this._setCount;
  }

  /** O(1). */
  get size(): number {
    return this._nodes.size;
  }

  /** O(1) expected (one Map insert); no-op when the value is already present. */
  makeSet(value: E): void {
    assertDefined(value, "value");
    if (this._nodes.has(value)) {
      return;
    }
    this._nodes.set(value, { parent: value, rank: 0, size: 1 });
    this._setCount++;
  }

  /**
   * O(alpha(n)) amortized, O(log n) worst case for a single call. Two passes: walk to the root,
   * then re-point every node on the path at it (full compression). Throws RangeError for unknown
   * values.
   */
  find(value: E): E {
    const node = this._nodes.get(value);
    if (node === undefined) {
      throw new RangeError("value is not present in the forest");
    }
    let root = value;
    while (!this.same(root, this._nodes.get(root)!.parent)) {
      root = this._nodes.get(root)!.parent;
    }
    let current = value;
    while (!this.same(current, root)) {
      const next = this._nodes.get(current)!.parent;
      this._nodes.get(current)!.parent = root;
      current = next;
    }
    return root;
  }

  /**
   * O(alpha(n)) amortized: two finds plus an O(1) relink. Union by rank: the lower-rank root hangs
   * under the higher; on a tie `a`'s root wins and its rank grows. Returns false when already
   * joined.
   */
  union(a: E, b: E): boolean {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (this.same(rootA, rootB)) {
      return false;
    }
    const nodeA = this._nodes.get(rootA)!;
    const nodeB = this._nodes.get(rootB)!;
    let newRoot: E;
    let child: E;
    if (nodeA.rank < nodeB.rank) {
      newRoot = rootB;
      child = rootA;
    } else if (nodeA.rank > nodeB.rank) {
      newRoot = rootA;
      child = rootB;
    } else {
      newRoot = rootA;
      child = rootB;
      nodeA.rank++;
    }
    const rootNode = this._nodes.get(newRoot)!;
    const childNode = this._nodes.get(child)!;
    childNode.parent = newRoot;
    rootNode.size += childNode.size;
    this._setCount--;
    return true;
  }

  /** O(alpha(n)) amortized: two finds. */
  connected(a: E, b: E): boolean {
    return this.same(this.find(a), this.find(b));
  }

  /**
   * O(alpha(n)) amortized: one find plus a Map lookup; sizes are maintained at roots, never
   * recounted.
   */
  sizeOf(value: E): number {
    return this._nodes.get(this.find(value))!.size;
  }

  /** O(1): live iterator over the Map's keys in insertion order; not a snapshot. */
  values(): IterableIterator<E> {
    return this._nodes.keys();
  }

  /**
   * O(n alpha(n)): one find per element (fully compressing every path as a side effect) plus fresh
   * arrays for every group.
   */
  groups(): E[][] {
    const groups = new Map<E, E[]>();
    for (const value of this._nodes.keys()) {
      const root = this.find(value);
      const group = groups.get(root);
      if (group === undefined) {
        groups.set(root, [value]);
      } else {
        group.push(value);
      }
    }
    return [...groups.values()];
  }

  /** O(n): Map.clear. */
  clear(): void {
    this._nodes.clear();
    this._setCount = 0;
  }

  /**
   * O(n log n): walks every parent chain without compressing and checks the rank and size
   * invariants.
   */
  validate(): true | string {
    for (const [value, node] of this._nodes) {
      if (value === undefined) {
        return "forest contains an undefined value";
      }
      if (!this._nodes.has(node.parent)) {
        return `parent of a value is missing from the forest`;
      }
      if (!Number.isInteger(node.rank) || node.rank < 0) {
        return "rank must be a non-negative integer";
      }
      if (!Number.isInteger(node.size) || node.size < 1) {
        return "set size must be a positive integer";
      }
    }
    const rootCount = new Map<E, number>();
    for (const value of this._nodes.keys()) {
      let current = value;
      let steps = 0;
      while (!this.same(current, this._nodes.get(current)!.parent)) {
        if (steps > this._nodes.size) {
          return "cycle detected in parent pointers";
        }
        const parent = this._nodes.get(current)!.parent;
        const childRank = this._nodes.get(current)!.rank;
        const parentRank = this._nodes.get(parent)!.rank;
        if (parentRank <= childRank) {
          return "union-by-rank invariant is violated";
        }
        current = parent;
        steps++;
      }
      const root = current;
      rootCount.set(root, (rootCount.get(root) ?? 0) + 1);
    }
    let roots = 0;
    for (const [root, count] of rootCount) {
      roots++;
      if (this._nodes.get(root)!.size !== count) {
        return "set size does not match member count";
      }
    }
    if (roots !== this._setCount) {
      return `setCount ${this._setCount} does not match root count ${roots}`;
    }
    return true;
  }

  /** O(n alpha(n)): serializes the output of groups(). */
  serialize(): string {
    return serializeSets("UnionFind", this.groups());
  }

  /** O(n alpha(n)): rebuilds through makeSet and union, then validates. */
  static deserialize<E>(json: unknown): UnionFind<E> {
    const groups = deserializeSets(json, "UnionFind");
    const forest = new UnionFind<E>();
    for (const group of groups) {
      for (const value of group) {
        forest.makeSet(value as E);
      }
      if (group.length > 0) {
        const first = group[0] as E;
        for (let index = 1; index < group.length; index++) {
          forest.union(first, group[index] as E);
        }
      }
    }
    if (forest.validate() !== true) {
      throw new TypeError(`Invalid UnionFind payload: ${forest.validate()}`);
    }
    return forest;
  }

  private same(a: E, b: E): boolean {
    return Object.is(a, b);
  }
}
