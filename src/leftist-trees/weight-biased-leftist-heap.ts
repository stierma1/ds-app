import { assertDefined } from "../core/index.ts";
import type { Comparator } from "../core/index.ts";
import { LeftistHeapBase } from "./base.ts";
import { parseLeftist } from "./serialization.ts";
import type { LeftistHeap as LeftistHeapContract } from "./types.ts";

interface WeightBiasedNode<T> {
  value: T;
  left: WeightBiasedNode<T> | null;
  right: WeightBiasedNode<T> | null;
  weight: number;
  rank: number;
}

/**
 * Weight-biased leftist heap. Each node stores its subtree weight (node count) and the invariant
 * `weight(left) >= weight(right)`; the right subtree is at most half the weight, so the right spine
 * is O(log n) and push, pop, and merge are O(log n) worst case. The rank field is maintained only
 * for the `rank` accessor and is not used to balance the tree.
 *
 * Duplicates are allowed and ties are broken arbitrarily. Iteration is a pre-order walk, not sorted
 * order. The structure is consumed by merge(); later use throws ConsumedError.
 *
 * Node: {value, left, right, weight, rank}
 */
export class WeightBiasedLeftistHeap<T> extends LeftistHeapBase<T> {
  private _root: WeightBiasedNode<T> | null = null;

  constructor(compare?: Comparator<T>) {
    super(compare);
  }

  /** O(log n): meld a singleton with the root. */
  push(value: T): void {
    this.assertLive();
    this.requireValue(value);
    this._root = this.meld(this._root, this.createNode(value));
    this._size++;
    this.touch();
  }

  /** O(log n): remove the root and meld its two subtrees. */
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

  /** O(n): pairwise bottom-up construction, not n independent pushes. */
  override build(values: Iterable<T>): void {
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
    let layer: WeightBiasedNode<T>[] = items.map((value) => this.createNode(value));
    while (layer.length > 1) {
      const next: WeightBiasedNode<T>[] = [];
      for (let index = 0; index + 1 < layer.length; index += 2) {
        next.push(this.meld(layer[index], layer[index + 1]) as WeightBiasedNode<T>);
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

  /** O(1): null-path length of the root, 0 when empty. */
  override get rank(): number {
    this.assertLive();
    return this._root?.rank ?? 0;
  }

  /** O(1): subtree weight at the root, 0 when empty. */
  get weight(): number {
    this.assertLive();
    return this._root?.weight ?? 0;
  }

  /**
   * O(log n) destructive merge of two WeightBiasedLeftistHeaps sharing one comparator. `other` is consumed. A
   * different comparator throws TypeError; any other implementation throws UnsupportedError
   * (melding it would require copying), and neither heap is changed.
   */
  merge(other: LeftistHeapContract<T>): WeightBiasedLeftistHeap<T> {
    this.acceptMerge(other, WeightBiasedLeftistHeap);
    const source = other as WeightBiasedLeftistHeap<T>;
    const otherRoot = source._root;
    const otherSize = source._size;
    source.markConsumed();
    if (otherRoot !== null) {
      this._root = this.meld(this._root, otherRoot);
      this._size += otherSize;
    }
    this.touch();
    return this;
  }

  /** O(n): checks heap order, weights, the weight invariant, ranks, and size. */
  validate(): true | string {
    this.assertLive();
    if (this._size === 0) {
      return this._root === null ? true : "empty heap still has a root";
    }
    if (this._root === null) {
      return "non-empty heap has no root";
    }
    const visited = new Set<WeightBiasedNode<T>>();
    const stack: WeightBiasedNode<T>[] = [this._root];
    while (stack.length > 0) {
      const node = stack.pop() as WeightBiasedNode<T>;
      if (visited.has(node)) {
        return "cycle or shared node detected";
      }
      visited.add(node);
      if (node.value === undefined) {
        return "node value is undefined";
      }
      const leftWeight = node.left?.weight ?? 0;
      const rightWeight = node.right?.weight ?? 0;
      const leftRank = node.left?.rank ?? 0;
      const rightRank = node.right?.rank ?? 0;
      if (!Number.isInteger(node.weight) || node.weight < 1) {
        return "node weight is not a positive integer";
      }
      if (node.weight !== leftWeight + rightWeight + 1) {
        return "node weight does not match its subtree size";
      }
      if (leftWeight < rightWeight) {
        return "weight-biased invariant violated";
      }
      if (!Number.isInteger(node.rank) || node.rank < 1) {
        return "node rank is not a positive integer";
      }
      if (node.rank !== Math.min(leftRank, rightRank) + 1) {
        return "node rank does not match its null-path length";
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

  /** O(n): rebuilds through the bottom-up build and validates the payload. */
  static deserialize<T>(
    json: unknown,
    compare?: Comparator<T>,
  ): WeightBiasedLeftistHeap<T> {
    const { values } = parseLeftist(json, "WeightBiasedLeftistHeap");
    const heap = new WeightBiasedLeftistHeap<T>(compare);
    heap.build(values as T[]);
    if (heap.validate() !== true) {
      throw new TypeError(`Invalid WeightBiasedLeftistHeap payload: ${heap.validate()}`);
    }
    return heap;
  }

  protected override get serializationType(): string {
    return "WeightBiasedLeftistHeap";
  }

  /** O(n): pre-order traversal of the tree. */
  protected collectItems(): T[] {
    const values: T[] = [];
    if (this._root === null) {
      return values;
    }
    const stack: WeightBiasedNode<T>[] = [this._root];
    while (stack.length > 0) {
      const node = stack.pop() as WeightBiasedNode<T>;
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

  private createNode(value: T): WeightBiasedNode<T> {
    return { value, left: null, right: null, weight: 1, rank: 1 };
  }

  /** Meld two weight-biased trees and restore the weight invariant; O(log n). */
  private meld(
    a: WeightBiasedNode<T> | null,
    b: WeightBiasedNode<T> | null,
  ): WeightBiasedNode<T> | null {
    if (a === null) {
      return b;
    }
    if (b === null) {
      return a;
    }
    if (this.compare(a.value, b.value) > 0) {
      const swap = a;
      a = b;
      b = swap;
    }
    a.right = this.meld(a.right, b);
    if ((a.left?.weight ?? 0) < (a.right?.weight ?? 0)) {
      const swap = a.left;
      a.left = a.right;
      a.right = swap;
    }
    const leftWeight = a.left?.weight ?? 0;
    const rightWeight = a.right?.weight ?? 0;
    a.weight = leftWeight + rightWeight + 1;
    a.rank = Math.min(a.left?.rank ?? 0, a.right?.rank ?? 0) + 1;
    return a;
  }
}
