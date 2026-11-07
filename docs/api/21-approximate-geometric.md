# Part 21 — Approximate Geometric Query Structures

**Module:** `ds-app/approximate` · **Source:** `src/approximate/` · **Status:** planned

## Scope

Structures that trade exactness for speed on high-dimensional geometric queries:
approximate range searching, approximate nearest-neighbor search, annulus
queries, BBD-trees, and epsilon-kernel/core-set constructions. Every query
carries an explicit error parameter.

## Common API

```ts
import type { Container, NearestResult, Point, Bounds } from 'ds-app/core';

export interface ApproximateResult<T> {
  value: T;
  distance: number;
  errorBound: number;
}

export interface ApproximateSpatialIndex<T> extends Container<T> {
  readonly epsilon: number;
  readonly dimensions: number;
  insert(point: Point, value: T): void;
  delete(point: Point, value?: T): boolean;
  search(bounds: Bounds, epsilon?: number): T[];
  nearest(point: Point, epsilon?: number): ApproximateResult<T> | undefined;
  nearestK(point: Point, k: number, epsilon?: number): ApproximateResult<T>[];
  annulus(center: Point, inner: number, outer: number): T[];
}

export interface ApproximateOptions {
  dimensions: number;
  epsilon: number;
  metric?: (a: Point, b: Point) => number;
}
```

### Semantics

- `epsilon` is a positive relative error; `0` means exact and is allowed only by
  structures that also implement an exact mode.
- `search(bounds, epsilon)` returns every point inside `bounds` and may also
  return points within an `epsilon`-expanded boundary. It never omits an exact
  match.
- `nearest` returns a point whose distance is at most `(1 + epsilon)` times the
  true nearest distance, and reports that ratio in `errorBound`.
- `annulus` reports points with distance in `[inner, outer]`; the boundary may
  be relaxed by `epsilon` for approximate structures.
- Results are deterministic for a fixed build and query.
- `validate()` checks node decomposition, stored bounding data, epsilon bounds,
  and size.

## Implementations and complexity

| Structure | Build | Range query | Nearest | Space |
|-----------|-------|-------------|---------|-------|
| `BBDTree` | O(n log n) | O(log n + ε^{-(d-1)} + k) | O(ε^{-d} log n) | O(n) |
| `ApproximateKdTree` | O(n log n) | O(log n + ε^{-(d-1)} + k) typical, O(n) worst | O(ε^{-d} log n) typical, O(n) worst | O(n) |
| `EpsilonKernel` | O(n) for fixed ε, O(n log n) general | — | — | O(ε^{-(d-1)/2}) |
| `AnnulusIndex` | O(n log n) | O(log n + ε^{-(d-1)} + k) | O(ε^{-d} log n) | O(n) |

Definitions: `n` points, `k` reported results, `d` dimensions, `ε` relative
error. The BBD-tree bounds are worst case and deterministic (Arya and Mount);
the approximate kd-tree has no worst-case guarantee and is listed with its
typical cost. Constants hidden by the `ε` terms grow quickly with dimension;
these structures are most useful for moderate `d` or with a larger `ε`.

### Notes

- **BBD-tree (box-decomposition tree):** recursively splits a bounding box into
  cells with bounded aspect ratio. Each node stores an inner and outer box; a
  query descends only where the inner box intersects and stops when the outer
  box is contained.
- **Approximate kd-tree:** prunes a subtree when its bounding box is farther
  than the current best divided by `(1 + ε)`.
- **Epsilon-kernel:** a small subset of points that preserves the width of the
  original set in every direction to within a factor `(1 + ε)`. Used for
  approximate extent, diameter, and minimum enclosing ball.
- **Annulus/ring queries:** report points in a distance shell; bounding-distance
  pruning is especially effective here.
- Exact range searching is available in Parts 15 and 17; this part is for cases
  where the exact structure's query cost is dominated by dimension.

## Example

```js
import { BBDTree } from 'ds-app/approximate';

const index = new BBDTree({ dimensions: 2, epsilon: 0.1 });
index.insert([1, 1], 'a');
index.insert([4, 4], 'b');

index.nearest([1.05, 1.05]);            // value 'a', errorBound <= 1.1
index.search({ min: [0, 0], max: [2, 2] }, 0.1); // ['a']
index.annulus([0, 0], 1, 3);             // points in the shell
index.validate();                        // true
```

## Conformance checklist

- Approximate nearest results are compared against exact brute force; the
  distance ratio never exceeds `1 + ε`.
- Approximate range queries never omit an exact-inside point.
- `epsilon = 0` either delegates to an exact index or throws
  `UnsupportedError`, as documented.
- Degenerate data (coincident points, points on a line) respects the error
  bound.
- Core-set size and width approximation are checked for exhaustive small sets.
- `validate()` detects an invalid epsilon and a cell outside its parent.
