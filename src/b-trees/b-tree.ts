import {
  assertDefined,
  assertInteger,
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

interface EntryLocation<K, V> {
  node: BTreeNode<K, V>;
  index: number;
  found: boolean;
}

interface NodeAt<K, V> {
  node: BTreeNode<K, V>;
  index: number;
}

interface PathStep<K, V> {
  node: BTreeNode<K, V>;
  index: number;
}

interface Trace<K, V> {
  path: PathStep<K, V>[];
  node: BTreeNode<K, V>;
  index: number;
  found: boolean;
}

interface ValidationFrame<K, V> {
  node: BTreeNode<K, V>;
  depth: number;
  lo: K | undefined;
  hi: K | undefined;
}

/**
 * A B-tree node. Leaves hold entries; internal nodes hold separator entries and one more child
 * than entries. `count` caches the number of entries in the subtree and drives select/rank.
 */
class BTreeNode<K, V> {
  keys: K[] = [];
  values: V[] = [];
  children: BTreeNode<K, V>[] = [];
  parent: BTreeNode<K, V> | null;
  count = 0;

  constructor(parent: BTreeNode<K, V> | null) {
    this.parent = parent;
  }

  get isLeaf(): boolean {
    return this.children.length === 0;
  }
}

/** O(1): recomputes a node's cached subtree entry count. */
function refreshCount<K, V>(node: BTreeNode<K, V>): void {
  let count = node.keys.length;
  for (const child of node.children) {
    count += child.count;
  }
  node.count = count;
}

/** O(1): a defined key or value is required, because `undefined` means "absent". */
function requireEntry<K, V>(key: K, value: V): void {
  assertDefined(key, "key");
  assertDefined(value, "value");
}

/**
 * General B-tree with a configurable order. Every node holds between `minFill - 1` and
 * `order - 1` entries (the root may hold one), internal nodes hold one more child than entries,
 * and all leaves sit at the same depth.
 *
 * Insertions split overflowing nodes on the way back to the root; deletions replace an internal
 * entry with its predecessor and then repair underflow with sibling borrows or merges. Cached
 * subtree counts make `at`, `indexOf`, and the destructive `bulkLoad` partition linear or
 * logarithmic as documented.
 */
export class BTree<K, V = K>
  extends ContainerBase<[K, V]>
  implements BTreeContract<K, V>
{
  readonly compare: Comparator<K>;
  readonly order: number;
  readonly minFill: number;
  private readonly _maxKeys: number;
  private readonly _minKeys: number;
  private _root: BTreeNode<K, V> | null = null;
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
      throw new RangeError("BTree order must be at least 3");
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

  /** O(log n): replaces an existing value or inserts a key into a leaf. */
  set(key: K, value: V): this {
    requireEntry(key, value);
    if (this._root === null) {
      const root = new BTreeNode<K, V>(null);
      root.keys.push(key);
      root.values.push(value);
      root.count = 1;
      this._root = root;
      this._size = 1;
      this._height = 0;
      this.touch();
      return this;
    }
    const location = this.locate(key) as EntryLocation<K, V>;
    if (location.found) {
      location.node.values[location.index] = value;
      this.touch();
      return this;
    }
    const leaf = location.node;
    leaf.keys.splice(location.index, 0, key);
    leaf.values.splice(location.index, 0, value);
    this._size++;
    let node = leaf;
    while (node.keys.length > this._maxKeys) {
      node = this.splitNode(node);
    }
    this.updateCountsUp(leaf);
    this.touch();
    return this;
  }

  /** O(log n): the value for `key`, or undefined when absent. */
  get(key: K): V | undefined {
    assertDefined(key, "key");
    const location = this.locate(key);
    return location !== null && location.found
      ? location.node.values[location.index]
      : undefined;
  }

  /** O(log n): membership test. */
  has(key: K): boolean {
    assertDefined(key, "key");
    const location = this.locate(key);
    return location !== null && location.found;
  }

  /** O(log n): removes `key` and repairs underflow bottom-up. */
  delete(key: K): boolean {
    assertDefined(key, "key");
    if (this._root === null) {
      return false;
    }
    const location = this.locate(key) as EntryLocation<K, V>;
    if (!location.found) {
      return false;
    }
    let node = location.node;
    let index = location.index;
    if (!node.isLeaf) {
      const predecessor = this.maximumEntry(
        node.children[index] as BTreeNode<K, V>,
      );
      node.keys[index] = predecessor.node.keys[predecessor.index] as K;
      node.values[index] = predecessor.node.values[predecessor.index] as V;
      node = predecessor.node;
      index = predecessor.index;
    }
    node.keys.splice(index, 1);
    node.values.splice(index, 1);
    this._size--;
    this.repairAfterDelete(node);
    this.touch();
    return true;
  }

  /** O(log n): the first entry. */
  min(): [K, V] | undefined {
    if (this._root === null) {
      return undefined;
    }
    let node = this._root;
    while (!node.isLeaf) {
      node = node.children[0] as BTreeNode<K, V>;
    }
    return [node.keys[0] as K, node.values[0] as V];
  }

  /** O(log n): the last entry. */
  max(): [K, V] | undefined {
    if (this._root === null) {
      return undefined;
    }
    let node = this._root;
    while (!node.isLeaf) {
      node = node.children[node.children.length - 1] as BTreeNode<K, V>;
    }
    const index = node.keys.length - 1;
    return [node.keys[index] as K, node.values[index] as V];
  }

  /** O(log n): largest entry strictly less than `key`; absent keys are supported. */
  predecessor(key: K): [K, V] | undefined {
    assertDefined(key, "key");
    if (this._root === null) {
      return undefined;
    }
    const trace = this.trace(key);
    if (trace.found) {
      if (!trace.node.isLeaf) {
        const found = this.maximumEntry(
          trace.node.children[trace.index] as BTreeNode<K, V>,
        );
        return [
          found.node.keys[found.index] as K,
          found.node.values[found.index] as V,
        ];
      }
      if (trace.index > 0) {
        return this.entryAt(trace.node, trace.index - 1);
      }
    } else if (trace.index > 0) {
      return this.entryAt(trace.node, trace.index - 1);
    }
    for (let step = trace.path.length - 2; step >= 0; step--) {
      const parentStep = trace.path[step] as PathStep<K, V>;
      if (parentStep.index > 0) {
        return this.entryAt(parentStep.node, parentStep.index - 1);
      }
    }
    return undefined;
  }

  /** O(log n): smallest entry strictly greater than `key`; absent keys are supported. */
  successor(key: K): [K, V] | undefined {
    assertDefined(key, "key");
    if (this._root === null) {
      return undefined;
    }
    const trace = this.trace(key);
    if (trace.found) {
      if (!trace.node.isLeaf) {
        const found = this.minimumEntry(
          trace.node.children[trace.index + 1] as BTreeNode<K, V>,
        );
        return [
          found.node.keys[found.index] as K,
          found.node.values[found.index] as V,
        ];
      }
      if (trace.index + 1 < trace.node.keys.length) {
        return this.entryAt(trace.node, trace.index + 1);
      }
    } else if (trace.index < trace.node.keys.length) {
      return this.entryAt(trace.node, trace.index);
    }
    for (let step = trace.path.length - 2; step >= 0; step--) {
      const parentStep = trace.path[step] as PathStep<K, V>;
      if (parentStep.index < parentStep.node.keys.length) {
        return this.entryAt(parentStep.node, parentStep.index);
      }
    }
    return undefined;
  }

  /** O(log n): select by rank through the cached subtree counts. */
  at(index: number): [K, V] | undefined {
    assertInteger(index);
    if (index < 0 || index >= this._size || this._root === null) {
      return undefined;
    }
    let node = this._root;
    let remaining = index;
    for (;;) {
      let descended = false;
      for (let keyIndex = 0; keyIndex < node.keys.length; keyIndex++) {
        if (!node.isLeaf) {
          const child = node.children[keyIndex] as BTreeNode<K, V>;
          if (remaining < child.count) {
            node = child;
            descended = true;
            break;
          }
          remaining -= child.count;
        }
        if (remaining === 0) {
          return this.entryAt(node, keyIndex);
        }
        remaining--;
      }
      if (descended) {
        continue;
      }
      if (node.isLeaf) {
        return undefined;
      }
      node = node.children[node.keys.length] as BTreeNode<K, V>;
    }
  }

  /** O(log n): rank through cached subtree counts; -1 when the key is absent. */
  indexOf(key: K): number {
    assertDefined(key, "key");
    if (this._root === null) {
      return -1;
    }
    let node = this._root;
    let rank = 0;
    for (;;) {
      let keyIndex = 0;
      while (keyIndex < node.keys.length) {
        const comparison = this.compare(
          node.keys[keyIndex] as K,
          key,
        );
        if (comparison >= 0) {
          break;
        }
        if (!node.isLeaf) {
          rank += (node.children[keyIndex] as BTreeNode<K, V>).count;
        }
        rank++;
        keyIndex++;
      }
      if (
        keyIndex < node.keys.length &&
        this.compare(node.keys[keyIndex] as K, key) === 0
      ) {
        if (!node.isLeaf) {
          rank += (node.children[keyIndex] as BTreeNode<K, V>).count;
        }
        return rank;
      }
      if (node.isLeaf) {
        return -1;
      }
      node = node.children[keyIndex] as BTreeNode<K, V>;
    }
  }

  /** O(log n + k): pruned in-order walk from the lower bound. */
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
    const entries: Array<[K, V]> = [];
    if (
      lo !== undefined &&
      hi !== undefined &&
      this.compare(lo, hi) > 0
    ) {
      return this.snapshotIterator(entries);
    }
    if (this._root !== null) {
      this.collectRange(
        this._root,
        lo,
        hi,
        loInclusive,
        hiInclusive,
        entries,
      );
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

  /** O(n): in-order entry list. */
  override toArray(): Array<[K, V]> {
    const entries: Array<[K, V]> = [];
    if (this._root !== null) {
      this.appendEntries(this._root, entries);
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
   * O(n): replaces the contents with sorted entries. Equal keys keep the last value, matching
   * repeated `set`, while a key smaller than its predecessor throws `RangeError` before the tree is
   * modified.
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
    return serializeBTreeEntries("BTree", this.toArray());
  }

  /** O(n): rebuilds a valid B-tree from sorted entries. */
  static deserialize<K, V>(
    json: unknown,
    compareOrOptions?: Comparator<K> | BTreeOptions<K>,
  ): BTree<K, V> {
    const entries = readBTreeEntries<K, V>(json, "BTree");
    const tree = new BTree<K, V>(compareOrOptions);
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
   * O(n): checks occupancy, key order, child containment, parent links, equal leaf depth, cached
   * counts, and the cached height.
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

    const seen = new Set<BTreeNode<K, V>>();
    const stack: ValidationFrame<K, V>[] = [
      { node: this._root, depth: 0, lo: undefined, hi: undefined },
    ];
    let leafDepth = -1;
    let entryCount = 0;
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
      if (node.values.length !== node.keys.length) {
        return `node at depth ${frame.depth} has mismatched values`;
      }
      if (node.children.length > 0 && node.children.length !== node.keys.length + 1) {
        return `internal node at depth ${frame.depth} has inconsistent children`;
      }
      for (let index = 0; index < node.keys.length; index++) {
        const key = node.keys[index];
        if (key === undefined || node.values[index] === undefined) {
          return `node at depth ${frame.depth} has an undefined entry`;
        }
        if (
          index > 0 &&
          this.compare(
            node.keys[index - 1] as K,
            key,
          ) >= 0
        ) {
          return `node at depth ${frame.depth} is not strictly ordered`;
        }
        if (
          frame.lo !== undefined &&
          this.compare(key, frame.lo) <= 0
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
        if (leafDepth === -1) {
          leafDepth = frame.depth;
        } else if (leafDepth !== frame.depth) {
          return "leaves are not all at the same depth";
        }
        if (node.count !== node.keys.length) {
          return `leaf at depth ${frame.depth} has a stale count`;
        }
      } else {
        let count = node.keys.length;
        for (let index = 0; index < node.children.length; index++) {
          const child = node.children[index] as BTreeNode<K, V>;
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
      entryCount += node.keys.length;
    }

    if (leafDepth !== this._height) {
      return `height ${this._height} does not match leaf depth ${leafDepth}`;
    }
    if (entryCount !== this._size) {
      return `size ${this._size} does not match entry count ${entryCount}`;
    }
    if ((this._root as BTreeNode<K, V>).count !== this._size) {
      return "root count does not match size";
    }
    return true;
  }

  /** O(log n): ordinary root descent to the entry or its insertion slot. */
  private locate(key: K): EntryLocation<K, V> | null {
    if (this._root === null) {
      return null;
    }
    let node = this._root;
    for (;;) {
      let index = 0;
      while (index < node.keys.length) {
        const comparison = this.compare(node.keys[index] as K, key);
        if (comparison >= 0) {
          break;
        }
        index++;
      }
      if (
        index < node.keys.length &&
        this.compare(node.keys[index] as K, key) === 0
      ) {
        return { node, index, found: true };
      }
      if (node.isLeaf) {
        return { node, index, found: false };
      }
      node = node.children[index] as BTreeNode<K, V>;
    }
  }

  /** O(log n): records the descent path for neighbour queries. */
  private trace(key: K): Trace<K, V> {
    let node = this._root as BTreeNode<K, V>;
    const path: PathStep<K, V>[] = [];
    for (;;) {
      let index = 0;
      while (index < node.keys.length) {
        const comparison = this.compare(node.keys[index] as K, key);
        if (comparison >= 0) {
          break;
        }
        index++;
      }
      if (
        index < node.keys.length &&
        this.compare(node.keys[index] as K, key) === 0
      ) {
        path.push({ node, index });
        return { path, node, index, found: true };
      }
      if (node.isLeaf) {
        path.push({ node, index });
        return { path, node, index, found: false };
      }
      path.push({ node, index });
      node = node.children[index] as BTreeNode<K, V>;
    }
  }

  /** O(log n) worst case: splits an overflowing node and promotes its median entry. */
  private splitNode(node: BTreeNode<K, V>): BTreeNode<K, V> {
    if (node.parent === null) {
      const root = new BTreeNode<K, V>(null);
      root.children.push(node);
      node.parent = root;
      this._root = root;
      this._height++;
    }
    const parent = node.parent as BTreeNode<K, V>;
    const middle = Math.floor((node.keys.length - 1) / 2);
    const medianKey = node.keys[middle] as K;
    const medianValue = node.values[middle] as V;
    const sibling = new BTreeNode<K, V>(parent);
    sibling.keys = node.keys.splice(middle + 1);
    sibling.values = node.values.splice(middle + 1);
    node.keys.pop();
    node.values.pop();
    if (!node.isLeaf) {
      sibling.children = node.children.splice(middle + 1);
      for (const child of sibling.children) {
        child.parent = sibling;
      }
    }
    refreshCount(node);
    refreshCount(sibling);

    const childIndex = parent.children.indexOf(node);
    parent.keys.splice(childIndex, 0, medianKey);
    parent.values.splice(childIndex, 0, medianValue);
    parent.children.splice(childIndex + 1, 0, sibling);
    refreshCount(parent);
    return parent;
  }

  /** O(log n) worst case: borrows or merges until the tree is valid again. */
  private repairAfterDelete(start: BTreeNode<K, V>): void {
    let current = start;
    for (;;) {
      if (current === this._root) {
        if (current.keys.length === 0) {
          if (current.isLeaf) {
            this._root = null;
            this._height = -1;
          } else {
            const child = current.children[0] as BTreeNode<K, V>;
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

      const parent = current.parent as BTreeNode<K, V>;
      const index = parent.children.indexOf(current);
      const right =
        index + 1 < parent.children.length
          ? (parent.children[index + 1] as BTreeNode<K, V>)
          : null;
      if (right !== null && right.keys.length > this._minKeys) {
        this.borrowFromRight(current, parent, index, right);
        this.updateCountsUp(parent);
        return;
      }
      const left =
        index > 0
          ? (parent.children[index - 1] as BTreeNode<K, V>)
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

  /** O(1): rotates one entry and one child from the right sibling into the underfull node. */
  private borrowFromRight(
    target: BTreeNode<K, V>,
    parent: BTreeNode<K, V>,
    index: number,
    right: BTreeNode<K, V>,
  ): void {
    target.keys.push(parent.keys[index] as K);
    target.values.push(parent.values[index] as V);
    parent.keys[index] = right.keys.shift() as K;
    parent.values[index] = right.values.shift() as V;
    if (!target.isLeaf) {
      const child = right.children.shift() as BTreeNode<K, V>;
      child.parent = target;
      target.children.push(child);
    }
    refreshCount(target);
    refreshCount(right);
  }

  /** O(1): rotates one entry and one child from the left sibling into the underfull node. */
  private borrowFromLeft(
    target: BTreeNode<K, V>,
    parent: BTreeNode<K, V>,
    index: number,
    left: BTreeNode<K, V>,
  ): void {
    target.keys.unshift(parent.keys[index - 1] as K);
    target.values.unshift(parent.values[index - 1] as V);
    parent.keys[index - 1] = left.keys.pop() as K;
    parent.values[index - 1] = left.values.pop() as V;
    if (!target.isLeaf) {
      const child = left.children.pop() as BTreeNode<K, V>;
      child.parent = target;
      target.children.unshift(child);
    }
    refreshCount(left);
    refreshCount(target);
  }

  /** O(1): folds the right sibling and the separator into the underfull node. */
  private mergeRight(
    target: BTreeNode<K, V>,
    parent: BTreeNode<K, V>,
    index: number,
    right: BTreeNode<K, V>,
  ): void {
    target.keys.push(parent.keys[index] as K);
    target.values.push(parent.values[index] as V);
    target.keys.push(...right.keys);
    target.values.push(...right.values);
    if (!target.isLeaf) {
      for (const child of right.children) {
        child.parent = target;
        target.children.push(child);
      }
    }
    parent.keys.splice(index, 1);
    parent.values.splice(index, 1);
    parent.children.splice(index + 1, 1);
    right.parent = null;
    refreshCount(target);
  }

  /** O(1): folds the underfull node and the separator into the left sibling. */
  private mergeLeft(
    left: BTreeNode<K, V>,
    parent: BTreeNode<K, V>,
    index: number,
    source: BTreeNode<K, V>,
  ): void {
    left.keys.push(parent.keys[index - 1] as K);
    left.values.push(parent.values[index - 1] as V);
    left.keys.push(...source.keys);
    left.values.push(...source.values);
    if (!left.isLeaf) {
      for (const child of source.children) {
        child.parent = left;
        left.children.push(child);
      }
    }
    parent.keys.splice(index - 1, 1);
    parent.values.splice(index - 1, 1);
    parent.children.splice(index, 1);
    source.parent = null;
    refreshCount(left);
  }

  /** O(log n): refreshes cached counts from a changed node to the root. */
  private updateCountsUp(start: BTreeNode<K, V>): void {
    let current: BTreeNode<K, V> | null = start;
    while (current !== null) {
      refreshCount(current);
      current = current.parent;
    }
  }

  /** O(log n): minimum entry of a non-empty subtree. */
  private minimumEntry(node: BTreeNode<K, V>): NodeAt<K, V> {
    let current = node;
    while (!current.isLeaf) {
      current = current.children[0] as BTreeNode<K, V>;
    }
    return { node: current, index: 0 };
  }

  /** O(log n): maximum entry of a non-empty subtree. */
  private maximumEntry(node: BTreeNode<K, V>): NodeAt<K, V> {
    let current = node;
    while (!current.isLeaf) {
      current = current.children[
        current.children.length - 1
      ] as BTreeNode<K, V>;
    }
    return { node: current, index: current.keys.length - 1 };
  }

  /** O(1): materializes one entry. */
  private entryAt(node: BTreeNode<K, V>, index: number): [K, V] {
    return [node.keys[index] as K, node.values[index] as V];
  }

  /** O(log n + k): prunes subtrees whose separator range misses the query interval. */
  private collectRange(
    node: BTreeNode<K, V>,
    lo: K | undefined,
    hi: K | undefined,
    loInclusive: boolean,
    hiInclusive: boolean,
    out: Array<[K, V]>,
  ): void {
    if (node.isLeaf) {
      for (let index = 0; index < node.keys.length; index++) {
        const key = node.keys[index] as K;
        if (this.inRange(key, lo, hi, loInclusive, hiInclusive)) {
          out.push([key, node.values[index] as V]);
        }
      }
      return;
    }
    for (let index = 0; index < node.children.length; index++) {
      const lower = index === 0 ? undefined : (node.keys[index - 1] as K);
      const upper =
        index === node.keys.length ? undefined : (node.keys[index] as K);
      let intersects = true;
      if (
        hi !== undefined &&
        lower !== undefined &&
        this.compare(lower, hi) >= 0
      ) {
        intersects = false;
      }
      if (
        lo !== undefined &&
        upper !== undefined &&
        this.compare(lo, upper) >= 0
      ) {
        intersects = false;
      }
      if (intersects) {
        this.collectRange(
          node.children[index] as BTreeNode<K, V>,
          lo,
          hi,
          loInclusive,
          hiInclusive,
          out,
        );
      }
      if (index < node.keys.length) {
        const key = node.keys[index] as K;
        if (this.inRange(key, lo, hi, loInclusive, hiInclusive)) {
          out.push([key, node.values[index] as V]);
        }
      }
    }
  }

  /** O(1): endpoint test shared by range collection. */
  private inRange(
    key: K,
    lo: K | undefined,
    hi: K | undefined,
    loInclusive: boolean,
    hiInclusive: boolean,
  ): boolean {
    if (lo !== undefined) {
      const comparison = this.compare(key, lo);
      if (comparison < 0 || (comparison === 0 && !loInclusive)) {
        return false;
      }
    }
    if (hi !== undefined) {
      const comparison = this.compare(key, hi);
      if (comparison > 0 || (comparison === 0 && !hiInclusive)) {
        return false;
      }
    }
    return true;
  }

  /** O(n): in-order walk for materialization. */
  private appendEntries(
    node: BTreeNode<K, V>,
    out: Array<[K, V]>,
  ): void {
    if (node.isLeaf) {
      for (let index = 0; index < node.keys.length; index++) {
        out.push([node.keys[index] as K, node.values[index] as V]);
      }
      return;
    }
    for (let index = 0; index < node.children.length; index++) {
      this.appendEntries(node.children[index] as BTreeNode<K, V>, out);
      if (index < node.keys.length) {
        out.push([node.keys[index] as K, node.values[index] as V]);
      }
    }
  }

  /**
   * O(n): builds a valid B-tree directly from ordered entries. The height is the smallest one
   * whose capacity covers the input; each recursive node chooses a feasible number of separator
   * entries and distributes the remaining entries across children so every subtree stays inside
   * its occupancy window.
   */
  private buildFromSorted(entries: ReadonlyArray<readonly [K, V]>): void {
    if (entries.length === 0) {
      this._root = null;
      this._size = 0;
      this._height = -1;
      return;
    }
    const minimum: number[] = [this._minKeys];
    const maximum: number[] = [this._maxKeys];
    let height = 0;
    while ((maximum[height] as number) < entries.length) {
      height++;
      minimum[height] =
        this._minKeys +
        (this._minKeys + 1) * (minimum[height - 1] as number);
      maximum[height] =
        this._maxKeys + this.order * (maximum[height - 1] as number);
    }
    this._root = this.buildNode(
      entries,
      0,
      entries.length,
      height,
      true,
      minimum,
      maximum,
    );
    this._root.parent = null;
    this._size = entries.length;
    this._height = height;
  }

  /** O(n) over the supplied range: recursively fills one subtree from sorted entries. */
  private buildNode(
    entries: ReadonlyArray<readonly [K, V]>,
    start: number,
    count: number,
    height: number,
    isRoot: boolean,
    minimum: ReadonlyArray<number>,
    maximum: ReadonlyArray<number>,
  ): BTreeNode<K, V> {
    const node = new BTreeNode<K, V>(null);
    if (height === 0) {
      for (let index = 0; index < count; index++) {
        const entry = entries[start + index] as readonly [K, V];
        node.keys.push(entry[0]);
        node.values.push(entry[1]);
      }
      refreshCount(node);
      return node;
    }

    const minChild = minimum[height - 1] as number;
    const maxChild = maximum[height - 1] as number;
    const minKeys = isRoot ? 1 : this._minKeys;
    let keyCount = -1;
    for (let keys = this._maxKeys; keys >= minKeys; keys--) {
      const children = keys + 1;
      const remaining = count - keys;
      if (remaining >= children * minChild && remaining <= children * maxChild) {
        keyCount = keys;
        break;
      }
    }
    if (keyCount < 0) {
      throw new RangeError("cannot partition entries into a B-tree");
    }

    const childCount = keyCount + 1;
    let remaining = count - keyCount;
    const sizes: number[] = [];
    for (let index = 0; index < childCount; index++) {
      const childrenLeft = childCount - index;
      const minRest = (childrenLeft - 1) * minChild;
      const maxRest = (childrenLeft - 1) * maxChild;
      let size = Math.floor(remaining / childrenLeft);
      const lower = Math.max(minChild, remaining - maxRest);
      const upper = Math.min(maxChild, remaining - minRest);
      if (size < lower) {
        size = lower;
      } else if (size > upper) {
        size = upper;
      }
      sizes.push(size);
      remaining -= size;
    }

    let cursor = start;
    for (let index = 0; index < childCount; index++) {
      const child = this.buildNode(
        entries,
        cursor,
        sizes[index] as number,
        height - 1,
        false,
        minimum,
        maximum,
      );
      child.parent = node;
      node.children.push(child);
      cursor += sizes[index] as number;
      if (index < keyCount) {
        const entry = entries[cursor] as readonly [K, V];
        node.keys.push(entry[0]);
        node.values.push(entry[1]);
        cursor++;
      }
    }
    refreshCount(node);
    return node;
  }
}
