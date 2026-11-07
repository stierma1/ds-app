# Part 17 — Interval, Segment, Range, and Priority Search Trees

**Module:** `ds-app/interval-trees` · **Source:** `src/interval-trees/` · **Status:** planned

## Scope

Indexes for intervals, points, and orthogonal ranges: interval trees, segment
trees, range trees, and priority search trees, plus the one-dimensional
prefix and range-minimum helpers (Fenwick tree, sparse table, Fischer-Heun
RMQ) that other parts reuse. These structures answer stabbing, overlap,
window, three-sided, prefix, and range-minimum queries.

## Common API

```ts
import type { Container, Point } from 'ds-app/core';

export interface Interval {
  lo: number;
  hi: number;
}

export interface IntervalIndex<T> extends Container<[Interval, T]> {
  insert(interval: Interval, value: T): void;
  delete(interval: Interval, value?: T): boolean;
  stab(point: number): T[];
  overlap(interval: Interval): T[];
  enclosing(point: number): T[];
}

export interface SegmentTree<T> extends Container<T> {
  build(values: Iterable<T>): void;
  update(index: number, value: T): void;
  query(lo: number, hi: number): T;
  rangeUpdate(lo: number, hi: number, value: T): void;
}

export interface RangeTree<T> extends Container<T> {
  build(points: Iterable<[number, T]>): void;
  range(lo: number, hi: number): T[];
}

export interface RangeTreeD<T> extends Container<T> {
  readonly dimensions: number;
  build(points: Iterable<[Point, T]>): void;
  insert(point: Point, value: T): void;
  delete(point: Point, value?: T): boolean;
  range(min: Point, max: Point): T[];
}

export interface PrioritySearchTree<T> extends Container<[number, number, T]> {
  insert(x: number, y: number, value: T): void;
  delete(x: number, y: number): boolean;
  query3Sided(xMin: number, xMax: number, yMax: number): T[];
}

export interface FenwickTree<T> extends Container<T> {
  build(values: Iterable<T>): void;
  update(index: number, delta: T): void;
  prefix(end: number): T;
  query(lo: number, hi: number): T;
  lowerBound(target: T): number;
}

export interface RangeMinimumQuery<T> {
  readonly length: number;
  build(values: Iterable<T>): void;
  query(lo: number, hi: number): number;
  validate(): true | string;
}
```

### Semantics

- Intervals are closed: `[lo, hi]` with `lo <= hi`.
- `stab(p)` reports intervals containing `p`; `overlap(q)` reports intervals
  intersecting `q`; `enclosing(p)` reports intervals strictly containing `p`.
- Segment-tree query/update ranges are half-open `[lo, hi)`.
- `query` returns a combined aggregate; the aggregate function is supplied at
  construction (default: sum).
- `RangeTree` is 1D. `RangeTreeD` is the d-dimensional variant, with
  `RangeTree2D` as its two-dimensional alias; both use closed box queries.
- Priority-search-tree queries are three-sided: `xMin <= x <= xMax` and
  `y <= yMax`.
- `FenwickTree` requires an invertible aggregate (a group, default addition);
  `prefix(end)` folds `[0, end)`, `query` folds `[lo, hi)`, and `lowerBound`
  returns the smallest index whose prefix reaches `target`, which requires
  non-negative values.
- `RangeMinimumQuery.query(lo, hi)` returns the index of the leftmost minimum
  in `[lo, hi)` under the comparator supplied at construction; `SparseTable`
  generalizes it to any idempotent aggregate.
- `SegmentTree` is the aggregate array tree (point update, range query, lazy
  range update). The Handbook's segment tree over intervals is
  `IntervalSegmentTree`, which implements `IntervalIndex<T>` over a fixed set of
  elementary intervals supplied at construction.
- `validate()` checks interval ordering, stored maxima, segment-tree aggregates,
  and size.

## Implementations and complexity

