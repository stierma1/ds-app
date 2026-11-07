import type { Container } from "./container.ts";

/**
 * Set ADT implemented by HashSet, BitSet, SortedArraySet, and IntervalSet. `add` and `delete`
 * return whether the set changed. The binary operations accept any Iterable and return a NEW set of
 * the receiver's type; several implementations first materialize `other` into a lookup structure,
 * so pass an already de-duplicated collection when `other` is large. Per-element cost ranges from
 * O(1) (BitSet, HashSet) to O(n) shifting (SortedArraySet, IntervalSet); see each class.
 */
export interface SetLike<E> extends Container<E> {
  add(value: E): boolean;
  delete(value: E): boolean;
  has(value: E): boolean;
  union(other: Iterable<E>): SetLike<E>;
  intersection(other: Iterable<E>): SetLike<E>;
  difference(other: Iterable<E>): SetLike<E>;
  symmetricDifference(other: Iterable<E>): SetLike<E>;
  isSubsetOf(other: Iterable<E>): boolean;
  isSupersetOf(other: Iterable<E>): boolean;
  equals(other: Iterable<E>): boolean;
}
