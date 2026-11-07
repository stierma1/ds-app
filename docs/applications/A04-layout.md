# A4 — VLSI Layout Data Structures

**Module:** `ds-app/applications/layout` · **Status:** planned ·
**Builds on:** Part 16 (trapezoidal map), Part 17 (interval trees), Part 20 (R-trees)

## Use case

A chip layout is millions of axis-aligned rectangles on a few dozen layers.
Layout editors, design-rule checkers, extractors, and routers need to find
what is at a point, which shapes are adjacent to a shape, and which shapes
fall in a window, and they need to insert and delete rectangles interactively
as the designer edits. The classic answer, used by the Magic layout system, is
corner stitching.

## Problem

Maintain a set of non-overlapping rectangles per layer under insertion and
deletion, and answer point location, neighbor enumeration along each side of
a rectangle, and window (area) enumeration, all in time proportional to the
local density rather than the layout size.

## How it is solved

1. **Corner stitching.** The plane is tiled completely: solid tiles are the
   rectangles and space tiles fill everything else, with space tiles kept as
   maximal horizontal strips so the tiling is canonical. Each tile stores its
   lower-left corner and four stitches: the tiles to the right at its top
   edge and above at its right edge, and the tiles to the left at its bottom
   edge and below at its left edge. No tree or index exists; every operation
   walks stitches.
   - *Point finding* walks up or down through tiles until the point's `y` is
     inside, then left or right until its `x` is inside, repeating because
     horizontal moves can leave the vertical range. The walk is proportional
     to the number of tiles crossed, about `O(√n)` on typical layouts, and the
     editor keeps the last tile found as a hint because consecutive queries
     are nearby.
   - *Neighbor enumeration* along one side follows the stitch at that side
     and then steps along the adjacent tiles until it passes the far corner;
     the cost is the number of neighbors.
   - *Area enumeration* visits every tile that intersects a window by
     stepping tile by tile from the top left, which is linear in the tiles
     inside the window.
   - *Insertion* finds the space tile containing the new rectangle's top
     edge, splits space tiles horizontally at the top and bottom edges, splits
     the strip vertically at the left and right edges, and merges the space
     fragments on either side with their neighbors to restore maximal strips.
     *Deletion* turns the tile into space and re-merges. Both touch only the
     tiles bordering the rectangle.
2. **Point location on static or non-Manhattan geometry.** Where shapes are
   fixed (a finished cell being queried by an extractor) or have 45-degree
   edges, Part 16's trapezoidal map answers point location in `O(log n)`
   expected time after an `O(n log n)` build.
3. **Overlap and spacing checks.** Design-rule checks ask which rectangles on
   the same or another layer are within distance `s`. A sweep along `x` with
   a Part 17 interval tree over the active `y`-intervals reports every
   overlapping or near pair in `O(n log n + k)`. For repeated window queries
   on a static layer, an STR-packed Part 20 R-tree is kept alongside.

## Structures used

| Part | Structure | Role |
|------|-----------|------|
| — | corner-stitched plane (defined here) | Interactive editing and local queries |
| 16 | `TrapezoidalMap` | Static point location |
| 17 | `IntervalTree` | Sweep-line overlap and spacing checks |
| 20 | `STRTree` | Window queries on static layers |

## Complexity summary

| Operation | Corner stitching | Alternatives |
|-----------|------------------|--------------|
| Point find | O(tiles crossed), ~O(√n) typical, O(n) worst | O(log n) trapezoidal map |
| Neighbors of a tile | O(neighbors) | — |
| Window enumeration | O(tiles in window) | O(log n + k) R-tree |
| Insert / delete | O(tiles bordering the rectangle) | rebuild for static structures |
| Space | O(n) tiles, no index | O(n) |

## Example

```js
import { CornerStitchedPlane } from 'ds-app/applications/layout';

const metal1 = new CornerStitchedPlane();
const a = metal1.insert({ x: 0, y: 0, w: 10, h: 4 });
const b = metal1.insert({ x: 12, y: 0, w: 6, h: 4 });
metal1.locate(5, 2) === a;            // true
metal1.locate(11, 2).solid;           // false, a space tile between a and b
[...metal1.neighbors(a, 'right')];    // [space tile]
metal1.validate();                    // true: maximal strips, consistent stitches
```

## Validation and benchmark data

- The stitched plane is differential-tested against a brute-force rectangle
  list for point, neighbor, and window queries after random insert/delete
  sequences; `validate()` checks stitch consistency and maximal strips.
- Benchmarks use MCNC/ISPD benchmark layouts and synthetic layouts up to 10^6
  rectangles, reporting edit latency and queries per second.