| Structure | Build | `insert` / `update` | `delete` | Query | Space |
|-----------|-------|---------------------|----------|-------|-------|
| `IntervalTree` (centered) | O(n log n) | O(log n) | O(log n) | O(log n + k) stab/overlap | O(n) |
| `AugmentedIntervalTree` | O(n log n) | O(log n) | O(log n) | O(min(n, k log n)) stab/overlap | O(n) |
| `IntervalSegmentTree` | O(n log n) | O(log n) | O(log n) | O(log n + k) stab | O(n log n) |
| `SegmentTree` (aggregate) | O(n) | O(log n) | O(log n) | O(log n) range, O(log n + k) report | O(n) |
| `RangeTreeD` (d-dim) | O(n log^{d-1} n) | O(log^d n) | O(log^d n) | O(log^d n + k) | O(n log^{d-1} n) |
| `PrioritySearchTree` | O(n log n) | O(log n) | O(log n) | O(log n + k) three-sided | O(n) |
| `FenwickTree` | O(n) | O(log n) | — | O(log n) prefix, range, and `lowerBound` | O(n) |
| `SparseTable` | O(n log n) | — | — | O(1) idempotent range query | O(n log n) |
| `RangeMinimumQuery` (Fischer-Heun) | O(n) | — | — | O(1) | O(n) |

Definitions: `n` elements, `k` reported results, `d` dimensions. A
`SegmentTree` supports lazy range updates in `O(log n)`; the reported query
cost is `O(log n + k)` when enumerating covered segments. A range tree with
fractional cascading answers `O(log^{d-1} n + k)`.

### Notes

- **Interval tree (centered):** a balanced tree over endpoint values; each
  interval is stored at the highest node whose split value it contains, in two
  lists sorted by `lo` and by `hi` (Edelsbrunner, McCreight). A stabbing query
  walks one root-to-leaf path and scans each node's list only as far as the
  matches, giving `O(log n + k)`. The dynamic version keeps the node lists in
  balanced trees.
- **Augmented interval tree:** a balanced BST keyed by `lo`, augmented with the
  maximum `hi` in each subtree. Pruning on the subtree maximum finds one
  overlap in `O(log n)` but reports all `k` in `O(min(n, k log n))`. It is kept
  as a simple reference implementation.
- **Interval segment tree:** the classic segment tree; each interval is stored
  at `O(log n)` canonical nodes, so space is `O(n log n)`. Stabbing walks one
  path and reports every interval stored on it.
- **Segment tree (aggregate):** stores canonical segments in an array tree.
  `build` is linear; point updates and range queries are logarithmic. Lazy
  propagation defers range assignments/additions to children.
- **Range tree:** a balanced tree on the primary coordinate; each node stores a
  sorted secondary structure. Fractional cascading is optional.
- **Priority search tree:** a balanced tree on `x` whose nodes also satisfy
  heap order on `y` (McCreight). A three-sided query descends the two boundary
  paths for `[xMin, xMax]` and explores the canonical subtrees between them only
  while `y <= yMax`.
- **Fenwick tree:** implicit binary indexed tree over an array; each prefix
  decomposes into O(log n) stored partial sums. `lowerBound` walks the tree
  top-down.
- **Sparse table:** stores the aggregate of every power-of-two window; an
  idempotent query overlaps two windows.
- **Range minimum query:** Fischer and Heun's block decomposition with
  Cartesian-tree types inside blocks and a sparse table over block minima.
  Part 23 uses it for `lcp(i, j)`.
- All structures use O(n) or O(n log n) space; the range tree's extra factor is
  the dominant memory cost for high dimensions.

## Example

```js
import { IntervalTree } from 'ds-app/interval-trees';

const tree = new IntervalTree();
tree.insert({ lo: 1, hi: 5 }, 'a');
tree.insert({ lo: 4, hi: 9 }, 'b');
tree.insert({ lo: 12, hi: 15 }, 'c');

tree.stab(4);    // ['a', 'b']
tree.overlap({ lo: 6, hi: 13 }); // ['b', 'c']
tree.validate(); // true
```

## Conformance checklist

- Interval queries are differential-tested against a linear scan on random
  interval sets, including empty, touching, nested, and duplicate intervals.
- Segment-tree aggregates match a brute-force fold after random point and range
  updates.
- Range-tree queries match a nested-loop reference for 2D and 3D.
- Priority-search-tree three-sided queries match a filtered scan.
- Fenwick prefix sums and `lowerBound` match a brute-force fold after random
  updates; RMQ and sparse-table answers match a linear scan on random and
  monotone arrays.
- `validate()` detects a wrong subtree maximum, a stale lazy tag, and a
  misordered range-tree node.
