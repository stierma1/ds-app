# Part 32 — PQ Trees, PC Trees, and Planarity

**Module:** `ds-app/pq-trees` · **Source:** `src/pq-trees/` · **Status:** planned

## Scope

Trees that represent all permutations of a set in which given subsets appear
consecutively: PQ trees (linear order), PC trees (circular order), and their
applications to the consecutive-ones property, interval-graph recognition, and
planarity testing with embedding.

## Common API

```ts
import type { Graph, Edge } from 'ds-app/graphs';
import type { PlanarGraph } from 'ds-app/pslg';

export interface ConsecutiveTree {
  readonly universe: number;
  readonly permutationCount: bigint;
  reduce(subset: Iterable<number>): boolean;
  frontier(): number[];
  isNull(): boolean;
  validate(): true | string;
}

export interface PQTree extends ConsecutiveTree {
  readonly kind: 'pq';
}

export interface PCTree extends ConsecutiveTree {
  readonly kind: 'pc';   // reduce() enforces circular consecutiveness
}

export interface PlanarityResult {
  planar: boolean;
  embedding?: PlanarGraph;   // rotation system, no coordinates
  obstruction?: Edge[];      // Kuratowski subgraph when not planar
}

export function hasConsecutiveOnes(rows: Iterable<Iterable<number>>, columns: number): number[] | undefined;
export function isIntervalGraph(g: Graph): boolean;
export function testPlanarity(g: Graph): PlanarityResult;
```

`ConsecutiveTree` is not a `Container`; it represents a set of permutations,
not a set of elements.

### Semantics

- The universe is `[0, universe)`. `reduce(S)` restricts the represented
  permutations to those in which `S` is consecutive (circularly consecutive
  for PC trees) and returns `false`, leaving the tree null, if none remain.
- `frontier()` returns one permitted permutation; `permutationCount` counts
  all of them.
- `hasConsecutiveOnes` returns a column order that makes every row's ones
  consecutive, or `undefined`.
- `testPlanarity` returns an embedding as a Part 16 `PlanarGraph` with no
  coordinates assigned, or a Kuratowski obstruction.
- `validate()` checks node types, child counts (a P node has at least two
  children, a Q node at least three), and that `frontier()` satisfies every
  reduction applied so far.

## Implementations and complexity

| Operation | `PQTree` (Booth and Lueker) | `PCTree` (Shih and Hsu) |
|-----------|-----------------------------|-------------------------|
| Construct over `U` elements | O(U) | O(U) |
| `reduce(S)`, over a sequence of reductions | O(U + Σ size(S)) total | O(U + Σ size(S)) total |
| `frontier` | O(U) | O(U) |
| `permutationCount` | O(U) | O(U) |
| Space | O(U) | O(U) |

| Algorithm | Cost |
|-----------|------|
| `hasConsecutiveOnes` | O(rows + columns + ones) |
| `isIntervalGraph` | O(V + E) |
| `testPlanarity` | O(V) for a simple graph, after rejecting E > 3V − 6 |

Definitions: `U` universe size, `S` reduction subset, `V`/`E` vertices and
edges. An individual reduction can cost more than its subset size; the bound is
amortized over the sequence.

### Notes

- **PQ tree:** P nodes permit any child order, Q nodes permit only a reversal.
  Reduction applies the template rules bottom-up over the pertinent subtree.
- **PC tree:** C nodes replace Q nodes and represent circular orders; the
  reduction splits the tree along a single path, which is simpler to implement
  and has the same bound.
- **Planarity:** the PC-tree algorithm of Shih and Hsu adds vertices in a
  depth-first postorder and keeps the partial embedding as a PC tree; the
  obstruction is extracted when a reduction fails.
- **Interval graphs:** a graph is an interval graph when its maximal cliques can
  be ordered so each vertex's cliques are consecutive, which is a PQ-tree
  reduction over the clique matrix.

## Example

```js
import { PQTree } from 'ds-app/pq-trees';

const tree = new PQTree(5);
tree.reduce([0, 1]);      // true
tree.reduce([1, 2]);      // true
tree.frontier();          // for example [0, 1, 2, 3, 4]
tree.permutationCount;    // 12n: the block {0,1,2} in 2 orientations × 3! arrangements
tree.reduce([0, 2]);      // false: 0 and 2 cannot be adjacent with 1 between them
tree.isNull();            // true
```

## Conformance checklist

- `reduce` results and `permutationCount` match brute-force enumeration over
  all permutations for universes up to 8.
- Consecutive-ones orders are verified by checking every row.
- Planarity is tested against known planar and non-planar families (K5, K3,3,
  grids, wheels, random maximal planar graphs); returned embeddings pass Part
  16 `validate()` and Euler's formula.
- Obstructions are verified to be subdivisions of K5 or K3,3.
- `validate()` detects a P node with one child and a violated reduction.
