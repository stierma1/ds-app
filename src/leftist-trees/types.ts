import type { Comparator, MeldablePriorityQueue } from "../core/index.ts";

/**
 * Meldable priority queue backed by a leftist tree. `rank` is the null-path length of the root for
 * height-biased trees and the corresponding null-path length for weight-biased trees, whose balance
 * key is the subtree weight instead. The null tree has rank 0 and a single node has rank 1.
 *
 * `merge` is destructive and consumes `other`; the returned heap owns both sets of elements and any
 * later operation on `other` throws ConsumedError. `build` replaces the contents rather than adding
 * to them.
 */
export interface LeftistHeap<T> extends MeldablePriorityQueue<T> {
  readonly compare: Comparator<T>;
  readonly rank: number;
  build(values: Iterable<T>): void;
  merge(other: LeftistHeap<T>): LeftistHeap<T>;
  peekMin(): T | undefined;
  popMin(): T | undefined;
}

/**
 * Leftist heap that also exposes the maximum. `popMin` and `popMax` both remove the only element
 * when one remains. `peekMin` and `peekMax` are O(1); each pop is O(log n) amortized over the
 * sequence of operations.
 */
export interface DoubleEndedLeftistTree<T> extends LeftistHeap<T> {
  peekMax(): T | undefined;
  popMax(): T | undefined;
}
