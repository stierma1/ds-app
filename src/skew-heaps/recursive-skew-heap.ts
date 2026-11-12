import type { Comparator } from "../core/index.ts";
import { SkewHeapBase } from "./base.ts";
import type { SkewNode } from "./node.ts";
import { parseSkew } from "./serialization.ts";

/**
 * Skew heap with the textbook recursive meld. It is provided for reference and teaching; the
 * iterative SkewHeap is the default because it cannot overflow the call stack on degenerate trees.
 * Push, pop, and merge are O(log n) amortized and O(n) worst case; peek is O(1); build is O(n).
 * Recursion depth equals the meld path length, which can be Θ(n): alternating-sign inserts followed
 * by a push of a larger key overflow Node's default stack (RangeError) from about 2×10^4 elements.
 * The meld only relinks nodes after its recursive call returns, so an overflow leaves the heap
 * unchanged.
 *
 * Duplicates are allowed and ties are broken arbitrarily. Iteration is a pre-order walk of the
 * tree, not sorted order. The structure is consumed by merge(); later use throws ConsumedError.
 *
 * Node: {value, left, right}
 */
export class RecursiveSkewHeap<T> extends SkewHeapBase<T> {
  constructor(compare?: Comparator<T>) {
    super(compare);
  }

  /** O(n): rebuilds through the bottom-up build and validates the payload. */
  static deserialize<T>(
    json: unknown,
    compare?: Comparator<T>,
  ): RecursiveSkewHeap<T> {
    const { values } = parseSkew(json, "RecursiveSkewHeap");
    const heap = new RecursiveSkewHeap<T>(compare);
    heap.build(values as T[]);
    if (heap.validate() !== true) {
      throw new TypeError(`Invalid RecursiveSkewHeap payload: ${heap.validate()}`);
    }
    return heap;
  }

  protected override get serializationType(): string {
    return "RecursiveSkewHeap";
  }

  /** O(log n) amortized: meld recursively, then swap the root's children. */
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
    if (this.compare(a.value, b.value) > 0) {
      const swap = a;
      a = b;
      b = swap;
    }
    a.right = this.meldNodes(a.right, b);
    const swap = a.left;
    a.left = a.right;
    a.right = swap;
    return a;
  }
}
