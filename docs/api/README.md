# API Contracts

One document per roadmap part. Each defines the generic interface for that part
and the time complexity of every implementation in it.

Shared rules — comparators, empty results, iteration, ownership, errors,
validation — are defined in [Common API Contract](./00-common-contract.md).

| Part | Document | Primary contract | Module |
|------|----------|------------------|--------|
| 1 | [Lists](./01-lists.md) | `ListLike<T>` | `ds-app/lists` |
| 2 | [Trees](./02-trees.md) | `TreeLike<T>`, `BinarySearchTree<K,V>` | `ds-app/trees` |
| 3 | [Graphs](./03-graphs.md) | `Graph<V,E>` | `ds-app/graphs` |
| 4 | [Leftist Trees](./04-leftist-trees.md) | `MeldablePriorityQueue<T>` | `ds-app/leftist-trees` |
| 5 | [Skew Heaps](./05-skew-heaps.md) | `MeldablePriorityQueue<T>` | `ds-app/skew-heaps` |
| 6 | [Heaps](./06-heaps.md) | `PriorityQueue<T>`, `IndexedPriorityQueue<K,V>` | `ds-app/heaps` |
| 7 | [Double-Ended Priority Queues](./07-depq.md) | `DoubleEndedPriorityQueue<T>` | `ds-app/depq` |
| 8 | [Hash Tables](./08-hash-tables.md) | `HashMap<K,V>`, `HashSet<E>` | `ds-app/hash-tables` |
| 9 | [Balanced Binary Trees](./09-balanced-binary-trees.md) | `OrderedMap<K,V>` | `ds-app/balanced-trees` |
| 10 | [Finger Search Trees](./10-finger-search-trees.md) | `FingerSearchMap<K,V>` | `ds-app/finger-search-trees` |
| 11 | [Splay Trees](./11-splay-trees.md) | `OrderedMap<K,V>` | `ds-app/splay-trees` |
| 12 | [Randomized Dictionary Structures](./12-randomized-dictionaries.md) | `OrderedMap<K,V>`, `MeldablePriorityQueue<T>` | `ds-app/randomized` |
| 13 | [Trees with Minimum Weighted Path Length](./13-mwpl-trees.md) | `PrefixCode<S>` | `ds-app/mwpl-trees` |
| 14 | [B Trees](./14-b-trees.md) | `OrderedMap<K,V>` | `ds-app/b-trees` |
| 15 | [Multidimensional Spatial Data Structures](./15-multidimensional-spatial.md) | `PointIndex<T>` | `ds-app/spatial` |
| 16 | [Planar Straight Line Graphs](./16-pslg.md) | `PlanarGraph` | `ds-app/pslg` |
| 17 | [Interval, Segment, Range, and Priority Search Trees](./17-interval-segment-range-priority.md) | `IntervalIndex<T>`, `SegmentTree<T>`, `RangeTree<T>`, `RangeTreeD<T>`, `PrioritySearchTree<T>`, `FenwickTree<T>`, `RangeMinimumQuery<T>` | `ds-app/interval-trees` |
| 18 | [Quadtrees and Octrees](./18-quadtrees-octrees.md) | `Quadtree<T>` | `ds-app/quadtrees` |
| 19 | [Binary Space Partitioning Trees](./19-bsp-trees.md) | `BSPTree<T>` | `ds-app/bsp` |
| 20 | [R Trees](./20-r-trees.md) | `SpatialIndex<T>` | `ds-app/r-trees` |
| 21 | [Approximate Geometric Query Structures](./21-approximate-geometric.md) | `ApproximateSpatialIndex<T>` | `ds-app/approximate` |
| 22 | [Tries](./22-tries.md) | `Trie<V>` | `ds-app/tries` |
| 23 | [Suffix Trees and Suffix Arrays](./23-suffix-trees-arrays.md) | `SuffixIndex` (extends `StringIndex`) | `ds-app/suffix` |
| 24 | [Sets](./24-sets.md) | `SetLike<E>` | `ds-app/sets` |
| 25 | [Dynamic Trees](./25-dynamic-trees.md) | `DynamicForest<T>`, `PathForest<T,A>`, `SubtreeForest<T,A>` | `ds-app/dynamic-trees` |
| 26 | [Succinct Data Structures](./26-succinct.md) | `BitVector`, `WaveletTree`, `SuccinctTree` | `ds-app/succinct` |
| 27 | [Integer Keys](./27-integer-keys.md) | `IntegerMap<V>`, `IntegerPriorityQueue` | `ds-app/integer-keys` |
| 28 | [Persistent Data Structures](./28-persistent.md) | `PersistentMap<K,V>`, `PersistentVector<T>`, `VersionedMap<K,V>` | `ds-app/persistent` |
| 29 | [Dynamic Graphs](./29-dynamic-graphs.md) | `DynamicConnectivity`, `DynamicMSF`, `DynamicShortestPaths` | `ds-app/dynamic-graphs` |
| 30 | [Cache-Oblivious Data Structures](./30-cache-oblivious.md) | `CacheObliviousBTree<K,V>`, `PackedMemoryArray<T>` | `ds-app/cache-oblivious` |
| 31 | [Kinetic Data Structures](./31-kinetic.md) | `KineticStructure<T>` | `ds-app/kinetic` |
| 32 | [PQ Trees, PC Trees, and Planarity](./32-pq-trees.md) | `ConsecutiveTree` | `ds-app/pq-trees` |
| 33 | [Spatiotemporal Data Structures](./33-spatiotemporal.md) | `MovingObjectIndex<T>`, `TrajectoryIndex<T>` | `ds-app/spatiotemporal` |
| 34 | [External-Memory Data Structures](./34-external-memory.md) | `BlockStore`, `BufferTree<K,V>` | `ds-app/external-memory` |
| 35 | [String Searching](./35-string-search.md) | `PatternMatcher` | `ds-app/string-search` |
| 36 | [Approximate Distance Oracles and Spanners](./36-distance-oracles.md) | `DistanceOracle` | `ds-app/distance-oracles` |
| 37 | [Cuttings](./37-cuttings.md) | `Cutting`, `SimplexRangeSearch<T>` | `ds-app/cuttings` |
| 38 | [Online Dictionary Structures](./38-online-dictionaries.md) | `StringDictionary<V>` | `ds-app/online-dictionaries` |

Parts 1 through 24 follow the Handbook's first 24 structure chapters; Parts 25
through 38 cover its remaining structure chapters. Structures that are not in
the book but that the library needs (deques, monotone priority queues, cover
trees, the trapezoidal map, Fenwick trees and RMQ, Bloom-filter variants) are
folded into the part they extend rather than given parts of their own.

Application contracts for A1-A9 are added when Phase 8 begins; they compose the
part contracts above rather than introducing new container semantics.

## Conventions used in complexity tables

- A bare `O(f(n))` is worst case.
- **amortized** and **expected** are stated explicitly.
- `n` is the number of stored elements; `k` is the number of reported results.
- Per-part symbols are defined at the top of each document.
- Space is auxiliary space for the structure itself unless stated otherwise.
- A dash (`—`) means the operation is not supported by that implementation.
