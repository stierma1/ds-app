import {
  assertDefined,
  assertInteger,
  ContainerBase,
  ConsumedError,
  resolveComparator,
  UnsupportedError,
} from "../core/index.ts";
import type { Comparator, RangeOptions } from "../core/index.ts";
import { readAvlEntries, serializeAvlEntries } from "./serialization.ts";
import type { BalancedTree } from "./types.ts";

/**
 * Size ratio that a child subtree may not exceed relative to its sibling. A node is balanced
 * when its left and right sizes are both at most `DELTA` times the other, which is the
 * weight-balanced condition with `alpha = 1 / (DELTA + 1) = 1/4`.
 */
const DELTA = 3;

/** Rotation selection ratio: a single rotation is used when the outer subtree is large enough. */
const RATIO = 2;

/**
 * Weight-balanced node. `size` is the subtree node count and drives both the balance condition
 * and order statistics; `height` is cached in edges (a leaf has height 0) so `height` is O(1).
 * Parent links make in-order neighbor steps and the upward validation walk allocation-free.
 */
class WeightBalancedNode<K, V> {
  key: K;
  value: V;
  left: WeightBalancedNode<K, V> | null = null;
  right: WeightBalancedNode<K, V> | null = null;
  parent: WeightBalancedNode<K, V> | null = null;
  size = 1;
  height = 0;

  constructor(key: K, value: V) {
    this.key = key;
    this.value = value;
  }
}

/** O(1): height in edges, with the null tree at -1. */
function heightOf<K, V>(node: WeightBalancedNode<K, V> | null): number {
  return node === null ? -1 : node.height;
}

/** O(1): subtree node count, with the null tree at 0. */
function sizeOf<K, V>(node: WeightBalancedNode<K, V> | null): number {
  return node === null ? 0 : node.size;
}

/**
 * O(1): allocates a node with the given children, reparents them, and refreshes the cached size
 * and height. Rebalancing rebuilds the affected path with fresh nodes, so old nodes never need
 * in-place rotation bookkeeping.
 */
function makeNode<K, V>(
  key: K,
  value: V,
  left: WeightBalancedNode<K, V> | null,
  right: WeightBalancedNode<K, V> | null,
): WeightBalancedNode<K, V> {
  const node = new WeightBalancedNode(key, value);
  node.left = left;
  node.right = right;
  if (left !== null) {
    left.parent = node;
  }
  if (right !== null) {
    right.parent = node;
  }
  node.size = 1 + sizeOf(left) + sizeOf(right);
  node.height = 1 + Math.max(heightOf(left), heightOf(right));
  return node;
}

/**
 * O(1): rebuilds a node whose left subtree may be too large, or whose left child was modified.
 * The fast path returns the node unchanged; otherwise the Data.Map/BB[alpha] single or double
 * rotation is applied and the affected nodes are rebuilt. The caller guarantees `right` is
 * already balanced and the imbalance is bounded by one modification.
 */
