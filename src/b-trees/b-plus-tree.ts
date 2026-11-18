import {
  assertDefined,
  assertInteger,
  ConcurrentModificationError,
  ContainerBase,
  resolveComparator,
} from "../core/index.ts";
import type { Comparator, RangeOptions } from "../core/index.ts";
import { readBTreeEntries, serializeBTreeEntries } from "./serialization.ts";
import type {
  BTree as BTreeContract,
  BTreeOptions,
} from "./types.ts";

const DEFAULT_ORDER = 4;

interface LeafLocation<K, V> {
  leaf: BPlusNode<K, V>;
  index: number;
  found: boolean;
}

interface NodeAt<K, V> {
  node: BPlusNode<K, V>;
  index: number;
}

interface ValidationFrame<K, V> {
  node: BPlusNode<K, V>;
  depth: number;
  lo: K | undefined;
  hi: K | undefined;
}

/**
 * A B+-tree node. Internal nodes hold separator keys only; leaves hold the entries and are linked
 * in key order through `next`/`prev`. In an internal node, `keys[index]` is the smallest key of the
 * subtree at `children[index + 1]`, so the leftmost child has no separator before it. `count` caches
 * the number of entries in the subtree and drives select/rank.
 */
class BPlusNode<K, V> {
  keys: K[] = [];
  values: V[] = [];
  children: BPlusNode<K, V>[] = [];
  parent: BPlusNode<K, V> | null;
  next: BPlusNode<K, V> | null = null;
  prev: BPlusNode<K, V> | null = null;
  count = 0;

  constructor(parent: BPlusNode<K, V> | null) {
    this.parent = parent;
  }

  get isLeaf(): boolean {
    return this.children.length === 0;
  }
}

/** O(1): recomputes a node's cached subtree entry count. */
function refreshCount<K, V>(node: BPlusNode<K, V>): void {
  if (node.isLeaf) {
    node.count = node.keys.length;
    return;
  }
  let count = 0;
  for (const child of node.children) {
    count += child.count;
  }
  node.count = count;
}

/** O(log m): first index whose key is not less than `key`. */
function lowerBound<K>(
  keys: readonly K[],
  key: K,
  compare: Comparator<K>,
): number {
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const middle = (lo + hi) >>> 1;
    if (compare(keys[middle] as K, key) < 0) {
      lo = middle + 1;
    } else {
      hi = middle;
    }
  }
  return lo;
}

/** O(log m): first index whose key is strictly greater than `key`. */
function upperBound<K>(
  keys: readonly K[],
  key: K,
  compare: Comparator<K>,
): number {
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const middle = (lo + hi) >>> 1;
    if (compare(keys[middle] as K, key) <= 0) {
      lo = middle + 1;
    } else {
      hi = middle;
    }
  }
  return lo;
}

/** O(1): a defined key or value is required, because `undefined` means "absent". */
function requireEntry<K, V>(key: K, value: V): void {
  assertDefined(key, "key");
  assertDefined(value, "value");
}

/**
 * B+-tree with a configurable order. Internal nodes hold between `minFill` and `order` children,
 * every node holds at most `order - 1` keys, and all entries live in leaves that are linked in key
 * order. Non-root leaves hold at least `minFill - 1` entries, non-root internal nodes hold at least
 * `minFill` children, and all leaves sit at the same depth.
 *
 * Insertions split an overflowing leaf or internal node on the way back to the root, promoting the
 * first key of the new right node. Deletions remove the entry from its leaf and repair underflow
 * with sibling borrows or merges, which also keep the leaf links intact. Cached subtree counts make
 * `at`, `indexOf`, and `bulkLoad` logarithmic or linear as documented, and range scans follow the
 * leaf chain after one root descent.
 */
