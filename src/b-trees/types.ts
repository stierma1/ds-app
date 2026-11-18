import type { Comparator, OrderedMap } from "../core/index.ts";

/**
 * Construction options shared by the B-tree family. A concrete tree may fix `order`; a 2-3-4
 * tree always uses order 4 and rejects any other value.
 */
export interface BTreeOptions<K> {
  order?: number;
  compare?: Comparator<K>;
}

/**
 * Block-oriented ordered dictionary. An implementation keeps between `minFill` and `order`
 * children per internal node (the root may hold fewer), stores at most `order - 1` keys per node,
 * keeps every leaf at the same depth, and reports that depth through `height`.
 *
 * `bulkLoad` replaces the current contents with sorted entries in linear time and throws
 * `RangeError` when the input is not sorted by key ascending.
 */
export interface BTree<K, V = K> extends OrderedMap<K, V> {
  readonly compare: Comparator<K>;
  readonly order: number;
  readonly height: number;
  readonly minFill: number;
  bulkLoad(entries: Iterable<[K, V]>): void;
}
