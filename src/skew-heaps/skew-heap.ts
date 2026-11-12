import type { Comparator } from "../core/index.ts";
import { SkewHeapBase } from "./base.ts";
import type { SkewNode } from "./node.ts";
import { parseSkew } from "./serialization.ts";

/**
 * Skew heap with an iterative meld. The default implementation: it walks the right spines of both
 * heaps, links the smaller root, and swaps children on every node of the meld path. Because the
 * walk is iterative, degenerate monotone insertion does not overflow the call stack. Push, pop, and
 * merge are O(log n) amortized and O(n) worst case; peek is O(1); build is O(n).
 *
 * Duplicates are allowed and ties are broken arbitrarily. Iteration is a pre-order walk of the
 * tree, not sorted order. The structure is consumed by merge(); later use throws ConsumedError.
 *
 * Node: {value, left, right}
 */
export class SkewHeap<T> extends SkewHeapBase<T> {
  constructor(compare?: Comparator<T>) {
    super(compare);
  }

  /** O(n): rebuilds through the bottom-up build and validates the payload. */
  static deserialize<T>(json: unknown, compare?: Comparator<T>): SkewHeap<T> {
    const { values } = parseSkew(json, "SkewHeap");
    const heap = new SkewHeap<T>(compare);
    heap.build(values as T[]);
    if (heap.validate() !== true) {
      throw new TypeError(`Invalid SkewHeap payload: ${heap.validate()}`);
    }
    return heap;
  }

  protected override get serializationType(): string {
    return "SkewHeap";
  }

  /**
   * O(log n) amortized: meld two trees without recursion. The path array records every node whose
   * children are swapped after the right spines are linked.
   */
  protected override meldNodes(
    a: SkewNode<T> | null,
    b: SkewNode<T> | null,
  ): SkewNode<T> | null {
    if (a === null) {
      return b;
    }
    if (b === null) {
      return a;
    }
    const path: SkewNode<T>[] = [];
    let left: SkewNode<T> | null = a;
    let right: SkewNode<T> | null = b;
    while (left !== null && right !== null) {
      if (this.compare(left.value, right.value) > 0) {
        const swapRoot: SkewNode<T> = left;
        left = right;
        right = swapRoot;
      }
      const next: SkewNode<T> | null = left.right;
      if (path.length > 0) {
        path[path.length - 1].right = left;
      }
      path.push(left);
      left = next;
    }
    const last = path[path.length - 1] as SkewNode<T>;
    last.right = left ?? right;
    for (let index = path.length - 1; index >= 0; index--) {
      const node = path[index];
      const swapChild: SkewNode<T> | null = node.left;
      node.left = node.right;
      node.right = swapChild;
    }
    return path[0];
  }
}