function balanceLeft<K, V>(
  key: K,
  value: V,
  left: WeightBalancedNode<K, V> | null,
  right: WeightBalancedNode<K, V> | null,
): WeightBalancedNode<K, V> {
  const leftSize = sizeOf(left);
  const rightSize = sizeOf(right);
  if (left !== null && right !== null && leftSize <= DELTA * rightSize) {
    return makeNode(key, value, left, right);
  }
  if (right === null) {
    if (left === null) {
      return makeNode(key, value, null, null);
    }
    const leftLeft = left.left;
    const leftRight = left.right;
    if (leftLeft === null && leftRight === null) {
      return makeNode(key, value, left, null);
    }
    if (leftLeft === null) {
      const inner = leftRight as WeightBalancedNode<K, V>;
      return makeNode(
        inner.key,
        inner.value,
        makeNode(left.key, left.value, null, null),
        makeNode(key, value, null, null),
      );
    }
    if (leftRight === null) {
      return makeNode(left.key, left.value, leftLeft, makeNode(key, value, null, null));
    }
    const leftLeftSize = sizeOf(leftLeft);
    const leftRightSize = sizeOf(leftRight);
    if (leftRightSize < RATIO * leftLeftSize) {
      return makeNode(
        left.key,
        left.value,
        leftLeft,
        makeNode(key, value, leftRight, null),
      );
    }
    return makeNode(
      leftRight.key,
      leftRight.value,
      makeNode(left.key, left.value, leftLeft, leftRight.left),
      makeNode(key, value, leftRight.right, null),
    );
  }
  if (left === null) {
    return makeNode(key, value, null, right);
  }
  const leftLeft = left.left;
  const leftRight = left.right;
  if (leftLeft === null || leftRight === null) {
    return makeNode(key, value, left, right);
  }
  const leftLeftSize = sizeOf(leftLeft);
  const leftRightSize = sizeOf(leftRight);
  if (leftRightSize < RATIO * leftLeftSize) {
    return makeNode(
      left.key,
      left.value,
      leftLeft,
      makeNode(key, value, leftRight, right),
    );
  }
  return makeNode(
    leftRight.key,
    leftRight.value,
    makeNode(left.key, left.value, leftLeft, leftRight.left),
    makeNode(key, value, leftRight.right, right),
  );
}

/** O(1): mirror image of `balanceLeft` for a right subtree that may be too large. */
function balanceRight<K, V>(
  key: K,
  value: V,
  left: WeightBalancedNode<K, V> | null,
  right: WeightBalancedNode<K, V> | null,
): WeightBalancedNode<K, V> {
  const leftSize = sizeOf(left);
  const rightSize = sizeOf(right);
  if (left !== null && right !== null && rightSize <= DELTA * leftSize) {
    return makeNode(key, value, left, right);
  }
  if (left === null) {
    if (right === null) {
      return makeNode(key, value, null, null);
    }
    const rightLeft = right.left;
    const rightRight = right.right;
    if (rightLeft === null && rightRight === null) {
      return makeNode(key, value, null, right);
    }
    if (rightLeft === null) {
      const outer = rightRight as WeightBalancedNode<K, V>;
      return makeNode(
        right.key,
        right.value,
        makeNode(key, value, null, null),
        outer,
      );
    }
    if (rightRight === null) {
      return makeNode(
        rightLeft.key,
        rightLeft.value,
        makeNode(key, value, null, null),
        makeNode(right.key, right.value, null, null),
      );
    }
    const rightLeftSize = sizeOf(rightLeft);
    const rightRightSize = sizeOf(rightRight);
    if (rightLeftSize < RATIO * rightRightSize) {
      return makeNode(
        right.key,
        right.value,
        makeNode(key, value, null, rightLeft),
        rightRight,
      );
    }
    return makeNode(
      rightLeft.key,
      rightLeft.value,
      makeNode(key, value, null, rightLeft.left),
      makeNode(right.key, right.value, rightLeft.right, rightRight),
    );
  }
  if (right === null) {
    return makeNode(key, value, left, null);
  }
  const rightLeft = right.left;
  const rightRight = right.right;
  if (rightLeft === null || rightRight === null) {
    return makeNode(key, value, left, right);
  }
  const rightLeftSize = sizeOf(rightLeft);
  const rightRightSize = sizeOf(rightRight);
  if (rightLeftSize < RATIO * rightRightSize) {
    return makeNode(
      right.key,
      right.value,
      makeNode(key, value, left, rightLeft),
      rightRight,
    );
  }
  return makeNode(
    rightLeft.key,
    rightLeft.value,
    makeNode(key, value, left, rightLeft.left),
    makeNode(right.key, right.value, rightLeft.right, rightRight),
  );
}

/** O(log n): inserts a key or replaces the value of a comparator-equal key. */
function insertNode<K, V>(
  node: WeightBalancedNode<K, V> | null,
  key: K,
  value: V,
  compare: Comparator<K>,
  status: { inserted: boolean },
): WeightBalancedNode<K, V> {
  if (node === null) {
    status.inserted = true;
    return makeNode(key, value, null, null);
  }
  const comparison = compare(key, node.key);
  if (comparison === 0) {
    node.value = value;
    return node;
  }
  if (comparison < 0) {
    return balanceLeft(
      node.key,
      node.value,
      insertNode(node.left, key, value, compare, status),
      node.right,
    );
  }
  return balanceRight(
    node.key,
    node.value,
    node.left,
    insertNode(node.right, key, value, compare, status),
  );
}

