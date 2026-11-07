# Part 15 — Multidimensional Spatial Data Structures

**Module:** `ds-app/spatial` · **Source:** `src/spatial/` · **Status:** planned

## Scope

Indexes for points and objects in `d` dimensions: kd-trees, range trees,
vantage-point trees, ball trees, cover trees, and spatial hashing. Bounding-box indexes with
their own storage policy are covered in Part 20; region-partition point indexes
(quadtrees and octrees) are covered in Part 18.

## Common API

```ts
import type { Container, NearestResult, Point, Bounds } from 'ds-app/core';

export interface PointIndex<T> extends Container<T> {
  insert(point: Point, value: T): void;
  delete(point: Point, value?: T): boolean;
  search(bounds: Bounds): T[];
  nearest(point: Point, k?: number): NearestResult<T>[];
  range(point: Point, radius: number): NearestResult<T>[];
}

export interface PointIndexOptions {
  dimensions: number;
  metric?: (a: Point, b: Point) => number;
  leafSize?: number;
}
```

Shared members come from [`Container`](./00-common-contract.md#container).
This part uses point insertion; the shared
[`SpatialIndex`](./00-common-contract.md#spatial-index) contract, which inserts
bounding boxes, is used by R-trees in Part 20. `nearest` and `range` return
results sorted by distance with deterministic tie-breaking.

### Semantics

- `Point` is a fixed-length array of finite numbers; `dimensions` is fixed at
  construction and every point must match it.
- Duplicate points are allowed; `delete(point, value)` removes the matching
  value, otherwise the first occurrence.
- `search(bounds)` is an exact axis-aligned range query unless a structure is
  documented as approximate (Part 21).
- `range(point, radius)` uses the configured metric; the default is Euclidean.
- `validate()` checks node bounds, point membership, tree order, and size.

## Implementations and complexity

| Structure | Build | `insert` | `delete` | Orthogonal range | `nearest` | Space |
|-----------|-------|----------|----------|------------------|-----------|-------|
| `KdTree` | O(n log n) | O(log n) avg, O(n) worst | O(log n) avg, O(n) worst | O(n^{1-1/d} + k) balanced, O(n) unbalanced | O(log n) avg, O(n) worst | O(n) |
| `RangeTreeD` (d-dim) | O(n log^{d-1} n) | O(log^d n) | O(log^d n) | O(log^d n + k) | O(n) unless augmented | O(n log^{d-1} n) |
| `VantagePointTree` | O(n log n) avg | O(log n) avg | O(log n) avg | O(n) | O(log n) avg, O(n) worst | O(n) |
| `BallTree` | O(n log n) avg | O(log n) avg | O(log n) avg | O(n), pruned by ball-box distance | O(log n) avg, O(n) worst | O(n) |
| `CoverTree` | O(c^6 n log n) | O(c^6 log n) | O(c^6 log n) | O(n) | O(c^12 log n) | O(n) |
| `SpatialHash` | O(n) | O(1) avg, O(n) worst | O(1) avg, O(n) worst | O(1 + k) avg, O(n) worst | O(n) worst | O(n + cells) |

Definitions: `n` points, `k` reported results, `d` dimensions, `c` the
expansion constant of the point set under the metric. Range-tree bounds
assume a balanced construction; `RangeTree` is primarily a static structure and
dynamic updates may rebuild affected subtrees. Vantage-point and ball trees are
metric structures: they accelerate `nearest` and radius queries, not orthogonal
range queries.

### Notes

- **kd-tree:** splits on one dimension per level at the median.
  `O(n^{1-1/d} + k)`, which is `O(√n + k)` in 2D, is the worst-case bound for
  orthogonal range reporting on a balanced tree (Lee and Wong); a tree degraded
  by unbalanced dynamic insertion can reach `O(n)`. Build uses quickselect for
  `O(n log n)` expected time, or presorting for the same bound worst case.
- **range tree:** a balanced tree on the first dimension with a range tree on
  each node's secondary structure. `RangeTreeD` is defined in
  [Part 17](./17-interval-segment-range-priority.md); fractional cascading
  reduces the query to `O(log^{d-1} n + k)`.
- **vantage-point tree:** partitions by distance to a vantage point; effective
  for high-dimensional metric data but degrades when distances concentrate.
- **ball tree:** stores points in nested balls; bounding distances prune
  `nearest` and radius searches.
- **cover tree:** a leveled hierarchy of nested covers with separation and
  covering invariants (Beygelzimer, Kakade, and Langford). Its bounds depend
  on the expansion constant `c` rather than on `d`, so it suits intrinsically
  low-dimensional data in a high ambient dimension and any metric.
- **spatial hash:** maps cells to buckets; performance depends on cell size and
  distribution. Long thin or clustered data can degrade to linear scans.
- The `leafSize` option controls bucket/leaf capacity for kd-trees, vantage-point
  trees, and ball trees.

## Example

```js
import { KdTree } from 'ds-app/spatial';

const tree = new KdTree({ dimensions: 2 });
tree.insert([1, 2], 'a');
tree.insert([4, 5], 'b');
tree.insert([2, 8], 'c');

tree.search({ min: [0, 0], max: [3, 3] }); // ['a']
tree.nearest([3, 4], 1);                   // [{ value: 'b', distance: 1.41 }]
tree.validate();                           // true
```

## Conformance checklist

- Every index is differential-tested against a linear scan for range and
  nearest queries on random and clustered point sets.
- Dimensionality mismatches throw `RangeError`.
- Duplicate points and coincident coordinates are covered.
- `nearest(k)` returns at most `k` results sorted by distance, with stable ties.
- `validate()` detects an out-of-bounds point and a broken split invariant.
- Build and query are benchmarked for 2D, 3D, and a high-dimensional case.
