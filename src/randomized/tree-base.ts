import {
  assertDefined,
  assertInteger,
  ContainerBase,
  resolveComparator,
  resolveRandomSource,
} from "../core/index.ts";
import type {
  Comparator,
  RandomSource,
  RangeOptions,
} from "../core/index.ts";
import { serializeRandomizedEntries } from "./serialization.ts";
import type { RandomizedMap, RandomOptions } from "./types.ts";

/** Structural shape shared by the treap and randomized-BST nodes. */
export interface RandomizedTreeNode<K, V> {
  key: K;
  value: V;
  left: RandomizedTreeNode<K, V> | null;
  right: RandomizedTreeNode<K, V> | null;
  size: number;
}

/** O(1): subtree node count, with the null tree at 0. */
export function treeSizeOf<K, V>(
  node: RandomizedTreeNode<K, V> | null,
): number {
  return node === null ? 0 : node.size;
}

/** O(1): recomputes the cached subtree size from the children. */
export function updateTreeNode<K, V>(
  node: RandomizedTreeNode<K, V>,
): void {
  node.size = 1 + treeSizeOf(node.left) + treeSizeOf(node.right);
}

/** O(1): validates the three-valued range endpoint options used by OrderedMap. */
export function readRangeOptions<K>(options?: RangeOptions<K>): {
  loInclusive: boolean;
  hiInclusive: boolean;
} {
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
  return {
    loInclusive: options?.lo === undefined || options.lo === "inclusive",
    hiInclusive: options?.hi === undefined || options.hi === "inclusive",
  };
}

/**
 * Shared skeleton for the randomized binary search trees. Subclasses supply the randomized
 * insertion and deletion rules; everything else — lookup, order statistics, range iteration,
 * validation, height, serialization — is identical to any ordered map.
 *
 * The tree maintains cached subtree sizes, so `at` and `indexOf` are O(height) expected. No balance
 * condition is enforced or validated; balance is expected over the random choices.
 */
