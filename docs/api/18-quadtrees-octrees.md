# Part 18 — Quadtrees and Octrees

**Module:** `ds-app/quadtrees` · **Source:** `src/quadtrees/` · **Status:** planned

## Scope

Space-decomposition trees that split a region into quadrants (2D) or octants
(3D): region quadtrees, point quadtrees, PR quadtrees, linear quadtrees, and
octrees. They support point insertion, region queries, and nearest-neighbor
search.

## Common API

```ts
import type { Container, NearestResult, Point, Bounds } from 'ds-app/core';

export interface Quadtree<T> extends Container<T> {
  readonly depth: number;
  insert(point: Point, value: T): void;
  delete(point: Point, value?: T): boolean;
  search(bounds: Bounds): T[];
  nearest(point: Point, k?: number): NearestResult<T>[];
  validate(): true | string;
}

export interface QuadtreeOptions {
  dimensions: 2 | 3;
  bounds: Bounds;
  maxDepth?: number;
  leafCapacity?: number;
}
```

Shared members come from [`Container`](./00-common-contract.md#container). This
is a point index; the bounding-box
[`SpatialIndex`](./00-common-contract.md#spatial-index) contract belongs to
R-trees in Part 20. `nearest` returns results sorted by distance with stable
ties.

### Semantics

- The universe is the `bounds` supplied at construction; points outside it throw
  `RangeError`.
- `maxDepth` bounds subdivision; `leafCapacity` controls when a leaf splits.
- Duplicate points are allowed; `delete(point, value)` removes the matching
  value, otherwise the first occurrence.
- `search` reports all points inside the closed query box.
- Linear quadtrees encode cells as Morton codes; their public behavior matches
  the pointer-based variants.
- Octrees use the same interface with `dimensions: 3`.
- `validate()` checks cell containment, depth limits, node occupancy, and
  parent/child consistency.

## Implementations and complexity

| Structure | `insert` | `delete` | Region query | `nearest` | Space |
|-----------|----------|----------|--------------|-----------|-------|
| `RegionQuadtree` | O(depth), worst O(n) | O(depth), worst O(n) | O(√n + k) avg, O(n) worst | O(n) worst | O(n + cells) |
| `PointQuadtree` | O(depth) avg, O(n) worst | O(depth) avg, O(n) worst | O(depth + k) avg, O(n) worst | O(n) worst | O(n) |
| `PRQuadtree` | O(depth), worst O(n) | O(depth), worst O(n) | O(depth + k) avg, O(n) worst | O(n) worst | O(n) |
| `LinearQuadtree` | O(log n + depth) | O(log n + depth) | O(log n + k) | O(log n) avg | O(n) |
| `Octree` | O(depth), worst O(n) | O(depth), worst O(n) | O(depth + k) avg, O(n) worst | O(n) worst | O(n) |

Definitions: `n` points, `k` reported results, `depth` = subdivision depth
(≤ `maxDepth`), which is `O(log(coordinate range / cell size))`. Region
quadtrees can use space proportional to the occupied boundary rather than `n`;
the table lists the point-set case.

### Notes

- **Region quadtree:** decomposes a binary image or occupancy grid; leaves are
  uniform regions. Point operations follow the root-to-leaf path.
- **Point quadtree:** each node stores a point and splits the plane into four
  quadrants at that point; shape depends on insertion order.
- **PR quadtree:** splits the region into four equal quadrants; points live in
  leaves, which split on capacity overflow.
- **Linear quadtree:** stores leaf cells as Morton codes in a sorted array or
  B-tree; no pointers, compact encoding, good for disk storage.
- **Octree:** the 3D analogue with eight children; used for point clouds,
  voxels, and collision broad phases.
- Degenerate distributions (all points on a line) can drive depth to
  `maxDepth`; the implementation stops subdividing and lets leaves exceed
  `leafCapacity` rather than loop forever.

## Example

```js
import { PRQuadtree } from 'ds-app/quadtrees';

const tree = new PRQuadtree({ dimensions: 2, bounds: { min: [0, 0], max: [16, 16] } });
tree.insert([2, 3], 'a');
tree.insert([10, 10], 'b');

tree.search({ min: [0, 0], max: [4, 4] }); // ['a']
tree.nearest([9, 9], 1);                   // [{ value: 'b', distance: 1.41 }]
tree.validate();                           // true
```

## Conformance checklist

- Region and nearest queries are differential-tested against a linear scan.
- Points outside the universe throw `RangeError`; boundary points are included.
- Duplicate and collinear points respect `maxDepth` without infinite splitting.
- Linear quadtree and pointer-based PR quadtree return the same results.
- Octree behavior mirrors the quadtree suite in 3D.
- `validate()` detects a point outside its cell and a broken parent link.
