import {
  assertDefined,
  assertInteger,
  ContainerBase,
  parseSerialized,
  readArray,
  readValue,
  resolveComparator,
  serializeRecord,
} from "../core/index.ts";
import type { Comparator, RangeOptions } from "../core/index.ts";
import type {
  BinarySearchTree as BinarySearchTreeContract,
  TreeNode,
  TreeLike,
} from "./types.ts";

/**
 * BST node augmented with a subtree `size`, which is what makes `at` (select) and
 * `indexOf` (rank) O(h) instead of O(n); keeping it costs an O(h) parent walk per
 * insert/delete. `value` is the live [key, value] tuple. `owner` and `generation`
 * let the tree verify in O(1) that a node handle is live and belongs to it, instead
 * of climbing parent links to the root; `clear()` bumps the generation so every old
 * handle is rejected without touching the nodes.
 */
export class BSTNode<K, V> implements TreeNode<[K, V]> {
  value: [K, V];
  left: BSTNode<K, V> | null = null;
  right: BSTNode<K, V> | null = null;
  parent: BSTNode<K, V> | null;
  size = 1;
  owner: object | null = null;
  generation = 0;

  constructor(value: [K, V], parent: BSTNode<K, V> | null) {
    this.value = value;
    this.parent = parent;
  }

  get key(): K {
    return this.value[0];
  }

  get data(): V {
    return this.value[1];
  }
}

interface SearchState<K, V> {
  parent: BSTNode<K, V> | null;
  node: BSTNode<K, V> | null;
  predecessor: BSTNode<K, V> | null;
  successor: BSTNode<K, V> | null;
}

/**
 * Unbalanced binary search tree with parent pointers and subtree-size counts,
 * exposing an OrderedMap plus order-statistic queries. Every keyed operation
 * (set/get/has/delete/min/max/predecessor/successor/at/indexOf) is O(h), h the
 * height: about log2(n) for random insertion order but O(n) after sorted or other
 * monotone input, since nothing rebalances; only deserialize() builds balanced, so
 * a serialize/deserialize round-trip is a cheap O(n log n) rebalance. `size` is
 * O(1), unlike BinaryTree. Iteration, keys/values/entries, and range() materialize
 * arrays and return snapshot iterators that throw on mutation; nothing is lazy.
 */
