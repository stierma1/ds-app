import {
  assertDefined,
  assertInteger,
  ContainerBase,
  ConsumedError,
  resolveComparator,
  UnsupportedError,
} from "../core/index.ts";
import type { Comparator, RangeOptions } from "../core/index.ts";
import { readSplayEntries, serializeSplayEntries } from "./serialization.ts";
import type { SplayTreeLike } from "./types.ts";

/**
 * Bottom-up splay node. Parent links let the splay walk climb back to the root without a stack.
 * `size` is the subtree node count; it is maintained through rotations so `at`/`indexOf` stay
 * O(height) and `join`/`split` do not need to recount their results.
 */
class SplayNode<K, V> {
  key: K;
  value: V;
  left: SplayNode<K, V> | null = null;
  right: SplayNode<K, V> | null = null;
  parent: SplayNode<K, V> | null;
  size = 1;

  constructor(key: K, value: V, parent: SplayNode<K, V> | null) {
    this.key = key;
    this.value = value;
    this.parent = parent;
  }
}

/** O(1): subtree node count, with the null tree at 0. */
function sizeOf<K, V>(node: SplayNode<K, V> | null): number {
  return node === null ? 0 : node.size;
}

/** O(1): recomputes the cached subtree size from the children. */
function updateNode<K, V>(node: SplayNode<K, V>): void {
  node.size = 1 + sizeOf(node.left) + sizeOf(node.right);
}

/**
 * Bottom-up splay tree: an ordered map whose every access splays the accessed node — or the last
 * node on the search path — to the root. A single operation can be O(n) worst case, but a sequence
 * of `m` operations costs O(m log n) amortized. There is no balance invariant; the tree's shape is
 * whatever the access sequence produced.
 *
 * `get`, `has`, `set`, successful and unsuccessful `delete`, `splay`, `min`, `max`,
 * `predecessor`, and `successor` all move a node to the root and therefore invalidate live
 * iterators. Iteration itself is ascending by key and never splays.
 *
 * `join` consumes both inputs; `split` consumes its receiver. Consumed trees throw
 * `ConsumedError` on every later operation.
 */
