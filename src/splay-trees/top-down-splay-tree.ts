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

/** Top-down splay node. No parent pointer; the descent itself restructures the tree. */
class SplayNode<K, V> {
  key: K;
  value: V;
  left: SplayNode<K, V> | null = null;
  right: SplayNode<K, V> | null = null;
  size = 1;

  constructor(key: K, value: V) {
    this.key = key;
    this.value = value;
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
 * Top-down splay tree: the Sleator–Tarjan top-down variant. The search descends once, splitting the
 * tree into a left chain of smaller keys and a right chain of larger keys, then reassembles them
 * around the accessed node. No parent pointers are stored, so each node carries less state than the
 * bottom-up variant.
 *
 * Like `SplayTree`, every access splays the accessed node — or the last node on the search path —
 * to the root; a single operation can be O(n) worst case and a sequence is O(log n) amortized.
 * `join` consumes both inputs and `split` consumes its receiver.
 */
export class TopDownSplayTree<K, V = K>
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
   * O(log n) amortized: splays the key to the root, then either replaces the value or links a new
   * root above the splayed tree.
   */
  set(key: K, value: V): this {
    this.assertLive();
    assertDefined(key, "key");
    assertDefined(value, "value");
    const root = this.splayInternal(key);
    if (root === null) {
      this._root = new SplayNode<K, V>(key, value);
      this._size = 1;
      this.touch();
      return this;
    }
    const comparison = this.compare(key, root.key);
    if (comparison === 0) {
      root.value = value;
      this.touch();
      return this;
    }
    const node = new SplayNode<K, V>(key, value);
    if (comparison < 0) {
      node.left = root.left;
      node.right = root;
      root.left = null;
      updateNode(root);
    } else {
      node.right = root.right;
      node.left = root;
      root.right = null;
      updateNode(root);
    }
    updateNode(node);
    this._root = node;
    this._size++;
    this.touch();
    return this;
  }

  /**
   * O(log n) amortized: splays the key (or the last node on the search path), then reports the
   * value when the root matches.
   */
  get(key: K): V | undefined {
    this.assertLive();
    assertDefined(key, "key");
    const root = this.splayInternal(key);
    if (root === null) {
      return undefined;
    }
    this.touch();
    return this.compare(root.key, key) === 0 ? root.value : undefined;
  }

  /** O(log n) amortized: same descent and splay as `get`, without reading the value. */
  has(key: K): boolean {
    this.assertLive();
    assertDefined(key, "key");
    const root = this.splayInternal(key);
    if (root === null) {
      return false;
    }
    this.touch();
    return this.compare(root.key, key) === 0;
  }

  /**
   * O(log n) amortized: splays the key to the root. When it matches, the root is removed and its
   * two subtrees are joined by splaying the maximum of the left side.
   */
  delete(key: K): boolean {
    this.assertLive();
    assertDefined(key, "key");
    const root = this.splayInternal(key);
    if (root === null) {
      return false;
    }
    if (this.compare(root.key, key) !== 0) {
      this.touch();
      return false;
    }

    const left = root.left;
    const right = root.right;
    root.left = null;
    root.right = null;
    this._size--;
    if (left === null) {
      this._root = right;
    } else {
      this._root = left;
      let maximum = left;
      while (maximum.right !== null) {
        maximum = maximum.right;
      }
      this.splayInternal(maximum.key);
      const newRoot = this._root as SplayNode<K, V>;
      newRoot.right = right;
      updateNode(newRoot);
    }
    this.touch();
    return true;
  }

  /** O(log n) amortized: walks the left spine, splays the minimum to the root, and returns it. */
  min(): [K, V] | undefined {
    this.assertLive();
    if (this._root === null) {
      return undefined;
    }
    let node = this._root;
    while (node.left !== null) {
      node = node.left;
    }
    const root = this.splayInternal(node.key) as SplayNode<K, V>;
    this.touch();
    return [root.key, root.value];
  }

  /** O(log n) amortized: walks the right spine, splays the maximum to the root, and returns it. */
  max(): [K, V] | undefined {
    this.assertLive();
    if (this._root === null) {
      return undefined;
    }
    let node = this._root;
    while (node.right !== null) {
      node = node.right;
    }
    const root = this.splayInternal(node.key) as SplayNode<K, V>;
    this.touch();
    return [root.key, root.value];
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
    const root = this.splayInternal(best.key) as SplayNode<K, V>;
    this.touch();
    return [root.key, root.value];
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
    const root = this.splayInternal(best.key) as SplayNode<K, V>;
    this.touch();
    return [root.key, root.value];
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
   * key is absent — to the root. Exposed for teaching and for benchmarks.
   */
  splay(key: K): void {
    this.assertLive();
    assertDefined(key, "key");
    if (this.splayInternal(key) !== null) {
      this.touch();
    }
  }

  /** O(n): dumps the sorted entry list; deserialization rebuilds a fresh splay tree. */
  serialize(): string {
    this.assertLive();
    return serializeSplayEntries("TopDownSplayTree", this.toArray());
  }

  /** O(n log n): parses the entry list and inserts it median-first. */
  static deserialize<K, V>(
    json: unknown,
    compare?: Comparator<K>,
  ): TopDownSplayTree<K, V> {
    const entries = readSplayEntries<K, V>(json, "TopDownSplayTree");
    const tree = new TopDownSplayTree<K, V>(compare);
    insertBalanced(tree, entries);
    return tree;
  }

  /**
   * O(log n) amortized: requires every key in this tree to be smaller than every key in `other`.
   * Both inputs are consumed; the returned tree owns the union and uses this tree's comparator.
   */
  join(other: SplayTreeLike<K, V>): TopDownSplayTree<K, V> {
    this.assertLive();
    if (!(other instanceof TopDownSplayTree)) {
      throw new UnsupportedError("TopDownSplayTree can only join another TopDownSplayTree");
    }
    other.assertLive();
    if (other === this) {
      throw new TypeError("cannot join a tree with itself");
    }
    if (this._root !== null && other._root !== null) {
      const leftMax = this.rightmost(this._root);
      const rightMin = this.leftmost(other._root);
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
      this.splayInternal(this.rightmost(leftRoot).key);
      root = this._root as SplayNode<K, V>;
      root.right = rightRoot;
      updateNode(root);
    }
    this.markConsumed();
    other.markConsumed();
    return TopDownSplayTree.fromParts(root, total, this.compare);
  }

  /**
   * O(log n) amortized: consumes the receiver and returns `[< key, >= key]` as fresh trees that
   * share its comparator and ownership of the original nodes.
   */
  split(key: K): [TopDownSplayTree<K, V>, TopDownSplayTree<K, V>] {
    this.assertLive();
    assertDefined(key, "key");
    let leftRoot: SplayNode<K, V> | null = null;
    let rightRoot: SplayNode<K, V> | null = null;
    const root = this.splayInternal(key);
    if (root !== null) {
      if (this.compare(root.key, key) < 0) {
        leftRoot = root;
        rightRoot = root.right;
        root.right = null;
        updateNode(root);
      } else {
        leftRoot = root.left;
        root.left = null;
        updateNode(root);
        rightRoot = root;
      }
    }
    const left = TopDownSplayTree.fromParts(leftRoot, sizeOf(leftRoot), this.compare);
    const right = TopDownSplayTree.fromParts(rightRoot, sizeOf(rightRoot), this.compare);
    this.markConsumed();
    return [left, right];
  }

  /**
   * O(n): iterative in-order validation of ordering, cached subtree sizes, and the container size.
   * There are no parent links to check, and balance is not a splay-tree invariant.
   */
  override validate(): true | string {
    this.assertLive();
    if (this._root === null) {
      return this._size === 0 ? true : "non-empty size with empty root";
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
  ): TopDownSplayTree<K, V> {
    const tree = new TopDownSplayTree<K, V>(compare);
    tree._root = root;
    tree._size = size;
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
   * O(height): the top-down splay. Descends once, collecting the right spine of the eventual left
   * tree and the left spine of the eventual right tree, then reassembles both around the accessed
   * node. Subtree sizes on the two assembled chains are recomputed bottom-up.
   */
  private splayInternal(key: K): SplayNode<K, V> | null {
    const root = this._root;
    if (root === null) {
      return null;
    }
    const leftChain: Array<SplayNode<K, V>> = [];
    const rightChain: Array<SplayNode<K, V>> = [];
    let current = root;
    while (true) {
      const comparison = this.compare(key, current.key);
      if (comparison < 0) {
        if (current.left === null) {
          break;
        }
        if (this.compare(key, current.left.key) < 0) {
          const promoted = current.left;
          const demoted = current;
          current.left = promoted.right;
          promoted.right = current;
          current = promoted;
          updateNode(demoted);
          updateNode(promoted);
          if (current.left === null) {
            break;
          }
        }
        if (rightChain.length > 0) {
          (rightChain[rightChain.length - 1] as SplayNode<K, V>).left = current;
        }
        rightChain.push(current);
        current = current.left as SplayNode<K, V>;
      } else if (comparison > 0) {
        if (current.right === null) {
          break;
        }
        if (this.compare(key, current.right.key) > 0) {
          const promoted = current.right;
          const demoted = current;
          current.right = promoted.left;
          promoted.left = current;
          current = promoted;
          updateNode(demoted);
          updateNode(promoted);
          if (current.right === null) {
            break;
          }
        }
        if (leftChain.length > 0) {
          (leftChain[leftChain.length - 1] as SplayNode<K, V>).right = current;
        }
        leftChain.push(current);
        current = current.right as SplayNode<K, V>;
      } else {
        break;
      }
    }

    const middle = current;
    const middleLeft = middle.left;
    const middleRight = middle.right;
    let leftRoot: SplayNode<K, V> | null;
    if (leftChain.length > 0) {
      leftChain[leftChain.length - 1].right = middleLeft;
      for (let index = leftChain.length - 1; index >= 0; index--) {
        updateNode(leftChain[index] as SplayNode<K, V>);
      }
      leftRoot = leftChain[0] as SplayNode<K, V>;
    } else {
      leftRoot = middleLeft;
    }
    let rightRoot: SplayNode<K, V> | null;
    if (rightChain.length > 0) {
      rightChain[rightChain.length - 1].left = middleRight;
      for (let index = rightChain.length - 1; index >= 0; index--) {
        updateNode(rightChain[index] as SplayNode<K, V>);
      }
      rightRoot = rightChain[0] as SplayNode<K, V>;
    } else {
      rightRoot = middleRight;
    }
    middle.left = leftRoot;
    middle.right = rightRoot;
    updateNode(middle);
    this._root = middle;
    return middle;
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
 * O(n log n): inserts sorted entries median-first through the normal `set` path. The explicit
 * range stack avoids recursion.
 */
function insertBalanced<K, V>(
  tree: TopDownSplayTree<K, V>,
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
