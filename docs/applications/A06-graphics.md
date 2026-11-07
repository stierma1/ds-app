# A6 — Computer Graphics

**Module:** `ds-app/applications/graphics` · **Status:** planned ·
**Builds on:** Part 19 (BSP), Part 20 (BVH), Part 15 (kd-tree, spatial hash), Part 16 (meshes), Part 2 (trees)

## Use case

Rendering a scene means organizing geometry so that the renderer touches only
what matters: the objects inside the view frustum, the surfaces visible from
the camera, the triangles a ray can hit. The same hierarchies drive scene
editing, level-of-detail selection, and picking. This module provides the
scene graph and the acceleration structures for rasterization and ray
tracing.

## Problem

Given a scene of meshes with transforms, support: hierarchical transform
composition and instancing; frustum culling; back-to-front or front-to-back
ordering of static geometry for a moving viewer; ray-scene intersection for
millions of rays against millions of triangles; and neighbor queries for
particles and dynamic objects.

## How it is solved

1. **Scene graph.** A directed acyclic graph of transform, group, and
   geometry nodes (Part 2 general trees with shared subtrees for instancing).
   A traversal composes transforms top-down and caches world-space bounding
   volumes bottom-up, so frustum culling rejects whole subtrees by testing
   one bounding box against six planes. Render order is produced by sorting
   visible leaves by material state to minimize pipeline changes.
2. **BSP visibility.** Static world geometry is compiled once into a Part 19
   BSP tree with a best-splitter heuristic. For a viewer position, an
   in-order traversal that visits the far side first yields the painter's
   order for back-to-front compositing without a depth buffer; the opposite
   order gives front-to-back rendering with early depth rejection. Convex
   cells of the tree define portals for precomputed potentially-visible sets.
3. **Ray tracing acceleration.** Triangles are stored in a Part 20 BVH built
   with the surface-area heuristic over binned centroids; a ray traverses the
   tree with an explicit stack, visiting the nearer child first and skipping
   any box farther than the closest hit found so far. Triangle intersection
   uses the Möller-Trumbore test. A Part 15 kd-tree with SAH splits is the
   alternative for static scenes where its tighter spatial cuts beat the BVH;
   the BVH wins for animation because it can be refit without a rebuild.
   Shadow rays use any-hit traversal that stops at the first intersection.
4. **Spatial hashing for dynamics.** Particles, sprites, and other objects of
   similar size are placed in a Part 15 spatial hash with cell size equal to
   the object diameter; neighbor queries check 27 cells. The hash is rebuilt
   every frame in `O(n)`.
5. **Mesh processing.** Meshes are kept as Part 16 half-edge structures when
   topology matters: computing vertex normals, edge collapse for decimation
   (with a Part 6 priority queue ordered by quadric error), and Loop
   subdivision.

## Structures used

| Part | Structure | Role |
|------|-----------|------|
| 2 | `GeneralTree` | Scene graph |
| 19 | `BSPTree` | Visibility ordering of static geometry |
| 20 | `BVH` | Ray-triangle acceleration, refit for animation |
| 15 | `KdTree`, `SpatialHash` | Static ray acceleration, particle neighbors |
| 16 | `PlanarGraph` (half-edge) | Mesh topology |
| 6 | `BinaryHeap` | Decimation queue |

## Complexity summary

| Operation | Cost |
|-----------|------|
| Scene traversal with culling | O(visible nodes) after O(n) bound update |
| BSP build / traversal | O(n log n) typical build; O(n) traversal |
| BVH build (SAH) / refit | O(n log n) / O(n) |
| Ray cast | O(log n + hits) average |
| Spatial hash rebuild / neighbor query | O(n) / O(1 + neighbors) |
| Edge collapse decimation | O(n log n) |

## Example

```js
import { Scene, RayTracer } from 'ds-app/applications/graphics';

const scene = new Scene();
const bunny = scene.addMesh(loadObj('bunny.obj'));
scene.instance(bunny, { translate: [1, 0, 0] });
const tracer = new RayTracer(scene, { accelerator: 'bvh', build: 'sah' });
const hit = tracer.trace({ origin: [0, 0, 5], direction: [0, 0, -1] });
hit?.t;          // distance to the first triangle
scene.cull(camera).length; // nodes inside the frustum
```

## Validation and benchmark data

- Ray casts are differential-tested against a brute-force triangle loop;
  BSP orders are checked for correct depth ordering of overlapping polygons.
- Benchmarks render the Stanford bunny and the Sponza atrium and report BVH
  and kd-tree build time, rays per second for primary and shadow rays, and
  refit cost under animation.
