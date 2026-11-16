import type { Comparator, OrderedMap } from "../core/index.ts";

/**
 * Ordered dictionary implemented by a self-adjusting binary search tree. In addition to the
 * `OrderedMap` surface, a splay tree exposes the raw root (for teaching and inspection), an
 * explicit `splay(key)` operation, and destructive `join`/`split`.
 *
 * Every access splays the accessed node — or the last node on the search path when the key is
 * absent — to the root. `join` requires all keys in the receiver to compare smaller than all keys
 * in `other`; both inputs are consumed. `split(key)` consumes the receiver and returns the trees
 * holding keys `< key` and `>= key`.
 */
export interface SplayTreeLike<K, V = K> extends OrderedMap<K, V> {
  readonly compare: Comparator<K>;
  readonly root: unknown | null;
  splay(key: K): void;
  join(other: SplayTreeLike<K, V>): SplayTreeLike<K, V>;
  split(key: K): [SplayTreeLike<K, V>, SplayTreeLike<K, V>];
}