export class BinarySearchTree<K, V = K>
  extends ContainerBase<[K, V]>
  implements BinarySearchTreeContract<K, V>, TreeLike<[K, V]>
{
  private _root: BSTNode<K, V> | null = null;
  private _generation = 0;
  readonly compare: Comparator<K>;

  /** O(1); `compare` defaults to the core natural-order comparator. */
  constructor(compare?: Comparator<K>) {
    super();
    this.compare = resolveComparator(compare);
  }

  /** O(1): live root node. */
  get root(): BSTNode<K, V> | null {
    return this._root;
  }

  /** O(n) level sweep; nothing caches it. Useful to detect degeneration (h approaching n). */
  get height(): number {
    if (this._root === null) {
      return -1;
    }
    let height = 0;
    let level: BSTNode<K, V>[] = [this._root];
    while (level.length > 0) {
      const next: BSTNode<K, V>[] = [];
      for (const node of level) {
        if (node.left !== null) next.push(node.left);
        if (node.right !== null) next.push(node.right);
      }
      if (next.length > 0) {
        height++;
      }
      level = next;
    }
    return height;
  }

  /**
   * O(h): one descent plus an O(h) climb bumping ancestor subtree sizes. An existing
   * key is updated in place (no relink) but still bumps the version for iterators.
   */
  set(key: K, value: V): this {
    assertDefined(key, "key");
    assertDefined(value, "value");
    const search = this.search(key);
    if (search.node !== null) {
      search.node.value = [search.node.key, value];
      this.touch();
      return this;
    }
    const node = this.createNode([key, value], search.parent);
    node.owner = this;
    node.generation = this._generation;
    if (search.parent === null) {
      this._root = node;
    } else if (this.compare(key, search.parent.key) < 0) {
      search.parent.left = node;
    } else {
      search.parent.right = node;
    }
    for (let current = node.parent; current !== null; current = current.parent) {
      current.size++;
    }
    this._size++;
    this.onInserted(node, search.predecessor, search.successor);
    this.touch();
    return this;
  }

  /** O(h) descent; O(n) worst case on a degenerate (sorted-input) tree. */
  get(key: K): V | undefined {
    const node = this.search(key).node;
    return node === null ? undefined : node.value[1];
  }

  /** O(h): same descent as get(). */
  has(key: K): boolean {
    return this.search(key).node !== null;
  }

  /**
   * O(h) descent plus an O(h) size-fixing climb. A two-child node keeps its object and
   * takes over the successor's tuple; the successor's node object is the one detached.
   */
  delete(key: K): boolean {
    const found = this.search(key).node;
    if (found === null) {
      return false;
    }
    if (found.left !== null && found.right !== null) {
      const physical = this.minimumNode(found.right);
      const predecessor = this._predecessorNode(physical);
      const successor = this._successorNode(physical);
      const parent = physical.parent;
      found.value = physical.value;
      this.removePhysical(physical);
      for (let node = parent; node !== null; node = node.parent) {
        node.size--;
      }
      this.onRemoved(physical, predecessor, successor, found);
    } else {
      const predecessor = this._predecessorNode(found);
      const successor = this._successorNode(found);
      const parent = found.parent;
      this.removePhysical(found);
      for (let node = parent; node !== null; node = node.parent) {
        node.size--;
      }
      this.onRemoved(found, predecessor, successor, null);
    }
    this._size--;
    this.touch();
    return true;
  }

  /** O(h): walks the left spine; O(n) on a right-degenerate tree. */
  min(): [K, V] | undefined {
    const node = this.minNode();
    return node === null ? undefined : node.value;
  }

  /** O(h): walks the right spine; O(n) on a left-degenerate tree. */
  max(): [K, V] | undefined {
    const node = this.maxNode();
    return node === null ? undefined : node.value;
  }

  /** O(h): left-spine walk returning the live node. */
  minNode(): BSTNode<K, V> | null {
    return this._root === null ? null : this.minimumNode(this._root);
  }

  /** O(h): right-spine walk returning the live node. */
  maxNode(): BSTNode<K, V> | null {
    return this._root === null ? null : this.maximumNode(this._root);
  }

  /** O(h) single descent; works for keys not in the tree (strictly less than `key`). */
  predecessor(key: K): [K, V] | undefined {
    let node = this._root;
    let best: BSTNode<K, V> | null = null;
    while (node !== null) {
      if (this.compare(node.key, key) < 0) {
        best = node;
        node = node.right;
      } else {
        node = node.left;
      }
    }
    return best === null ? undefined : best.value;
  }

  /** O(h) single descent; works for keys not in the tree (strictly greater than `key`). */
  successor(key: K): [K, V] | undefined {
    let node = this._root;
    let best: BSTNode<K, V> | null = null;
    while (node !== null) {
      if (this.compare(node.key, key) > 0) {
        best = node;
        node = node.left;
      } else {
        node = node.right;
      }
    }
    return best === null ? undefined : best.value;
  }

  /**
   * O(h): an O(1) ownership check, then one step to the in-order neighbor without a
   * stack (left subtree's maximum, or the nearest ancestor on the right). O(1)
   * amortized over a full sweep by repeated calls. ThreadedBinaryTree makes the step
   * O(1) worst case.
   */
  predecessorNode(node: TreeNode<[K, V]>): TreeNode<[K, V]> | null {
    return this._predecessorNode(this.assertOwned(node));
  }

  /**
   * O(h) worst case per call after an O(1) ownership check; a full sweep by repeated
   * calls is O(n) in total. entries()/range() are still cheaper for bulk iteration.
   */
  successorNode(node: TreeNode<[K, V]>): TreeNode<[K, V]> | null {
    return this._successorNode(this.assertOwned(node));
  }

  /** O(h) select by rank via subtree sizes; no traversal. Returns undefined out of range. */
  at(index: number): [K, V] | undefined {
    assertInteger(index);
    if (index < 0 || index >= this._size) {
      return undefined;
    }
    let node = this._root;
    let remaining = index;
    while (node !== null) {
      const leftSize = node.left === null ? 0 : node.left.size;
      if (remaining < leftSize) {
        node = node.left;
      } else if (remaining === leftSize) {
        return node.value;
      } else {
        remaining -= leftSize + 1;
        node = node.right;
      }
    }
    return undefined;
  }

  /** O(h) rank query via subtree sizes; -1 when absent. */
  indexOf(key: K): number {
    let node = this._root;
    let rank = 0;
    while (node !== null) {
      const comparison = this.compare(key, node.key);
      if (comparison === 0) {
        return rank + (node.left === null ? 0 : node.left.size);
      }
      if (comparison < 0) {
        node = node.left;
      } else {
        rank += (node.left === null ? 0 : node.left.size) + 1;
        node = node.right;
      }
    }
    return -1;
  }

  /**
   * O(h + k) for k entries returned: one descent to the lower bound, then k successor
   * steps (amortized O(1) each). Materializes all k entries before returning the snapshot.
   */
  range(lo?: K, hi?: K, options?: RangeOptions<K>): IterableIterator<[K, V]> {
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
    let node: BSTNode<K, V> | null =
      lo === undefined ? this.minNode() : this.lowerBoundNode(lo, loInclusive);
    while (node !== null) {
      if (hi !== undefined) {
        const comparison = this.compare(node.key, hi);
        if (comparison > 0 || (comparison === 0 && !hiInclusive)) {
          break;
        }
      }
      entries.push(node.value);
      node = this._successorNode(node);
    }
    return this.snapshotIterator(entries);
  }

  /** O(n): materializes the full in-order array, then a second array of keys. */
  keys(): IterableIterator<K> {
    return this.snapshotIterator(this.toArray().map((entry) => entry[0]));
  }

  /** O(n): materializes the full in-order array, then a second array of values. */
  values(): IterableIterator<V> {
    return this.snapshotIterator(this.toArray().map((entry) => entry[1]));
  }

  /** O(n): in-order; materializes a full snapshot array (via toArray), not lazy. */
  entries(): IterableIterator<[K, V]> {
    return this.snapshotIterator(this.toArray());
  }

  /** O(n): iterative explicit-stack walk, materialized snapshot. */
  preorder(): IterableIterator<[K, V]> {
    const values: Array<[K, V]> = [];
    const stack: BSTNode<K, V>[] = this._root === null ? [] : [this._root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      values.push(node.value);
      if (node.right !== null) stack.push(node.right);
      if (node.left !== null) stack.push(node.left);
    }
    return this.snapshotIterator(values);
  }

  /** Alias for entries(): O(n) materialized in-order snapshot. */
  inorder(): IterableIterator<[K, V]> {
    return this.entries();
  }

  /** O(n): reversed root-right-left preorder with one stack plus an array reverse. */
  postorder(): IterableIterator<[K, V]> {
    const values: Array<[K, V]> = [];
    const stack: BSTNode<K, V>[] = this._root === null ? [] : [this._root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      values.push(node.value);
      if (node.left !== null) stack.push(node.left);
      if (node.right !== null) stack.push(node.right);
    }
    values.reverse();
    return this.snapshotIterator(values);
  }

  /** O(n): BFS with an index cursor (no Array.shift()); materialized snapshot. */
  levelOrder(): IterableIterator<[K, V]> {
    const values: Array<[K, V]> = [];
    const queue: BSTNode<K, V>[] = this._root === null ? [] : [this._root];
    let index = 0;
    while (index < queue.length) {
      const node = queue[index++];
      values.push(node.value);
      if (node.left !== null) queue.push(node.left);
      if (node.right !== null) queue.push(node.right);
    }
    return this.snapshotIterator(values);
  }

  /** O(n), 2n-1 values materialized: iterative frame stack, no recursion. */
  eulerTour(): IterableIterator<[K, V]> {
    const values: Array<[K, V]> = [];
    if (this._root === null) {
      return this.snapshotIterator(values);
    }
    interface Frame {
      node: BSTNode<K, V>;
      entered: boolean;
      childIndex: number;
    }
    const stack: Frame[] = [{ node: this._root, entered: false, childIndex: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (!frame.entered) {
        frame.entered = true;
        values.push(frame.node.value);
        continue;
      }
      const children = [frame.node.left, frame.node.right].filter(
        (child): child is BSTNode<K, V> => child !== null,
      );
      if (frame.childIndex < children.length) {
        const child = children[frame.childIndex++];
        stack.push({ node: child, entered: false, childIndex: 0 });
      } else {
        stack.pop();
        if (stack.length > 0) {
          values.push(stack[stack.length - 1].node.value);
        }
      }
    }
    return this.snapshotIterator(values);
  }

  /** O(n): dumps the sorted entry list; the shape is not stored, deserialize rebalances. */
  serialize(): string {
    return serializeBstEntries("BinarySearchTree", this.toArray());
  }

  /**
   * O(n log n): inserts the sorted entries median-first, so the result is balanced
   * (h about log2 n) regardless of how skewed the serialized tree was.
   */
  static deserialize<K, V>(
    json: unknown,
    compare?: Comparator<K>,
  ): BinarySearchTree<K, V> {
    const entries = readBstEntries<K, V>(json, "BinarySearchTree");
    const tree = new BinarySearchTree<K, V>(compare);
    insertBalanced(tree, entries);
    return tree;
  }

  /** O(1): drops the root, resets the count, and invalidates every outstanding node handle. */
  clear(): void {
    this._root = null;
    this._size = 0;
    this._generation++;
    this.touch();
  }

  /** O(n): single-pass iterative in-order walk into one fresh array (sorted by key). */
  toArray(): Array<[K, V]> {
    const values: Array<[K, V]> = [];
    const stack: BSTNode<K, V>[] = [];
    let node = this._root;
    while (node !== null || stack.length > 0) {
      while (node !== null) {
        stack.push(node);
        node = node.left;
      }
      node = stack.pop()!;
      values.push(node.value);
      node = node.right;
    }
    return values;
  }

  /** Same as entries(): materialized O(n) in-order snapshot. */
  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }

  /** O(n): iterative in-order sweep checking order, parent links, and subtree sizes. */
  validate(): true | string {
    if (this._root === null) {
      return this._size === 0 ? true : "non-empty size with empty root";
    }
    if (this._root.parent !== null) {
      return "root has a parent";
    }
    const stack: BSTNode<K, V>[] = [];
    let node: BSTNode<K, V> | null = this._root;
    let previous: BSTNode<K, V> | null = null;
    let count = 0;
    const seen = new Set<BSTNode<K, V>>();
    while (node !== null || stack.length > 0) {
      while (node !== null) {
        if (seen.has(node)) {
          return "cycle detected in left links";
        }
        seen.add(node);
        stack.push(node);
        node = node.left;
      }
      node = stack.pop()!;
      count++;
      if (count > this._size) {
        return "tree contains more nodes than size";
      }
      if (node.value === undefined || node.value[0] === undefined || node.value[1] === undefined) {
        return `node at index ${count - 1} has an undefined key or value`;
      }
      if (node.left !== null && node.left.parent !== node) {
        return `left child of node at index ${count - 1} has an incorrect parent link`;
      }
      if (node.right !== null && node.right.parent !== node) {
        return `right child of node at index ${count - 1} has an incorrect parent link`;
      }
      const expectedSize =
        1 + (node.left === null ? 0 : node.left.size) + (node.right === null ? 0 : node.right.size);
      if (node.size !== expectedSize) {
        return `subtree size at index ${count - 1} is ${node.size}, expected ${expectedSize}`;
      }
      if (previous !== null && this.compare(previous.key, node.key) >= 0) {
        return "binary search tree ordering is violated";
      }
      previous = node;
      node = node.right;
    }
    if (count !== this._size) {
      return `size ${this._size} does not match node count ${count}`;
    }
    return true;
  }

  /** Extension point: subclasses swap in a richer node type; O(1). */
  protected createNode(value: [K, V], parent: BSTNode<K, V> | null): BSTNode<K, V> {
    return new BSTNode(value, parent);
  }

  /**
   * Extension hook called after linking. The predecessor/successor were recorded for
   * free during the O(h) search, so a subclass (ThreadedBinaryTree) can maintain
   * threads in O(1) without any extra traversal.
   */
  protected onInserted(
    _node: BSTNode<K, V>,
    _predecessor: BSTNode<K, V> | null,
    _successor: BSTNode<K, V> | null,
  ): void {}

  /**
   * Extension hook called after unlinking, again with neighbors found for free. For a
   * two-child delete, `replacement` is the surviving node that took the successor's tuple.
   */
  protected onRemoved(
    _node: BSTNode<K, V>,
    _predecessor: BSTNode<K, V> | null,
    _successor: BSTNode<K, V> | null,
    _replacement: BSTNode<K, V> | null,
  ): void {}

  /**
   * O(1): checks the node's recorded owner and generation. A node detached by delete()
   * has its owner cleared, and clear() bumps the generation, so stale handles throw
   * TypeError without any parent walk. Shared by every node-based query here and in
   * ThreadedBinaryTree.
   */
  protected assertOwned(node: TreeNode<[K, V]>): BSTNode<K, V> {
    if (
      !(node instanceof BSTNode) ||
      node.owner !== this ||
      node.generation !== this._generation
    ) {
      throw new TypeError("Node does not belong to this tree");
    }
    return node;
  }

  /**
   * O(h) descent that also records the in-order predecessor and successor of the
   * search position, which lets set()/delete() feed the hooks at no extra cost.
   */
  private search(key: K): SearchState<K, V> {
    let parent: BSTNode<K, V> | null = null;
    let node = this._root;
    let predecessor: BSTNode<K, V> | null = null;
    let successor: BSTNode<K, V> | null = null;
    while (node !== null) {
      const comparison = this.compare(key, node.key);
      if (comparison === 0) {
        return { parent, node, predecessor, successor };
      }
      parent = node;
      if (comparison < 0) {
        successor = node;
        node = node.left;
      } else {
        predecessor = node;
        node = node.right;
      }
    }
    return { parent, node: null, predecessor, successor };
  }

  private minimumNode(node: BSTNode<K, V>): BSTNode<K, V> {
    let current = node;
    while (current.left !== null) {
      current = current.left;
    }
    return current;
  }

  private maximumNode(node: BSTNode<K, V>): BSTNode<K, V> {
    let current = node;
    while (current.right !== null) {
      current = current.right;
    }
    return current;
  }

  /** O(h) worst case; amortized O(1) per step across a full in-order sweep. No stack. */
  protected _predecessorNode(node: BSTNode<K, V>): BSTNode<K, V> | null {
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

  /** O(h) worst case; amortized O(1) per step across a full in-order sweep. No stack. */
  protected _successorNode(node: BSTNode<K, V>): BSTNode<K, V> | null {
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

  private removePhysical(node: BSTNode<K, V>): void {
    const child = node.left !== null ? node.left : node.right;
    if (node.parent === null) {
      this._root = child;
    } else if (node === node.parent.left) {
      node.parent.left = child;
    } else {
      node.parent.right = child;
    }
    if (child !== null) {
      child.parent = node.parent;
    }
    node.left = null;
    node.right = null;
    node.parent = null;
    node.owner = null;
  }

  private lowerBoundNode(key: K, inclusive: boolean): BSTNode<K, V> | null {
    let node = this._root;
    let best: BSTNode<K, V> | null = null;
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

/** O(n): validates and JSON-encodes the entry list. */
export function serializeBstEntries(
  type: string,
  entries: Array<[unknown, unknown]>,
): string {
  for (const entry of entries) {
    if (entry[0] === undefined || entry[1] === undefined) {
      throw new TypeError("Cannot serialize an undefined key or value");
    }
  }
  return serializeRecord(type, { entries });
}

/** O(n): parses and validates [key, value] pairs. */
export function readBstEntries<K, V>(
  json: unknown,
  type: string,
): Array<[K, V]> {
  const record = parseSerialized(json, type);
  const raw = readArray(record, "entries");
  const entries: Array<[K, V]> = [];
  for (let index = 0; index < raw.length; index++) {
    const entry = raw[index];
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new TypeError(`entries[${index}] must be a [key, value] pair`);
    }
    const key = readValue<K>(entry[0], `entries[${index}][0]`);
    const value = readValue<V>(entry[1], `entries[${index}][1]`);
    entries.push([key, value]);
  }
  return entries;
}

/**
 * O(n log n) for n sorted entries: inserts median-first using an explicit range stack
 * (no recursion), so the resulting tree is balanced with height about log2(n). Each
 * insert is a normal O(h) set(), so subtree sizes and thread hooks stay consistent.
 */
export function insertBalanced<K, V>(
  tree: BinarySearchTree<K, V>,
  entries: Array<[K, V]>,
): void {
  const ranges: Array<[number, number]> = [];
  if (entries.length > 0) {
    ranges.push([0, entries.length - 1]);
  }
  while (ranges.length > 0) {
    const [low, high] = ranges.pop()!;
    if (low > high) {
      continue;
    }
    const middle = (low + high) >>> 1;
    const entry = entries[middle];
    tree.set(entry[0], entry[1]);
    ranges.push([middle + 1, high]);
    ranges.push([low, middle - 1]);
  }
}