/** O(log n): removes the minimum entry of a detached subtree and returns it with the remainder. */
function deleteMinNode<K, V>(
  node: WeightBalancedNode<K, V>,
): [K, V, WeightBalancedNode<K, V> | null] {
  if (node.left === null) {
    return [node.key, node.value, node.right];
  }
  const [key, value, left] = deleteMinNode(node.left);
  return [key, value, balanceRight(node.key, node.value, left, node.right)];
}

/** O(log n): removes the maximum entry of a detached subtree and returns it with the remainder. */
function deleteMaxNode<K, V>(
  node: WeightBalancedNode<K, V>,
): [K, V, WeightBalancedNode<K, V> | null] {
  if (node.right === null) {
    return [node.key, node.value, node.left];
  }
  const [key, value, right] = deleteMaxNode(node.right);
  return [key, value, balanceLeft(node.key, node.value, node.left, right)];
}

/**
 * O(log n): joins two detached balanced subtrees after a node with a two-child deletion. Taking
 * an extreme from the larger side keeps the rebuilt root within the weight-balance bound, as in
 * the Data.Map glue operation.
 */
function glue<K, V>(
  left: WeightBalancedNode<K, V> | null,
  right: WeightBalancedNode<K, V> | null,
): WeightBalancedNode<K, V> | null {
  if (left === null) {
    if (right !== null) {
      right.parent = null;
    }
    return right;
  }
  if (right === null) {
    left.parent = null;
    return left;
  }
  if (sizeOf(left) > sizeOf(right)) {
    const [key, value, remaining] = deleteMaxNode(left);
    return makeNode(key, value, remaining, right);
  }
  const [key, value, remaining] = deleteMinNode(right);
  return makeNode(key, value, left, remaining);
}

/** O(log n): removes a key and reports whether it was present. */
function deleteNode<K, V>(
  node: WeightBalancedNode<K, V> | null,
  key: K,
  compare: Comparator<K>,
  status: { deleted: boolean },
): WeightBalancedNode<K, V> | null {
  if (node === null) {
    return null;
  }
  const comparison = compare(key, node.key);
  if (comparison < 0) {
    return balanceRight(
      node.key,
      node.value,
      deleteNode(node.left, key, compare, status),
      node.right,
    );
  }
  if (comparison > 0) {
    return balanceLeft(
      node.key,
      node.value,
      node.left,
      deleteNode(node.right, key, compare, status),
    );
  }
  status.deleted = true;
  return glue(node.left, node.right);
}

/** O(log n): inserts the minimum key of a detached balanced tree through the left spine. */
function insertMinNode<K, V>(
  key: K,
  value: V,
  node: WeightBalancedNode<K, V> | null,
): WeightBalancedNode<K, V> {
  if (node === null) {
    return makeNode(key, value, null, null);
  }
  return balanceLeft(
    node.key,
    node.value,
    insertMinNode(key, value, node.left),
    node.right,
  );
}

/** O(log n): inserts the maximum key of a detached balanced tree through the right spine. */
function insertMaxNode<K, V>(
  key: K,
  value: V,
  node: WeightBalancedNode<K, V> | null,
): WeightBalancedNode<K, V> {
  if (node === null) {
    return makeNode(key, value, null, null);
  }
  return balanceRight(
    node.key,
    node.value,
    node.left,
    insertMaxNode(key, value, node.right),
  );
}

/** O(log n): descends the left tree's right spine while it is too large for the right tree. */
function linkLeft<K, V>(
  key: K,
  value: V,
  left: WeightBalancedNode<K, V> | null,
  rightSize: number,
  right: WeightBalancedNode<K, V> | null,
): WeightBalancedNode<K, V> {
  if (left === null) {
    return makeNode(key, value, null, right);
  }
  if (DELTA * rightSize < left.size) {
    return balanceRight(
      left.key,
      left.value,
      left.left,
      linkLeft(key, value, left.right, rightSize, right),
    );
  }
  return makeNode(key, value, left, right);
}

