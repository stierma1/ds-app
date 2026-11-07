# Part 36 — Approximate Distance Oracles and Spanners

**Module:** `ds-app/distance-oracles` · **Source:** `src/distance-oracles/` · **Status:** planned

## Scope

Compact structures that answer distance queries on weighted undirected graphs
with bounded multiplicative error after subquadratic preprocessing: the
Thorup-Zwick distance oracle, graph spanners (greedy and Baswana-Sen), and
landmark-based bounds. They trade exactness for `O(k)` queries and
`O(k n^{1+1/k})` space.

## Common API

```ts
import type { Graph, Vertex, Edge } from 'ds-app/graphs';
import type { RandomSource } from 'ds-app/randomized';

export interface OracleOptions {
  k: number;                       // stretch parameter; stretch = 2k - 1
  rng?: RandomSource | number;
}

export interface DistanceOracle {
  readonly stretch: number;
  readonly order: number;
  readonly spaceEstimate: number;  // stored (vertex, center) pairs
  distance(u: Vertex, v: Vertex): number;
  path(u: Vertex, v: Vertex): Vertex[];
  validate(): true | string;
}

export interface SpannerOptions {
  algorithm?: 'greedy' | 'baswana-sen';
  rng?: RandomSource | number;
}

export function buildSpanner(g: Graph, k: number, options?: SpannerOptions): Edge[];
export function landmarkOracle(g: Graph, landmarks: Vertex[]): DistanceOracle;
```

Oracles are static and not `Container`s. `distance` returns an estimate `d'`
with `d ≤ d' ≤ stretch · d`, and `path` returns a walk of that length.

### Semantics

- The input graph must be undirected with non-negative weights; otherwise the
  constructor throws `RangeError`.
- `k` must be a positive integer; `k = 1` yields exact distances with
  `O(n²)` space.
- Unreachable pairs return `Infinity` and an empty path.
- Construction is randomized (center sampling); a seed makes it reproducible.
- `validate()` checks bunch and cluster consistency and that every stored
  distance equals a shortest-path recomputation on small graphs.

## Implementations and complexity

| Structure | Build | Space | `distance` | `path` | Stretch |
|-----------|-------|-------|------------|--------|---------|
| `ThorupZwickOracle` | O(k m n^{1/k}) expected | O(k n^{1+1/k}) expected | O(k) | O(k + path length) | 2k − 1 |
| `landmarkOracle` | O(L (m + n log n)) | O(L n) | O(L) | — | upper bound only, no guarantee |
| `buildSpanner` (greedy) | O(m n^{1+1/k}) | O(n^{1+1/k}) edges | — | — | 2k − 1 |
| `buildSpanner` (Baswana-Sen) | O(k m) expected | O(k n^{1+1/k}) edges expected | — | — | 2k − 1 |

Definitions: `n` vertices, `m` edges, `k` stretch parameter, `L` number of
landmarks. Spanners are returned as edge lists; running Part 3 Dijkstra on a
spanner gives `(2k − 1)`-approximate distances with less memory than the
original graph.

### Notes

- **Thorup-Zwick:** samples nested center sets `A_0 ⊇ A_1 ⊇ … ⊇ A_k = ∅`,
  stores for each vertex its bunch (centers closer than the next level's
  nearest center) with distances in a hash table, and answers queries by
  walking up the levels.
- **Greedy spanner:** processes edges by weight and keeps an edge when the
  current spanner distance between its endpoints exceeds `(2k − 1)` times its
  weight; optimal size but slow to build.
- **Baswana-Sen:** clusters vertices in `k` rounds of random sampling; linear
  expected time.
- **Landmarks:** triangle-inequality bounds from a few exact SSSP runs; cheap
  and useful as a heuristic, but without a stretch guarantee.

## Example

```js
import { ThorupZwickOracle } from 'ds-app/distance-oracles';
import { AdjacencyList } from 'ds-app/graphs';

const g = new AdjacencyList({ directed: false });
g.addEdge('a', 'b', 1);
g.addEdge('b', 'c', 1);
g.addEdge('a', 'c', 3);

const oracle = new ThorupZwickOracle(g, { k: 2, rng: 7 });
oracle.stretch;              // 3
oracle.distance('a', 'c');   // between 2 and 6
oracle.validate();           // true
```

## Conformance checklist

- Every query satisfies `d ≤ d' ≤ stretch · d` against Part 3 Dijkstra on
  random graphs, grids, and trees.
- `path` lengths equal the returned distance.
- Space scales as `n^{1+1/k}` across `k = 1..4` on random graphs.
- Spanner outputs are verified for stretch by all-pairs comparison on small
  graphs.
- `validate()` detects a wrong bunch distance.
