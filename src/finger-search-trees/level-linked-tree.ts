import {
  assertDefined,
  assertInteger,
  ConcurrentModificationError,
  ConsumedError,
  ContainerBase,
  resolveComparator,
  UnsupportedError,
} from "../core/index.ts";
import type { Comparator, RangeOptions } from "../core/index.ts";
import { FingerHandle } from "./finger.ts";
import {
  readFingerEntries,
  serializeFingerEntries,
} from "./serialization.ts";
import type { Finger, FingerSearchMap } from "./types.ts";

/** Maximum keys in a leaf and maximum children in an internal node. */
const MAX_LEAF_KEYS = 3;
const MAX_CHILDREN = 4;

/**
 * A level-linked (2,4)-tree node. Leaves store the entries; internal nodes store only children
 * and derive their separator keys from the maximum key of each child. Every level is a doubly
 * linked list, which is what makes search from a held finger local.
 */
class LevelNode<K, V> {
  keys: K[] = [];
  values: V[] = [];
  children: LevelNode<K, V>[] = [];
  parent: LevelNode<K, V> | null = null;
  next: LevelNode<K, V> | null = null;
  prev: LevelNode<K, V> | null = null;
  subtreeCount = 0;
  minKey!: K;
  maxKey!: K;
  readonly fingers = new Set<FingerHandle<K>>();

  readonly isLeaf: boolean;

  constructor(isLeaf: boolean) {
    this.isLeaf = isLeaf;
  }
}

interface Location<K, V> {
  leaf: LevelNode<K, V>;
  index: number;
  found: boolean;
}

/** O(1): total entries in a subtree, with the empty subtree at 0. */
function nodeSizeOf<K, V>(node: LevelNode<K, V> | null): number {
  return node === null ? 0 : node.subtreeCount;
}

/**
 * O(1) for a node with at most 4 children: recomputes the cached count, extreme keys, and the
 * separator list from the children. An empty transient leaf leaves the extreme keys stale; the
 * underflow repair runs before any search can observe it.
 */
function refreshNode<K, V>(node: LevelNode<K, V>): void {
  if (node.isLeaf) {
    node.subtreeCount = node.keys.length;
    if (node.keys.length > 0) {
      node.minKey = node.keys[0] as K;
      node.maxKey = node.keys[node.keys.length - 1] as K;
    }
    return;
  }
  let count = 0;
  for (const child of node.children) {
    count += child.subtreeCount;
  }
  node.subtreeCount = count;
  const separatorCount = Math.max(0, node.children.length - 1);
  node.keys.length = separatorCount;
  for (let index = 0; index < separatorCount; index++) {
    node.keys[index] = (node.children[index] as LevelNode<K, V>).maxKey;
  }
  if (node.children.length > 0) {
    node.minKey = (node.children[0] as LevelNode<K, V>).minKey;
    node.maxKey = (
      node.children[node.children.length - 1] as LevelNode<K, V>
    ).maxKey;
  }
}

/**
 * Level-linked (2,4)-tree: a B+-tree whose leaves and internal levels are doubly linked. The
 * ordered-map surface is O(log n); searching from a finger costs O(log d), where d is the number
 * of entries between the finger and the target, because the search climbs levels and follows
 * same-level links instead of restarting at the root.
 *
 * Finger updates are Θ(log n) because the subtree counts behind `distance`, `at`, and `indexOf`
 * are kept exact. `join` and `splitAt` are O(log n), destructive, and consume their inputs.
 * Fingers are not serialized.
 */
