# Part 29 — Dynamic Graphs

**Module:** `ds-app/dynamic-graphs` · **Source:** `src/dynamic-graphs/` · **Status:** planned

## Scope

Graphs that change by edge insertion and deletion while connectivity, minimum
spanning forest, and shortest-path queries stay faster than recomputation.
Incremental (insert-only), decremental (delete-only), and fully dynamic
variants are provided; they build on Part 3 graphs and Part 25 forests.

## Common API

```ts
import type { Vertex, Edge } from 'ds-app/graphs';

export interface DynamicGraph {
  readonly order: number;
  readonly size: number;
  addVertex(v: Vertex): boolean;
  addEdge(u: Vertex, v: Vertex, weight?: number): boolean;
  removeEdge(u: Vertex, v: Vertex): boolean;
  hasEdge(u: Vertex, v: Vertex): boolean;
  validate(): true | string;
}

export interface DynamicConnectivity extends DynamicGraph {
  readonly componentCount: number;
  connected(u: Vertex, v: Vertex): boolean;
  componentSize(v: Vertex): number;
}

export interface DynamicMSF extends DynamicGraph {
  readonly weight: number;
  forestEdges(): Iterable<Edge>;
  inForest(u: Vertex, v: Vertex): boolean;
}

export interface DynamicShortestPaths extends DynamicGraph {
  distance(u: Vertex, v: Vertex): number;
  path(u: Vertex, v: Vertex): Vertex[];
}
```

Dynamic graphs are not `Container`s; like Part 3 they expose `order`, `size`,
and `validate()` directly. Updates return `true` only when the graph changed.

### Semantics

- Graphs in this part are undirected unless the implementation says otherwise;
  self-loops are ignored and parallel edges are allowed.
- Incremental structures throw `UnsupportedError` on `removeEdge`; decremental
  structures throw `UnsupportedError` on `addEdge` after construction.
- `distance` returns `Infinity` for unreachable pairs.
- `validate()` recomputes connectivity, forest weight, or distances from
  scratch on small graphs and checks level invariants on large ones.

## Implementations and complexity

| Structure | Model | `addEdge` | `removeEdge` | Query | Space |
|-----------|-------|-----------|--------------|-------|-------|
| `IncrementalConnectivity` | union-find (Part 24) | O(α(n)) amortized | — | O(α(n)) amortized | O(n) |
| `DecrementalForestConnectivity` | Euler-tour trees (Part 25) | — | O(log n) expected | O(log n) expected | O(n) |
| `DynamicConnectivity` | Holm, de Lichtenberg, and Thorup levels | O(log² n) amortized | O(log² n) amortized | O(log n / log log n) | O(m + n log n) |
| `DynamicMSF` | HDT-based (Holm et al.) | O(log⁴ n) amortized | O(log⁴ n) amortized | `inForest` O(log n) | O(m log n) |
| `FredericksonMSF` | topology trees | O(√m) | O(√m) | O(1) | O(m) |
| `IncrementalSSSP` | Ramalingam and Reps | O(δ log δ) per update, output-bounded | — | O(1) | O(m + n) |
| `DynamicAPSP` | Demetrescu and Italiano | O(n² log³ n) amortized | O(n² log³ n) amortized | O(1) | O(n² log n) |

Definitions: `n` vertices, `m` edges, `α` inverse Ackermann, `δ` the number of
vertices whose distance changes plus their incident edges. Expected bounds come
from the treaps inside Euler-tour trees.

### Notes

- **HDT connectivity:** maintains a spanning forest per level with Euler-tour
  trees; deleting a tree edge searches the deleted edge's level for a
  replacement and pushes non-replacement edges down a level, which amortizes
  to O(log² n).
- **Dynamic MSF:** reduces to O(log n) instances of decremental MSF over HDT
  (Holm et al.); the Frederickson variant gives worst-case bounds through
  topology trees and is better when `m` is small.
- **Incremental SSSP:** after an insertion, only vertices whose distance drops
  are re-relaxed; cost is proportional to the change, not the graph.
- **Dynamic APSP:** maintains locally shortest paths; `distance` is a table
  lookup.
- The Part 3 static algorithms remain the reference for differential tests.

## Example

```js
import { DynamicConnectivity } from 'ds-app/dynamic-graphs';

const g = new DynamicConnectivity();
g.addEdge('a', 'b');
g.addEdge('b', 'c');
g.addEdge('a', 'c');
g.removeEdge('a', 'b');
g.connected('a', 'b');   // true, via c
g.removeEdge('b', 'c');
g.connected('a', 'b');   // false
g.validate();            // true
```

## Conformance checklist

- Connectivity, MSF weight, and distances are differential-tested against the
  Part 3 static algorithms after every update on random graphs.
- Decremental runs delete every edge in random order and check each step.
- Replacement-edge search is exercised on graphs with many parallel paths.
- Large sequences (10^5 updates) stay within the measured amortized budget.
- `validate()` detects a broken level invariant and a wrong forest weight.
