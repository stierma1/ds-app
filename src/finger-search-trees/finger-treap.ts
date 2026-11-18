import {
  assertDefined,
  assertInteger,
  ConcurrentModificationError,
  ConsumedError,
  ContainerBase,
  resolveComparator,
  resolveRandomSource,
  UnsupportedError,
} from "../core/index.ts";
import type {
  Comparator,
  RandomSource,
  RangeOptions,
} from "../core/index.ts";
import { FingerHandle } from "./finger.ts";
import {
  readFingerEntries,
  serializeFingerEntries,
} from "./serialization.ts";
import type {
  Finger,
  FingerSearchMap,
  FingerTreeOptions,
} from "./types.ts";

/**
 * Treap node: BST key, value, random priority, parent link, cached subtree size, and the extreme
 * keys of its subtree. The subtree extremes let a finger climb only until the target lies in an
 * ancestor's interval, which is what gives expected O(log d) search from a held position.
 */
class FingerNode<K, V> {
  key: K;
  value: V;
  priority: number;
  left: FingerNode<K, V> | null = null;
  right: FingerNode<K, V> | null = null;
  parent: FingerNode<K, V> | null = null;
  size = 1;
  minKey: K;
  maxKey: K;
  readonly fingers = new Set<FingerHandle<K>>();

  constructor(key: K, value: V, priority: number) {
    this.key = key;
    this.value = value;
    this.priority = priority;
    this.minKey = key;
    this.maxKey = key;
  }
}

/** O(1): subtree size with the empty tree at 0. */
function sizeOf<K, V>(node: FingerNode<K, V> | null): number {
  return node === null ? 0 : node.size;
}

/** O(1): refreshes the cached size and extreme keys from the children. */
function updateNode<K, V>(node: FingerNode<K, V>): void {
  node.size = 1 + sizeOf(node.left) + sizeOf(node.right);
  node.minKey = node.left === null ? node.key : node.left.minKey;
  node.maxKey = node.right === null ? node.key : node.right.maxKey;
}

/**
 * Treap with finger search: a randomized binary search tree with parent pointers, cached subtree
 * sizes, and cached subtree extremes. Ordinary operations are O(log n) expected; `findFrom` is
 * O(log d) expected, where d is the rank distance from the finger to the target.
 *
 * The tree is fully meldable in the expected sense: `join` and `splitAt` consume their inputs and
 * combine or partition the underlying treaps by priority. Priorities come from the constructor's
 * random source, so a seed makes a run reproducible.
 */