export class LevelLinkedTree<K, V = K>
  extends ContainerBase<[K, V]>
  implements FingerSearchMap<K, V>
{
  readonly compare: Comparator<K>;
  private _root: LevelNode<K, V> | null = null;
  private _consumed = false;
  private readonly _fingers = new Set<FingerHandle<K>>();

  /** O(1); `compare` defaults to the core natural-order comparator. */
  constructor(compare?: Comparator<K>) {
    super();
    this.compare = resolveComparator(compare);
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

  /** O(log n): replaces an existing value or inserts a key into its leaf. */
  set(key: K, value: V): this {
    this.assertLive();
    assertDefined(key, "key");
    assertDefined(value, "value");
    const location = this.locate(key);
    if (location !== null && location.found) {
      location.leaf.values[location.index] = value;
      this.touch();
      return this;
    }
    if (location === null) {
      this._root = this.createLeaf([key], [value]);
      this._size = 1;
      this.touch();
      return this;
    }
    this.insertEntry(location.leaf, location.index, key, value);
    this._size++;
    this.touch();
    return this;
  }

  /** O(log n): the value for `key`, or undefined when absent. */
  get(key: K): V | undefined {
    this.assertLive();
    assertDefined(key, "key");
    const location = this.locate(key);
    return location !== null && location.found
      ? location.leaf.values[location.index]
      : undefined;
  }

  /** O(log n): membership test. */
  has(key: K): boolean {
    this.assertLive();
    assertDefined(key, "key");
    const location = this.locate(key);
    return location !== null && location.found;
  }

  /** O(log n): removes `key`, invalidating any finger that points at it. */
  delete(key: K): boolean {
    this.assertLive();
    assertDefined(key, "key");
    const location = this.locate(key);
    if (location === null || !location.found) {
      return false;
    }
    this.removeEntryAt(location.leaf, location.index);
    this._size--;
    this.touch();
    this.fixAfterLeafDeletion(location.leaf);
    return true;
  }

  /** O(log n): the first entry. */
  min(): [K, V] | undefined {
    this.assertLive();
    const leaf = this.leftmostLeaf(this._root);
    return leaf === null
      ? undefined
      : [leaf.keys[0] as K, leaf.values[0] as V];
  }

  /** O(log n): the last entry. */
  max(): [K, V] | undefined {
    this.assertLive();
    const leaf = this.rightmostLeaf(this._root);
    if (leaf === null || leaf.keys.length === 0) {
      return undefined;
    }
    const index = leaf.keys.length - 1;
    return [leaf.keys[index] as K, leaf.values[index] as V];
  }

  /** O(log n): largest entry strictly less than `key`; absent keys are supported. */
  predecessor(key: K): [K, V] | undefined {
    this.assertLive();
    assertDefined(key, "key");
    const location = this.locate(key);
    if (location === null) {
      return undefined;
    }
    let leaf: LevelNode<K, V> | null = location.leaf;
    let index = location.index - 1;
    if (index < 0) {
      leaf = leaf.prev;
      if (leaf === null) {
        return undefined;
      }
      index = leaf.keys.length - 1;
    }
    return [leaf.keys[index] as K, leaf.values[index] as V];
  }

  /** O(log n): smallest entry strictly greater than `key`; absent keys are supported. */
  successor(key: K): [K, V] | undefined {
    this.assertLive();
    assertDefined(key, "key");
    const location = this.locate(key);
    if (location === null) {
      return undefined;
    }
    let leaf: LevelNode<K, V> | null = location.leaf;
    let index = location.found ? location.index + 1 : location.index;
    if (index >= leaf.keys.length) {
      leaf = leaf.next;
      if (leaf === null) {
        return undefined;
      }
      index = 0;
    }
    return [leaf.keys[index] as K, leaf.values[index] as V];
  }

  /** O(log n): select by rank through the cached subtree counts. */
  at(index: number): [K, V] | undefined {
    this.assertLive();
    assertInteger(index);
    if (index < 0 || index >= this._size || this._root === null) {
      return undefined;
    }
    let node: LevelNode<K, V> = this._root;
    let remaining = index;
    while (!node.isLeaf) {
      let childIndex = 0;
      while (
        childIndex < node.children.length - 1 &&
        remaining >= (node.children[childIndex] as LevelNode<K, V>).subtreeCount
      ) {
        remaining -= (
          node.children[childIndex] as LevelNode<K, V>
        ).subtreeCount;
        childIndex++;
      }
      node = node.children[childIndex] as LevelNode<K, V>;
    }
    if (remaining >= node.keys.length) {
      return undefined;
    }
    return [node.keys[remaining] as K, node.values[remaining] as V];
  }

  /** O(log n): rank through cached subtree counts; -1 when the key is absent. */
  indexOf(key: K): number {
    this.assertLive();
    assertDefined(key, "key");
    if (this._root === null) {
      return -1;
    }
    let node: LevelNode<K, V> = this._root;
    let rank = 0;
    while (!node.isLeaf) {
      let childIndex = 0;
      while (
        childIndex < node.children.length - 1 &&
        this.compare(key, (node.children[childIndex] as LevelNode<K, V>).maxKey) > 0
      ) {
        rank += (node.children[childIndex] as LevelNode<K, V>).subtreeCount;
        childIndex++;
      }
      node = node.children[childIndex] as LevelNode<K, V>;
    }
    const location = this.searchLeaf(node, key);
    return location.found ? rank + location.index : -1;
  }

  /** O(log n + k): lower-bound descent followed by k linked-leaf steps. */
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
    let leaf = this._root === null ? null : this.leftmostLeaf(this._root);
    let index = 0;
    if (lo !== undefined && leaf !== null) {
      const location = this.locate(lo);
      if (location !== null) {
        leaf = location.leaf;
        if (location.found) {
          index = loInclusive ? location.index : location.index + 1;
        } else {
          index = location.index;
        }
        if (index >= leaf.keys.length) {
          leaf = leaf.next;
          index = 0;
        }
      }
    }
    while (leaf !== null) {
      for (let cursor = index; cursor < leaf.keys.length; cursor++) {
        const key = leaf.keys[cursor] as K;
        if (hi !== undefined) {
          const comparison = this.compare(key, hi);
          if (comparison > 0 || (comparison === 0 && !hiInclusive)) {
            return this.snapshotIterator(entries);
          }
        }
        entries.push([key, leaf.values[cursor] as V]);
      }
      leaf = leaf.next;
      index = 0;
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

  /** O(n): iterative leaf-left-to-right walk. */
  override toArray(): Array<[K, V]> {
    this.assertLive();
    const entries: Array<[K, V]> = [];
    if (this._root === null) {
      return entries;
    }
    const stack: Array<LevelNode<K, V>> = [this._root];
    while (stack.length > 0) {
      const node = stack.pop() as LevelNode<K, V>;
      if (node.isLeaf) {
        for (let index = 0; index < node.keys.length; index++) {
          entries.push([
            node.keys[index] as K,
            node.values[index] as V,
          ]);
        }
      } else {
        for (let index = node.children.length - 1; index >= 0; index--) {
          stack.push(node.children[index] as LevelNode<K, V>);
        }
      }
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

  /** O(log n): returns a finger for an existing key. */
  fingerAt(key: K): Finger<K> | undefined {
    this.assertLive();
    assertDefined(key, "key");
    const location = this.locate(key);
    if (location === null || !location.found) {
      return undefined;
    }
    return this.createFinger(location.leaf, location.index);
  }

  /** O(log d): searches from `finger` without moving it. */
  findFrom(finger: Finger<K>, key: K): [K, V] | undefined {
    this.assertLive();
    assertDefined(key, "key");
    const handle = this.resolveFinger(finger);
    const start = handle._node as LevelNode<K, V>;
    if (!start.isLeaf) {
      throw new ConcurrentModificationError("finger does not point at a leaf");
    }
    // A key outside the root's cached extremes is absent; without this check the climb would
    // run to the root even when the finger sits next to the edge (d = 0).
    const root = this._root as LevelNode<K, V>;
    if (this.compare(key, root.minKey) < 0 || this.compare(key, root.maxKey) > 0) {
      return undefined;
    }
    const location = this.locateFrom(start, key);
    return location.found
      ? [location.leaf.keys[location.index] as K, location.leaf.values[location.index] as V]
      : undefined;
  }

  /**
   * O(log n): inserts strictly between the finger and its successor, moves the finger to the new
   * entry, and returns it. Splits are O(1) amortized, but the cached subtree counts are refreshed
   * up to the root on every insertion, so the whole operation is Θ(log n).
   */
  insertAfter(finger: Finger<K>, key: K, value: V): Finger<K> {
    this.assertLive();
    assertDefined(key, "key");
    assertDefined(value, "value");
    const handle = this.resolveFinger(finger);
    const leaf = handle._node as LevelNode<K, V>;
    if (!leaf.isLeaf || handle._index < 0 || handle._index >= leaf.keys.length) {
      throw new ConcurrentModificationError("finger target is no longer present");
    }
    if (this.compare(leaf.keys[handle._index] as K, handle._key) !== 0) {
      throw new ConcurrentModificationError("finger target is no longer present");
    }
    if (this.compare(key, handle._key) <= 0) {
      throw new RangeError("key must be greater than the finger's key");
    }
    const successorKey =
      handle._index + 1 < leaf.keys.length
        ? (leaf.keys[handle._index + 1] as K)
        : leaf.next !== null
          ? (leaf.next.keys[0] as K)
          : undefined;
    if (successorKey !== undefined && this.compare(key, successorKey) >= 0) {
      throw new RangeError("key must be less than the finger's successor");
    }
    leaf.fingers.delete(handle);
    const location = this.insertEntry(leaf, handle._index + 1, key, value);
    this._size++;
    location.leaf.fingers.add(handle);
    handle.move(location.leaf, location.index, key);
    this.touch();
    return handle;
  }

  /**
   * O(log n): removes the finger's entry and invalidates that finger. Fusions are O(1) amortized,
   * but the cached subtree counts are refreshed up to the root on every deletion.
   */
  deleteAt(finger: Finger<K>): boolean {
    this.assertLive();
    const handle = this.resolveFinger(finger);
    const leaf = handle._node as LevelNode<K, V>;
    if (!leaf.isLeaf || handle._index < 0 || handle._index >= leaf.keys.length) {
      throw new ConcurrentModificationError("finger target is no longer present");
    }
    if (this.compare(leaf.keys[handle._index] as K, handle._key) !== 0) {
      throw new ConcurrentModificationError("finger target is no longer present");
    }
    this.removeEntryAt(leaf, handle._index);
    this._size--;
    this.touch();
    this.fixAfterLeafDeletion(leaf);
    return true;
  }

  /** O(1): entry immediately after the finger. */
  successorFrom(finger: Finger<K>): [K, V] | undefined {
    this.assertLive();
    const handle = this.resolveFinger(finger);
    const leaf = handle._node as LevelNode<K, V>;
    let index = handle._index + 1;
    let current = leaf;
    if (index >= current.keys.length) {
      current = current.next as LevelNode<K, V>;
      if (current === null) {
        return undefined;
      }
      index = 0;
    }
    return [current.keys[index] as K, current.values[index] as V];
  }

  /** O(1): entry immediately before the finger. */
  predecessorFrom(finger: Finger<K>): [K, V] | undefined {
    this.assertLive();
    const handle = this.resolveFinger(finger);
    let leaf = handle._node as LevelNode<K, V>;
    let index = handle._index - 1;
    if (index < 0) {
      leaf = leaf.prev as LevelNode<K, V>;
      if (leaf === null) {
        return undefined;
      }
      index = leaf.keys.length - 1;
    }
    return [leaf.keys[index] as K, leaf.values[index] as V];
  }

  /** O(log n): absolute rank distance between two fingers in this map. */
  distance(a: Finger<K>, b: Finger<K>): number {
    this.assertLive();
    const left = this.resolveFinger(a);
    const right = this.resolveFinger(b);
    return Math.abs(this.rankOf(left) - this.rankOf(right));
  }

  /**
   * O(log n): consumes both inputs and returns a fresh tree holding the union. The receiver's keys
   * must all compare smaller than `other`'s. The shorter tree is hung off the facing spine of the
   * taller one, the two facing spines are level-linked, and any overflow splits upward.
   */
  join(other: FingerSearchMap<K, V>): LevelLinkedTree<K, V> {
    this.assertLive();
    if (!(other instanceof LevelLinkedTree)) {
      throw new UnsupportedError("LevelLinkedTree can only join another LevelLinkedTree");
    }
    const second = other as LevelLinkedTree<K, V>;
    second.assertLive();
    if (second === this) {
      throw new TypeError("cannot join a tree with itself");
    }
    if (this._root !== null && second._root !== null) {
      const leftMax = this.maxKeyOf(this._root);
      const rightMin = this.minKeyOf(second._root);
      if (this.compare(leftMax, rightMin) >= 0) {
        throw new TypeError(
          "join requires every key in the receiver to be smaller than every key in other",
        );
      }
    }
    const leftRoot = this._root;
    const rightRoot = second._root;
    const size = this._size + second._size;
    this.markConsumed();
    second.markConsumed();
    const result = new LevelLinkedTree<K, V>(this.compare);
    result._size = size;
    result.concatenate(leftRoot, rightRoot);
    return result;
  }

  /**
   * O(log n): consumes the receiver and partitions it into the entries before the finger and the
   * entries from the finger on. The cut runs up the finger's leaf-to-root path, splitting each
   * straddling node in two and severing the level links it crosses; the two exposed spines are then
   * repaired bottom-up with O(1) borrow or merge work per level.
   */
  splitAt(finger: Finger<K>): [LevelLinkedTree<K, V>, LevelLinkedTree<K, V>] {
    this.assertLive();
    const handle = this.resolveFinger(finger);
    const leaf = handle._node as LevelNode<K, V>;
    if (!leaf.isLeaf || handle._index < 0 || handle._index >= leaf.keys.length) {
      throw new ConcurrentModificationError("finger target is no longer present");
    }
    const rank = this.rankOf(handle);
    const size = this._size;
    const index = handle._index;
    this.markConsumed();

    // Cut the leaf level: everything before `index` stays left of the cut.
    let leftNode: LevelNode<K, V> | null;
    let rightNode: LevelNode<K, V>;
    if (index === 0) {
      leftNode = leaf.prev;
      rightNode = leaf;
    } else {
      const tail = new LevelNode<K, V>(true);
      tail.keys = leaf.keys.splice(index);
      tail.values = leaf.values.splice(index);
      tail.parent = leaf.parent;
      if (leaf.parent !== null) {
        const position = leaf.parent.children.indexOf(leaf);
        leaf.parent.children.splice(position + 1, 0, tail);
      }
      tail.next = leaf.next;
      if (leaf.next !== null) {
        leaf.next.prev = tail;
      }
      leftNode = leaf;
      rightNode = tail;
    }
    if (leftNode !== null) {
      leftNode.next = null;
    }
    rightNode.prev = null;
    const leftLeaf = leftNode;
    const rightLeaf = rightNode;

    // Cut each ancestor level along the path.
    while (rightNode.parent !== null) {
      const parent: LevelNode<K, V> = rightNode.parent;
      const position = parent.children.indexOf(rightNode);
      if (position === 0) {
        leftNode = parent.prev;
        rightNode = parent;
      } else {
        const tail = new LevelNode<K, V>(false);
        tail.children = parent.children.splice(position);
        for (const child of tail.children) {
          child.parent = tail;
        }
        tail.parent = parent.parent;
        if (parent.parent !== null) {
          const slot = parent.parent.children.indexOf(parent);
          parent.parent.children.splice(slot + 1, 0, tail);
        }
        tail.next = parent.next;
        if (parent.next !== null) {
          parent.next.prev = tail;
        }
        leftNode = parent;
        rightNode = tail;
      }
      if (leftNode !== null) {
        leftNode.next = null;
      }
      rightNode.prev = null;
    }

    const left = new LevelLinkedTree<K, V>(this.compare);
    const right = new LevelLinkedTree<K, V>(this.compare);
    if (leftLeaf !== null) {
      left._root = this.repairSpine(leftLeaf, "right");
      left._size = rank;
    }
    right._root = this.repairSpine(rightLeaf, "left");
    right._size = size - rank;
    return [left, right];
  }

  /** O(n): dumps ascending entries; fingers are not part of the payload. */
  serialize(): string {
    this.assertLive();
    return serializeFingerEntries("LevelLinkedTree", this.toArray());
  }

  /** O(n): rebuilds a balanced level-linked tree from sorted entries. */
  static deserialize<K, V>(
    json: unknown,
    compare?: Comparator<K>,
  ): LevelLinkedTree<K, V> {
    const entries = readFingerEntries<K, V>(json, "LevelLinkedTree");
    const tree = new LevelLinkedTree<K, V>(compare);
    tree.bulkLoad(entries);
    return tree;
  }

  /**
   * O(n): checks node degree, separators, level links, parent links, cached counts and extremes,
   * ascending order, and every active finger target.
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
    if (this._root.prev !== null || this._root.next !== null) {
      return "root has a level link";
    }

    const levels: Array<Array<LevelNode<K, V>>> = [];
    const leaves: Array<LevelNode<K, V>> = [];
    const seen = new Set<LevelNode<K, V>>();
    const stack: Array<[LevelNode<K, V>, number]> = [[this._root, 0]];
    let leafDepth = -1;
    while (stack.length > 0) {
      const [node, depth] = stack.pop() as [LevelNode<K, V>, number];
      if (seen.has(node)) {
        return "cycle detected in child links";
      }
      seen.add(node);
      const level = levels[depth] ?? (levels[depth] = []);
      level.push(node);
      if (node.isLeaf) {
        if (leafDepth === -1) {
          leafDepth = depth;
        } else if (leafDepth !== depth) {
          return "leaves are not all at the same depth";
        }
        leaves.push(node);
      }
      const maxKeys = node.isLeaf ? MAX_LEAF_KEYS : MAX_CHILDREN - 1;
      const minKeys = node === this._root ? (node.isLeaf ? 0 : 1) : node.isLeaf ? 1 : 1;
      if (node === this._root && node.isLeaf && node.keys.length === 0) {
        return "root leaf is empty";
      }
      if (node.keys.length < minKeys) {
        return `node at depth ${depth} has too few keys`;
      }
      if (node.keys.length > maxKeys) {
        return `node at depth ${depth} has too many keys`;
      }
      if (node.isLeaf) {
        if (node.values.length !== node.keys.length) {
          return `leaf at depth ${depth} has mismatched values`;
        }
        for (let index = 0; index < node.keys.length; index++) {
          if (node.keys[index] === undefined) {
            return `leaf at depth ${depth} has an undefined key`;
          }
          if (node.values[index] === undefined) {
            return `leaf at depth ${depth} has an undefined value`;
          }
          if (
            index > 0 &&
            this.compare(
              node.keys[index - 1] as K,
              node.keys[index] as K,
            ) >= 0
          ) {
            return `leaf at depth ${depth} is not strictly ordered`;
          }
        }
        if (node.keys.length > 0) {
          const expectedMin = node.keys[0] as K;
          const expectedMax = node.keys[node.keys.length - 1] as K;
          if (this.compare(node.minKey, expectedMin) !== 0) {
            return `leaf at depth ${depth} has a stale minimum`;
          }
          if (this.compare(node.maxKey, expectedMax) !== 0) {
            return `leaf at depth ${depth} has a stale maximum`;
          }
        }
      } else {
        const expectedChildren = node.keys.length + 1;
        if (node.children.length !== expectedChildren) {
          return `internal node at depth ${depth} has inconsistent separators`;
        }
        if (node.children.length < 2 || node.children.length > MAX_CHILDREN) {
          return `internal node at depth ${depth} has an invalid child count`;
        }
        let count = 0;
        for (let index = 0; index < node.children.length; index++) {
          const child = node.children[index] as LevelNode<K, V>;
          if (child.parent !== node) {
            return `child at depth ${depth} has an incorrect parent link`;
          }
          if (index > 0) {
            const previous = node.children[index - 1] as LevelNode<K, V>;
            if (this.compare(previous.maxKey, child.minKey) >= 0) {
              return `sibling ranges overlap at depth ${depth}`;
            }
          }
          if (index < node.keys.length) {
            if (
              this.compare(
                node.keys[index] as K,
                child.maxKey,
              ) !== 0
            ) {
              return `separator at depth ${depth} does not match its child`;
            }
          }
          count += child.subtreeCount;
        }
        if (node.subtreeCount !== count) {
          return `internal node at depth ${depth} has a stale subtree count`;
        }
        if (this.compare(node.minKey, (node.children[0] as LevelNode<K, V>).minKey) !== 0) {
          return `internal node at depth ${depth} has a stale minimum`;
        }
        if (
          this.compare(
            node.maxKey,
            (node.children[node.children.length - 1] as LevelNode<K, V>).maxKey,
          ) !== 0
        ) {
          return `internal node at depth ${depth} has a stale maximum`;
        }
        for (let index = node.children.length - 1; index >= 0; index--) {
          stack.push([node.children[index] as LevelNode<K, V>, depth + 1]);
        }
      }
    }

    for (let depth = 0; depth < levels.length; depth++) {
      const level = levels[depth] as Array<LevelNode<K, V>>;
      if (level.length === 0) {
        return `missing level ${depth}`;
      }
      if ((level[0] as LevelNode<K, V>).prev !== null) {
        return `level ${depth} has a previous link on its first node`;
      }
      if ((level[level.length - 1] as LevelNode<K, V>).next !== null) {
        return `level ${depth} has a next link on its last node`;
      }
      let node: LevelNode<K, V> | null = level[0] as LevelNode<K, V>;
      let index = 0;
      while (node !== null) {
        if (index >= level.length || level[index] !== node) {
          return `level ${depth} links do not match tree order`;
        }
        if (index > 0 && node.prev !== level[index - 1]) {
          return `level ${depth} has an incorrect previous link`;
        }
        if (index + 1 < level.length && node.next !== level[index + 1]) {
          return `level ${depth} has an incorrect next link`;
        }
        node = node.next;
        index++;
      }
      if (index !== level.length) {
        return `level ${depth} is missing nodes`;
      }
    }

    let previousMax: K | undefined;
    let count = 0;
    for (const leaf of leaves) {
      for (const key of leaf.keys) {
        if (previousMax !== undefined && this.compare(previousMax, key) >= 0) {
          return "leaf order is violated";
        }
        previousMax = key;
        count++;
      }
    }
    if (count !== this._size) {
      return `size ${this._size} does not match entry count ${count}`;
    }
    if (this._root.subtreeCount !== this._size) {
      return "root subtree count does not match size";
    }

    for (const finger of this._fingers) {
      if (finger.invalid) {
        return "active finger is invalid";
      }
      if (finger._owner !== this) {
        return "active finger belongs to another map";
      }
      const node = finger._node as LevelNode<K, V>;
      if (!node.isLeaf || !seen.has(node)) {
        return "finger does not point at a live leaf";
      }
      if (finger._index < 0 || finger._index >= node.keys.length) {
        return "finger index is out of range";
      }
      if (this.compare(node.keys[finger._index] as K, finger._key) !== 0) {
        return "finger key does not match its target";
      }
      if (!node.fingers.has(finger)) {
        return "finger is not registered with its leaf";
      }
    }
    for (const leaf of leaves) {
      for (const finger of leaf.fingers) {
        if (!this._fingers.has(finger)) {
          return "leaf has an unregistered finger";
        }
        if (finger._node !== leaf) {
          return "leaf finger points at another leaf";
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

  /** O(1): makes a fresh finger at a live leaf slot. */
  private createFinger(leaf: LevelNode<K, V>, index: number): Finger<K> {
    const handle = new FingerHandle<K>(
      this,
      () => this._consumed,
      leaf.keys[index] as K,
      leaf,
      index,
    );
    leaf.fingers.add(handle);
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
    leaf: LevelNode<K, V>,
  ): void {
    handle.markInvalid();
    leaf.fingers.delete(handle);
    this._fingers.delete(handle);
  }

  /** O(f): invalidates every finger, for clear and consumption. */
  private invalidateAllFingers(): void {
    for (const finger of this._fingers) {
      finger.markInvalid();
      const leaf = finger._node as LevelNode<K, V>;
      leaf.fingers.delete(finger);
    }
    this._fingers.clear();
  }

  /** O(log n): rank from a finger, summing left-sibling counts on the way to the root. */
  private rankOf(finger: FingerHandle<K>): number {
    let node = finger._node as LevelNode<K, V>;
    let rank = finger._index;
    while (node.parent !== null) {
      const parent = node.parent;
      const childIndex = parent.children.indexOf(node);
      for (let index = 0; index < childIndex; index++) {
        rank += nodeSizeOf(parent.children[index] as LevelNode<K, V>);
      }
      node = parent;
    }
    return rank;
  }

  /** O(log n): minimum key of a non-empty subtree. */
  private minKeyOf(node: LevelNode<K, V>): K {
    return this.leftmostLeaf(node)?.keys[0] as K;
  }

  /** O(log n): maximum key of a non-empty subtree. */
  private maxKeyOf(node: LevelNode<K, V>): K {
    const leaf = this.rightmostLeaf(node) as LevelNode<K, V>;
    return leaf.keys[leaf.keys.length - 1] as K;
  }

  /** O(log n): leftmost leaf of a subtree. */
  private leftmostLeaf(node: LevelNode<K, V> | null): LevelNode<K, V> | null {
    let current = node;
    while (current !== null && !current.isLeaf) {
      current = current.children[0] as LevelNode<K, V>;
    }
    return current;
  }

  /** O(log n): rightmost leaf of a subtree. */
  private rightmostLeaf(node: LevelNode<K, V> | null): LevelNode<K, V> | null {
    let current = node;
    while (current !== null && !current.isLeaf) {
      current = current.children[
        current.children.length - 1
      ] as LevelNode<K, V>;
    }
    return current;
  }

  /** O(log n): ordinary root descent. */
  private locate(key: K): Location<K, V> | null {
    if (this._root === null) {
      return null;
    }
    let node: LevelNode<K, V> = this._root;
    while (!node.isLeaf) {
      let childIndex = node.children.length - 1;
      for (let index = 0; index < node.keys.length; index++) {
        if (this.compare(key, node.keys[index] as K) <= 0) {
          childIndex = index;
          break;
        }
      }
      node = node.children[childIndex] as LevelNode<K, V>;
    }
    return this.searchLeaf(node, key);
  }

  /** O(log d): climbs and follows same-level links from a held leaf. */
  private locateFrom(start: LevelNode<K, V>, key: K): Location<K, V> {
    let node = start;
    for (;;) {
      if (this.compare(key, node.minKey) < 0) {
        if (node.prev !== null) {
          if (this.compare(key, node.prev.maxKey) > 0) {
            return this.firstLocation(node);
          }
          if (this.compare(key, node.prev.minKey) >= 0) {
            node = node.prev;
            continue;
          }
        }
        if (node.parent !== null) {
          node = node.parent;
          continue;
        }
        return this.firstLocation(node);
      }
      if (this.compare(key, node.maxKey) > 0) {
        if (node.next !== null) {
          if (this.compare(key, node.next.minKey) < 0) {
            return this.firstLocation(node.next);
          }
          if (this.compare(key, node.next.maxKey) <= 0) {
            node = node.next;
            continue;
          }
        }
        if (node.parent !== null) {
          node = node.parent;
          continue;
        }
        return this.lastLocation(node);
      }
      if (node.isLeaf) {
        return this.searchLeaf(node, key);
      }
      let childIndex = node.children.length - 1;
      for (let index = 0; index < node.keys.length; index++) {
        if (this.compare(key, node.keys[index] as K) <= 0) {
          childIndex = index;
          break;
        }
      }
      node = node.children[childIndex] as LevelNode<K, V>;
    }
  }

  /** O(height of node): first entry of a subtree, used as an absent-key insertion point. */
  private firstLocation(node: LevelNode<K, V>): Location<K, V> {
    const leaf = this.leftmostLeaf(node) as LevelNode<K, V>;
    return { leaf, index: 0, found: false };
  }

  /** O(height of node): last entry of a subtree. */
  private lastLocation(node: LevelNode<K, V>): Location<K, V> {
    const leaf = this.rightmostLeaf(node) as LevelNode<K, V>;
    return { leaf, index: leaf.keys.length - 1, found: false };
  }

  /** O(1): binary search inside one leaf of at most three keys. */
  private searchLeaf(leaf: LevelNode<K, V>, key: K): Location<K, V> {
    let low = 0;
    let high = leaf.keys.length - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const comparison = this.compare(leaf.keys[middle] as K, key);
      if (comparison === 0) {
        return { leaf, index: middle, found: true };
      }
      if (comparison < 0) {
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return { leaf, index: low, found: false };
  }

  /** O(log n): inserts into a leaf, cascades splits (O(1) amortized), and refreshes counts to the root. */
  private insertEntry(
    leaf: LevelNode<K, V>,
    index: number,
    key: K,
    value: V,
  ): Location<K, V> {
    for (const finger of leaf.fingers) {
      if (finger._index >= index) {
        finger._index++;
      }
    }
    leaf.keys.splice(index, 0, key);
    leaf.values.splice(index, 0, value);
    refreshNode(leaf);
    if (leaf.keys.length > MAX_LEAF_KEYS) {
      const middle = 2;
      const right = this.splitLeaf(leaf);
      return index >= middle
        ? { leaf: right, index: index - middle, found: true }
        : { leaf, index, found: true };
    }
    this.refreshUp(leaf);
    return { leaf, index, found: true };
  }

  /** O(log n) worst case: splits a four-entry leaf two-and-two and promotes the new sibling. */
  private splitLeaf(leaf: LevelNode<K, V>): LevelNode<K, V> {
    const middle = 2;
    const right = new LevelNode<K, V>(true);
    right.keys = leaf.keys.splice(middle);
    right.values = leaf.values.splice(middle);
    right.parent = leaf.parent;
    for (const finger of Array.from(leaf.fingers)) {
      if (finger._index >= middle) {
        leaf.fingers.delete(finger);
        right.fingers.add(finger);
        finger._node = right;
        finger._index -= middle;
      }
    }
    this.linkAfter(leaf, right);
    refreshNode(leaf);
    refreshNode(right);
    this.insertChildAfter(leaf, right);
    return right;
  }

  /** O(1): inserts a same-level sibling immediately after `left`. */
  private linkAfter(
    left: LevelNode<K, V>,
    right: LevelNode<K, V>,
  ): void {
    right.prev = left;
    right.next = left.next;
    if (left.next !== null) {
      left.next.prev = right;
    }
    left.next = right;
  }

  /** O(log n) worst case: links a child into its parent and splits overflowing parents. */
  private insertChildAfter(
    left: LevelNode<K, V>,
    right: LevelNode<K, V>,
  ): void {
    const parent = left.parent;
    if (parent === null) {
      const root = new LevelNode<K, V>(false);
      root.children = [left, right];
      left.parent = root;
      right.parent = root;
      left.prev = null;
      right.next = null;
      refreshNode(root);
      this._root = root;
      return;
    }
    const index = parent.children.indexOf(left);
    parent.children.splice(index + 1, 0, right);
    right.parent = parent;
    refreshNode(parent);
    if (parent.children.length > MAX_CHILDREN) {
      this.splitInternal(parent);
    } else {
      this.refreshUp(parent);
    }
  }

  /** O(log n) worst case: splits a five-child internal node. */
  private splitInternal(node: LevelNode<K, V>): void {
    const middle = 3;
    const right = new LevelNode<K, V>(false);
    right.children = node.children.splice(middle);
    for (const child of right.children) {
      child.parent = right;
    }
    right.parent = node.parent;
    this.linkAfter(node, right);
    refreshNode(node);
    refreshNode(right);
    this.insertChildAfter(node, right);
  }

  /** O(log n): refreshes every ancestor after a local change. */
  private refreshUp(start: LevelNode<K, V> | null): void {
    let current = start;
    while (current !== null) {
      refreshNode(current);
      current = current.parent;
    }
  }

  /** O(1): removes one leaf entry and repairs finger indices. */
  private removeEntryAt(leaf: LevelNode<K, V>, index: number): void {
    for (const finger of Array.from(leaf.fingers)) {
      if (finger._index === index) {
        this.killFinger(finger, leaf);
      } else if (finger._index > index) {
        finger._index--;
      }
    }
    leaf.keys.splice(index, 1);
    leaf.values.splice(index, 1);
    refreshNode(leaf);
  }

  /** O(log n) worst case: borrows or merges upward until every node is valid. */
  private fixAfterLeafDeletion(leaf: LevelNode<K, V>): void {
    let current: LevelNode<K, V> = leaf;
    for (;;) {
      if (current.isLeaf) {
        if (current === this._root) {
          if (current.keys.length === 0) {
            current.prev = null;
            current.next = null;
            this._root = null;
          } else {
            refreshNode(current);
          }
          return;
        }
        if (current.keys.length >= 1) {
          this.refreshUp(current);
          return;
        }
        const parent = current.parent as LevelNode<K, V>;
        const next = current.next;
        const prev = current.prev;
        if (
          next !== null &&
          next.parent === parent &&
          next.keys.length >= 2
        ) {
          this.borrowFirstLeaf(current, next);
          this.refreshUp(parent);
          return;
        }
        if (
          prev !== null &&
          prev.parent === parent &&
          prev.keys.length >= 2
        ) {
          this.borrowLastLeaf(current, prev);
          this.refreshUp(parent);
          return;
        }
        if (next !== null && next.parent === parent) {
          this.mergeLeaves(current, next);
          current = parent;
          continue;
        }
        if (prev !== null && prev.parent === parent) {
          this.mergeLeaves(prev, current);
          current = parent;
          continue;
        }
        current = parent;
        continue;
      }

      if (current === this._root) {
        if (current.children.length === 0) {
          this._root = null;
          return;
        }
        if (current.children.length === 1) {
          const child = current.children[0] as LevelNode<K, V>;
          child.parent = null;
          child.prev = null;
          child.next = null;
          this._root = child;
          return;
        }
        this.refreshUp(current);
        return;
      }
      if (current.children.length >= 2) {
        this.refreshUp(current);
        return;
      }
      const parent = current.parent as LevelNode<K, V>;
      const next = current.next;
      const prev = current.prev;
      if (
        next !== null &&
        next.parent === parent &&
        next.children.length >= 3
      ) {
        this.borrowFirstChild(current, next);
        this.refreshUp(parent);
        return;
      }
      if (
        prev !== null &&
        prev.parent === parent &&
        prev.children.length >= 3
      ) {
        this.borrowLastChild(current, prev);
        this.refreshUp(parent);
        return;
      }
      if (next !== null && next.parent === parent) {
        this.mergeChildren(current, next);
        current = parent;
        continue;
      }
      if (prev !== null && prev.parent === parent) {
        this.mergeChildren(prev, current);
        current = parent;
        continue;
      }
      current = parent;
    }
  }

  /** O(1): moves the first entry of `next` to the end of `current`. */
  private borrowFirstLeaf(
    current: LevelNode<K, V>,
    next: LevelNode<K, V>,
  ): void {
    const key = next.keys.shift() as K;
    const value = next.values.shift() as V;
    const offset = current.keys.length;
    current.keys.push(key);
    current.values.push(value);
    for (const finger of Array.from(next.fingers)) {
      if (finger._index === 0) {
        next.fingers.delete(finger);
        current.fingers.add(finger);
        finger._node = current;
        finger._index = offset;
      } else {
        finger._index--;
      }
    }
    refreshNode(current);
    refreshNode(next);
  }

  /** O(1): moves the last entry of `prev` to the front of `current`. */
  private borrowLastLeaf(
    current: LevelNode<K, V>,
    prev: LevelNode<K, V>,
  ): void {
    const removedIndex = prev.keys.length - 1;
    const key = prev.keys.pop() as K;
    const value = prev.values.pop() as V;
    for (const finger of current.fingers) {
      finger._index++;
    }
    for (const finger of Array.from(prev.fingers)) {
      if (finger._index === removedIndex) {
        prev.fingers.delete(finger);
        current.fingers.add(finger);
        finger._node = current;
        finger._index = 0;
      }
    }
    current.keys.unshift(key);
    current.values.unshift(value);
    refreshNode(current);
    refreshNode(prev);
  }

  /** O(1): moves the first child of `next` to the end of `current`. */
  private borrowFirstChild(
    current: LevelNode<K, V>,
    next: LevelNode<K, V>,
  ): void {
    const child = next.children.shift() as LevelNode<K, V>;
    current.children.push(child);
    child.parent = current;
    refreshNode(current);
    refreshNode(next);
  }

  /** O(1): moves the last child of `prev` to the front of `current`. */
  private borrowLastChild(
    current: LevelNode<K, V>,
    prev: LevelNode<K, V>,
  ): void {
    const child = prev.children.pop() as LevelNode<K, V>;
    current.children.unshift(child);
    child.parent = current;
    refreshNode(current);
    refreshNode(prev);
  }

  /** O(1): merges two leaf siblings and removes `source` from the parent. */
  private mergeLeaves(
    target: LevelNode<K, V>,
    source: LevelNode<K, V>,
  ): void {
    const offset = target.keys.length;
    target.keys.push(...source.keys);
    target.values.push(...source.values);
    for (const finger of Array.from(source.fingers)) {
      source.fingers.delete(finger);
      target.fingers.add(finger);
      finger._node = target;
      finger._index += offset;
    }
    const parent = source.parent as LevelNode<K, V>;
    this.unlinkLevel(source);
    this.removeChild(parent, source);
    refreshNode(target);
  }

  /** O(1): merges two internal siblings and removes `source` from the parent. */
  private mergeChildren(
    target: LevelNode<K, V>,
    source: LevelNode<K, V>,
  ): void {
    const parent = source.parent as LevelNode<K, V>;
    for (const child of source.children) {
      target.children.push(child);
      child.parent = target;
    }
    source.children = [];
    this.unlinkLevel(source);
    this.removeChild(parent, source);
    refreshNode(target);
  }

  /** O(1): drops a node from its same-level list. */
  private unlinkLevel(node: LevelNode<K, V>): void {
    if (node.prev !== null) {
      node.prev.next = node.next;
    }
    if (node.next !== null) {
      node.next.prev = node.prev;
    }
    node.prev = null;
    node.next = null;
  }

  /** O(1): removes a child from its parent. */
  private removeChild(
    parent: LevelNode<K, V>,
    child: LevelNode<K, V>,
  ): void {
    const index = parent.children.indexOf(child);
    if (index >= 0) {
      parent.children.splice(index, 1);
    }
    child.parent = null;
    refreshNode(parent);
  }

  /** O(f): invalidates every finger and marks this tree consumed by join or split. */
  private markConsumed(): void {
    this.invalidateAllFingers();
    this._consumed = true;
    this._root = null;
    this._size = 0;
    this.touch();
  }

  /** O(h): the nodes on one outer spine of a subtree, root first and leaf last. */
  private spine(
    root: LevelNode<K, V>,
    side: "left" | "right",
  ): Array<LevelNode<K, V>> {
    const nodes: Array<LevelNode<K, V>> = [root];
    let current = root;
    while (!current.isLeaf) {
      current = current.children[
        side === "left" ? 0 : current.children.length - 1
      ] as LevelNode<K, V>;
      nodes.push(current);
    }
    return nodes;
  }

  /**
   * O(log n): installs the concatenation of two valid trees (every key of `left` below every key
   * of `right`) as this tree's root. The facing spines are level-linked at every shared height,
   * then the shorter tree becomes an outer child of the taller one's spine node one level above
   * it, splitting upward on overflow.
   */
  private concatenate(
    left: LevelNode<K, V> | null,
    right: LevelNode<K, V> | null,
  ): void {
    if (left === null || right === null) {
      this._root = left ?? right;
      return;
    }
    const leftSpine = this.spine(left, "right");
    const rightSpine = this.spine(right, "left");
    const leftHeight = leftSpine.length - 1;
    const rightHeight = rightSpine.length - 1;
    for (let height = 0; height <= Math.min(leftHeight, rightHeight); height++) {
      const before = leftSpine[leftHeight - height] as LevelNode<K, V>;
      const after = rightSpine[rightHeight - height] as LevelNode<K, V>;
      before.next = after;
      after.prev = before;
    }
    if (leftHeight === rightHeight) {
      const root = new LevelNode<K, V>(false);
      root.children = [left, right];
      left.parent = root;
      right.parent = root;
      refreshNode(root);
      this._root = root;
      return;
    }
    let target: LevelNode<K, V>;
    if (leftHeight > rightHeight) {
      this._root = left;
      target = leftSpine[leftHeight - rightHeight - 1] as LevelNode<K, V>;
      target.children.push(right);
      right.parent = target;
    } else {
      this._root = right;
      target = rightSpine[rightHeight - leftHeight - 1] as LevelNode<K, V>;
      target.children.unshift(left);
      left.parent = target;
    }
    refreshNode(target);
    if (target.children.length > MAX_CHILDREN) {
      this.splitInternal(target);
    } else {
      this.refreshUp(target);
    }
  }

  /**
   * O(log n): repairs the exposed spine of one half after `splitAt`. `leaf` is the half's outer
   * leaf on the cut side (`side` is "right" for the left half). Internal nodes on that spine may
   * hold a single child; each is fixed by borrowing from, or merging into, its inward level
   * neighbour, which is never on the spine and so always has 2-4 children. Merges may empty the
   * spine node's ancestors; those are unlinked as they empty. The first node found alone on its
   * level is the new root. Every changed node is a spine node or its inward neighbour, so one final
   * pass refreshing those two nodes per level restores counts and separators.
   */
  private repairSpine(
    leaf: LevelNode<K, V>,
    side: "left" | "right",
  ): LevelNode<K, V> {
    const inward = side === "right" ? "prev" : "next";
    let node = leaf;
    let root: LevelNode<K, V>;
    for (;;) {
      if (node[inward] === null) {
        // Alone on its level: every node above is a single-child chain.
        root = node;
        break;
      }
      const parent = node.parent as LevelNode<K, V>;
      if (parent.children.length >= 2) {
        node = parent;
        continue;
      }
      const sibling = parent[inward] as LevelNode<K, V>;
      if (sibling.children.length >= 3) {
        const moved = (
          side === "right" ? sibling.children.pop() : sibling.children.shift()
        ) as LevelNode<K, V>;
        if (side === "right") {
          parent.children.unshift(moved);
        } else {
          parent.children.push(moved);
        }
        moved.parent = parent;
        node = parent;
        continue;
      }
      if (side === "right") {
        sibling.children.push(node);
      } else {
        sibling.children.unshift(node);
      }
      node.parent = sibling;
      parent.children = [];
      let empty: LevelNode<K, V> = parent;
      while (empty.children.length === 0) {
        const above = empty.parent as LevelNode<K, V>;
        this.unlinkLevel(empty);
        const slot = above.children.indexOf(empty);
        above.children.splice(slot, 1);
        empty.parent = null;
        empty = above;
      }
      node = sibling;
    }

    let current = leaf;
    for (;;) {
      const neighbour = current[inward];
      if (neighbour !== null) {
        refreshNode(neighbour);
      }
      refreshNode(current);
      if (current === root) {
        break;
      }
      current = current.parent as LevelNode<K, V>;
    }
    root.parent = null;
    root.prev = null;
    root.next = null;
    return root;
  }

  /** O(n): rebuilds the whole tree from sorted entries. */
  private bulkLoad(entries: ReadonlyArray<readonly [K, V]>): void {
    this.invalidateAllFingers();
    this._root = null;
    this._size = 0;
    if (entries.length === 0) {
      return;
    }
    for (let index = 1; index < entries.length; index++) {
      if (
        this.compare(
          (entries[index - 1] as readonly [K, V])[0],
          (entries[index] as readonly [K, V])[0],
        ) >= 0
      ) {
        throw new TypeError("entries must be sorted and strictly increasing");
      }
    }

    const leaves: Array<LevelNode<K, V>> = [];
    for (let start = 0; start < entries.length; start += MAX_LEAF_KEYS) {
      const chunk = entries.slice(start, start + MAX_LEAF_KEYS);
      leaves.push(
        this.createLeaf(
          chunk.map((entry) => entry[0]),
          chunk.map((entry) => entry[1]),
        ),
      );
    }
    this.linkLevel(leaves);
    let level = leaves;
    while (level.length > 1) {
      const parents: Array<LevelNode<K, V>> = [];
      for (const group of this.groupLevel(level)) {
        const parent = new LevelNode<K, V>(false);
        parent.children = group;
        for (const child of group) {
          child.parent = parent;
        }
        refreshNode(parent);
        parents.push(parent);
      }
      this.linkLevel(parents);
      level = parents;
    }
    this._root = level[0] as LevelNode<K, V>;
    this._root.parent = null;
    this._root.prev = null;
    this._root.next = null;
    this._size = entries.length;
  }

  /** O(1): creates a leaf from parallel key/value arrays. */
  private createLeaf(keys: K[], values: V[]): LevelNode<K, V> {
    const leaf = new LevelNode<K, V>(true);
    leaf.keys = keys;
    leaf.values = values;
    refreshNode(leaf);
    return leaf;
  }

  /** O(k): links an ordered array of k nodes into one level. */
  private linkLevel(nodes: Array<LevelNode<K, V>>): void {
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index] as LevelNode<K, V>;
      node.prev = index === 0 ? null : (nodes[index - 1] as LevelNode<K, V>);
      node.next =
        index + 1 === nodes.length
          ? null
          : (nodes[index + 1] as LevelNode<K, V>);
    }
  }

  /** O(k): groups a level of k nodes into 2-4 child nodes, avoiding a one-child tail. */
  private groupLevel(
    nodes: Array<LevelNode<K, V>>,
  ): Array<Array<LevelNode<K, V>>> {
    const groups: Array<Array<LevelNode<K, V>>> = [];
    let index = 0;
    while (index < nodes.length) {
      let size = Math.min(MAX_CHILDREN, nodes.length - index);
      if (nodes.length - index - size === 1) {
        size--;
      }
      groups.push(nodes.slice(index, index + size));
      index += size;
    }
    return groups;
  }
}
