# Part 19 — Binary Space Partitioning Trees

**Module:** `ds-app/bsp` · **Source:** `src/bsp/` · **Status:** planned

## Scope

Binary space partitioning (BSP) trees for sets of polygons or half-spaces.
Nodes store splitting planes; polygons are classified as front, back, coplanar,
or spanning. BSP trees support visibility ordering, point classification,
clipping, and constructive solid geometry (CSG).

## Common API

```ts
import type { Container, Point } from 'ds-app/core';

export type Plane = { normal: Point; offset: number };
export type Classification = 'front' | 'back' | 'coplanar' | 'spanning';

export interface Polygon {
  vertices: Point[];
  plane: Plane;
  data?: unknown;
}

export interface BSPTree<T> extends Container<T> {
  build(entries: Iterable<[Polygon, T]>, options?: BSPOptions): void;
  insert(polygon: Polygon, value: T): void;
  delete(value: T): boolean;
  classify(point: Point): -1 | 0 | 1;
  query(point: Point): T[];
  traverse(viewer: Point, order?: 'front-to-back' | 'back-to-front'): T[];
  clip(polygon: Polygon): Polygon[];
  union(other: BSPTree<T>): BSPTree<T>;
  intersect(other: BSPTree<T>): BSPTree<T>;
  difference(other: BSPTree<T>): BSPTree<T>;
  readonly height: number;
  readonly splitCount: number;
}

export interface BSPOptions {
  splitter?: 'first' | 'random' | 'best' | 'longest';
  epsilon?: number;
}
```

### Semantics

- `build` replaces the contents with polygon/value pairs and chooses splitters
  according to `splitter`.
- `classify` returns `-1` (back), `0` (coplanar), or `1` (front) relative to the
  node planes along the query path.
- `query` reports the values whose cells contain the point.
- `traverse` visits nodes in visibility order for a viewer position.
- `clip` returns the parts of a polygon inside the tree's solid.
- CSG operations return a new tree and do not mutate either input.
- `epsilon` controls coplanarity tolerance; the default is `1e-9`.
- `validate()` checks plane normalization, front/back ordering, polygon
  classification, and size.

## Implementations and complexity

| Operation | First splitter | Random splitter | Best splitter |
|-----------|----------------|-----------------|---------------|
| `build` | O(n log n) avg, O(n²) worst | O(n log n) expected, O(n²) worst | O(n² log n) typical with all candidates, O(n log n) typical with a sampled candidate set, O(n³) worst |
| `insert` | O(log n) avg, O(n) worst | O(log n) expected, O(n) worst | O(log n) avg, O(n) worst |
| `delete` | O(log n) avg, O(n) worst | O(log n) expected, O(n) worst | O(log n) avg, O(n) worst |
| `classify` / `query` | O(log n) avg, O(n) worst | O(log n) expected, O(n) worst | O(log n) avg, O(n) worst |
| `traverse` | O(n) | O(n) | O(n) |
| `clip` | O(n) avg, O(n + k) | O(n) avg, O(n + k) | O(n) avg, O(n + k) |
| CSG (union/intersect/difference) | O(n log n + k) typical | O(n log n + k) typical | O(n log n + k) typical |
| Space | O(n + splits) | O(n + splits) | O(n + splits) |

Definitions: `n` input polygons, `k` output fragments, `splits` = polygons cut
by splitting planes. CSG worst case is O(n²) when every polygon intersects every
plane.

### Notes

- `first` is fast to build but sensitive to input order; `random` gives
  expected balance; `best` evaluates candidate splitters and minimizes splits
  and imbalance at higher build cost; `longest` uses the longest edge's plane.
- A polygon that spans a plane is split into front and back fragments; `splits`
  tracks the added fragments.
- Back-to-front traversal is used for painter's-algorithm visibility;
  front-to-back traversal is used for depth-buffered or occlusion rendering.
- CSG classifies polygons against the other solid and keeps the appropriate
  fragments.
- The tree is not balanced by a stored invariant; `height` can be linear for
  adversarial polygon order.

## Example

```js
import { BSPTree } from 'ds-app/bsp';

const bsp = new BSPTree();
const entries = polygons.map((polygon, i) => [polygon, `poly-${i}`]);
bsp.build(entries, { splitter: 'best' });

bsp.classify([1, 2, 3]);              // 1, 0, or -1
bsp.traverse([0, 0, 10], 'front-to-back');
const clipped = bsp.clip(polygons[0]);
bsp.validate();                       // true
```

## Conformance checklist

- Point classification is differential-tested against direct plane evaluation.
- Front-to-back and back-to-front traversals are reverse orders of each other
  for the same viewer.
- Clipping a polygon against a convex cell produces fragments entirely on one
  side of every plane.
- CSG operations are checked on simple cubes for volume, closure, and fragment
  count.
- `validate()` detects an unnormalized plane, a misclassified polygon, and a
  broken front/back link.
- Adversarial input orders do not overflow the stack during traversal.