export class SplayTree<K, V = K>
  extends ContainerBase<[K, V]>
  implements SplayTreeLike<K, V>
{
  readonly compare: Comparator<K>;
  private _root: SplayNode<K, V> | null = null;
  private _consumed = false;

  /** O(1); `compare` defaults to the core natural-order comparator. */
  constructor(compare?: Comparator<K>) {
    super();
    this.compare = resolveComparator(compare);
  }

  /** O(1): the raw root node, exposed for teaching and invariant inspection. */
  get root(): unknown | null {
    this.assertLive();
    return this._root;
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
   * O(log n) amortized: descends to the key (or its insertion point), links a new node when the
   * key is absent, replaces the value otherwise, and splays the node to the root.
   */
  set(key: K, value: V): this {
    this.assertLive();
    assertDefined(key, "key");
    assertDefined(value, "value");
    let parent: SplayNode<K, V> | null = null;
    let current = this._root;
    while (current !== null) {
      const comparison = this.compare(key, current.key);
      if (comparison === 0) {
        current.value = value;
        this.splayToRoot(current);
        this.touch();
        return this;
      }
      parent = current;
      current = comparison < 0 ? current.left : current.right;
    }
    const node = new SplayNode<K, V>(key, value, parent);
    if (parent === null) {
      this._root = node;
    } else if (this.compare(key, parent.key) < 0) {
      parent.left = node;
    } else {
      parent.right = node;
    }
    this._size++;
    this.splayToRoot(node);
    this.touch();
    return this;
  }

  /**
   * O(log n) amortized: descends to the key, splays the accessed node (or the last node on the
   * search path), and returns `undefined` when the key is absent.
   */
  get(key: K): V | undefined {
    this.assertLive();
    assertDefined(key, "key");
    const node = this.splayLast(key);
    if (node === null) {
      return undefined;
    }
    this.touch();
    return this.compare(node.key, key) === 0 ? node.value : undefined;
  }

  /** O(log n) amortized: same descent and splay as `get`, without reading the value. */
  has(key: K): boolean {
    this.assertLive();
    assertDefined(key, "key");
    const node = this.splayLast(key);
    if (node === null) {
      return false;
    }
    this.touch();
    return this.compare(node.key, key) === 0;
  }

  /**
   * O(log n) amortized: splays the key (or the last node on the search path) to the root. When the
   * key is present, the root is detached and its left and right subtrees are joined by splaying the
   * maximum of the left side.
   */
  delete(key: K): boolean {
    this.assertLive();
    assertDefined(key, "key");
    const node = this.splayLast(key);
    if (node === null) {
      return false;
    }
    if (this.compare(node.key, key) !== 0) {
      this.touch();
      return false;
    }

    const left = node.left;
    const right = node.right;
    node.left = null;
    node.right = null;
    if (left === null) {
      this._root = right;
      if (right !== null) {
        right.parent = null;
      }
    } else {
      left.parent = null;
      this._root = left;
      let maximum = left;
      while (maximum.right !== null) {
        maximum = maximum.right;
      }
      this.splayToRoot(maximum);
      const root = this._root as SplayNode<K, V>;
      root.right = right;
      if (right !== null) {
        right.parent = root;
      }
      updateNode(root);
    }
    this._size--;
    this.touch();
    return true;
  }

  /** O(log n) amortized: walks the left spine, splays the minimum to the root, and returns it. */
  min(): [K, V] | undefined {
    this.assertLive();
    if (this._root === null) {
      return undefined;
    }
    const node = this.leftmost(this._root);
    this.splayToRoot(node);
    this.touch();
    return [node.key, node.value];
  }

  /** O(log n) amortized: walks the right spine, splays the maximum to the root, and returns it. */
  max(): [K, V] | undefined {
    this.assertLive();
    if (this._root === null) {
      return undefined;
    }
    const node = this.rightmost(this._root);
    this.splayToRoot(node);
    this.touch();
    return [node.key, node.value];
  }

  /** O(log n) amortized: largest entry strictly less than `key`; splays the result when found. */
  predecessor(key: K): [K, V] | undefined {
    this.assertLive();
    assertDefined(key, "key");
    let node = this._root;
    let best: SplayNode<K, V> | null = null;
    while (node !== null) {
      if (this.compare(node.key, key) < 0) {
        best = node;
        node = node.right;
      } else {
        node = node.left;
      }
    }
    if (best === null) {
      return undefined;
    }
    this.splayToRoot(best);
    this.touch();
    return [best.key, best.value];
  }

  /** O(log n) amortized: smallest entry strictly greater than `key`; splays the result when found. */
  successor(key: K): [K, V] | undefined {
    this.assertLive();
    assertDefined(key, "key");
    let node = this._root;
    let best: SplayNode<K, V> | null = null;
    while (node !== null) {
      if (this.compare(node.key, key) > 0) {
        best = node;
        node = node.left;
      } else {
        node = node.right;
      }
    }
    if (best === null) {
      return undefined;
    }
    this.splayToRoot(best);
    this.touch();
    return [best.key, best.value];
  }

  /**
   * O(height) worst case, O(n) for a path-shaped tree: select by rank through cached subtree
   * sizes. This is a pure query and does not splay. Out-of-range indices return `undefined`.
   */
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

  /**
   * O(height) worst case, O(n) for a path-shaped tree: rank through cached subtree sizes; -1 when
   * the key is absent. This is a pure query and does not splay.
   */
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

  /**
   * O(log n + k) amortized: descends to the lower bound, then takes k in-order steps and
   * materializes the entries before returning the snapshot iterator. Range iteration itself does
   * not splay, so it does not invalidate itself.
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

    const stack: Array<SplayNode<K, V>> = [];
    let node = this._root;
    if (lo === undefined) {
      while (node !== null) {
        stack.push(node);
        node = node.left;
      }
    } else {
      while (node !== null) {
        const comparison = this.compare(node.key, lo);
        if (comparison > 0 || (comparison === 0 && loInclusive)) {
          stack.push(node);
          node = node.left;
        } else {
          node = node.right;
        }
      }
    }

    while (stack.length > 0) {
      const current = stack.pop() as SplayNode<K, V>;
      if (hi !== undefined) {
        const comparison = this.compare(current.key, hi);
        if (comparison > 0 || (comparison === 0 && !hiInclusive)) {
          break;
        }
      }
      entries.push([current.key, current.value]);
      let child = current.right;
      while (child !== null) {
        stack.push(child);
        child = child.left;
      }
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
    const stack: Array<SplayNode<K, V>> = [];
    let node = this._root;
    while (node !== null || stack.length > 0) {
      while (node !== null) {
        stack.push(node);
        node = node.left;
      }
      const current = stack.pop() as SplayNode<K, V>;
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

  /**
   * O(log n) amortized: moves the node with `key` — or the last node on the search path when the
   * key is absent — to the root. Exposed for teaching and for benchmarks that drive access
   * patterns directly.
   */
  splay(key: K): void {
    this.assertLive();
    assertDefined(key, "key");
    const node = this.splayLast(key);
    if (node !== null) {
      this.touch();
    }
  }

  /** O(n): dumps the sorted entry list; deserialization rebuilds a fresh splay tree. */
  serialize(): string {
    this.assertLive();
    return serializeSplayEntries("SplayTree", this.toArray());
  }

  /** O(n log n): parses the entry list and inserts it median-first. */
  static deserialize<K, V>(
    json: unknown,
    compare?: Comparator<K>,
  ): SplayTree<K, V> {
    const entries = readSplayEntries<K, V>(json, "SplayTree");
    const tree = new SplayTree<K, V>(compare);
    insertBalanced(tree, entries);
    return tree;
  }

  /**
   * O(log n) amortized: requires every key in this tree to be smaller than every key in `other`.
   * Both inputs are consumed; the returned tree owns the union and uses this tree's comparator.
   */
  join(other: SplayTreeLike<K, V>): SplayTree<K, V> {
    this.assertLive();
    if (!(other instanceof SplayTree)) {
      throw new UnsupportedError("SplayTree can only join another SplayTree");
    }
    other.assertLive();
    if (other === this) {
      throw new TypeError("cannot join a tree with itself");
    }
    if (this._root !== null && other._root !== null) {
      const leftMax = this.rightmost(this._root);
      const rightMin = other.leftmost(other._root);
      if (this.compare(leftMax.key, rightMin.key) >= 0) {
        throw new TypeError(
          "join requires every key in the receiver to be smaller than every key in other",
        );
      }
    }

    const leftRoot = this._root;
    const rightRoot = other._root;
    const total = this._size + other._size;
    let root: SplayNode<K, V> | null;
    if (leftRoot === null) {
      root = rightRoot;
    } else if (rightRoot === null) {
      root = leftRoot;
    } else {
      this.splayToRoot(this.rightmost(leftRoot));
      root = this._root as SplayNode<K, V>;
      root.right = rightRoot;
      rightRoot.parent = root;
      updateNode(root);
    }
    this.markConsumed();
    other.markConsumed();
    return SplayTree.fromParts(root, total, this.compare);
  }

  /**
   * O(log n) amortized: consumes the receiver and returns `[< key, >= key]` as fresh trees that
   * share its comparator and ownership of the original nodes.
   */
  split(key: K): [SplayTree<K, V>, SplayTree<K, V>] {
    this.assertLive();
    assertDefined(key, "key");
    this.splayLast(key);
    let leftRoot: SplayNode<K, V> | null = null;
    let rightRoot: SplayNode<K, V> | null = null;
    const root = this._root;
    if (root !== null) {
      if (this.compare(root.key, key) < 0) {
        leftRoot = root;
        rightRoot = root.right;
        root.right = null;
        if (rightRoot !== null) {
          rightRoot.parent = null;
        }
        updateNode(root);
      } else {
        leftRoot = root.left;
        if (leftRoot !== null) {
          leftRoot.parent = null;
        }
        root.left = null;
        updateNode(root);
        rightRoot = root;
      }
    }
    const left = SplayTree.fromParts(leftRoot, sizeOf(leftRoot), this.compare);
    const right = SplayTree.fromParts(rightRoot, sizeOf(rightRoot), this.compare);
    this.markConsumed();
    return [left, right];
  }

  /**
   * O(n): iterative in-order validation of ordering, parent links, cached subtree sizes, and the
   * container size. Balance is not an invariant of a splay tree and is not checked.
   */
  override validate(): true | string {
    this.assertLive();
    if (this._root === null) {
      return this._size === 0 ? true : "non-empty size with empty root";
    }
    if (this._root.parent !== null) {
      return "root has a parent";
    }
    const stack: Array<SplayNode<K, V>> = [];
    const seen = new Set<SplayNode<K, V>>();
    let node: SplayNode<K, V> | null = this._root;
    let previous: SplayNode<K, V> | null = null;
    let count = 0;
    while (node !== null || stack.length > 0) {
      while (node !== null) {
        if (seen.has(node)) {
          return "cycle detected in child links";
        }
        seen.add(node);
        stack.push(node);
        node = node.left;
      }
      const current = stack.pop() as SplayNode<K, V>;
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

  /** O(1): creates a tree that adopts `root`; used by join, split, and deserialization. */
  private static fromParts<K, V>(
    root: SplayNode<K, V> | null,
    size: number,
    compare: Comparator<K>,
  ): SplayTree<K, V> {
    const tree = new SplayTree<K, V>(compare);
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

  /**
   * O(log n) amortized in access sequences: descends to `key`, then splays the matching node or
   * the last node on the search path. Returns the new root (null only for an empty tree).
   */
  private splayLast(key: K): SplayNode<K, V> | null {
    let current = this._root;
    let last: SplayNode<K, V> | null = null;
    while (current !== null) {
      last = current;
      const comparison = this.compare(key, current.key);
      if (comparison === 0) {
        break;
      }
      current = comparison < 0 ? current.left : current.right;
    }
    if (last !== null) {
      this.splayToRoot(last);
    }
    return last;
  }

  /**
   * O(height): rotates `node` to the root using single, zig-zig, and zig-zag steps. Iterative, so
   * a path-shaped tree cannot overflow the call stack.
   */
  private splayToRoot(node: SplayNode<K, V>): void {
    while (node.parent !== null) {
      const parent = node.parent;
      const grandparent = parent.parent;
      if (grandparent === null) {
        if (node === parent.left) {
          this.rotateRight(parent);
        } else {
          this.rotateLeft(parent);
        }
      } else if (node === parent.left && parent === grandparent.left) {
        this.rotateRight(grandparent);
        this.rotateRight(parent);
      } else if (node === parent.right && parent === grandparent.right) {
        this.rotateLeft(grandparent);
        this.rotateLeft(parent);
      } else if (node === parent.right && parent === grandparent.left) {
        this.rotateLeft(parent);
        this.rotateRight(grandparent);
      } else {
        this.rotateRight(parent);
        this.rotateLeft(grandparent);
      }
    }
    this._root = node;
  }

  /** O(1): promotes `x.right`, fixing parent links, sizes, and the tracked root. */
  private rotateLeft(x: SplayNode<K, V>): void {
    const y = x.right as SplayNode<K, V>;
    x.right = y.left;
    if (y.left !== null) {
      y.left.parent = x;
    }
    y.parent = x.parent;
    if (x.parent === null) {
      this._root = y;
    } else if (x === x.parent.left) {
      x.parent.left = y;
    } else {
      x.parent.right = y;
    }
    y.left = x;
    x.parent = y;
    updateNode(x);
    updateNode(y);
  }

  /** O(1): promotes `x.left`, fixing parent links, sizes, and the tracked root. */
  private rotateRight(x: SplayNode<K, V>): void {
    const y = x.left as SplayNode<K, V>;
    x.left = y.right;
    if (y.right !== null) {
      y.right.parent = x;
    }
    y.parent = x.parent;
    if (x.parent === null) {
      this._root = y;
    } else if (x === x.parent.left) {
      x.parent.left = y;
    } else {
      x.parent.right = y;
    }
    y.right = x;
    x.parent = y;
    updateNode(x);
    updateNode(y);
  }

  /** O(h): leftmost node of a subtree. */
  private leftmost(node: SplayNode<K, V>): SplayNode<K, V> {
    let current = node;
    while (current.left !== null) {
      current = current.left;
    }
    return current;
  }

  /** O(h): rightmost node of a subtree. */
  private rightmost(node: SplayNode<K, V>): SplayNode<K, V> {
    let current = node;
    while (current.right !== null) {
      current = current.right;
    }
    return current;
  }
}

/**
 * O(n log n): inserts sorted entries median-first through the normal `set` path, which keeps the
 * initial tree shallow while exercising the same splay logic as live insertions. The explicit
 * range stack avoids recursion.
 */
function insertBalanced<K, V>(
  tree: SplayTree<K, V>,
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
