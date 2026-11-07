# A9 — Computational Geometry

**Module:** `ds-app/applications/computational-geometry` · **Status:** planned ·
**Builds on:** Part 16 (PSLG), Part 15 (kd-tree), Part 9 (ordered maps), Part 6 (heaps)

## Use case

Convex hulls, triangulations, Voronoi diagrams, and polygon operations are the
building blocks of GIS (A7), graphics (A6), collision (A8), mesh generation,
and robotics. This module provides the fundamental constructions and the
proximity and location queries built on them, with exact predicates so the
results are correct on degenerate input.

## Problem

Given points, segments, and polygons in the plane (and points in 3D for
hulls), compute: the convex hull; the Delaunay triangulation and its dual
Voronoi diagram; the closest pair; width, diameter, and minimum bounding
rectangle; the union, intersection, and difference of polygons; and answer
nearest-site and point-in-region queries. The PSLG machinery these rest on
(segment intersection, polygon triangulation, overlay, point location) lives
in Part 16 and is reused, not duplicated.

## How it is solved

1. **Convex hull.** Andrew's monotone chain sorts points by `x` and builds
   lower and upper chains with a stack, `O(n log n)`; quickhull recursively
   discards points inside the triangle formed by extreme points, `O(n log n)`
   expected. In 3D, quickhull maintains the hull as a Part 16 half-edge mesh
   with conflict lists from unprocessed points to visible faces.
2. **Delaunay triangulation and Voronoi diagram.** Randomized incremental
   insertion (Bowyer-Watson): locate the triangle containing the new point,
   delete the triangles whose circumcircle contains it, and retriangulate the
   cavity; the triangulation is a Part 16 planar graph and location uses the
   history DAG of the insertions, giving `O(n log n)` expected. Lawson edge
   flipping restores the Delaunay property after constrained edges are
   added. The Voronoi diagram is read off as the dual: one face per site,
   one vertex per triangle circumcenter.
3. **Closest pair.** Sweep by `x` with a Part 9 ordered map of the active
   points by `y`; for each point only the points within the current best
   distance in `y` are examined, `O(n log n)`.
4. **Rotating calipers.** On the convex hull, two parallel support lines
   rotate around the polygon; antipodal pairs give the diameter, the minimum
   distance between parallel supports gives the width, and the minimum-area
   bounding rectangle has a side flush with a hull edge. All are `O(h)` after
   the hull.
5. **Polygon booleans.** Both polygons (with holes) become Part 16 planar
   graphs, the overlay computes the arrangement, and each face is labeled
   inside or outside each input by a traversal from the outer face; union,
   intersection, and difference select faces by label and are reassembled
   into polygons with holes. `O((n + k) log n)` for `k` intersections.
6. **Point location and proximity.** Point-in-region and nearest-site
   queries use the Part 16 trapezoidal map over the Voronoi diagram or the
   subdivision; k-nearest-neighbor queries over raw points use the Part 15
   kd-tree.
7. **Robustness.** Orientation and in-circle predicates are evaluated with a
   floating-point filter and fall back to exact arithmetic (Shewchuk's
   adaptive predicates) when the filter cannot decide; ties are broken by
   symbolic perturbation so degenerate inputs (collinear, cocircular,
   duplicate points) produce consistent results.

## Structures used

| Part | Structure | Role |
|------|-----------|------|
| 16 | `PlanarGraph`, `TrapezoidalMap`, `overlay` | Triangulations, Voronoi, booleans, location |
| 9 | `RedBlackTree` | Sweep status for closest pair |
| 15 | `KdTree` | k-nearest neighbors |
| 6 | `BinaryHeap` | Event queues |
| 1 | `ArrayList` | Hull stacks |

## Complexity summary

| Construction | Cost |
|--------------|------|
| Convex hull 2D | O(n log n) |
| Convex hull 3D | O(n log n) expected |
| Delaunay / Voronoi | O(n log n) expected |
| Closest pair | O(n log n) |
| Rotating calipers | O(h) after hull |
| Polygon booleans | O((n + k) log n) |
| Nearest site query | O(log n) expected |

## Example

```js
import { convexHull, delaunay, closestPair, polygonUnion } from 'ds-app/applications/computational-geometry';

const pts = [[0, 0], [4, 0], [4, 3], [0, 3], [2, 1]];
convexHull(pts);               // [[0,0],[4,0],[4,3],[0,3]]
closestPair(pts);              // { a: [2,1], b: [0,0] ... } the pair at distance √5 or closer
const dt = delaunay(pts);      // PlanarGraph with 4 triangles
dt.voronoi().faceCount;        // 5 sites + outer face
polygonUnion(square, triangle).length; // number of output rings
```

## Validation and benchmark data

- Hulls, triangulations, and closest pairs are differential-tested against
  brute force on random, clustered, and degenerate (grid, collinear,
  cocircular) point sets; Delaunay output is checked with the empty-circle
  test; booleans are checked by area identities such as
  `area(A ∪ B) = area(A) + area(B) − area(A ∩ B)`.
- Benchmarks use random and real point sets (city coordinates, LIDAR
  samples) and GIS polygon pairs, reporting construction time and query
  throughput.