export class FingerTreap<K, V = K>
  extends ContainerBase<[K, V]>
  implements FingerSearchMap<K, V>
{
  readonly compare: Comparator<K>;
  readonly rng: RandomSource;
  private _root: FingerNode<K, V> | null = null;
  private _consumed = false;
  private readonly _fingers = new Set<FingerHandle<K>>();

  /** O(1); `compare` defaults to natural order and `rng` to a CSPRNG seed. */
  constructor(compare?: Comparator<K>, options?: FingerTreeOptions) {
    super();
    this.compare = resolveComparator(compare);
    this.rng = resolveRandomSource(options?.rng);
  }

  /** O(1) after the live check. */
  override get size(): number {
    this.assertLive();
    return this._size;
  }

  /** O(1) after the live check. */
  override isEmpty(): boolean {
    this.assertLive();
    return this._size === 0;
  }

  /** O(log n) expected: replaces a value or inserts a new key. */
  set(key: K, value: V): this {
    this.assertLive();
    assertDefined(key, "key");
    assertDefined(value, "value");
    const existing = this.findNode(key);
    if (existing !== null) {
      existing.value = value;
      this.touch();
      return this;
    }
    const node = this.createNode(key, value);
    this._root = this.insertNode(this._root, node);
    this._size++;
    this.touch();
    return this;
  }

  /** O(log n) expected: the value for `key`, or undefined when absent. */
  get(key: K): V | undefined {
    this.assertLive();
    assertDefined(key, "key");
    return this.findNode(key)?.value;
  }

  /** O(log n) expected: membership test. */
  has(key: K): boolean {
    this.assertLive();
    assertDefined(key, "key");
    return this.findNode(key) !== null;
  }

  /** O(log n) expected: removes `key` and invalidates a finger that pointed at it. */
  delete(key: K): boolean {
    this.assertLive();
    assertDefined(key, "key");
    const node = this.findNode(key);
    if (node === null) {
      return false;
    }
    this.removeNode(node);
    this._size--;
    this.touch();
    return true;
  }

  /** O(log n) expected: smallest entry. */
  min(): [K, V] | undefined {
    this.assertLive();
    const node = this.minimumNode(this._root);
    return node === null ? undefined : [node.key, node.value];
  }

  /** O(log n) expected: largest entry. */
  max(): [K, V] | undefined {
    this.assertLive();
    const node = this.maximumNode(this._root);
    return node === null ? undefined : [node.key, node.value];
  }

  /** O(log n) expected: largest entry strictly less than `key`. */
  predecessor(key: K): [K, V] | undefined {
    this.assertLive();
    assertDefined(key, "key");
    const node = this.predecessorNode(key);
    return node === null ? undefined : [node.key, node.value];
  }

  /** O(log n) expected: smallest entry strictly greater than `key`. */
  successor(key: K): [K, V] | undefined {
    this.assertLive();
    assertDefined(key, "key");
    const node = this.successorNodeForKey(key);
    return node === null ? undefined : [node.key, node.value];
  }

  /** O(log n) expected: select by rank through cached subtree sizes. */
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

  /** O(log n) expected: rank query through cached subtree sizes. */
  indexOf(key: K): number {
    this.assertLive();
    assertDefined(key, "key");
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

  /** O(log n + k) expected: lower-bound descent plus k successor steps. */
  range(
    lo?: K,
    hi?: K,
    options?: RangeOptions<K>,
  ): IterableIterator<[K, V]> {
    this.assertLive();
    const loInclusive = options?.lo === undefined || options.lo === "inclusive";
    const hiInclusive = options?.hi === undefined || options.hi === "inclusive";
    if (
      options?.lo !== undefined &&
      options.lo !== "inclusive" &&
      options.lo !== "exclusive"
    ) {
      throw new TypeError("lo must be 'inclusive' or 'exclusive'");
    }
    if (
      options?.hi !== undefined &&
      options.hi !== "inclusive" &&
      options.hi !== "exclusive"
    ) {
      throw new TypeError("hi must be 'inclusive' or 'exclusive'");
    }
    const entries: Array<[K, V]> = [];
    if (lo !== undefined && hi !== undefined && this.compare(lo, hi) > 0) {
      return this.snapshotIterator(entries);
    }
    let node = lo === undefined ? this.minimumNode(this._root) : this.lowerBoundNode(lo, loInclusive);
    while (node !== null) {
      if (hi !== undefined) {
        const comparison = this.compare(node.key, hi);
        if (comparison > 0 || (comparison === 0 && !hiInclusive)) {
          break;
        }
      }
      entries.push([node.key, node.value]);
      node = this.inOrderSuccessor(node);
    }
    return this.snapshotIterator(entries);
  }

  /** O(n): ascending keys. */
  keys(): IterableIterator<K> {
    return this.snapshotIterator(this.toArray().map((entry) => entry[0]));
  }

  /** O(n): ascending values. */
  values(): IterableIterator<V> {
    return this.snapshotIterator(this.toArray().map((entry) => entry[1]));
  }

  /** O(n): ascending entries. */
  entries(): IterableIterator<[K, V]> {
    return this.snapshotIterator(this.toArray());
  }

  /** O(n): iterative in-order snapshot. */
  override toArray(): Array<[K, V]> {
    this.assertLive();
    const entries: Array<[K, V]> = [];
    const stack: Array<FingerNode<K, V>> = [];
    let node = this._root;
    while (node !== null || stack.length > 0) {
      while (node !== null) {
        stack.push(node);
        node = node.left;
      }
      const current = stack.pop() as FingerNode<K, V>;
      entries.push([current.key, current.value]);
      node = current.right;
    }
    return entries;
  }

  /** Same as entries(). */
  override [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }

  /** O(f) for f outstanding fingers: drops the tree and invalidates every finger. */
  override clear(): void {
    this.assertLive();
    this.invalidateAllFingers();
    this._root = null;
    this._size = 0;
    this.touch();
  }

  /** O(log n) expected: returns a finger for an existing key. */
  fingerAt(key: K): Finger<K> | undefined {
    this.assertLive();
    assertDefined(key, "key");
    const node = this.findNode(key);
    return node === null ? undefined : this.createFinger(node);
  }

  /** O(log d) expected: searches from `finger` without moving it. */
  findFrom(finger: Finger<K>, key: K): [K, V] | undefined {
    this.assertLive();
    assertDefined(key, "key");
    const handle = this.resolveFinger(finger);
    // A key outside the root's cached extremes is absent; without this check the climb would
    // run to the root even when the finger sits next to the edge (d = 0).
    const root = this._root as FingerNode<K, V>;
    if (this.compare(key, root.minKey) < 0 || this.compare(key, root.maxKey) > 0) {
      return undefined;
    }
    let node = handle._node as FingerNode<K, V>;
    while (
      node.parent !== null &&
      (this.compare(key, node.minKey) < 0 ||
        this.compare(key, node.maxKey) > 0)
    ) {
      node = node.parent;
    }
    let current: FingerNode<K, V> | null = node;
    while (current !== null) {
      const comparison = this.compare(key, current.key);
      if (comparison === 0) {
        return [current.key, current.value];
      }
      current = comparison < 0 ? current.left : current.right;
    }
    return undefined;
  }

  /**
   * O(log n) expected: inserts strictly between the finger and its successor, then moves the
   * finger to the new entry and returns it.
   */
  insertAfter(finger: Finger<K>, key: K, value: V): Finger<K> {
    this.assertLive();
    assertDefined(key, "key");
    assertDefined(value, "value");
    const handle = this.resolveFinger(finger);
    const target = handle._node as FingerNode<K, V>;
    if (this.compare(target.key, handle._key) !== 0) {
      throw new ConcurrentModificationError("finger target is no longer present");
    }
    if (this.compare(key, target.key) <= 0) {
      throw new RangeError("key must be greater than the finger's key");
    }
    const successor = this.inOrderSuccessor(target);
    if (successor !== null && this.compare(key, successor.key) >= 0) {
      throw new RangeError("key must be less than the finger's successor");
    }
    const node = this.createNode(key, value);
    this._root = this.insertNode(this._root, node);
    this._size++;
    target.fingers.delete(handle);
    node.fingers.add(handle);
    this._fingers.add(handle);
    handle.move(node, -1, key);
    this.touch();
    return handle;
  }

  /** O(log n) expected: removes the finger's entry and invalidates that finger. */
  deleteAt(finger: Finger<K>): boolean {
    this.assertLive();
    const handle = this.resolveFinger(finger);
    const node = handle._node as FingerNode<K, V>;
    if (this.compare(node.key, handle._key) !== 0) {
      throw new ConcurrentModificationError("finger target is no longer present");
    }
    this.removeNode(node);
    this._size--;
    this.touch();
    return true;
  }

  /** O(1) expected: entry immediately after the finger (neighbour paths in a treap are O(1) long on average). */
  successorFrom(finger: Finger<K>): [K, V] | undefined {
    this.assertLive();
    const handle = this.resolveFinger(finger);
    const node = this.inOrderSuccessor(handle._node as FingerNode<K, V>);
    return node === null ? undefined : [node.key, node.value];
  }

  /** O(1) expected: entry immediately before the finger. */
  predecessorFrom(finger: Finger<K>): [K, V] | undefined {
    this.assertLive();
    const handle = this.resolveFinger(finger);
    const node = this.inOrderPredecessor(handle._node as FingerNode<K, V>);
    return node === null ? undefined : [node.key, node.value];
  }

  /** O(log n) expected: absolute rank distance between two fingers. */
  distance(a: Finger<K>, b: Finger<K>): number {
    this.assertLive();
    const left = this.resolveFinger(a);
    const right = this.resolveFinger(b);
    return Math.abs(this.rankOf(left) - this.rankOf(right));
  }

  /**
   * O(log n) expected: consumes both inputs and returns a fresh treap holding the union. Every
   * key in the receiver must compare smaller than every key in `other`.
   */
  join(other: FingerSearchMap<K, V>): FingerTreap<K, V> {
    this.assertLive();
    if (!(other instanceof FingerTreap)) {
      throw new UnsupportedError("FingerTreap can only join another FingerTreap");
    }
    const second = other as FingerTreap<K, V>;
    second.assertLive();
    if (second === this) {
      throw new TypeError("cannot join a tree with itself");
    }
    if (this._root !== null && second._root !== null) {
      const leftMax = this.maximumNode(this._root) as FingerNode<K, V>;
      const rightMin = this.minimumNode(second._root) as FingerNode<K, V>;
      if (this.compare(leftMax.key, rightMin.key) >= 0) {
        throw new TypeError(
          "join requires every key in the receiver to be smaller than every key in other",
        );
      }
    }
    const root = this.mergeNodes(this._root, second._root);
    const size = this._size + second._size;
    this.markConsumed();
    second.markConsumed();
    return FingerTreap.fromParts(root, size, this.compare, this.rng);
  }

  /** O(log n) expected: consumes the receiver and partitions at the finger's key. */
  splitAt(finger: Finger<K>): [FingerTreap<K, V>, FingerTreap<K, V>] {
    this.assertLive();
    const handle = this.resolveFinger(finger);
    const [leftRoot, rightRoot] = this.splitByKey(
      this._root,
      handle._key,
    );
    const left = FingerTreap.fromParts(
      leftRoot,
      sizeOf(leftRoot),
      this.compare,
      this.rng,
    );
    const right = FingerTreap.fromParts(
      rightRoot,
      sizeOf(rightRoot),
      this.compare,
      this.rng,
    );
    this.markConsumed();
    return [left, right];
  }

  /** O(n): dumps ascending entries; fingers are not part of the payload. */
  serialize(): string {
    this.assertLive();
    return serializeFingerEntries("FingerTreap", this.toArray());
  }

  /** O(n log n) expected: rebuilds by inserting the sorted entries; priorities are fresh. */
  static deserialize<K, V>(
    json: unknown,
    compare?: Comparator<K>,
    options?: FingerTreeOptions,
  ): FingerTreap<K, V> {
    const entries = readFingerEntries<K, V>(json, "FingerTreap");
    const tree = new FingerTreap<K, V>(compare, options);
    for (const [key, value] of entries) {
      tree.set(key, value);
    }
    return tree;
  }

  /**
   * O(n): checks BST order, heap order on priorities, parent links, cached sizes and extremes,
   * the node count, and every active finger target.
   */
  override validate(): true | string {
    this.assertLive();
    if (this._root === null) {
      if (this._size !== 0) {
        return "non-empty size with empty root";
      }
      if (this._fingers.size !== 0) {
        return "active fingers without a root";
      }
      return true;
    }
    if (this._root.parent !== null) {
      return "root has a parent";
    }
    const stack: Array<FingerNode<K, V>> = [];
    const seen = new Set<FingerNode<K, V>>();
    let node: FingerNode<K, V> | null = this._root;
    let previous: FingerNode<K, V> | null = null;
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
      const current = stack.pop() as FingerNode<K, V>;
      count++;
      if (count > this._size) {
        return "tree contains more nodes than size";
      }
      if (current.key === undefined || current.value === undefined) {
        return `node at index ${count - 1} has an undefined key or value`;
      }
      if (!Number.isFinite(current.priority)) {
        return `node at index ${count - 1} has a non-finite priority`;
      }
      if (current.left !== null && current.left.parent !== current) {
        return `left child of node at index ${count - 1} has an incorrect parent link`;
      }
      if (current.right !== null && current.right.parent !== current) {
        return `right child of node at index ${count - 1} has an incorrect parent link`;
      }
      if (
        current.left !== null &&
        current.left.priority < current.priority
      ) {
        return `heap order is violated at the left child of node ${count - 1}`;
      }
      if (
        current.right !== null &&
        current.right.priority < current.priority
      ) {
        return `heap order is violated at the right child of node ${count - 1}`;
      }
      const expectedSize = 1 + sizeOf(current.left) + sizeOf(current.right);
      if (current.size !== expectedSize) {
        return `node at index ${count - 1} has a stale subtree size`;
      }
      const expectedMin =
        current.left === null ? current.key : current.left.minKey;
      const expectedMax =
        current.right === null ? current.key : current.right.maxKey;
      if (this.compare(current.minKey, expectedMin) !== 0) {
        return `node at index ${count - 1} has a stale minimum`;
      }
      if (this.compare(current.maxKey, expectedMax) !== 0) {
        return `node at index ${count - 1} has a stale maximum`;
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
    for (const finger of this._fingers) {
      if (finger.invalid) {
        return "active finger is invalid";
      }
      if (finger._owner !== this) {
        return "active finger belongs to another map";
      }
      const target = finger._node as FingerNode<K, V>;
      if (!seen.has(target)) {
        return "finger does not point at a live node";
      }
      if (this.compare(target.key, finger._key) !== 0) {
        return "finger key does not match its target";
      }
      if (!target.fingers.has(finger)) {
        return "finger is not registered with its node";
      }
    }
    for (const current of seen) {
      for (const finger of current.fingers) {
        if (!this._fingers.has(finger)) {
          return "node has an unregistered finger";
        }
        if (finger._node !== current) {
          return "node finger points at another node";
        }
      }
    }
    return true;
  }

  /** O(1): rejects use after join/split consumed this tree. */
  private assertLive(): void {
    if (this._consumed) {
      throw new ConsumedError();
    }
  }

  /** O(1): creates a node with a fresh priority. */
  private createNode(key: K, value: V): FingerNode<K, V> {
    const priority = this.rng.next();
    if (typeof priority !== "number" || !Number.isFinite(priority)) {
      throw new TypeError("rng.next() must return a finite number");
    }
    return new FingerNode<K, V>(key, value, priority);
  }

  /** O(1): makes a fresh finger at a live node. */
  private createFinger(node: FingerNode<K, V>): Finger<K> {
    const handle = new FingerHandle<K>(
      this,
      () => this._consumed,
      node.key,
      node,
      -1,
    );
    node.fingers.add(handle);
    this._fingers.add(handle);
    return handle;
  }

  /** O(1): validates ownership, liveness, and invalidation of a finger. */
  private resolveFinger(finger: Finger<K>): FingerHandle<K> {
    if (!(finger instanceof FingerHandle)) {
      throw new TypeError("finger must be a finger created by this map");
    }
    if (finger._owner !== this) {
      if (finger.isOwnerConsumed()) {
        throw new ConsumedError();
      }
      throw new TypeError("finger belongs to another map");
    }
    if (finger.invalid) {
      throw new ConcurrentModificationError();
    }
    return finger;
  }

  /** O(1): invalidates one finger and removes it from both registries. */
  private killFinger(
    handle: FingerHandle<K>,
    node: FingerNode<K, V>,
  ): void {
    handle.markInvalid();
    node.fingers.delete(handle);
    this._fingers.delete(handle);
  }

  /** O(f): invalidates every finger, for clear and consumption. */
  private invalidateAllFingers(): void {
    for (const finger of this._fingers) {
      finger.markInvalid();
      const node = finger._node as FingerNode<K, V>;
      node.fingers.delete(finger);
    }
    this._fingers.clear();
  }

  /** O(log n) expected: rank of a finger, climbing to the root over cached subtree sizes. */
  private rankOf(finger: FingerHandle<K>): number {
    let node = finger._node as FingerNode<K, V>;
    let rank = sizeOf(node.left);
    while (node.parent !== null) {
      if (node === node.parent.right) {
        rank += 1 + sizeOf(node.parent.left);
      }
      node = node.parent;
    }
    return rank;
  }

  /** O(log n) expected: comparator descent. */
  private findNode(key: K): FingerNode<K, V> | null {
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

  /** O(h): leftmost node of a subtree. */
  private minimumNode(
    node: FingerNode<K, V> | null,
  ): FingerNode<K, V> | null {
    let current = node;
    while (current !== null && current.left !== null) {
      current = current.left;
    }
    return current;
  }

  /** O(h): rightmost node of a subtree. */
  private maximumNode(
    node: FingerNode<K, V> | null,
  ): FingerNode<K, V> | null {
    let current = node;
    while (current !== null && current.right !== null) {
      current = current.right;
    }
    return current;
  }

  /** O(h): in-order successor of a node. */
  private inOrderSuccessor(
    node: FingerNode<K, V>,
  ): FingerNode<K, V> | null {
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

  /** O(h): in-order predecessor of a node. */
  private inOrderPredecessor(
    node: FingerNode<K, V>,
  ): FingerNode<K, V> | null {
    if (node.left !== null) {
      return this.maximumNode(node.left);
    }
    let current = node;
    let parent = current.parent;
    while (parent !== null && current === parent.left) {
      current = parent;
      parent = parent.parent;
    }
    return parent;
  }

  /** O(log n) expected: successor for a key, present or absent. */
  private successorNodeForKey(key: K): FingerNode<K, V> | null {
    let node = this._root;
    let best: FingerNode<K, V> | null = null;
    while (node !== null) {
      if (this.compare(node.key, key) > 0) {
        best = node;
        node = node.left;
      } else {
        node = node.right;
      }
    }
    return best;
  }

  /** O(log n) expected: predecessor for a key, present or absent. */
  private predecessorNode(key: K): FingerNode<K, V> | null {
    let node = this._root;
    let best: FingerNode<K, V> | null = null;
    while (node !== null) {
      if (this.compare(node.key, key) < 0) {
        best = node;
        node = node.right;
      } else {
        node = node.left;
      }
    }
    return best;
  }

  /** O(log n) expected: first node satisfying the lower bound. */
  private lowerBoundNode(key: K, inclusive: boolean): FingerNode<K, V> | null {
    let node = this._root;
    let best: FingerNode<K, V> | null = null;
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

  /** O(log n) expected: inserts a new node and repairs parent links. */
  private insertNode(
    root: FingerNode<K, V> | null,
    node: FingerNode<K, V>,
  ): FingerNode<K, V> {
    if (root === null) {
      node.parent = null;
      return node;
    }
    if (node.priority < root.priority) {
      const [left, right] = this.splitByKey(root, node.key);
      node.left = left;
      node.right = right;
      if (left !== null) {
        left.parent = node;
      }
      if (right !== null) {
        right.parent = node;
      }
      updateNode(node);
      node.parent = null;
      return node;
    }
    if (this.compare(node.key, root.key) < 0) {
      const child = this.insertNode(root.left, node);
      root.left = child;
      child.parent = root;
    } else {
      const child = this.insertNode(root.right, node);
      root.right = child;
      child.parent = root;
    }
    updateNode(root);
    root.parent = null;
    return root;
  }

  /** O(log n) expected: destructive split into keys `< key` and `>= key`. */
  private splitByKey(
    root: FingerNode<K, V> | null,
    key: K,
  ): [FingerNode<K, V> | null, FingerNode<K, V> | null] {
    if (root === null) {
      return [null, null];
    }
    if (this.compare(root.key, key) < 0) {
      const [left, right] = this.splitByKey(root.right, key);
      root.right = left;
      if (left !== null) {
        left.parent = root;
      }
      updateNode(root);
      root.parent = null;
      return [root, right];
    }
    const [left, right] = this.splitByKey(root.left, key);
    root.left = right;
    if (right !== null) {
      right.parent = root;
    }
    updateNode(root);
    root.parent = null;
    return [left, root];
  }

  /** O(log n) expected: melds two treaps whose key ranges are fully ordered. */
  private mergeNodes(
    left: FingerNode<K, V> | null,
    right: FingerNode<K, V> | null,
  ): FingerNode<K, V> | null {
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
    if (left.priority <= right.priority) {
      const merged = this.mergeNodes(left.right, right);
      left.right = merged;
      if (merged !== null) {
        merged.parent = left;
      }
      updateNode(left);
      left.parent = null;
      return left;
    }
    const merged = this.mergeNodes(left, right.left);
    right.left = merged;
    if (merged !== null) {
      merged.parent = right;
    }
    updateNode(right);
    right.parent = null;
    return right;
  }

  /** O(log n) expected: removes a node, invalidating every finger on it. */
  private removeNode(node: FingerNode<K, V>): void {
    for (const finger of Array.from(node.fingers)) {
      this.killFinger(finger, node);
    }
    const parent = node.parent;
    const replacement = this.mergeNodes(node.left, node.right);
    node.left = null;
    node.right = null;
    node.parent = null;
    if (parent === null) {
      this._root = replacement;
    } else if (parent.left === node) {
      parent.left = replacement;
    } else {
      parent.right = replacement;
    }
    if (replacement !== null) {
      replacement.parent = parent;
    }
    this.refreshUp(parent);
  }

  /** O(h): refreshes caches from a node to the root. */
  private refreshUp(start: FingerNode<K, V> | null): void {
    let current = start;
    while (current !== null) {
      updateNode(current);
      current = current.parent;
    }
  }

  /** O(1): creates a live tree that adopts `root`; used by join and split. */
  private static fromParts<K, V>(
    root: FingerNode<K, V> | null,
    size: number,
    compare: Comparator<K>,
    rng: RandomSource,
  ): FingerTreap<K, V> {
    const tree = new FingerTreap<K, V>(compare, { rng });
    tree._root = root;
    tree._size = size;
    if (root !== null) {
      root.parent = null;
    }
    return tree;
  }

  /** O(f) for f outstanding fingers: invalidates every finger and marks the tree consumed. */
  private markConsumed(): void {
    this.invalidateAllFingers();
    this._consumed = true;
    this._root = null;
    this._size = 0;
    this.touch();
  }
}
