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
 * AVL node. `height` is measured in edges, so a leaf has height 0 and the null child has height
 * -1; `size` is the subtree node count and drives select/rank. Parent links make in-order neighbor
 * steps and the upward rebalance walk allocation-free.
 */
class AVLNode<K, V> {
  key: K;
  value: V;
  left: AVLNode<K, V> | null = null;
  right: AVLNode<K, V> | null = null;
  parent: AVLNode<K, V> | null;
  height = 0;
  size = 1;

  constructor(key: K, value: V, parent: AVLNode<K, V> | null) {
    this.key = key;
    this.value = value;
    this.parent = parent;
  }
}

/** Mutable holder that lets the rotation/rebalance helpers replace the subtree root. */
interface RootState<K, V> {
  root: AVLNode<K, V> | null;
}

/** O(1): height in edges, with the null tree at -1. */
function heightOf<K, V>(node: AVLNode<K, V> | null): number {
  return node === null ? -1 : node.height;
}

/** O(1): subtree node count, with the null tree at 0. */
function sizeOf<K, V>(node: AVLNode<K, V> | null): number {
  return node === null ? 0 : node.size;
}

/** O(1): recomputes the cached height and subtree size from the children. */
function updateNode<K, V>(node: AVLNode<K, V>): void {
  node.height = 1 + Math.max(heightOf(node.left), heightOf(node.right));
  node.size = 1 + sizeOf(node.left) + sizeOf(node.right);
}

/** O(1): right height minus left height; an AVL tree keeps this in [-1, 1]. */
function balanceFactor<K, V>(node: AVLNode<K, V>): number {
  return heightOf(node.right) - heightOf(node.left);
}

/** O(1): promotes `x.right`, fixing parent links and the tracked subtree root. */
function rotateLeft<K, V>(
  state: RootState<K, V>,
  x: AVLNode<K, V>,
): AVLNode<K, V> {
  const y = x.right as AVLNode<K, V>;
  x.right = y.left;
  if (y.left !== null) {
    y.left.parent = x;
  }
  y.parent = x.parent;
  if (x.parent === null) {
    state.root = y;
  } else if (x === x.parent.left) {
    x.parent.left = y;
  } else {
    x.parent.right = y;
  }
  y.left = x;
  x.parent = y;
  updateNode(x);
  updateNode(y);
  return y;
}

/** O(1): promotes `x.left`, fixing parent links and the tracked subtree root. */
function rotateRight<K, V>(
  state: RootState<K, V>,
  x: AVLNode<K, V>,
): AVLNode<K, V> {
  const y = x.left as AVLNode<K, V>;
  x.left = y.right;
  if (y.right !== null) {
    y.right.parent = x;
  }
  y.parent = x.parent;
  if (x.parent === null) {
    state.root = y;
  } else if (x === x.parent.left) {
    x.parent.left = y;
  } else {
    x.parent.right = y;
  }
  y.right = x;
  x.parent = y;
  updateNode(x);
  updateNode(y);
  return y;
}

/**
 * O(1): restores the height/size caches and applies at most one single or double rotation. The
 * node is the root of the affected subtree, whose children are already valid AVL trees, so the
 * balance factor is at most +/-2.
 */
function rebalanceNode<K, V>(
  state: RootState<K, V>,
  node: AVLNode<K, V>,
): AVLNode<K, V> {
  updateNode(node);
  if (balanceFactor(node) > 1) {
    const right = node.right as AVLNode<K, V>;
    if (balanceFactor(right) < 0) {
      rotateRight(state, right);
    }
    return rotateLeft(state, node);
  }
  if (balanceFactor(node) < -1) {
    const left = node.left as AVLNode<K, V>;
    if (balanceFactor(left) > 0) {
      rotateLeft(state, left);
    }
    return rotateRight(state, node);
  }
  return node;
}

/**
 * O(log n): climbs from `start` to the root, refreshing caches and rebalancing. Insert stops
 * rotating after the first repair, but the walk still refreshes every ancestor's size; delete can
 * cascade rotations all the way up.
 */