/** O(log n): descends the right tree's left spine while it is too large for the left tree. */
function linkRight<K, V>(
  key: K,
  value: V,
  leftSize: number,
  left: WeightBalancedNode<K, V> | null,
  right: WeightBalancedNode<K, V> | null,
): WeightBalancedNode<K, V> {
  if (right === null) {
    return makeNode(key, value, left, null);
  }
  if (DELTA * leftSize < right.size) {
    return balanceLeft(
      right.key,
      right.value,
      linkRight(key, value, leftSize, left, right.left),
      right.right,
    );
  }
  return makeNode(key, value, left, right);
}

/**
 * O(log n): joins two detached balanced trees around a separator whose key lies strictly between
 * their key ranges. Both inputs are already balanced; the recursion descends the heavier spine
 * and restores the weight-balance condition on the way back.
 */
function linkNode<K, V>(
  key: K,
  value: V,
  left: WeightBalancedNode<K, V> | null,
  right: WeightBalancedNode<K, V> | null,
): WeightBalancedNode<K, V> {
  if (left === null) {
    return insertMinNode(key, value, right);
  }
  if (right === null) {
    return insertMaxNode(key, value, left);
  }
  if (DELTA * left.size < right.size) {
    return balanceLeft(
      right.key,
      right.value,
      linkRight(key, value, left.size, left, right.left),
      right.right,
    );
  }
  if (DELTA * right.size < left.size) {
    return balanceRight(
      left.key,
      left.value,
      left.left,
      linkLeft(key, value, left.right, right.size, right),
    );
  }
  return makeNode(key, value, left, right);
}

/**
 * O(log n): splits a detached tree into keys `< key` and `>= key`. Each level rebuilds the path
 * node with one weight-based join, so the halves are balanced without reinserting either side.
 */
function splitRoots<K, V>(
  root: WeightBalancedNode<K, V> | null,
  key: K,
  compare: Comparator<K>,
): [
  WeightBalancedNode<K, V> | null,
  WeightBalancedNode<K, V> | null,
] {
  if (root === null) {
    return [null, null];
  }
  if (compare(root.key, key) < 0) {
    const [less, greater] = splitRoots(root.right, key, compare);
    return [
      linkNode(root.key, root.value, root.left, less),
      greater,
    ];
  }
  const [less, greater] = splitRoots(root.left, key, compare);
  return [
    less,
    linkNode(root.key, root.value, greater, root.right),
  ];
}

/**
 * O(n log n): inserts sorted entries median-first through the normal `set` path, which produces a
 * balanced tree while keeping every cache consistent. The explicit range stack avoids recursion.
 */
function insertBalanced<K, V>(
  tree: WeightBalancedTree<K, V>,
  entries: ReadonlyArray<readonly [K, V]>,
): void {
  const ranges: Array<[number, number]> = [];
  if (entries.length > 0) {
    ranges.push([0, entries.length - 1]);
  }
  while (ranges.length > 0) {
    const [low, high] = ranges.pop() as [number, number];
    if (low > high) {
      continue;
    }
    const middle = (low + high) >>> 1;
    const entry = entries[middle] as readonly [K, V];
    tree.set(entry[0], entry[1]);
    ranges.push([middle + 1, high]);
    ranges.push([low, middle - 1]);
  }
}

/**
 * Weight-balanced tree (BB[alpha] with `alpha = 1/4`): an ordered map with a worst-case
 * O(log n) height. Every node caches its subtree size and height, so `get`/`set`/`delete` are
 * O(log n), `height` is O(1), and the order-statistic `at`/`indexOf` pair is O(log n).
 * `min`/`max` walk a spine in O(log n); `range` is O(log n + k) because it materializes the k
 * reported entries before returning the snapshot iterator.
 *
 * The weight-balance condition bounds each child subtree to at most three times its sibling's
 * size, so every root-to-leaf step shrinks the subtree by at least a factor of 4/3. Updates
 * rebuild the affected path; `join` and `split` reuse untouched subtrees. Both are destructive:
 * `join` consumes both inputs and `split` consumes its receiver. Iteration is ascending by key
 * and follows the common snapshot/invalidation protocol.
 */
