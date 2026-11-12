import type { Comparator, MeldablePriorityQueue } from "../core/index.ts";

/**
 * Self-adjusting meldable priority queue backed by a skew heap. Every node stores only a value and
 * two child links; meld always swaps the children of every node it touches, so no rank or size
 * metadata is needed. Push, pop, and merge are O(log n) amortized and O(n) worst case.
 *
 * `merge` is destructive and consumes `other`; the returned heap owns both sets of elements and any
 * later operation on `other` throws ConsumedError. `build` replaces the contents rather than adding
 * to them.
 */
export interface SkewHeap<T> extends MeldablePriorityQueue<T> {
  readonly compare: Comparator<T>;
  build(values: Iterable<T>): void;
  merge(other: SkewHeap<T>): SkewHeap<T>;
}
