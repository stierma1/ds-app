# A8 — Collision Detection

**Module:** `ds-app/applications/collision` · **Status:** planned ·
**Builds on:** Part 20 (BVH), Part 15 (spatial hash), Part 18 (octrees), Part 31 (kinetic), Part 1 (lists)

## Use case

Physics engines, games, robotics simulators, and CAD interference checks must
find every pair of objects that touch, each frame, among thousands to
millions of moving objects, and then compute the contact geometry for the
pairs that do. Doing this in time proportional to the number of actual
contacts rather than to the number of pairs is the whole problem.

## Problem

Given objects with bounding boxes that move a little each frame, report all
pairs whose shapes intersect (discrete collision), or the first time within a
frame at which two shapes touch (continuous collision), without testing every
pair. Separate a cheap broad phase that over-approximates with boxes from a
narrow phase that tests exact shapes.

## How it is solved

1. **Broad phase: sweep and prune.** Each axis keeps a sorted list of box
   endpoints. Because objects move little between frames, the lists are
   re-sorted by insertion sort in near-linear time, and every swap of a start
   and an end endpoint adds or removes exactly one candidate pair. Pairs that
   overlap on all three axes go to the narrow phase. It is the best broad
   phase for scenes with temporal coherence and few objects entering or
   leaving.
2. **Broad phase: uniform grid and spatial hash.** With cell size equal to
   the largest object, each box is inserted into the cells it covers and
   candidates are the pairs sharing a cell; a Part 15 spatial hash makes the
   grid unbounded. Rebuilt every frame in `O(n)`, it wins for many similar
   small objects such as particles.
3. **Broad phase: hierarchies.** A Part 20 BVH over the boxes supports
   self-overlap traversal that descends two subtrees only when their boxes
   intersect; it is refit each frame and rebuilt when the SAH cost grows past
   a threshold. A Part 18 octree (loose variant, with cells enlarged so an
   object fits in one cell) holds static world geometry.
4. **Narrow phase.** Exact tests by shape pair: sphere-sphere, box-box with
   the separating-axis theorem for oriented boxes, triangle-triangle, and
   GJK for arbitrary convex shapes with EPA to recover penetration depth and
   contact normal. Concave meshes are decomposed into convex pieces or tested
   per triangle through a per-mesh BVH.
5. **Continuous collision.** Fast or thin objects can pass through each other
   between frames. Swept tests treat the motion as a capsule or swept box;
   conservative advancement steps objects forward by their distance bound
   until they touch; time of impact is found by root bracketing on the
   separating distance. For objects with known trajectories, Part 31 kinetic
   structures maintain the sorted endpoint lists exactly between events.

## Structures used

| Part | Structure | Role |
|------|-----------|------|
| 1 | `ArrayList` with insertion sort | Sweep-and-prune endpoint lists |
| 15 | `SpatialHash` | Uniform grid broad phase |
| 20 | `BVH` | Hierarchical broad phase, per-mesh narrow phase |
| 18 | `Octree` | Static world geometry |
| 31 | `KineticSortedList` | Exact endpoint order under known motion |
| 24 | `HashSet` | Candidate pair set |

## Complexity summary

| Phase | Structure | Per frame |
|-------|-----------|-----------|
| Broad | sweep and prune | O(n + swaps), swaps small under coherence |
| Broad | spatial hash | O(n + candidate pairs) |
| Broad | BVH refit + self overlap | O(n) + O(n log n + pairs) |
| Narrow | per pair | O(1) primitives; O(iterations) GJK |
| Continuous | conservative advancement | O(steps) per pair |

## Example

```js
import { CollisionWorld } from 'ds-app/applications/collision';

const world = new CollisionWorld({ broadPhase: 'sweep-and-prune' });
const a = world.add({ shape: { type: 'sphere', radius: 1 }, position: [0, 0, 0], velocity: [1, 0, 0] });
const b = world.add({ shape: { type: 'box', halfExtents: [1, 1, 1] }, position: [3, 0, 0] });
world.step(1 / 60);
world.contacts();                 // [] not yet touching
world.timeOfImpact(a, b);         // about 1.0
```

## Validation and benchmark data

- Every broad phase reports the same candidate pairs as an all-pairs box
  test; narrow-phase results match analytic contact points for primitive
  pairs; GJK distance matches brute-force vertex-pair search on convex hulls.
- Benchmarks run particle scenes from 10^4 to 10^6 objects and rigid-body
  stacking scenes, reporting broad-phase time, pairs tested, and continuous
  collision cost.
