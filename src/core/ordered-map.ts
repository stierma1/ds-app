import type { Comparator } from "./comparator.ts";
import type { Container } from "./container.ts";

/** Endpoint inclusivity for `OrderedMap.range()`. */
export interface RangeOptions<K> {
  lo?: "inclusive" | "exclusive";
  hi?: "inclusive" | "exclusive";
}

/**
 * Ordered-map ADT implemented by the tree containers. Beyond get/set/has/delete it exposes order
 * statistics (`min`, `max`, `predecessor`, `successor`, `at(index)`, `indexOf`) and lazy in-order
 * `range` iteration. `at` and `indexOf` are the operations whose cost differs most between
 * implementations (O(log n) only when subtree sizes are maintained), so check the implementing
 * class.
 */
export interface OrderedMap<K, V = K> extends Container<[K, V]> {
  readonly compare: Comparator<K>;
  set(key: K, value: V): this;
  get(key: K): V | undefined;
  has(key: K): boolean;
  delete(key: K): boolean;
  min(): [K, V] | undefined;
  max(): [K, V] | undefined;
  predecessor(key: K): [K, V] | undefined;
  successor(key: K): [K, V] | undefined;
  at(index: number): [K, V] | undefined;
  indexOf(key: K): number;
  range(lo?: K, hi?: K, options?: RangeOptions<K>): IterableIterator<[K, V]>;
  keys(): IterableIterator<K>;
  values(): IterableIterator<V>;
  entries(): IterableIterator<[K, V]>;
}