function rebalanceFrom<K, V>(
  state: RootState<K, V>,
  start: AVLNode<K, V> | null,
): void {
  let current = start;
  while (current !== null) {
    const root = rebalanceNode(state, current);
    if (root.parent === null) {
      state.root = root;
    }
    current = root.parent;
  }
}

/**
 * O(log n): joins two detached AVL subtrees around the single-node `separator`. Recurses down the
 * taller spine and repairs each ancestor on the way back, leaving `separator` with the two inputs
 * as its children when the heights differ by at most one.
 */
function joinNode<K, V>(
  separator: AVLNode<K, V>,
  left: AVLNode<K, V> | null,
  right: AVLNode<K, V> | null,
): AVLNode<K, V> {
  const leftHeight = heightOf(left);
  const rightHeight = heightOf(right);
  if (leftHeight > rightHeight + 1) {
    const root = left as AVLNode<K, V>;
    const rootRight = root.right;
    root.right = null;
    if (rootRight !== null) {
      rootRight.parent = null;
    }
    root.parent = null;
    const joined = joinNode(separator, rootRight, right);
    root.right = joined;
    joined.parent = root;
    const state: RootState<K, V> = { root };
    rebalanceNode(state, root);
    return state.root as AVLNode<K, V>;
  }
  if (rightHeight > leftHeight + 1) {
    const root = right as AVLNode<K, V>;
    const rootLeft = root.left;
    root.left = null;
    if (rootLeft !== null) {
      rootLeft.parent = null;
    }
    root.parent = null;
    const joined = joinNode(separator, left, rootLeft);
    root.left = joined;
    joined.parent = root;
    const state: RootState<K, V> = { root };
    rebalanceNode(state, root);
    return state.root as AVLNode<K, V>;
  }
  separator.left = left;
  if (left !== null) {
    left.parent = separator;
  }
  separator.right = right;
  if (right !== null) {
    right.parent = separator;
  }
  separator.parent = null;
  updateNode(separator);
  return separator;
}

/**
 * O(log n): removes and returns the maximum node of a detached subtree, rebalancing the remaining
 * tree. The returned node is a single isolated node suitable as a `joinNode` separator.
 */
function extractMax<K, V>(state: RootState<K, V>): AVLNode<K, V> {
  let max = state.root as AVLNode<K, V>;
  while (max.right !== null) {
    max = max.right;
  }
  const parent = max.parent;
  const left = max.left;
  if (parent === null) {
    state.root = left;
    if (left !== null) {
      left.parent = null;
    }
  } else {
    parent.right = left;
    if (left !== null) {
      left.parent = parent;
    }
  }
  max.left = null;
  max.right = null;
  max.parent = null;
  if (parent !== null) {
    rebalanceFrom(state, parent);
  }
  return max;
}

/**
 * O(log n): joins two detached trees whose key ranges do not overlap. The receiver's maximum is
 * removed and used as the separator, so the recursive join never has to synthesize a key.
 */
function joinRoots<K, V>(
  left: AVLNode<K, V> | null,
  right: AVLNode<K, V> | null,
): AVLNode<K, V> | null {
  if (left === null) {
    return right;
  }
  if (right === null) {
    return left;
  }
  const state: RootState<K, V> = { root: left };
  const separator = extractMax(state);
  return joinNode(separator, state.root, right);
}

/**
 * O(log n): splits a detached tree into keys `< key` and `>= key`. Each level rebuilds the path
 * node with one height-based join, so the result is balanced without reinserting either side.
 */
function splitRoots<K, V>(
  root: AVLNode<K, V> | null,
  key: K,
  compare: Comparator<K>,
): [AVLNode<K, V> | null, AVLNode<K, V> | null] {
  if (root === null) {
    return [null, null];
  }
  const left = root.left;
  const right = root.right;
  if (compare(root.key, key) < 0) {
    if (right !== null) {
      right.parent = null;
    }
    root.right = null;
    root.parent = null;
    const [less, greater] = splitRoots(right, key, compare);
    if (left !== null) {
      left.parent = null;
    }
    root.left = null;
    updateNode(root);
    return [joinNode(root, left, less), greater];
  }
  if (left !== null) {
    left.parent = null;
  }
  root.left = null;
  root.parent = null;
  const [less, greater] = splitRoots(left, key, compare);
  if (right !== null) {
    right.parent = null;
  }
  root.right = null;
  updateNode(root);
  return [less, joinNode(root, greater, right)];
}

