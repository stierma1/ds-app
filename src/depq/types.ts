import type {
  Comparator,
  DoubleEndedPriorityQueue,
} from "../core/index.ts";

/**
 * Double-ended priority queue with bulk construction and an explicit structural
 * height. `peekMin`/`peekMax` are O(1) for the array-backed structures;
 * `popMin`/`popMax` both remove the only element when one remains.
 *
 * `build` replaces the contents rather than adding to them. `height` is the
 * height in edges of the representation's tree (0 when empty or a single node);
 * for `SortedArrayDepq` it is the height of the perfectly balanced search tree
 * over the sorted contents.
 */
export interface Depq<T> extends DoubleEndedPriorityQueue<T> {
  readonly compare: Comparator<T>;
  readonly height: number;
  build(values: Iterable<T>): void;
  /** O(1): alias for `peekMin`. */
  getMin(): T | undefined;
  /** O(1): alias for `peekMax`. */
  getMax(): T | undefined;
}
