# Part 37 — Cuttings

**Module:** `ds-app/cuttings` · **Source:** `src/cuttings/` · **Status:** planned

## Scope

Divide-and-conquer decompositions of space for sets of lines, segments, and
hyperplanes: `(1/r)`-cuttings, hierarchical cuttings for point location in
arrangements, and cutting-based partition trees for simplex range searching.
These are the geometric analogue of balanced search trees for problems with no
one-dimensional order.

## Common API

```ts
import type { Point } from 'ds-app/core';

export interface Hyperplane {
  normal: Point;
  offset: number;
}

export interface Cell {
  vertices: Point[];            // simplex vertices
  crossing: number[];           // indices of hyperplanes crossing the cell
  below: number;                // count of hyperplanes entirely below the cell
}

export interface Cutting {
  readonly dimensions: number;
  readonly r: number;
  readonly cells: Cell[];
  locate(point: Point): Cell;
  validate(): true | string;
}

export interface ArrangementLocator {
  readonly dimensions: number;
  locate(point: Point): { above: number[]; below: number[]; on: number[] };
  validate(): true | string;
}

export interface SimplexRangeSearch<T> {
  readonly size: number;
  query(simplex: Point[]): T[];
  count(simplex: Point[]): number;
  validate(): true | string;
}

export interface CuttingOptions {
  dimensions: number;
  rng?: number;
}

export function buildCutting(hyperplanes: Hyperplane[], r: number, options: CuttingOptions): Cutting;
```

Cuttings are static and not `Container`s.

### Semantics

- A `(1/r)`-cutting is a set of disjoint simplices covering space such that
  each simplex is crossed by at most `n/r` of the `n` input hyperplanes.
- `Cutting.locate` returns the cell containing the point; ties on cell
  boundaries go to the lowest-index cell.
- `ArrangementLocator.locate` classifies the point against every hyperplane
  without testing each one, by descending a hierarchy of cuttings.
- `SimplexRangeSearch.query` reports points inside a closed simplex;
  `count` does not materialize them.
- `validate()` checks that cells are disjoint and cover a bounding simplex,
  recounts crossing hyperplanes per cell, and checks the `n/r` bound.

## Implementations and complexity

| Structure | Build | Size | Query | Space |
|-----------|-------|------|-------|-------|
| `buildCutting` (Chazelle, deterministic) | O(n r^{d−1}) | O(r^d) cells | `locate` O(r^d) by scan | O(r^d) |
| `buildCutting` (random sampling) | O(n r^{d−1}) expected | O(r^d log r) cells | `locate` O(r^d) by scan | O(r^d log r) |
| `HierarchicalCutting` (point location in an arrangement) | O(n^d) | — | O(log n) | O(n^d) |
| `PartitionTree` (simplex range searching, linear space) | O(n log n) expected | — | O(n^{1−1/d} polylog n + k) | O(n) |
| `PartitionTree` with cuttings (polylog query) | O(n^d polylog n) | — | O(log^{d+1} n + k) | O(n^d polylog n) |

Definitions: `n` hyperplanes or points, `d` dimensions (2 and 3 supported),
`r` cutting parameter, `k` reported points. Constants grow steeply with `d`;
the implementation targets `d = 2` with `d = 3` as a secondary case.

### Notes

- **Cuttings:** in the plane a cutting is a set of triangles; Chazelle's
  construction refines a coarse random cutting level by level to remove the
  `log r` factor.
- **Point location in arrangements:** a hierarchy of cuttings with constant
  `r` per level gives O(log n) descent; each cell stores the hyperplanes
  entirely above or below it, so the classification is accumulated along the
  path.
- **Simplex range searching:** partition trees built from cuttings of the dual
  arrangement (Chazelle, Sharir, and Welzl; Matoušek); the linear-space
  variant is the practical one.
- Exact arithmetic (Part 16 predicates) is used for cell boundaries;
  degenerate inputs are perturbed symbolically.

## Example

```js
import { buildCutting } from 'ds-app/cuttings';

const lines = [
  { normal: [1, 0], offset: 0 }, { normal: [0, 1], offset: 0 },
  { normal: [1, 1], offset: 1 }, { normal: [1, -1], offset: 0 },
];
const cutting = buildCutting(lines, 2, { dimensions: 2 });
cutting.cells.every((c) => c.crossing.length <= lines.length / 2); // true
cutting.locate([0.25, 0.25]).crossing;                              // at most 2 lines
cutting.validate();                                                 // true
```

## Conformance checklist

- The `n/r` crossing bound is verified for every cell on random and
  degenerate (parallel, concurrent) line sets.
- Cells are checked for disjointness and coverage by sampling points.
- Arrangement point location matches a direct test against every hyperplane.
- Simplex range queries match a linear scan on random point sets.
- `validate()` detects an overlapping pair of cells and a cell exceeding the
  crossing bound.