export class WeightBalancedTree<K, V = K>
  extends ContainerBase<[K, V]>
  implements BalancedTree<K, V>
{
  readonly compare: Comparator<K>;
  private _root: WeightBalancedNode<K, V> | null = null;
  private _consumed = false;

  /** O(1); `compare` defaults to the core natural-order comparator. */
  constructor(compare?: Comparator<K>) {
    super();
    this.compare = resolveComparator(compare);
  }

  /** O(1): height in edges; -1 for an empty tree and 0 for a single node. */
  get height(): number {
    this.assertLive();
    return this._root === null ? -1 : this._root.height;
  }

  /** O(1) after the live check: cached element count. */
  override get size(): number {
    this.assertLive();
    return this._size;
  }

  /** O(1) after the live check. */
  override isEmpty(): boolean {
    this.assertLive();
    return this._size === 0;
  }

  /**
   * O(log n): one descent to the key, replacing the value in place when it already exists, or
   * rebuilding the path to the root with a freshly linked leaf.
   */
  set(key: K, value: V): this {
    this.assertLive();
    assertDefined(key, "key");
    assertDefined(value, "value");
    const status = { inserted: false };
    this._root = insertNode(this._root, key, value, this.compare, status);
    if (status.inserted) {
      this._size++;
    }
    this.touch();
    return this;
  }

  /** O(log n): one descent; returns undefined when the key is absent. */
  get(key: K): V | undefined {
    this.assertLive();
    const node = this.findNode(key);
    return node === null ? undefined : node.value;
  }

  /** O(log n): one descent. */
  has(key: K): boolean {
    this.assertLive();
    return this.findNode(key) !== null;
  }

  /**
   * O(log n): a two-child node is replaced by the extreme entry of its larger subtree, whose
   * removal path is rebuilt, so every ancestor stays weight-balanced.
   */
  delete(key: K): boolean {
    this.assertLive();
    const status = { deleted: false };
    this._root = deleteNode(this._root, key, this.compare, status);
    if (!status.deleted) {
      return false;
    }
    if (this._root !== null) {
      this._root.parent = null;
    }
    this._size--;
    this.touch();
    return true;
  }

  /** O(log n): left-spine walk. */
  min(): [K, V] | undefined {
    this.assertLive();
    const node = this.minNodeInternal();
    return node === null ? undefined : [node.key, node.value];
  }

  /** O(log n): right-spine walk. */
  max(): [K, V] | undefined {
    this.assertLive();
    const node = this.maxNodeInternal();
    return node === null ? undefined : [node.key, node.value];
  }

  /** O(log n): largest entry strictly less than `key`; works for absent keys too. */
  predecessor(key: K): [K, V] | undefined {
    this.assertLive();
    let node = this._root;
    let best: WeightBalancedNode<K, V> | null = null;
    while (node !== null) {
      if (this.compare(node.key, key) < 0) {
        best = node;
        node = node.right;
      } else {
        node = node.left;
      }
    }
    return best === null ? undefined : [best.key, best.value];
  }

  /** O(log n): smallest entry strictly greater than `key`; works for absent keys too. */
  successor(key: K): [K, V] | undefined {
    this.assertLive();
    let node = this._root;
    let best: WeightBalancedNode<K, V> | null = null;
    while (node !== null) {
      if (this.compare(node.key, key) > 0) {
        best = node;
        node = node.left;
      } else {
        node = node.right;
      }
    }
    return best === null ? undefined : [best.key, best.value];
  }

  /** O(log n): select by rank through cached subtree sizes. Out-of-range indices return undefined. */
  at(index: number): [K, V] | undefined {
    this.assertLive();
    assertInteger(index);
    if (index < 0 || index >= this._size) {
      return undefined;
    }
    let node = this._root;
    let remaining = index;
    while (node !== null) {
      const leftSize = sizeOf(node.left);
      if (remaining < leftSize) {
        node = node.left;
      } else if (remaining === leftSize) {
        return [node.key, node.value];
      } else {
        remaining -= leftSize + 1;
        node = node.right;
      }
    }
    return undefined;
  }

  /** O(log n): rank query through cached subtree sizes; -1 when the key is absent. */
  indexOf(key: K): number {
    this.assertLive();
    let node = this._root;
    let rank = 0;
    while (node !== null) {
      const comparison = this.compare(key, node.key);
      if (comparison === 0) {
        return rank + sizeOf(node.left);
      }
      if (comparison < 0) {
        node = node.left;
      } else {
        rank += sizeOf(node.left) + 1;
        node = node.right;
      }
    }
    return -1;
  }

  /**
   * O(log n + k): descends to the lower bound, then takes k in-order successor steps and
   * materializes the entries before returning the snapshot iterator.
   */
  range(lo?: K, hi?: K, options?: RangeOptions<K>): IterableIterator<[K, V]> {
    this.assertLive();
    const loInclusive = options?.lo === undefined || options.lo === "inclusive";
    const hiInclusive = options?.hi === undefined || options.hi === "inclusive";
    if (options?.lo !== undefined && options.lo !== "inclusive" && options.lo !== "exclusive") {
      throw new TypeError("lo must be 'inclusive' or 'exclusive'");
    }
    if (options?.hi !== undefined && options.hi !== "inclusive" && options.hi !== "exclusive") {
      throw new TypeError("hi must be 'inclusive' or 'exclusive'");
    }
    const entries: Array<[K, V]> = [];
    if (lo !== undefined && hi !== undefined && this.compare(lo, hi) > 0) {
      return this.snapshotIterator(entries);
    }
    let node = lo === undefined ? this.minNodeInternal() : this.lowerBoundNode(lo, loInclusive);
    while (node !== null) {
      if (hi !== undefined) {
        const comparison = this.compare(node.key, hi);
        if (comparison > 0 || (comparison === 0 && !hiInclusive)) {
          break;
        }
      }
      entries.push([node.key, node.value]);
      node = this.successorNodeInternal(node);
    }
    return this.snapshotIterator(entries);
  }

  /** O(n): in-order snapshot of the keys. */
  keys(): IterableIterator<K> {
    return this.snapshotIterator(this.toArray().map((entry) => entry[0]));
  }

  /** O(n): in-order snapshot of the values. */
  values(): IterableIterator<V> {
    return this.snapshotIterator(this.toArray().map((entry) => entry[1]));
  }

  /** O(n): in-order snapshot iterator. */
  entries(): IterableIterator<[K, V]> {
    return this.snapshotIterator(this.toArray());
  }

  /** O(n): iterative in-order walk into one fresh array. */
  override toArray(): Array<[K, V]> {
    this.assertLive();
    const entries: Array<[K, V]> = [];
    const stack: Array<WeightBalancedNode<K, V>> = [];
    let node = this._root;
    while (node !== null || stack.length > 0) {
      while (node !== null) {
        stack.push(node);
        node = node.left;
      }
      const current = stack.pop() as WeightBalancedNode<K, V>;
      entries.push([current.key, current.value]);
      node = current.right;
    }
    return entries;
  }

  /** Same as entries(): materialized O(n) in-order snapshot. */
  override [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }

  /** O(1): drops the root and invalidates every live snapshot iterator. */
  override clear(): void {
    this.assertLive();
    this._root = null;
    this._size = 0;
    this.touch();
  }

  /** O(n): dumps the sorted entry list; deserialization rebuilds a balanced tree. */
  serialize(): string {
    this.assertLive();
    return serializeAvlEntries("WeightBalancedTree", this.toArray());
  }

  /** O(n log n): parses the entry list and inserts it median-first, producing a balanced tree. */
  static deserialize<K, V>(
    json: unknown,
    compare?: Comparator<K>,
  ): WeightBalancedTree<K, V> {
    const entries = readAvlEntries<K, V>(json, "WeightBalancedTree");
    const tree = new WeightBalancedTree<K, V>(compare);
    insertBalanced(tree, entries);
    return tree;
  }

  /**
   * O(log n): requires every key in this tree to be smaller than every key in `other`. Both inputs
   * are consumed; the returned tree owns the union and uses this tree's comparator.
   */
  join(other: BalancedTree<K, V>): WeightBalancedTree<K, V> {
    this.assertLive();
    if (!(other instanceof WeightBalancedTree)) {
      throw new UnsupportedError(
        "WeightBalancedTree can only join another WeightBalancedTree",
      );
    }
    other.assertLive();
    if (other === this) {
      throw new TypeError("cannot join a tree with itself");
    }
    if (this._root !== null && other._root !== null) {
      const leftMax = this.maximumNode(this._root);
      const rightMin = this.minimumNode(other._root);
      if (this.compare(leftMax.key, rightMin.key) >= 0) {
        throw new TypeError(
          "join requires every key in the receiver to be smaller than every key in other",
        );
      }
    }

    const totalSize = this._size + other._size;
    if (this._root === null) {
      const root = other._root;
      this.markConsumed();
      other.markConsumed();
      return WeightBalancedTree.fromParts(root, totalSize, this.compare);
    }
    if (other._root === null) {
      const root = this._root;
      this.markConsumed();
      other.markConsumed();
      return WeightBalancedTree.fromParts(root, totalSize, this.compare);
    }

    const maxNode = this.maximumNode(this._root);
    const status = { deleted: false };
    const leftRoot = deleteNode(this._root, maxNode.key, this.compare, status);
    const root = linkNode(maxNode.key, maxNode.value, leftRoot, other._root);
    this.markConsumed();
    other.markConsumed();
    return WeightBalancedTree.fromParts(root, totalSize, this.compare);
  }

  /**
   * O(log n): consumes the receiver and returns `[< key, >= key]` as fresh trees that share its
   * comparator and ownership of the original nodes.
   */
  split(key: K): [WeightBalancedTree<K, V>, WeightBalancedTree<K, V>] {
    this.assertLive();
    assertDefined(key, "key");
    const [leftRoot, rightRoot] = splitRoots(this._root, key, this.compare);
    const left = WeightBalancedTree.fromParts(
      leftRoot,
      sizeOf(leftRoot),
      this.compare,
    );
    const right = WeightBalancedTree.fromParts(
      rightRoot,
      sizeOf(rightRoot),
      this.compare,
    );
    this.markConsumed();
    return [left, right];
  }

  /**
   * O(n): iterative in-order validation of ordering, parent links, cached heights and sizes, and
   * the weight-balance condition (each non-null child is at most `DELTA` times its sibling).
   * Returns the first violation as a string.
   */
  override validate(): true | string {
    this.assertLive();
    if (this._root === null) {
      return this._size === 0 ? true : "non-empty size with empty root";
    }
    if (this._root.parent !== null) {
      return "root has a parent";
    }
    const stack: Array<WeightBalancedNode<K, V>> = [];
    const seen = new Set<WeightBalancedNode<K, V>>();
    let node: WeightBalancedNode<K, V> | null = this._root;
    let previous: WeightBalancedNode<K, V> | null = null;
    let count = 0;
    while (node !== null || stack.length > 0) {
      while (node !== null) {
        if (seen.has(node)) {
          return "cycle detected in left links";
        }
        seen.add(node);
        stack.push(node);
        node = node.left;
      }
      const current = stack.pop() as WeightBalancedNode<K, V>;
      count++;
      if (count > this._size) {
        return "tree contains more nodes than size";
      }
      if (current.key === undefined || current.value === undefined) {
        return `node at index ${count - 1} has an undefined key or value`;
      }
      if (current.left !== null && current.left.parent !== current) {
        return `left child of node at index ${count - 1} has an incorrect parent link`;
      }
      if (current.right !== null && current.right.parent !== current) {
        return `right child of node at index ${count - 1} has an incorrect parent link`;
      }
      const leftHeight = heightOf(current.left);
      const rightHeight = heightOf(current.right);
      if (current.height !== 1 + Math.max(leftHeight, rightHeight)) {
        return `node at index ${count - 1} has a stale height`;
      }
      const expectedSize = 1 + sizeOf(current.left) + sizeOf(current.right);
      if (current.size !== expectedSize) {
        return `node at index ${count - 1} has a stale subtree size`;
      }
      const leftSize = sizeOf(current.left);
      const rightSize = sizeOf(current.right);
      if (current.left === null || current.right === null) {
        if (Math.max(leftSize, rightSize) > 1) {
          return `node at index ${count - 1} violates the weight balance condition`;
        }
      } else if (leftSize > DELTA * rightSize || rightSize > DELTA * leftSize) {
        return `node at index ${count - 1} violates the weight balance condition`;
      }
      if (previous !== null && this.compare(previous.key, current.key) >= 0) {
        return "binary search tree ordering is violated";
      }
      previous = current;
      node = current.right;
    }
    if (count !== this._size) {
      return `size ${this._size} does not match node count ${count}`;
    }
    return true;
  }

  /** O(1): creates a tree that adopts `root`; used by join and split. */
  private static fromParts<K, V>(
    root: WeightBalancedNode<K, V> | null,
    size: number,
    compare: Comparator<K>,
  ): WeightBalancedTree<K, V> {
    const tree = new WeightBalancedTree<K, V>(compare);
    tree._root = root;
    tree._size = size;
    if (root !== null) {
      root.parent = null;
    }
    return tree;
  }

  /** O(1): rejects any use after join/split consumed this tree. */
  private assertLive(): void {
    if (this._consumed) {
      throw new ConsumedError();
    }
  }

  /** O(1): transfers ownership of every node and invalidates the receiver. */
  private markConsumed(): void {
    this._consumed = true;
    this._root = null;
    this._size = 0;
    this.touch();
  }

  /** O(log n): comparator descent returning the live node or null. */
  private findNode(key: K): WeightBalancedNode<K, V> | null {
    let node = this._root;
    while (node !== null) {
      const comparison = this.compare(key, node.key);
      if (comparison === 0) {
        return node;
      }
      node = comparison < 0 ? node.left : node.right;
    }
    return null;
  }

  /** O(log n): left-spine walk. */
  private minNodeInternal(): WeightBalancedNode<K, V> | null {
    return this._root === null ? null : this.minimumNode(this._root);
  }

  /** O(log n): right-spine walk. */
  private maxNodeInternal(): WeightBalancedNode<K, V> | null {
    return this._root === null ? null : this.maximumNode(this._root);
  }

  /** O(h): leftmost node of a subtree. */
  private minimumNode(node: WeightBalancedNode<K, V>): WeightBalancedNode<K, V> {
    let current = node;
    while (current.left !== null) {
      current = current.left;
    }
    return current;
  }

  /** O(h): rightmost node of a subtree. */
  private maximumNode(node: WeightBalancedNode<K, V>): WeightBalancedNode<K, V> {
    let current = node;
    while (current.right !== null) {
      current = current.right;
    }
    return current;
  }

  /** O(h) worst case; amortized O(1) across a full in-order sweep. */
  private successorNodeInternal(
    node: WeightBalancedNode<K, V>,
  ): WeightBalancedNode<K, V> | null {
    if (node.right !== null) {
      return this.minimumNode(node.right);
    }
    let current = node;
    let parent = current.parent;
    while (parent !== null && current === parent.right) {
      current = parent;
      parent = parent.parent;
    }
    return parent;
  }

  /** O(log n): first node whose key satisfies the lower bound. */
  private lowerBoundNode(
    key: K,
    inclusive: boolean,
  ): WeightBalancedNode<K, V> | null {
    let node = this._root;
    let best: WeightBalancedNode<K, V> | null = null;
    while (node !== null) {
      const comparison = this.compare(node.key, key);
      if (comparison > 0 || (inclusive && comparison === 0)) {
        best = node;
        node = node.left;
      } else {
        node = node.right;
      }
    }
    return best;
  }
}
