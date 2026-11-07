# Part 33 — Spatiotemporal Data Structures

**Module:** `ds-app/spatiotemporal` · **Source:** `src/spatiotemporal/` · **Status:** planned

## Scope

Indexes for objects that move or change over time: the time-parameterized
R-tree (TPR-tree) and TPR*-tree for predicted positions, the historical R-tree
(HR-tree) for versioned snapshots, and the 3D R-tree for stored trajectories.
They extend Part 20 with a time axis.

## Common API

```ts
import type { Bounds, NearestResult, Point } from 'ds-app/core';

export interface Sample {
  time: number;
  position: Point;
}

export interface MovingObjectIndex<T> {
  readonly size: number;
  readonly now: number;
  readonly dimensions: number;
  readonly horizon: number;
  insert(id: number, value: T, position: Point, velocity: Point, time?: number): void;
  update(id: number, position: Point, velocity: Point, time?: number): boolean;
  delete(id: number): boolean;
  searchAt(bounds: Bounds, time: number): T[];
  searchDuring(bounds: Bounds, from: number, to: number): T[];
  nearestAt(point: Point, time: number, k?: number): NearestResult<T>[];
  advance(time: number): void;
  validate(): true | string;
}

export interface TrajectoryIndex<T> {
  readonly size: number;
  readonly dimensions: number;
  insert(id: number, value: T, samples: Sample[]): void;
  delete(id: number): boolean;
  searchAt(bounds: Bounds, time: number): T[];
  searchDuring(bounds: Bounds, from: number, to: number): T[];
  trajectory(id: number): Sample[] | undefined;
  validate(): true | string;
}
```

These are handle-based indexes keyed by object id, not `Container`s. Spatial
types come from the common contract; `Bounds` queries are closed boxes in space
and closed intervals in time.

### Semantics

- A `MovingObjectIndex` holds the current motion of each object; `searchAt`
  and `nearestAt` answer for a future time by linear extrapolation. Queries
  for `time < now` throw `RangeError` except on the HR-tree.
- `advance(time)` moves the reference time forward and tightens bounding
  rectangles; `horizon` bounds how far ahead queries are expected and drives
  the split heuristics.
- The HR-tree snapshots the whole index at each `advance` and shares unchanged
  subtrees between versions; `searchAt` for a past time is answered from the
  matching version.
- A `TrajectoryIndex` stores polylines; `searchDuring` reports trajectories
  that intersect the box at any time in the interval.
- `validate()` checks containment of time-parameterized rectangles over the
  horizon, version sharing (HR-tree), and size.

## Implementations and complexity

| Structure | `insert` / `update` | `delete` | `searchAt` / `searchDuring` | `nearestAt` | Space |
|-----------|---------------------|----------|-----------------------------|-------------|-------|
| `TPRTree` | O(log n) avg, O(n) worst | O(log n) avg | O(log n + k) avg, O(n) worst | O(log n) avg | O(n) |
| `TPRStarTree` | O(log n) avg, higher constant | O(log n) avg | O(log n + k) avg, O(n) worst | O(log n) avg | O(n) |
| `HistoricalRTree` | O(log n) avg per version | O(log n) avg | O(log n + k) avg at any version | O(log n) avg | O(n + u log n) |
| `ThreeDRTree` (trajectories) | O(s log n) avg | O(s log n) avg | O(log n + k) avg, O(n) worst | — | O(n s) |

Definitions: `n` objects, `k` reported objects, `u` number of updates across
versions, `s` samples per trajectory. All query bounds are average case, as for
R-trees; bounding rectangles of moving objects grow with time, so query cost
degrades toward the horizon.

### Notes

- **TPR-tree:** bounding rectangles have a position and a velocity in each
  dimension; node selection and splits minimize the integral of area, margin,
  and overlap over `[now, now + horizon]`.
- **TPR*-tree:** improves insertion by choosing paths that minimize the swept
  region and by actively tightening rectangles at updates.
- **HR-tree:** a version of the R-tree is kept per timestamp; unchanged
  subtrees are shared, so space grows with the number of updates rather than
  with versions times `n`.
- **3D R-tree:** indexes trajectory segments as boxes in (x, y, t); simple and
  effective for historical queries over stored movement.
- Motion is linear; nonlinear motion must be approximated by frequent updates.

## Example

```js
import { TPRTree } from 'ds-app/spatiotemporal';

const index = new TPRTree({ dimensions: 2, horizon: 60 });
index.insert(1, 'car', [0, 0], [1, 0]);   // moves +1 per unit time in x
index.insert(2, 'bike', [10, 10], [0, 0]);

index.searchAt({ min: [4, -1], max: [6, 1] }, 5);   // ['car']
index.nearestAt([10, 9], 0, 1);                      // [{ value: 'bike', distance: 1 }]
index.validate();                                    // true
```

## Conformance checklist

- `searchAt`/`searchDuring`/`nearestAt` are differential-tested against
  extrapolating every object and scanning linearly.
- Horizon and `advance` behavior are tested with objects that leave and re-enter
  query windows.
- HR-tree past-version queries match snapshots taken at each version.
- Trajectory queries match a segment-box intersection scan.
- `validate()` detects a rectangle that fails to contain its children over the
  horizon and a broken version link.
