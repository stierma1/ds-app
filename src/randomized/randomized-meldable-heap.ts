import {
  assertMergeCompatible,
  resolveRandomSource,
  UnsupportedError,
} from "../core/index.ts";
import type { Comparator, RandomSource } from "../core/index.ts";
import { HeapBase } from "../heaps/base.ts";
import type { Heap } from "../heaps/types.ts";
import { readRandomizedValues } from "./serialization.ts";
import type {
  RandomizedMeldableHeap as RandomizedMeldableHeapContract,
  RandomOptions,
} from "./types.ts";

/** Heap node: a value, two child links, and a cached subtree node count. */
class RandomizedHeapNode<T> {
  value: T;
  left: RandomizedHeapNode<T> | null = null;
  right: RandomizedHeapNode<T> | null = null;
  size = 1;

  constructor(value: T) {
    this.value = value;
  }
}

/**
 * Randomized meldable heap (Gambin and Malinowski). Every node keeps the smallest value of its
 * subtree; melding two heaps keeps the smaller root and flips a fair coin to decide whether to meld
 * the other heap into its left or right child. No balance metadata is stored, so push, pop, and
 * merge are O(log n) expected and O(n) worst case; peek is O(1).
 *
 * Duplicates are allowed and ties are broken arbitrarily. Iteration is a pre-order walk, not sorted
 * order. `merge` is destructive and consumes its argument; later operations on the consumed heap
 * throw ConsumedError. The constructor's `rng` makes the coin flips reproducible.
 */
