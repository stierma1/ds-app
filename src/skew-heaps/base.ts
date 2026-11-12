import {
  assertDefined,
  assertMergeCompatible,
  ContainerBase,
  ConsumedError,
  resolveComparator,
  takeForMerge,
  UnsupportedError,
} from "../core/index.ts";
import type { Comparator } from "../core/index.ts";
import type { SkewNode } from "./node.ts";
import { serializeSkew } from "./serialization.ts";
import type { SkewHeap } from "./types.ts";

/**
 * Shared skeleton for the skew-heap implementations: comparator resolution, live/consumed state,
 * snapshot iteration, serialization, the common priority-queue operations, and bottom-up build.
 * Subclasses supply only the meld strategy.
 *
 * A heap is consumed by merge(): the owner marks the argument dead, releases its storage, and from
 * then on every public operation on the argument throws ConsumedError. Iteration is a snapshot and
 * throws ConcurrentModificationError if the heap is mutated mid-iteration.
 */
export abstract class SkewHeapBase<T>
  extends ContainerBase<T>
  implements SkewHeap<T>
{
  readonly compare: Comparator<T>;
  protected _root: SkewNode<T> | null = null;
  private _consumed = false;

  protected constructor(compare?: Comparator<T>) {
    super();
    this.compare = resolveComparator(compare);
  }

  /** Melds two node trees and swaps children along the meld path. */
  protected abstract meldNodes(
    a: SkewNode<T> | null,
    b: SkewNode<T> | null,
  ): SkewNode<T> | null;

  protected abstract get serializationType(): string;

  /** O(log n) amortized: meld a singleton with the root. */
  push(value: T): void {
    this.assertLive();
    this.requireValue(value);
    this._root = this.meldNodes(this._root, this.createNode(value));
    this._size++;
    this.touch();
  }

  /** O(log n) amortized: remove the root and meld its two subtrees. */
  pop(): T | undefined {
    this.assertLive();
    const root = this._root;
    if (root === null) {
      return undefined;
    }
    this._root = this.meldNodes(root.left, root.right);
    this._size--;
    this.touch();
    return root.value;
  }

  /** O(1): the minimum element, or undefined when empty. */
  peek(): T | undefined {
    this.assertLive();
    return this._root?.value;
  }

  /** O(n): pairwise bottom-up meld of singleton trees, not n independent pushes. */
  build(values: Iterable<T>): void {
    this.assertLive();
    const items = [...values];
    for (const value of items) {
      assertDefined(value);
    }
    if (items.length === 0) {
      this._root = null;
      this._size = 0;
      this.touch();
      return;
    }
    let layer: SkewNode<T>[] = items.map((value) => this.createNode(value));
    while (layer.length > 1) {
      const next: SkewNode<T>[] = [];
      for (let index = 0; index + 1 < layer.length; index += 2) {
        next.push(this.meldNodes(layer[index], layer[index + 1]) as SkewNode<T>);
      }
      if ((layer.length & 1) === 1) {
        next.push(layer[layer.length - 1]);
      }
      layer = next;
    }
    this._root = layer[0];
    this._size = items.length;
    this.touch();
  }

  /** O(1): number of stored elements. */
  override get size(): number {
    this.assertLive();
    return this._size;
  }

  /** O(1): emptiness check that rejects a consumed heap. */
  override isEmpty(): boolean {
    this.assertLive();
    return this._size === 0;
  }

  /** O(n): fresh array in iteration order. */
  override toArray(): T[] {
    this.assertLive();
    return this.collectItems();
  }

  /** O(n) up front: snapshot of the heap in iteration order; mutation mid-iteration throws. */
  override [Symbol.iterator](): IterableIterator<T> {
    this.assertLive();
    return this.snapshotIterator(this.collectItems());
  }

  /** O(1): drops every element and bumps the version. */
  override clear(): void {
    this.assertLive();
    this.releaseStorage();
    this._size = 0;
    this.touch();
  }

  /** O(n): values in iteration order plus any implementation configuration. */
  override serialize(): string {
    this.assertLive();
    return serializeSkew(this.serializationType, this.collectItems());
  }

  /**
   * O(log n) amortized destructive merge. SkewHeap and RecursiveSkewHeap share one node structure,
   * so either melds the other directly; `other` is consumed. A different comparator throws
   * TypeError; any other implementation throws UnsupportedError (melding it would require copying
   * its elements), and neither heap is changed.
   */
  merge(other: SkewHeap<T>): SkewHeap<T> {
    this.assertLive();
    assertMergeCompatible(this, other);
    if (!(other instanceof SkewHeapBase)) {
      throw new UnsupportedError(
        `${this.constructor.name} can only merge another skew heap in O(log n) amortized`,
      );
    }
    const otherHeap = other as SkewHeapBase<T>;
    otherHeap.assertLive();
    const otherRoot = otherHeap._root;
    const otherSize = otherHeap._size;
    if (otherRoot !== null) {
      // Meld before consuming `other`: a RecursiveSkewHeap meld can overflow the call stack, and
      // it only relinks nodes after the recursion returns, so a throw leaves both heaps intact.
      this._root = this.meldNodes(this._root, otherRoot);
      this._size += otherSize;
    }
    otherHeap.markConsumed();
    this.touch();
    return this;
  }

  /** O(n): checks heap order, cycles or shared nodes, and size. No balance invariant exists. */
  validate(): true | string {
    this.assertLive();
    if (this._size === 0) {
      return this._root === null ? true : "empty heap still has a root";
    }
    if (this._root === null) {
      return "non-empty heap has no root";
    }
    const visited = new Set<SkewNode<T>>();
    const stack: SkewNode<T>[] = [this._root];
    while (stack.length > 0) {
      const node = stack.pop() as SkewNode<T>;
      if (visited.has(node)) {
        return "cycle or shared node detected";
      }
      visited.add(node);
      if (node.value === undefined) {
        return "node value is undefined";
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
    if (visited.size !== this._size) {
      return `size ${this._size} does not match node count ${visited.size}`;
    }
    return true;
  }

  /** O(1) per call: throws ConsumedError after this heap has been merged into another one. */
  protected assertLive(): void {
    if (this._consumed) {
      throw new ConsumedError();
    }
  }

  /** O(1): permanently transfers ownership and releases storage. */
  protected markConsumed(): void {
    this._consumed = true;
    this._size = 0;
    this.releaseStorage();
    this.touch();
  }

  /** O(n): hands every element to a merge in another module and marks this heap consumed. */
  [takeForMerge](): T[] {
    this.assertLive();
    const values = this.collectItems();
    this.markConsumed();
    return values;
  }

  protected requireValue(value: T, name = "value"): void {
    assertDefined(value, name);
  }

  /** O(n): pre-order traversal of the tree. */
  protected collectItems(): T[] {
    const values: T[] = [];
    if (this._root === null) {
      return values;
    }
    const stack: SkewNode<T>[] = [this._root];
    while (stack.length > 0) {
      const node = stack.pop() as SkewNode<T>;
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

  protected createNode(value: T): SkewNode<T> {
    return { value, left: null, right: null };
  }
}
