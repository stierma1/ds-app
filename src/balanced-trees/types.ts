import type { Comparator, OrderedMap } from "../core/index.ts";

/**
 * Ordered dictionary with a worst-case logarithmic height guarantee. In addition to the
 * `OrderedMap` surface (`set/get/has/delete`, order statistics, range queries, and ascending
 * iteration), a balanced tree reports its height and supports destructive `join` and `split`.
 *
 * `join` requires every key in the receiver to compare smaller than every key in `other`; it
 * consumes both inputs and returns a tree that owns the union. `split(key)` consumes the receiver
 * and returns two trees holding the keys `< key` and `>= key`. A consumed tree rejects every later
 * operation with `ConsumedError`.
 */
export interface BalancedTree<K, V = K> extends OrderedMap<K, V> {
  readonly compare: Comparator<K>;
  readonly height: number;
  join(other: BalancedTree<K, V>): BalancedTree<K, V>;
  split(key: K): [BalancedTree<K, V>, BalancedTree<K, V>];
}
