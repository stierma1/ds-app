# A12 — Data Mining

**Module:** `ds-app/applications/data-mining` · **Status:** planned ·
**Builds on:** Part 22 (tries), Part 8 (hashing), Part 15 (kd-trees), Part 20 (R-trees), Part 6 (heaps), Part 24 (union-find)

## Use case

Mining frequent itemsets from transactions (market baskets, logs, feature
co-occurrence), clustering points or vectors into groups, and finding similar
items in a large collection. These are batch analyses over data that does not
fit a naive all-pairs or all-subsets approach, and the gain comes from the
structures that prune the search.

## Problem

Frequent itemsets: given `N` transactions over `I` items and a support
threshold, find every itemset contained in at least that many transactions.
Clustering: partition `n` points in `d` dimensions into `k` groups (k-means),
or into density-connected groups of arbitrary shape (DBSCAN), or into a
hierarchy (agglomerative clustering). Similarity search: find pairs of
high-dimensional vectors above a similarity threshold without comparing all
pairs.

## How it is solved

1. **Apriori with a hash tree.** Candidate itemsets of size `s` are generated
   from frequent itemsets of size `s − 1` and pruned by the downward-closure
   property. Candidates are stored in a hash tree, a trie whose internal
   nodes hash the next item into a small number of children and whose leaves
   hold candidate lists; counting support for a transaction walks only the
   subtrees reachable from the transaction's items. Each pass scans the
   transactions once.
2. **FP-growth.** Transactions are inserted into an FP-tree, a Part 22 prefix
   trie over items sorted by decreasing frequency, with a header table that
   links every occurrence of an item through a Part 1 list. Frequent itemsets
   are mined recursively: for each item, the conditional pattern base is read
   from the links, a conditional FP-tree is built, and the recursion
   continues. It avoids candidate generation entirely and reads the data
   twice.
3. **k-means with a kd-tree.** Points are stored in a Part 15 kd-tree with
   per-node centroid sums and counts. In each iteration the tree is traversed
   with the set of candidate centers; a center is pruned from a subtree when
   every point of the subtree's box is closer to some other candidate, and
   when one candidate remains the whole subtree is assigned in O(1). This
   filtering algorithm makes an iteration cost far below `n·k` for low `d`.
   Seeds come from k-means++.
4. **DBSCAN.** Each point's `ε`-neighborhood is a radius query on a Part 15
   kd-tree (or a Part 20 R-tree for extended objects); core points are those
   with at least `minPts` neighbors, and clusters are the connected
   components of the core points joined through shared neighborhoods,
   computed with Part 24 union-find. Noise points are left unlabeled.
5. **Agglomerative clustering.** All pair distances enter a Part 6 priority
   queue; the closest pair is merged and the distances to the new cluster are
   updated by the chosen linkage (single, complete, average, Ward) with lazy
   deletion of stale queue entries. The nearest-neighbor chain algorithm
   replaces the queue for reducible linkages and runs in `O(n²)` time and
   `O(n)` space.
6. **Locality-sensitive hashing.** Vectors are hashed with families that
   collide with probability increasing in similarity (random hyperplanes for
   cosine, p-stable projections for Euclidean, minhash for Jaccard); `b`
   bands of `r` concatenated hashes each go into a Part 8 hash table, and
   candidate pairs are those colliding in any band. The choice of `b` and `r`
   sets the similarity threshold.

## Structures used

| Part | Structure | Role |
|------|-----------|------|
| 22 | `StandardTrie` | FP-tree, hash tree |
| 1 | `SinglyLinkedList` | FP-tree header links |
| 15 | `KdTree` | k-means filtering, DBSCAN neighborhoods |
| 20 | `RTree` | DBSCAN over extended objects |
| 24 | `UnionFind` | DBSCAN cluster assembly |
| 6 | `BinaryHeap` | Agglomerative merge queue |
| 8 | `HashMap` | LSH bands, item counts |

## Complexity summary

| Algorithm | Cost |
|-----------|------|
| Apriori | passes × O(N · candidates reached per transaction) |
| FP-growth | O(N · avg transaction length) to build, mining output-sensitive |
| k-means (filtering) | O(n log n) build, per iteration well below O(n·k) in low d |
| DBSCAN | O(n log n) expected with an index, O(n²) worst |
| Agglomerative | O(n² log n) with a heap, O(n²) with NN-chain |
| LSH | O(n · b · r) hashing plus candidate verification |

## Example

```js
import { fpGrowth, kMeans, dbscan } from 'ds-app/applications/data-mining';

fpGrowth(transactions, { minSupport: 0.02 });            // [{ items, support }]
const km = kMeans(points, { k: 8, seed: 1 });              // { centers, labels, iterations }
const db = dbscan(points, { eps: 0.3, minPts: 10 });       // { labels, clusters, noise }
```

## Validation and benchmark data

- Itemsets match a brute-force enumeration on small transaction sets;
  k-means with filtering matches Lloyd's algorithm exactly for the same
  seeds; DBSCAN matches a naive implementation; LSH recall is measured
  against exact all-pairs on a sample.
- Benchmarks use retail transaction data sets, UCI clustering sets, and
  synthetic high-dimensional vectors, reporting time against naive baselines.