export class RandomizedMeldableHeap<T>
  extends HeapBase<T>
  implements RandomizedMeldableHeapContract<T>
{
  readonly rng: RandomSource;
  private _root: RandomizedHeapNode<T> | null = null;

  /** O(1); `compare` defaults to natural order and `rng` defaults to a CSPRNG seed. */
  constructor(compare?: Comparator<T>, options?: RandomOptions) {
    super(compare);
    this.rng = resolveRandomSource(options?.rng);
  }

  /** O(log n) expected: meld a singleton into the root. */
  push(value: T): void {
    this.assertLive();
    this.requireValue(value);
    this._root = this.meld(this._root, new RandomizedHeapNode<T>(value));
    this._size++;
    this.touch();
  }

  /** O(log n) expected: remove the root and meld its two children. */
  pop(): T | undefined {
    this.assertLive();
    const root = this._root;
    if (root === null) {
      return undefined;
    }
    this._root = this.meld(root.left, root.right);
    this._size--;
    this.touch();
    return root.value;
  }

  /** O(1): the minimum element, or undefined when empty. */
  peek(): T | undefined {
    this.assertLive();
    return this._root?.value;
  }

  /** O(n): height in edges; the empty heap is 0. Randomized balancing is not a height bound. */
  get height(): number {
    this.assertLive();
    if (this._root === null) {
      return 0;
    }
    let maximum = 0;
    const nodes: Array<RandomizedHeapNode<T>> = [this._root];
    const depths: number[] = [0];
    while (nodes.length > 0) {
      const node = nodes.pop() as RandomizedHeapNode<T>;
      const depth = depths.pop() as number;
      if (depth > maximum) {
        maximum = depth;
      }
      if (node.left !== null) {
        nodes.push(node.left);
        depths.push(depth + 1);
      }
      if (node.right !== null) {
        nodes.push(node.right);
        depths.push(depth + 1);
      }
    }
    return maximum;
  }

  /**
   * O(log n) expected: destructive meld. `other` must be a RandomizedMeldableHeap with the same
   * comparator; it is consumed and every later operation on it throws ConsumedError. Any other heap
   * implementation throws UnsupportedError before either heap is changed.
   */
  override merge(other: Heap<T>): RandomizedMeldableHeap<T> {
    this.assertLive();
    assertMergeCompatible(this, other);
    if (!(other instanceof RandomizedMeldableHeap)) {
      throw new UnsupportedError(
        "RandomizedMeldableHeap can only merge another RandomizedMeldableHeap in O(log n)",
      );
    }
    const source = other as RandomizedMeldableHeap<T>;
    source.assertLive();
    const sourceRoot = source._root;
    const sourceSize = source._size;
    source.markConsumed();
    if (sourceRoot !== null) {
      this._root = this.meld(this._root, sourceRoot);
      this._size += sourceSize;
    }
    this.touch();
    return this;
  }

  /** O(n log n) expected: rebuilds by pushing the payload and validates the result. */
  static deserialize<T>(
    json: unknown,
    compare?: Comparator<T>,
    options?: RandomOptions,
  ): RandomizedMeldableHeap<T> {
    const values = readRandomizedValues(json, "RandomizedMeldableHeap");
    const heap = new RandomizedMeldableHeap<T>(compare, options);
    heap.build(values as T[]);
    const validation = heap.validate();
    if (validation !== true) {
      throw new TypeError(`Invalid RandomizedMeldableHeap payload: ${validation}`);
    }
    return heap;
  }

  protected override get serializationType(): string {
    return "RandomizedMeldableHeap";
  }

  /** O(n): pre-order walk of the heap tree. */
  protected collectItems(): T[] {
    const values: T[] = [];
    if (this._root === null) {
      return values;
    }
    const stack: Array<RandomizedHeapNode<T>> = [this._root];
    while (stack.length > 0) {
      const node = stack.pop() as RandomizedHeapNode<T>;
      values.push(node.value);
      if (node.right !== null) {
        stack.push(node.right);
      }
      if (node.left !== null) {
        stack.push(node.left);
      }
    }
    return values;
  }

  protected releaseStorage(): void {
    this._root = null;
  }

  /** O(n): heap order, cached subtree sizes, defined values, and the node count. */
  protected checkInvariants(): true | string {
    if (this._size === 0) {
      return this._root === null ? true : "empty heap still has a root";
    }
    if (this._root === null) {
      return "non-empty heap has no root";
    }
    const seen = new Set<RandomizedHeapNode<T>>();
    const stack: Array<RandomizedHeapNode<T>> = [this._root];
    while (stack.length > 0) {
      const node = stack.pop() as RandomizedHeapNode<T>;
      if (seen.has(node)) {
        return "cycle or shared node detected";
      }
      seen.add(node);
      if (node.value === undefined) {
        return "node value is undefined";
      }
      const expected =
        1 +
        (node.left === null ? 0 : node.left.size) +
        (node.right === null ? 0 : node.right.size);
      if (node.size !== expected) {
        return "node has a stale subtree size";
      }
      if (node.left !== null) {
        if (this.compare(node.value, node.left.value) > 0) {
          return "heap order violated at a left child";
        }
        stack.push(node.left);
      }
      if (node.right !== null) {
        if (this.compare(node.value, node.right.value) > 0) {
          return "heap order violated at a right child";
        }
        stack.push(node.right);
      }
    }
    if (seen.size !== this._size) {
      return `size ${this._size} does not match node count ${seen.size}`;
    }
    return true;
  }

  /**
   * O(log n) expected: keeps the smaller root, flips a fair coin, and recursively melds the other
   * heap into the chosen child. Sizes are refreshed on the return path.
   */
  private meld(
    left: RandomizedHeapNode<T> | null,
    right: RandomizedHeapNode<T> | null,
  ): RandomizedHeapNode<T> | null {
    if (left === null) {
      return right;
    }
    if (right === null) {
      return left;
    }
    let root = left;
    let other = right;
    if (this.compare(root.value, other.value) > 0) {
      root = right;
      other = left;
    }
    if (this.nextRandom() < 0.5) {
      root.left = this.meld(root.left, other);
    } else {
      root.right = this.meld(root.right, other);
    }
    root.size =
      1 +
      (root.left === null ? 0 : root.left.size) +
      (root.right === null ? 0 : root.right.size);
    return root;
  }

  /** O(1): one validated coin flip from the configured random source. */
  private nextRandom(): number {
    const value = this.rng.next();
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TypeError("rng.next() must return a finite number");
    }
    return value;
  }
}
