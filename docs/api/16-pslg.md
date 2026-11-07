# Part 16 — Planar Straight Line Graphs

**Module:** `ds-app/pslg` · **Source:** `src/pslg/` · **Status:** planned

## Scope

Planar straight-line graphs (PSLGs) represented with a doubly connected edge
list (DCEL / half-edge structure), plus sweep-line triangulation, point
location, and overlay operations. Coordinates are finite numbers; the graph may
be disconnected.

## Common API

```ts
import type { Point } from 'ds-app/core';

export type VertexId = number;
export type HalfEdgeId = number;
export type FaceId = number;

export interface PlanarGraph {
  readonly vertexCount: number;
  readonly halfEdgeCount: number;
  readonly faceCount: number;

  addVertex(x: number, y: number): VertexId;
  removeVertex(v: VertexId): boolean;
  addEdge(u: VertexId, v: VertexId): HalfEdgeId;
  removeEdge(e: HalfEdgeId): boolean;

  vertices(): Iterable<VertexId>;
  halfEdges(): Iterable<HalfEdgeId>;
  faces(): Iterable<FaceId>;

  source(e: HalfEdgeId): VertexId;
  target(e: HalfEdgeId): VertexId;
  twin(e: HalfEdgeId): HalfEdgeId;
  next(e: HalfEdgeId): HalfEdgeId;
  prev(e: HalfEdgeId): HalfEdgeId;
  face(e: HalfEdgeId): FaceId;
  incidentHalfEdges(v: VertexId): Iterable<HalfEdgeId>;
  outerFace(): FaceId;

  readonly locationBuilt: boolean;
  buildLocation(options?: { rng?: number }): void;
  locate(point: Point): FaceId | undefined;
  triangulate(): PlanarGraph;
  overlay(other: PlanarGraph): PlanarGraph;
  validate(): true | string;
}

export type SegmentId = number;

export interface TrapezoidalMap {
  readonly segmentCount: number;
  readonly trapezoidCount: number;
  locate(point: Point): { above: SegmentId | undefined; below: SegmentId | undefined; trapezoid: number };
  validate(): true | string;
}

export function buildTrapezoidalMap(segments: Array<[Point, Point]>, options?: { rng?: number }): TrapezoidalMap;
```

### Semantics

- `PlanarGraph` is a handle-based topology structure, not a generic container;
  it exposes counts, iterators, and `validate()` directly instead of extending
  `Container`.
- Each undirected edge is stored as two half-edges; `twin(twin(e)) === e`.
- `next(e)` is the next half-edge counterclockwise around `face(e)`;
  `prev(next(e)) === e`.
- `addEdge` splits the target faces if the edge is inserted inside a face and
  rejects crossings, duplicate edges, and non-finite coordinates.
- `removeVertex` removes all incident edges.
- `locate` returns the face containing the point, or the outer face for points
  outside the graph, and `undefined` on an empty graph. It uses a linear scan
  until `buildLocation()` builds the trapezoidal search structure; any later
  `addEdge`/`removeEdge` resets `locationBuilt` to `false`.
- `TrapezoidalMap` is the same search structure exposed on its own for a set
  of non-crossing segments: `locate` reports the segments directly above and
  below the point. A crossing pair of segments throws `RangeError`.
- `triangulate` returns a new PSLG whose bounded faces are triangles.
- `overlay` returns the arrangement of both graphs and does not mutate either
  input.
- `validate()` checks half-edge cycles, twin/next consistency, vertex incidence,
  face cycles, and Euler's formula.

## Implementations and complexity

| Operation | DCEL, naive location | DCEL, trapezoidal location | Sweep-line triangulation |
|-----------|----------------------|----------------------------|--------------------------|
| `addVertex` | O(1) | O(1) | O(1) |
| `addEdge` | O(deg + f) | O(log n + deg + f) | O(log n + deg + f) |
| `removeEdge` | O(deg + f) | O(log n + deg + f) | O(log n + deg + f) |
| `incidentHalfEdges` | O(deg) | O(deg) | O(deg) |
| Face boundary traversal | O(deg) | O(deg) | O(deg) |
| `locate` | O(n) | O(log n) | O(log n) |
| `triangulate` | O(n²) naive ear clipping | O(n log n) | O(n log n) |
| `overlay` | O(n²) | O((n + k) log n) | O((n + k) log n) |
| Space | O(V + E + F) | O(V + E + F) | O(V + E + F) |

| Operation | `TrapezoidalMap` |
|-----------|------------------|
| `buildTrapezoidalMap` / `buildLocation` | O(n log n) expected |
| `locate` | O(log n) expected |
| Space | O(n) expected |

Definitions: `n` = number of vertices/edges, `k` = number of intersections in
the overlay, `deg` = vertex degree, `f` = boundary length of the face that an
edge insertion splits or an edge removal merges (its half-edges are relabeled).
A planar graph with `C` connected components satisfies `V - E + F = 1 + C`,
which is `2` when connected; `validate()` checks the global formula.

### Notes

- The DCEL stores, per half-edge, its origin, twin, next, previous, and incident
  face. Vertex records hold one outgoing half-edge.
- Face records hold one boundary half-edge; the outer face is represented
  explicitly with a clockwise boundary.
- The trapezoidal point-location structure is the randomized incremental
  construction of Mulmuley and of Seidel: expected `O(n log n)` build and
  `O(log n)` query, with a seed for reproducibility. The naive scan is the
  default until `buildLocation()` is called.
- Sweep-line triangulation handles simple polygons with no self-intersections.
  For general PSLGs, run overlay or segment intersection first.
- `overlay` uses a Bentley-Ottmann-style sweep and reports all intersections.

## Example

```js
import { PlanarGraph } from 'ds-app/pslg';

const g = new PlanarGraph();
const a = g.addVertex(0, 0);
const b = g.addVertex(1, 0);
const c = g.addVertex(0, 1);
g.addEdge(a, b);
g.addEdge(b, c);
g.addEdge(c, a);

g.faceCount;          // 2 including the outer face
g.locate([0.2, 0.2]); // bounded face
g.validate();         // true
```

## Conformance checklist

- Half-edge/twin/next/prev identities hold after randomized edge insertions and
  removals.
- Euler's formula is checked for connected components, including isolated
  vertices and bridges.
- `locate` is tested on points inside, outside, on edges, and on vertices.
- Triangulation produces only triangular bounded faces and preserves the
  boundary.
- Overlay handles disjoint, touching, crossing, and coincident edges.
- `validate()` detects a broken twin link and a corrupted face cycle.
- `TrapezoidalMap.locate` matches a direct above/below scan on random
  non-crossing segment sets, including shared endpoints and vertical segments.
