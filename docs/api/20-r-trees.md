# Part 20 — R Trees

**Module:** `ds-app/r-trees` · **Source:** `src/r-trees/` · **Status:** planned

## Scope

Balanced bounding-box indexes for rectangles in `d` dimensions: R-trees,
R+-trees, R*-trees, Hilbert R-trees, and STR bulk loading. They support
insertion, deletion, window queries, and nearest-neighbor search. The
bounding-volume hierarchy (BVH) is the build-once, traverse-often variant
used by ray tracing (A6) and collision broad phases (A8).

## Common API

```ts
import type { Bounds, NearestResult, Point, SpatialIndex } from 'ds-app/core';

export interface RTreeOptions {
  dimensions: number;
  maxEntries?: number;
  minEntries?: number;
  split?: 'quadratic' | 'linear' | 'rstar';
}

export interface RTree<T> extends SpatialIndex<T> {
  readonly dimensions: number;
  readonly maxEntries: number;
  readonly minEntries: number;
  readonly height: number;
  bulkLoad(entries: Iterable<[Bounds, T]>): void;
  nearest(point: readonly number[], k?: number): NearestResult<T>[];
}

export interface BVHOptions {
  dimensions: number;
  build?: 'sah' | 'median' | 'lbvh';
  leafSize?: number;
}

export interface RayHit<T> {
  value: T;
  tMin: number;
  tMax: number;
}

export interface BVH<T> extends SpatialIndex<T> {
  readonly dimensions: number;
  readonly height: number;
  build(entries: Iterable<[Bounds, T]>): void;
  refit(entries: Iterable<[Bounds, T]>): void;
  raycast(origin: Point, direction: Point, maxDistance?: number): RayHit<T>[];
  overlaps(other: BVH<T>): Array<[T, T]>;
  selfOverlaps(): Array<[T, T]>;
}
```

Shared members come from [`Container`](./00-common-contract.md#container); the
`insert/delete/search/nearest` surface comes from
[`SpatialIndex`](./00-common-contract.md#spatial-index).

### Semantics

- `maxEntries` is the node capacity `B`; `minEntries` is the minimum fill `m`
  (normally `ceil(B/2)`).
- `insert` takes a bounding box and a value; `delete(bounds, value)` removes the
  matching entry, or the first entry with equal bounds when `value` is omitted.
- `search` returns values whose boxes intersect the query box.
- `nearest` returns up to `k` values sorted by distance to the query point.
- `bulkLoad` replaces the contents and requires no sorted input; STR sorts and
  packs entries.
- R+-trees may store the same value in multiple nodes to eliminate overlap;
  iteration and `size` still count logical entries once.
- `BVH.build` replaces the contents; `refit` keeps the topology and recomputes
  boxes from new bounds for the same values, which is how moving geometry is
  updated between rebuilds. `insert`/`delete` work but degrade query quality
  until the next `build`. `raycast` returns leaves whose boxes the ray enters
  within `maxDistance`, sorted by entry parameter `tMin`; `overlaps` and
  `selfOverlaps` report intersecting leaf-box pairs.
- `validate()` checks node occupancy, subtree containment, equal leaf depth, and
  size.

## Implementations and complexity

| Structure | `insert` | `delete` | Window query | `nearest` | `bulkLoad` | Space |
|-----------|----------|----------|--------------|-----------|------------|-------|
| `RTree` | O(log n) avg, O(n) worst | O(log n) avg, O(n) worst | O(log n + k) avg, O(n) worst | O(log n) avg, O(n) worst | O(n log n) | O(n) |
| `RPlusTree` | O(log n) avg, O(n) worst | O(log n) avg, O(n) worst | O(log n + k) avg, O(n) worst | O(log n) avg, O(n) worst | O(n log n) | O(n) to O(n log n) |
| `RStarTree` | O(log n) avg, O(n) worst | O(log n) avg, O(n) worst | O(log n + k) avg, O(n) worst | O(log n) avg, O(n) worst | O(n log n) | O(n) |
| `HilbertRTree` | O(log n) avg | O(log n) avg | O(log n + k) avg | O(log n) avg | O(n log n) | O(n) |
| `STRTree` (packed) | — | — | O(log n + k) avg, O(n) worst | O(log n) avg | O(n log n) | O(n) |
| `BVH` (SAH build) | O(log n) avg, degrades quality | O(log n) avg | O(log n + k) avg, O(n) worst | O(log n) avg | `build` O(n log n) binned, `refit` O(n) | O(n) |
| `BVH` (LBVH build) | as above | as above | as above | as above | `build` O(n log n) by sort, O(n) with radix sort | O(n) |

Definitions: `n` entries, `k` reported results, `B` max entries per node. All
query bounds are average under a reasonable distribution; the worst-case window
query is O(n) for every variant because bounding boxes may all overlap.

### Notes

- **R-tree:** groups nearby boxes; insertion chooses the child whose box needs
  the least enlargement, then splits on overflow. The default split is
  quadratic; `linear` is faster but packs worse.
- **R+-tree:** forbids overlap by duplicating entries across nodes. Window
  queries descend a single path to each match, but storage can grow.
- **R*-tree:** chooses splits by minimizing margin and overlap, and reinserts
  some entries instead of splitting. It usually gives the best query
  performance at higher insert cost.
- **Hilbert R-tree:** orders entries by Hilbert curve position; bulk loading
  groups consecutive entries into packed nodes.
- **STR (Sort-Tile-Recursive):** sorts by one coordinate, tiles into slabs,
  sorts each slab by the next coordinate, and packs leaves; it produces
  nearly full nodes in `O(n log n)`.
- Nearest-neighbor search uses a best-first priority queue over node
  bounding-box distances; once the nearest leaf distance is known, subtrees
  farther than the current k-th result are pruned.
- **BVH:** a binary tree of boxes over geometry; unlike an R-tree it is not
  kept balanced or minimally filled, so it can be built to minimize traversal
  cost instead. The surface-area-heuristic build chooses each split from
  binned candidates to minimize expected ray cost; the median build splits at
  the median centroid; the LBVH build sorts Morton codes and emits the tree in
  one pass, trading quality for build speed. `raycast` costs `O(log n + hits)`
  on average, and `overlaps` between two hierarchies descends both trees
  together.

## Example

```js
import { RTree } from 'ds-app/r-trees';

const tree = new RTree({ dimensions: 2, maxEntries: 8 });
tree.insert({ min: [0, 0], max: [2, 2] }, 'a');
tree.insert({ min: [5, 5], max: [7, 7] }, 'b');

tree.search({ min: [1, 1], max: [6, 6] }); // ['a', 'b']
tree.nearest([8, 8], 1);                   // [{ value: 'b', distance: 1.41 }]
tree.validate();                           // true
```

## Conformance checklist

- Window queries are differential-tested against a linear scan on random boxes,
  clustered boxes, and highly overlapping boxes.
- Node occupancy and equal leaf depth hold after random insert/delete logs.
- `bulkLoad` matches repeated insertion and produces valid packed nodes.
- `raycast`, `overlaps`, and `selfOverlaps` match a brute-force box test on
  random and clustered boxes; `refit` after random motion keeps every leaf
  inside its ancestors, and the SAH build traverses fewer nodes than the median
  build on a benchmark mesh.
- Nearest-neighbor results match a brute-force sort, with deterministic ties.
- R+ duplication is invisible to `size`, iteration, and deletion.
- `validate()` detects a box outside its parent and an underfull or overfull
  node.
