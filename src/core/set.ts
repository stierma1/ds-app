import type { Container } from "./container.ts";

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
