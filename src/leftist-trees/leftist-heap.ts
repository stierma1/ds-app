import { assertDefined } from "../core/index.ts";
import type { Comparator } from "../core/index.ts";
import { LeftistHeapBase } from "./base.ts";
import { parseLeftist } from "./serialization.ts";
import type { LeftistHeap as LeftistHeapContract } from "./types.ts";

interface LeftistNode<T> {
  value: T;
  left: LeftistNode<T> | null;
  right: LeftistNode<T> | null;
  rank: number;
}

/**
 * Height-biased leftist heap. Every node stores the null-path length (rank) of its subtree, and the
 * invariant `rank(left) >= rank(right)` keeps the right spine O(log n) long. As a result push, pop,
 * and merge are O(log n) worst case, peek is O(1), and the two-pass bottom-up build is O(n).
 *
 * Duplicates are allowed and ties are broken arbitrarily. Iteration is a pre-order walk of the
 * leftist tree, not sorted order. The structure is consumed by merge(); later use throws
 * ConsumedError.
 *
 * Node: {value, left, right, rank}
 */
export class LeftistHeap<T> extends LeftistHeapBase<T> {
  private _root: LeftistNode<T> | null = null;

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
    let layer: LeftistNode<T>[] = items.map((value) => this.createNode(value));
    while (layer.length > 1) {
      const next: LeftistNode<T>[] = [];
      for (let index = 0; index + 1 < layer.length; index += 2) {
        next.push(this.meld(layer[index], layer[index + 1]) as LeftistNode<T>);
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

  /**
   * O(log n) destructive merge of two LeftistHeaps sharing one comparator. `other` is consumed. A
   * different comparator throws TypeError; any other implementation throws UnsupportedError
   * (melding it would require copying), and neither heap is changed.
   */
  merge(other: LeftistHeapContract<T>): LeftistHeap<T> {
    this.acceptMerge(other, LeftistHeap);
    const source = other as LeftistHeap<T>;
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

  /** O(n): checks heap order, rank values, the leftist invariant, and size. */
  validate(): true | string {
    this.assertLive();
    if (this._size === 0) {
      return this._root === null ? true : "empty heap still has a root";
    }
    if (this._root === null) {
      return "non-empty heap has no root";
    }
    const visited = new Set<LeftistNode<T>>();
    const stack: LeftistNode<T>[] = [this._root];
    while (stack.length > 0) {
      const node = stack.pop() as LeftistNode<T>;
      if (visited.has(node)) {
        return "cycle or shared node detected";
      }
      visited.add(node);
      if (node.value === undefined) {
        return "node value is undefined";
      }
      const leftRank = node.left?.rank ?? 0;
      const rightRank = node.right?.rank ?? 0;
      if (!Number.isInteger(node.rank) || node.rank < 1) {
        return "node rank is not a positive integer";
      }
      if (leftRank < rightRank) {
        return "leftist rank invariant violated";
      }
      if (node.rank !== rightRank + 1) {
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
  static deserialize<T>(json: unknown, compare?: Comparator<T>): LeftistHeap<T> {
    const { values } = parseLeftist(json, "LeftistHeap");
    const heap = new LeftistHeap<T>(compare);
    heap.build(values as T[]);
    if (heap.validate() !== true) {
      throw new TypeError(`Invalid LeftistHeap payload: ${heap.validate()}`);
    }
    return heap;
  }

  protected override get serializationType(): string {
    return "LeftistHeap";
  }

  /** O(n): pre-order traversal of the tree. */
  protected collectItems(): T[] {
    const values: T[] = [];
    if (this._root === null) {
      return values;
    }
    const stack: LeftistNode<T>[] = [this._root];
    while (stack.length > 0) {
      const node = stack.pop() as LeftistNode<T>;
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

  private createNode(value: T): LeftistNode<T> {
    return { value, left: null, right: null, rank: 1 };
  }

  /** Meld two leftist trees and restore the rank invariant on the merged path; O(log n). */
  private meld(
    a: LeftistNode<T> | null,
    b: LeftistNode<T> | null,
  ): LeftistNode<T> | null {
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
    if ((a.left?.rank ?? 0) < (a.right?.rank ?? 0)) {
      const swap = a.left;
      a.left = a.right;
      a.right = swap;
    }
    a.rank = (a.right?.rank ?? 0) + 1;
    return a;
  }
}