export abstract class RandomizedTreeBase<K, V, N extends RandomizedTreeNode<K, V>>
  extends ContainerBase<[K, V]>
  implements RandomizedMap<K, V>
{
  readonly compare: Comparator<K>;
  readonly rng: RandomSource;
  protected _root: N | null = null;

  protected constructor(compare?: Comparator<K>, options?: RandomOptions) {
    super();
    this.compare = resolveComparator(compare);
    this.rng = resolveRandomSource(options?.rng);
  }

  protected abstract createNode(key: K, value: V): N;

  /** Inserts a node whose key is known to be absent; returns the new subtree root. */
  protected abstract insertNode(root: N | null, node: N): N;

  /** Removes `key`; returns the new subtree root and whether anything was removed. */
  protected abstract deleteNode(root: N, key: K): [N | null, boolean];

  /** Additional per-node invariant checked by `validate`, such as heap order on priorities. */
  protected checkNode(_node: N): true | string {
    return true;
  }

  protected abstract get serializationType(): string;

  /** O(log n) expected: replaces an existing value or inserts a new key. */
  set(key: K, value: V): this {
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
    assertDefined(key, "key");
    return this.findNode(key)?.value;
  }

  /** O(log n) expected: membership test. */
  has(key: K): boolean {
    assertDefined(key, "key");
    return this.findNode(key) !== null;
  }

  /** O(log n) expected: removes `key` and returns whether it was present. */
  delete(key: K): boolean {
    assertDefined(key, "key");
    if (this._root === null) {
      return false;
    }
    const [root, deleted] = this.deleteNode(this._root, key);
    if (!deleted) {
      return false;
    }
    this._root = root;
    this._size--;
    this.touch();
    return true;
  }

  /** O(log n) expected: the smallest entry. */
  min(): [K, V] | undefined {
    let node = this._root;
    if (node === null) {
      return undefined;
    }
    while (node.left !== null) {
      node = node.left as N;
    }
    return [node.key, node.value];
  }

  /** O(log n) expected: the largest entry. */
  max(): [K, V] | undefined {
    let node = this._root;
    if (node === null) {
      return undefined;
    }
    while (node.right !== null) {
      node = node.right as N;
    }
    return [node.key, node.value];
  }

  /** O(log n) expected: largest entry strictly less than `key`. */
  predecessor(key: K): [K, V] | undefined {
    assertDefined(key, "key");
    let node = this._root;
    let best: N | null = null;
    while (node !== null) {
      if (this.compare(node.key, key) < 0) {
        best = node;
        node = node.right as N | null;
      } else {
        node = node.left as N | null;
      }
    }
    return best === null ? undefined : [best.key, best.value];
  }

  /** O(log n) expected: smallest entry strictly greater than `key`. */
  successor(key: K): [K, V] | undefined {
    assertDefined(key, "key");
    let node = this._root;
    let best: N | null = null;
    while (node !== null) {
      if (this.compare(node.key, key) > 0) {
        best = node;
        node = node.left as N | null;
      } else {
        node = node.right as N | null;
      }
    }
    return best === null ? undefined : [best.key, best.value];
  }

  /** O(height) expected: select by rank through cached subtree sizes. */
  at(index: number): [K, V] | undefined {
    assertInteger(index);
    if (index < 0 || index >= this._size) {
      return undefined;
    }
    let node = this._root;
    let remaining = index;
    while (node !== null) {
      const leftSize = treeSizeOf(node.left);
      if (remaining < leftSize) {
        node = node.left as N;
      } else if (remaining === leftSize) {
        return [node.key, node.value];
      } else {
        remaining -= leftSize + 1;
        node = node.right as N | null;
      }
    }
    return undefined;
  }

  /** O(height) expected: rank through cached subtree sizes; -1 when absent. */
  indexOf(key: K): number {
    assertDefined(key, "key");
    let node = this._root;
    let rank = 0;
    while (node !== null) {
      const comparison = this.compare(key, node.key);
      if (comparison === 0) {
        return rank + treeSizeOf(node.left);
      }
      if (comparison < 0) {
        node = node.left as N;
      } else {
        rank += treeSizeOf(node.left) + 1;
        node = node.right as N | null;
      }
    }
    return -1;
  }

  /**
   * O(log n + k) expected: descends to the lower bound, then materializes k in-order entries into
   * a snapshot iterator. Mutating the tree invalidates the iterator.
   */
  range(lo?: K, hi?: K, options?: RangeOptions<K>): IterableIterator<[K, V]> {
    const { loInclusive, hiInclusive } = readRangeOptions(options);
    const entries: Array<[K, V]> = [];
    if (lo !== undefined && hi !== undefined && this.compare(lo, hi) > 0) {
      return this.snapshotIterator(entries);
    }

    const stack: N[] = [];
    let node = this._root;
    if (lo === undefined) {
      while (node !== null) {
        stack.push(node);
        node = node.left as N | null;
      }
    } else {
      while (node !== null) {
        const comparison = this.compare(node.key, lo);
        if (comparison > 0 || (comparison === 0 && loInclusive)) {
          stack.push(node);
          node = node.left as N | null;
        } else {
          node = node.right as N | null;
        }
      }
    }

    while (stack.length > 0) {
      const current = stack.pop() as N;
      if (hi !== undefined) {
        const comparison = this.compare(current.key, hi);
        if (comparison > 0 || (comparison === 0 && !hiInclusive)) {
          break;
        }
      }
      entries.push([current.key, current.value]);
      let child = current.right;
      while (child !== null) {
        stack.push(child as N);
        child = child.left as N | null;
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
    const entries: Array<[K, V]> = [];
    const stack: N[] = [];
    let node = this._root;
    while (node !== null || stack.length > 0) {
      while (node !== null) {
        stack.push(node);
        node = node.left as N | null;
      }
      const current = stack.pop() as N;
      entries.push([current.key, current.value]);
      node = current.right as N | null;
    }
    return entries;
  }

  /** Same as entries(): materialized O(n) in-order snapshot. */
  override [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }

  /** O(1): drops the root and invalidates every live snapshot iterator. */
  override clear(): void {
    this._root = null;
    this._size = 0;
    this.touch();
  }

  /** O(n): height in edges; the empty tree is -1. Randomized trees do not enforce a bound. */
  get height(): number {
    if (this._root === null) {
      return -1;
    }
    let maximum = 0;
    const nodes: Array<N> = [this._root];
    const depths: number[] = [0];
    while (nodes.length > 0) {
      const node = nodes.pop() as N;
      const depth = depths.pop() as number;
      if (depth > maximum) {
        maximum = depth;
      }
      if (node.left !== null) {
        nodes.push(node.left as N);
        depths.push(depth + 1);
      }
      if (node.right !== null) {
        nodes.push(node.right as N);
        depths.push(depth + 1);
      }
    }
    return maximum;
  }

  /** O(n): sorted entry list; priorities and randomness are not serialized. */
  serialize(): string {
    return serializeRandomizedEntries(this.serializationType, this.toArray());
  }

  /**
   * O(n): in-order validation of BST order, cached subtree sizes, node count, and any subclass
   * node invariant. Balance is not checked because none is maintained.
   */
  override validate(): true | string {
    if (this._root === null) {
      return this._size === 0 ? true : "non-empty size with empty root";
    }
    const stack: N[] = [];
    const seen = new Set<N>();
    let node: N | null = this._root;
    let previous: N | null = null;
    let count = 0;
    while (node !== null || stack.length > 0) {
      while (node !== null) {
        if (seen.has(node)) {
          return "cycle or shared node detected";
        }
        seen.add(node);
        stack.push(node);
        node = node.left as N | null;
      }
      const current = stack.pop() as N;
      count++;
      if (count > this._size) {
        return "tree contains more nodes than size";
      }
      if (current.key === undefined || current.value === undefined) {
        return `node at index ${count - 1} has an undefined key or value`;
      }
      if (current.size !== 1 + treeSizeOf(current.left) + treeSizeOf(current.right)) {
        return `node at index ${count - 1} has a stale subtree size`;
      }
      const extra = this.checkNode(current);
      if (extra !== true) {
        return extra;
      }
      if (previous !== null && this.compare(previous.key, current.key) >= 0) {
        return "binary search tree ordering is violated";
      }
      previous = current;
      node = current.right as N | null;
    }
    if (count !== this._size) {
      return `size ${this._size} does not match node count ${count}`;
    }
    return true;
  }

  /** O(log n) expected: iterative lookup by key. */
  protected findNode(key: K): N | null {
    let node = this._root;
    while (node !== null) {
      const comparison = this.compare(key, node.key);
      if (comparison === 0) {
        return node;
      }
      node = comparison < 0 ? (node.left as N | null) : (node.right as N | null);
    }
    return null;
  }
}