/**
 * O(n log n): inserts sorted entries median-first through the normal `set` path, which produces a
 * balanced tree while keeping every cache consistent. The explicit range stack avoids recursion.
 */
function insertBalanced<K, V>(
  tree: AVLTree<K, V>,
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
 * AVL tree: an ordered map with a worst-case O(log n) height. Every node caches its height and
 * subtree size, so `get`/`set`/`delete` are O(log n), `height` is O(1), and the order-statistic
 * `at`/`indexOf` pair is O(log n). `min`/`max` walk a spine in O(log n); `range` is O(log n + k)
 * because it materializes the k reported entries before returning the snapshot iterator.
 *
 * `join` and `split` are destructive: `join` consumes both inputs and returns a fresh tree;
 * `split` consumes its receiver and returns two fresh trees. Iteration is ascending by key and
 * follows the common snapshot/invalidation protocol: a mutation after the iterator is created
 * makes the next step throw `ConcurrentModificationError`.
 */
export class AVLTree<K, V = K>
  extends ContainerBase<[K, V]>
  implements BalancedTree<K, V>
{
  readonly compare: Comparator<K>;
  private _root: AVLNode<K, V> | null = null;
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
   * linking a leaf and repairing the path to the root.
   */
  set(key: K, value: V): this {
    this.assertLive();
    assertDefined(key, "key");
    assertDefined(value, "value");
    const state: RootState<K, V> = { root: this._root };
    let parent: AVLNode<K, V> | null = null;
    let current = state.root;
    while (current !== null) {
      const comparison = this.compare(key, current.key);
      if (comparison === 0) {
        current.value = value;
        this.touch();
        return this;
      }
      parent = current;
      current = comparison < 0 ? current.left : current.right;
    }
    const node = new AVLNode(key, value, parent);
    if (parent === null) {
      state.root = node;
    } else if (this.compare(key, parent.key) < 0) {
      parent.left = node;
    } else {
      parent.right = node;
    }
    this._size++;
    rebalanceFrom(state, parent);
    this._root = state.root;
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
   * O(log n): a two-child node takes over its successor's entry, the successor (which has at most
   * one child) is unlinked, and the path from its parent is repaired.
   */
  delete(key: K): boolean {
    this.assertLive();
    const state: RootState<K, V> = { root: this._root };
    const found = this.findNode(key);
    if (found === null) {
      return false;
    }
    let start: AVLNode<K, V> | null;
    if (found.left !== null && found.right !== null) {
      const physical = this.minimumNode(found.right);
      found.key = physical.key;
      found.value = physical.value;
      start = this.unlink(state, physical);
    } else {
      start = this.unlink(state, found);
    }
    this._size--;
    rebalanceFrom(state, start);
    this._root = state.root;
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
    let best: AVLNode<K, V> | null = null;
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
    let best: AVLNode<K, V> | null = null;
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
    const stack: Array<AVLNode<K, V>> = [];
    let node = this._root;
    while (node !== null || stack.length > 0) {
      while (node !== null) {
        stack.push(node);
        node = node.left;
      }
      const current = stack.pop() as AVLNode<K, V>;
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
    return serializeAvlEntries("AVLTree", this.toArray());
  }

  /** O(n log n): parses the entry list and inserts it median-first, producing a balanced tree. */
  static deserialize<K, V>(
    json: unknown,
    compare?: Comparator<K>,
  ): AVLTree<K, V> {
    const entries = readAvlEntries<K, V>(json, "AVLTree");
    const tree = new AVLTree<K, V>(compare);
    insertBalanced(tree, entries);
    return tree;
  }

  /**
   * O(log n): requires every key in this tree to be smaller than every key in `other`. Both inputs
   * are consumed; the returned tree owns the union and uses this tree's comparator.
   */
  join(other: BalancedTree<K, V>): AVLTree<K, V> {
    this.assertLive();
    if (!(other instanceof AVLTree)) {
      throw new UnsupportedError("AVLTree can only join another AVLTree");
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
    const leftRoot = this._root;
    const rightRoot = other._root;
    const leftSize = this._size;
    const rightSize = other._size;
    const root = joinRoots(leftRoot, rightRoot);
    this.markConsumed();
    other.markConsumed();
    return AVLTree.fromParts(root, leftSize + rightSize, this.compare);
  }

  /**
   * O(log n): consumes the receiver and returns `[< key, >= key]` as fresh trees that share its
   * comparator and ownership of the original nodes.
   */
  split(key: K): [AVLTree<K, V>, AVLTree<K, V>] {
    this.assertLive();
    assertDefined(key, "key");
    const [leftRoot, rightRoot] = splitRoots(this._root, key, this.compare);
    const left = AVLTree.fromParts(leftRoot, sizeOf(leftRoot), this.compare);
    const right = AVLTree.fromParts(rightRoot, sizeOf(rightRoot), this.compare);
    this.markConsumed();
    return [left, right];
  }

  /**
   * O(n): iterative in-order validation of ordering, parent links, cached heights and sizes, and
   * the AVL balance condition. Returns the first violation as a string.
   */
  override validate(): true | string {
    this.assertLive();
    if (this._root === null) {
      return this._size === 0 ? true : "non-empty size with empty root";
    }
    if (this._root.parent !== null) {
      return "root has a parent";
    }
    const stack: Array<AVLNode<K, V>> = [];
    const seen = new Set<AVLNode<K, V>>();
    let node: AVLNode<K, V> | null = this._root;
    let previous: AVLNode<K, V> | null = null;
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
      const current = stack.pop() as AVLNode<K, V>;
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
      if (Math.abs(rightHeight - leftHeight) > 1) {
        return `node at index ${count - 1} violates the AVL balance condition`;
      }
      const expectedSize = 1 + sizeOf(current.left) + sizeOf(current.right);
      if (current.size !== expectedSize) {
        return `node at index ${count - 1} has a stale subtree size`;
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
    root: AVLNode<K, V> | null,
    size: number,
    compare: Comparator<K>,
  ): AVLTree<K, V> {
    const tree = new AVLTree<K, V>(compare);
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
  private findNode(key: K): AVLNode<K, V> | null {
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
  private minNodeInternal(): AVLNode<K, V> | null {
    return this._root === null ? null : this.minimumNode(this._root);
  }

  /** O(log n): right-spine walk. */
  private maxNodeInternal(): AVLNode<K, V> | null {
    return this._root === null ? null : this.maximumNode(this._root);
  }

  /** O(h): leftmost node of a subtree. */
  private minimumNode(node: AVLNode<K, V>): AVLNode<K, V> {
    let current = node;
    while (current.left !== null) {
      current = current.left;
    }
    return current;
  }

  /** O(h): rightmost node of a subtree. */
  private maximumNode(node: AVLNode<K, V>): AVLNode<K, V> {
    let current = node;
    while (current.right !== null) {
      current = current.right;
    }
    return current;
  }

  /** O(h) worst case; amortized O(1) across a full in-order sweep. */
  private successorNodeInternal(node: AVLNode<K, V>): AVLNode<K, V> | null {
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
  private lowerBoundNode(key: K, inclusive: boolean): AVLNode<K, V> | null {
    let node = this._root;
    let best: AVLNode<K, V> | null = null;
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

  /** O(log n): unlinks a node with at most one child and returns its former parent. */
  private unlink(
    state: RootState<K, V>,
    node: AVLNode<K, V>,
  ): AVLNode<K, V> | null {
    const child = node.left !== null ? node.left : node.right;
    const parent = node.parent;
    if (parent === null) {
      state.root = child;
    } else if (node === parent.left) {
      parent.left = child;
    } else {
      parent.right = child;
    }
    if (child !== null) {
      child.parent = parent;
    }
    node.left = null;
    node.right = null;
    node.parent = null;
    return parent;
  }
}