export class BPlusTree<K, V = K>
  extends ContainerBase<[K, V]>
  implements BTreeContract<K, V>
{
  readonly compare: Comparator<K>;
  readonly order: number;
  readonly minFill: number;
  private readonly _maxKeys: number;
  private readonly _minKeys: number;
  private _root: BPlusNode<K, V> | null = null;
  private _height = -1;

  constructor(compare?: Comparator<K>);
  constructor(options?: BTreeOptions<K>);
  constructor(compareOrOptions?: Comparator<K> | BTreeOptions<K>);
  /** O(1); accepts either a comparator or a `BTreeOptions` object. The default order is 4. */
  constructor(compareOrOptions?: Comparator<K> | BTreeOptions<K>) {
    super();
    const options: BTreeOptions<K> =
      typeof compareOrOptions === "function"
        ? { compare: compareOrOptions }
        : compareOrOptions ?? {};
    const order = options.order ?? DEFAULT_ORDER;
    assertInteger(order, "order");
    if (order < 3) {
      throw new RangeError("BPlusTree order must be at least 3");
    }
    this.order = order;
    this.minFill = Math.ceil(order / 2);
    this._maxKeys = order - 1;
    this._minKeys = this.minFill - 1;
    this.compare = resolveComparator(options.compare);
  }

  /** O(1): number of edges from the root to a leaf; -1 for an empty tree. */
  get height(): number {
    return this._height;
  }

  /** O(log n): replaces an existing value or inserts a key into its leaf. */
  set(key: K, value: V): this {
    requireEntry(key, value);
    if (this._root === null) {
      const root = new BPlusNode<K, V>(null);
      root.keys.push(key);
      root.values.push(value);
      root.count = 1;
      this._root = root;
      this._size = 1;
      this._height = 0;
      this.touch();
      return this;
    }
    const location = this.locate(key);
    if (location.found) {
      location.leaf.values[location.index] = value;
      this.touch();
      return this;
    }
    const leaf = location.leaf;
    leaf.keys.splice(location.index, 0, key);
    leaf.values.splice(location.index, 0, value);
    this._size++;
    let parent: BPlusNode<K, V> | null = null;
    if (leaf.keys.length > this._maxKeys) {
      parent = this.splitLeaf(leaf);
    }
    while (parent !== null && parent.keys.length > this._maxKeys) {
      parent = this.splitInternal(parent);
    }
    this.updateCountsUp(leaf);
    this.touch();
    return this;
  }

  /** O(log n): the value for `key`, or undefined when absent. */
  get(key: K): V | undefined {
    assertDefined(key, "key");
    if (this._root === null) {
      return undefined;
    }
    const location = this.locate(key);
    return location.found
      ? location.leaf.values[location.index]
      : undefined;
  }

  /** O(log n): membership test. */
  has(key: K): boolean {
    assertDefined(key, "key");
    if (this._root === null) {
      return false;
    }
    return this.locate(key).found;
  }

  /** O(log n): removes `key` from its leaf and repairs underflow bottom-up. */
  delete(key: K): boolean {
    assertDefined(key, "key");
    if (this._root === null) {
      return false;
    }
    const location = this.locate(key);
    if (!location.found) {
      return false;
    }
    const leaf = location.leaf;
    leaf.keys.splice(location.index, 1);
    leaf.values.splice(location.index, 1);
    this._size--;
    this.repairAfterDelete(leaf);
    this.touch();
    return true;
  }

  /** O(log n): the first entry, taken from the leftmost leaf. */
  min(): [K, V] | undefined {
    if (this._root === null) {
      return undefined;
    }
    const leaf = this.leftmostLeaf();
    return [leaf.keys[0] as K, leaf.values[0] as V];
  }

  /** O(log n): the last entry, taken from the rightmost leaf. */
  max(): [K, V] | undefined {
    if (this._root === null) {
      return undefined;
    }
    const leaf = this.rightmostLeaf();
    const index = leaf.keys.length - 1;
    return [leaf.keys[index] as K, leaf.values[index] as V];
  }

  /** O(log n): largest entry strictly less than `key`; absent keys are supported. */
  predecessor(key: K): [K, V] | undefined {
    assertDefined(key, "key");
    if (this._root === null) {
      return undefined;
    }
    const location = this.locate(key);
    if (location.index > 0) {
      return this.entryAt(location.leaf, location.index - 1);
    }
    const previous = location.leaf.prev;
    if (previous === null) {
      return undefined;
    }
    return this.entryAt(previous, previous.keys.length - 1);
  }

  /** O(log n): smallest entry strictly greater than `key`; absent keys are supported. */
  successor(key: K): [K, V] | undefined {
    assertDefined(key, "key");
    if (this._root === null) {
      return undefined;
    }
    const location = this.locate(key);
    let index = location.index;
    if (location.found) {
      index++;
    }
    if (index < location.leaf.keys.length) {
      return this.entryAt(location.leaf, index);
    }
    const next = location.leaf.next;
    if (next === null) {
      return undefined;
    }
    return this.entryAt(next, 0);
  }

  /** O(log n): select by rank through the cached subtree counts. */
  at(index: number): [K, V] | undefined {
    assertInteger(index);
    if (index < 0 || index >= this._size || this._root === null) {
      return undefined;
    }
    let node = this._root;
    let remaining = index;
    while (!node.isLeaf) {
      let descended = false;
      for (let childIndex = 0; childIndex < node.children.length; childIndex++) {
        const child = node.children[childIndex] as BPlusNode<K, V>;
        if (remaining < child.count) {
          node = child;
          descended = true;
          break;
        }
        remaining -= child.count;
      }
      if (!descended) {
        return undefined;
      }
    }
    return this.entryAt(node, remaining);
  }

  /** O(log n): rank through cached subtree counts; -1 when the key is absent. */
  indexOf(key: K): number {
    assertDefined(key, "key");
    if (this._root === null) {
      return -1;
    }
    let node = this._root;
    let rank = 0;
    while (!node.isLeaf) {
      const index = upperBound(node.keys, key, this.compare);
      for (let childIndex = 0; childIndex < index; childIndex++) {
        rank += (node.children[childIndex] as BPlusNode<K, V>).count;
      }
      node = node.children[index] as BPlusNode<K, V>;
    }
    const index = lowerBound(node.keys, key, this.compare);
    if (
      index < node.keys.length &&
      this.compare(node.keys[index] as K, key) === 0
    ) {
      return rank + index;
    }
    return -1;
  }

  /** O(log n + k): root descent to the first leaf entry, then a leaf-chain scan. */
  range(
    lo?: K,
    hi?: K,
    options?: RangeOptions<K>,
  ): IterableIterator<[K, V]> {
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
    if (
      lo !== undefined &&
      hi !== undefined &&
      this.compare(lo, hi) > 0
    ) {
      return this.makeRangeIterator(null, hi, hiInclusive);
    }
    return this.makeRangeIterator(
      this.rangeStart(lo, loInclusive),
      hi,
      hiInclusive,
    );
  }

  /** O(n): ascending keys, following the leaf chain. */
  keys(): IterableIterator<K> {
    return this.mapIterator(this.entries(), (entry) => entry[0]);
  }

  /** O(n): ascending values, following the leaf chain. */
  values(): IterableIterator<V> {
    return this.mapIterator(this.entries(), (entry) => entry[1]);
  }

  /** O(n): ascending entries, following the leaf chain. */
  entries(): IterableIterator<[K, V]> {
    return this.range();
  }

  /** O(n): in-order entry list. */
  override toArray(): Array<[K, V]> {
    const entries: Array<[K, V]> = [];
    if (this._root === null) {
      return entries;
    }
    let leaf: BPlusNode<K, V> | null = this.leftmostLeaf();
    while (leaf !== null) {
      for (let index = 0; index < leaf.keys.length; index++) {
        entries.push([
          leaf.keys[index] as K,
          leaf.values[index] as V,
        ]);
      }
      leaf = leaf.next;
    }
    return entries;
  }

  /** Same as entries(). */
  override [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }

  /** O(1): drops every entry. */
  override clear(): void {
    this._root = null;
    this._size = 0;
    this._height = -1;
    this.touch();
  }

  /**
   * O(n): replaces the contents with sorted entries by building leaves and then the internal levels
   * bottom-up. Equal keys keep the last value, matching repeated `set`, while a key smaller than its
   * predecessor throws `RangeError` before the tree is modified.
   */
  bulkLoad(entries: Iterable<[K, V]>): void {
    const prepared: Array<[K, V]> = [];
    for (const entry of entries) {
      const key = entry[0];
      const value = entry[1];
      requireEntry(key, value);
      if (prepared.length > 0) {
        const previous = prepared[prepared.length - 1] as [K, V];
        const comparison = this.compare(previous[0], key);
        if (comparison > 0) {
          throw new RangeError(
            "bulkLoad requires entries sorted by key ascending",
          );
        }
        if (comparison === 0) {
          previous[1] = value;
          continue;
        }
      }
      prepared.push([key, value]);
    }
    this.buildFromSorted(prepared);
    this.touch();
  }

  /** O(n): dumps ascending entries in the shared serialization shape. */
  serialize(): string {
    return serializeBTreeEntries("BPlusTree", this.toArray());
  }

  /** O(n): rebuilds a valid B+-tree from sorted entries. */
  static deserialize<K, V>(
    json: unknown,
    compareOrOptions?: Comparator<K> | BTreeOptions<K>,
  ): BPlusTree<K, V> {
    const entries = readBTreeEntries<K, V>(json, "BPlusTree");
    const tree = new BPlusTree<K, V>(compareOrOptions);
    try {
      tree.bulkLoad(entries);
    } catch (error) {
      if (error instanceof RangeError) {
        throw new TypeError(error.message);
      }
      throw error;
    }
    return tree;
  }

  /**
   * O(n): checks occupancy, separator and leaf key order, child containment, parent links, equal
   * leaf depth, cached counts, cached height, and the doubly linked leaf chain.
   */
  override validate(): true | string {
    if (this._root === null) {
      if (this._size !== 0) {
        return "non-empty size with empty root";
      }
      if (this._height !== -1) {
        return "empty tree has a non-negative height";
      }
      return true;
    }
    if (this._size === 0) {
      return "empty size with a live root";
    }
    if (this._root.parent !== null) {
      return "root has a parent";
    }

    const seen = new Set<BPlusNode<K, V>>();
    const stack: ValidationFrame<K, V>[] = [
      { node: this._root, depth: 0, lo: undefined, hi: undefined },
    ];
    let leafDepth = -1;
    let entryCount = 0;
    let leafTotal = 0;
    while (stack.length > 0) {
      const frame = stack.pop() as ValidationFrame<K, V>;
      const node = frame.node;
      const isRoot = frame.depth === 0;
      const minimumKeys = isRoot ? 1 : this._minKeys;
      if (seen.has(node)) {
        return "cycle detected in child links";
      }
      seen.add(node);
      if (node.keys.length < minimumKeys) {
        return `node at depth ${frame.depth} has too few keys`;
      }
      if (node.keys.length > this._maxKeys) {
        return `node at depth ${frame.depth} has too many keys`;
      }
      for (let index = 0; index < node.keys.length; index++) {
        const key = node.keys[index];
        if (key === undefined) {
          return `node at depth ${frame.depth} has an undefined key`;
        }
        if (
          index > 0 &&
          this.compare(node.keys[index - 1] as K, key) >= 0
        ) {
          return `node at depth ${frame.depth} is not strictly ordered`;
        }
        if (
          frame.lo !== undefined &&
          this.compare(key, frame.lo) < 0
        ) {
          return `node at depth ${frame.depth} has a key below its range`;
        }
        if (
          frame.hi !== undefined &&
          this.compare(key, frame.hi) >= 0
        ) {
          return `node at depth ${frame.depth} has a key above its range`;
        }
      }

      if (node.isLeaf) {
        leafTotal++;
        if (leafDepth === -1) {
          leafDepth = frame.depth;
        } else if (leafDepth !== frame.depth) {
          return "leaves are not all at the same depth";
        }
        if (node.values.length !== node.keys.length) {
          return `leaf at depth ${frame.depth} has mismatched values`;
        }
        if (node.count !== node.keys.length) {
          return `leaf at depth ${frame.depth} has a stale count`;
        }
        for (let index = 0; index < node.keys.length; index++) {
          if (node.values[index] === undefined) {
            return `leaf at depth ${frame.depth} has an undefined value`;
          }
        }
        entryCount += node.keys.length;
      } else {
        if (node.values.length !== 0) {
          return `internal node at depth ${frame.depth} holds values`;
        }
        if (node.children.length !== node.keys.length + 1) {
          return `internal node at depth ${frame.depth} has inconsistent children`;
        }
        let count = 0;
        for (let index = 0; index < node.children.length; index++) {
          const child = node.children[index] as BPlusNode<K, V>;
          if (child.parent !== node) {
            return `child at depth ${frame.depth} has an incorrect parent`;
          }
          count += child.count;
          const childLo =
            index === 0 ? frame.lo : (node.keys[index - 1] as K);
          const childHi =
            index === node.keys.length ? frame.hi : (node.keys[index] as K);
          stack.push({
            node: child,
            depth: frame.depth + 1,
            lo: childLo,
            hi: childHi,
          });
        }
        if (node.count !== count) {
          return `internal node at depth ${frame.depth} has a stale count`;
        }
      }
    }

    if (leafDepth !== this._height) {
      return `height ${this._height} does not match leaf depth ${leafDepth}`;
    }
    if (entryCount !== this._size) {
      return `size ${this._size} does not match entry count ${entryCount}`;
    }
    if ((this._root as BPlusNode<K, V>).count !== this._size) {
      return "root count does not match size";
    }

    const first = this.leftmostLeaf();
    if (first.prev !== null) {
      return "first leaf has a previous link";
    }
    const linked = new Set<BPlusNode<K, V>>();
    let previous: BPlusNode<K, V> | null = null;
    let cursor: BPlusNode<K, V> | null = first;
    let linkedEntries = 0;
    while (cursor !== null) {
      if (linked.has(cursor)) {
        return "cycle detected in leaf links";
      }
      linked.add(cursor);
      if (!cursor.isLeaf) {
        return "leaf link points at an internal node";
      }
      if (cursor.prev !== previous) {
        return "leaf link does not match the previous leaf";
      }
      if (previous !== null && previous.next !== cursor) {
        return "previous leaf does not link to the next leaf";
      }
      linkedEntries += cursor.keys.length;
      previous = cursor;
      cursor = cursor.next;
    }
    if ((previous as BPlusNode<K, V> | null)?.next !== null) {
      return "last leaf has a next link";
    }
    if (linked.size !== leafTotal) {
      return "leaf chain does not contain every leaf";
    }
    if (linkedEntries !== this._size) {
      return "leaf chain entry count does not match size";
    }
    return true;
  }

  /** O(log n): ordinary root descent to the leaf entry or its insertion slot. */
  private locate(key: K): LeafLocation<K, V> {
    let node = this._root as BPlusNode<K, V>;
    while (!node.isLeaf) {
      const index = upperBound(node.keys, key, this.compare);
      node = node.children[index] as BPlusNode<K, V>;
    }
    const index = lowerBound(node.keys, key, this.compare);
    const found =
      index < node.keys.length &&
      this.compare(node.keys[index] as K, key) === 0;
    return { leaf: node, index, found };
  }

  /** O(log n): resolves the first leaf entry at or after `lo`. */
  private rangeStart(
    lo: K | undefined,
    loInclusive: boolean,
  ): NodeAt<K, V> | null {
    if (this._root === null) {
      return null;
    }
    if (lo === undefined) {
      return { node: this.leftmostLeaf(), index: 0 };
    }
    let node = this._root;
    while (!node.isLeaf) {
      const index = upperBound(node.keys, lo, this.compare);
      node = node.children[index] as BPlusNode<K, V>;
    }
    let index = lowerBound(node.keys, lo, this.compare);
    if (
      !loInclusive &&
      index < node.keys.length &&
      this.compare(node.keys[index] as K, lo) === 0
    ) {
      index++;
    }
    if (index < node.keys.length) {
      return { node, index };
    }
    const next = node.next;
    return next === null ? null : { node: next, index: 0 };
  }

  /**
   * O(1) to create and O(1) per step. Walks the leaf chain, checking the container version before
   * every value so mutation is detected during iteration.
   */
  private makeRangeIterator(
    start: NodeAt<K, V> | null,
    hi: K | undefined,
    hiInclusive: boolean,
  ): IterableIterator<[K, V]> {
    const tree = this;
    const expected = this._version;
    let leaf = start === null ? null : start.node;
    let index = start === null ? 0 : start.index;
    let done = leaf === null;
    const iterator: IterableIterator<[K, V]> = {
      next(): IteratorResult<[K, V]> {
        if (tree._version !== expected) {
          throw new ConcurrentModificationError();
        }
        while (!done && leaf !== null) {
          if (index >= leaf.keys.length) {
            leaf = leaf.next;
            index = 0;
            if (leaf === null) {
              done = true;
            }
            continue;
          }
          const key = leaf.keys[index] as K;
          if (hi !== undefined) {
            const comparison = tree.compare(key, hi);
            if (comparison > 0 || (comparison === 0 && !hiInclusive)) {
              done = true;
              break;
            }
          }
          const value = leaf.values[index] as V;
          index++;
          return { done: false, value: [key, value] };
        }
        return { done: true, value: undefined };
      },
      [Symbol.iterator]() {
        return iterator;
      },
    };
    return iterator;
  }

  /** O(1) to create and O(1) per step: maps a fail-fast iterator. */
  private mapIterator<U, W>(
    source: IterableIterator<U>,
    map: (value: U) => W,
  ): IterableIterator<W> {
    const iterator: IterableIterator<W> = {
      next(): IteratorResult<W> {
        const result = source.next();
        if (result.done) {
          return { done: true, value: undefined };
        }
        return { done: false, value: map(result.value) };
      },
      [Symbol.iterator]() {
        return iterator;
      },
    };
    return iterator;
  }

  /** O(1): leftmost leaf of a non-empty tree. */
  private leftmostLeaf(): BPlusNode<K, V> {
    let node = this._root as BPlusNode<K, V>;
    while (!node.isLeaf) {
      node = node.children[0] as BPlusNode<K, V>;
    }
    return node;
  }

  /** O(1): rightmost leaf of a non-empty tree. */
  private rightmostLeaf(): BPlusNode<K, V> {
    let node = this._root as BPlusNode<K, V>;
    while (!node.isLeaf) {
      node = node.children[
        node.children.length - 1
      ] as BPlusNode<K, V>;
    }
    return node;
  }

  /** O(1): materializes one entry. */
  private entryAt(node: BPlusNode<K, V>, index: number): [K, V] {
    return [node.keys[index] as K, node.values[index] as V];
  }

  /**
   * O(log n) worst case: splits an overflowing leaf, links the new right leaf, and promotes the
   * first key of the right leaf into the parent.
   */
  private splitLeaf(leaf: BPlusNode<K, V>): BPlusNode<K, V> {
    const middle = Math.ceil(leaf.keys.length / 2);
    const right = new BPlusNode<K, V>(leaf.parent);
    right.keys = leaf.keys.splice(middle);
    right.values = leaf.values.splice(middle);
    right.next = leaf.next;
    if (right.next !== null) {
      right.next.prev = right;
    }
    right.prev = leaf;
    leaf.next = right;
    refreshCount(leaf);
    refreshCount(right);
    return this.insertSeparator(leaf, right.keys[0] as K, right);
  }

  /**
   * O(log n) worst case: splits an overflowing internal node, promoting its middle separator. The
   * promoted key is not stored again below, so both children keep their separator ranges intact.
   */
  private splitInternal(node: BPlusNode<K, V>): BPlusNode<K, V> {
    const middle = Math.floor(node.keys.length / 2);
    const promoted = node.keys[middle] as K;
    const right = new BPlusNode<K, V>(node.parent);
    right.keys = node.keys.splice(middle + 1);
    node.keys.pop();
    right.children = node.children.splice(middle + 1);
    for (const child of right.children) {
      child.parent = right;
    }
    refreshCount(node);
    refreshCount(right);
    return this.insertSeparator(node, promoted, right);
  }

  /**
   * O(log n) worst case: installs `separator` and `right` next to `left` in the parent, creating a
   * new root when the split reached the top.
   */
  private insertSeparator(
    left: BPlusNode<K, V>,
    separator: K,
    right: BPlusNode<K, V>,
  ): BPlusNode<K, V> {
    if (left.parent === null) {
      const root = new BPlusNode<K, V>(null);
      root.keys.push(separator);
      root.children.push(left, right);
      left.parent = root;
      right.parent = root;
      refreshCount(root);
      this._root = root;
      this._height++;
      return root;
    }
    const parent = left.parent;
    const childIndex = parent.children.indexOf(left);
    parent.keys.splice(childIndex, 0, separator);
    parent.children.splice(childIndex + 1, 0, right);
    right.parent = parent;
    refreshCount(parent);
    return parent;
  }

  /** O(log n) worst case: borrows or merges until the tree is valid again. */
  private repairAfterDelete(start: BPlusNode<K, V>): void {
    let current = start;
    for (;;) {
      if (current === this._root) {
        if (current.keys.length === 0) {
          if (current.isLeaf) {
            this._root = null;
            this._height = -1;
          } else {
            const child = current.children[0] as BPlusNode<K, V>;
            child.parent = null;
            this._root = child;
            this._height--;
            refreshCount(child);
          }
        } else {
          refreshCount(current);
        }
        return;
      }
      if (current.keys.length >= this._minKeys) {
        this.updateCountsUp(current);
        return;
      }

      const parent = current.parent as BPlusNode<K, V>;
      const index = parent.children.indexOf(current);
      const right =
        index + 1 < parent.children.length
          ? (parent.children[index + 1] as BPlusNode<K, V>)
          : null;
      if (right !== null && right.keys.length > this._minKeys) {
        this.borrowFromRight(current, parent, index, right);
        this.updateCountsUp(parent);
        return;
      }
      const left =
        index > 0
          ? (parent.children[index - 1] as BPlusNode<K, V>)
          : null;
      if (left !== null && left.keys.length > this._minKeys) {
        this.borrowFromLeft(current, parent, index, left);
        this.updateCountsUp(parent);
        return;
      }
      if (right !== null) {
        this.mergeRight(current, parent, index, right);
        current = parent;
        continue;
      }
      if (left !== null) {
        this.mergeLeft(left, parent, index, current);
        current = parent;
        continue;
      }
      current = parent;
    }
  }

  /** O(1): moves one leaf entry or one separator and child from the right sibling. */
  private borrowFromRight(
    target: BPlusNode<K, V>,
    parent: BPlusNode<K, V>,
    index: number,
    right: BPlusNode<K, V>,
  ): void {
    if (target.isLeaf) {
      target.keys.push(right.keys.shift() as K);
      target.values.push(right.values.shift() as V);
      parent.keys[index] = right.keys[0] as K;
    } else {
      target.keys.push(parent.keys[index] as K);
      const child = right.children.shift() as BPlusNode<K, V>;
      child.parent = target;
      target.children.push(child);
      parent.keys[index] = right.keys.shift() as K;
    }
    refreshCount(target);
    refreshCount(right);
  }

  /** O(1): moves one leaf entry or one separator and child from the left sibling. */
  private borrowFromLeft(
    target: BPlusNode<K, V>,
    parent: BPlusNode<K, V>,
    index: number,
    left: BPlusNode<K, V>,
  ): void {
    if (target.isLeaf) {
      target.keys.unshift(left.keys.pop() as K);
      target.values.unshift(left.values.pop() as V);
      parent.keys[index - 1] = target.keys[0] as K;
    } else {
      target.keys.unshift(parent.keys[index - 1] as K);
      const child = left.children.pop() as BPlusNode<K, V>;
      child.parent = target;
      target.children.unshift(child);
      parent.keys[index - 1] = left.keys.pop() as K;
    }
    refreshCount(left);
    refreshCount(target);
  }

  /** O(1): folds the right sibling into the underfull node and repairs the leaf links. */
  private mergeRight(
    target: BPlusNode<K, V>,
    parent: BPlusNode<K, V>,
    index: number,
    right: BPlusNode<K, V>,
  ): void {
    if (target.isLeaf) {
      target.keys.push(...right.keys);
      target.values.push(...right.values);
      target.next = right.next;
      if (right.next !== null) {
        right.next.prev = target;
      }
    } else {
      target.keys.push(parent.keys[index] as K);
      target.keys.push(...right.keys);
      for (const child of right.children) {
        child.parent = target;
        target.children.push(child);
      }
    }
    parent.keys.splice(index, 1);
    parent.children.splice(index + 1, 1);
    right.parent = null;
    right.next = null;
    right.prev = null;
    refreshCount(target);
  }

  /** O(1): folds the underfull node and the separator into the left sibling. */
  private mergeLeft(
    left: BPlusNode<K, V>,
    parent: BPlusNode<K, V>,
    index: number,
    source: BPlusNode<K, V>,
  ): void {
    if (left.isLeaf) {
      left.keys.push(...source.keys);
      left.values.push(...source.values);
      left.next = source.next;
      if (source.next !== null) {
        source.next.prev = left;
      }
    } else {
      left.keys.push(parent.keys[index - 1] as K);
      left.keys.push(...source.keys);
      for (const child of source.children) {
        child.parent = left;
        left.children.push(child);
      }
    }
    parent.keys.splice(index - 1, 1);
    parent.children.splice(index, 1);
    source.parent = null;
    source.next = null;
    source.prev = null;
    refreshCount(left);
  }

  /** O(log n): refreshes cached counts from a changed node to the root. */
  private updateCountsUp(start: BPlusNode<K, V>): void {
    let current: BPlusNode<K, V> | null = start;
    while (current !== null) {
      refreshCount(current);
      current = current.parent;
    }
  }

  /**
   * O(n): builds a valid B+-tree directly from ordered entries. Leaves are filled with balanced
   * sizes and linked in order; each internal level groups the level below into balanced nodes whose
   * separators are the smallest keys of their right subtrees.
   */
  private buildFromSorted(
    entries: ReadonlyArray<readonly [K, V]>,
  ): void {
    if (entries.length === 0) {
      this._root = null;
      this._size = 0;
      this._height = -1;
      return;
    }

    const leafCount = Math.ceil(entries.length / this._maxKeys);
    const base = Math.floor(entries.length / leafCount);
    const remainder = entries.length % leafCount;
    const leaves: BPlusNode<K, V>[] = [];
    let previous: BPlusNode<K, V> | null = null;
    let cursor = 0;
    for (let leafIndex = 0; leafIndex < leafCount; leafIndex++) {
      const size = base + (leafIndex < remainder ? 1 : 0);
      const leaf = new BPlusNode<K, V>(null);
      for (let offset = 0; offset < size; offset++) {
        const entry = entries[cursor + offset] as readonly [K, V];
        leaf.keys.push(entry[0]);
        leaf.values.push(entry[1]);
      }
      cursor += size;
      refreshCount(leaf);
      leaf.prev = previous;
      if (previous !== null) {
        previous.next = leaf;
      }
      previous = leaf;
      leaves.push(leaf);
    }

    let level = leaves;
    let height = 0;
    while (level.length > 1) {
      level = this.buildLevel(level);
      height++;
    }
    const root = level[0] as BPlusNode<K, V>;
    root.parent = null;
    this._root = root;
    this._size = entries.length;
    this._height = height;
  }

  /** O(n) over the level: groups children into balanced internal nodes. */
  private buildLevel(
    children: BPlusNode<K, V>[],
  ): BPlusNode<K, V>[] {
    const nodeCount = Math.ceil(children.length / this.order);
    const base = Math.floor(children.length / nodeCount);
    const remainder = children.length % nodeCount;
    const parents: BPlusNode<K, V>[] = [];
    let cursor = 0;
    for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex++) {
      const size = base + (nodeIndex < remainder ? 1 : 0);
      const parent = new BPlusNode<K, V>(null);
      let count = 0;
      for (let childOffset = 0; childOffset < size; childOffset++) {
        const child = children[cursor + childOffset] as BPlusNode<K, V>;
        parent.children.push(child);
        child.parent = parent;
        count += child.count;
        if (childOffset > 0) {
          parent.keys.push(this.subtreeMin(child));
        }
      }
      parent.count = count;
      parents.push(parent);
      cursor += size;
    }
    return parents;
  }

  /** O(height): smallest key in a non-empty subtree. */
  private subtreeMin(node: BPlusNode<K, V>): K {
    let current = node;
    while (!current.isLeaf) {
      current = current.children[0] as BPlusNode<K, V>;
    }
    return current.keys[0] as K;
  }
}
