# Part 3 — Graphs

**Module:** `ds-app/graphs` · **Source:** `src/graphs/` · **Status:** planned

## Scope

Directed and undirected graphs with multiple representations, plus the core
graph algorithms from the book. Vertices and edges may carry data. Algorithms
are exposed as pure functions over the `Graph` interface, so they work with any
representation.

## Common API

```ts
import type { Container } from 'ds-app/core';

export type Vertex = string | number;

export interface Edge<E = unknown> {
  from: Vertex;
  to: Vertex;
  weight: number;
  data?: E;
}

export interface Graph<V = unknown, E = unknown> {
  readonly order: number;
  readonly size: number;
  readonly directed: boolean;
  addVertex(vertex: Vertex, data?: V): boolean;
  removeVertex(vertex: Vertex): boolean;
  hasVertex(vertex: Vertex): boolean;
  addEdge(from: Vertex, to: Vertex, weight?: number, data?: E): boolean;
  removeEdge(from: Vertex, to: Vertex): boolean;
  hasEdge(from: Vertex, to: Vertex): boolean;
  getEdge(from: Vertex, to: Vertex): Edge<E> | undefined;
  neighbors(vertex: Vertex): Iterable<Vertex>;
  incidentEdges(vertex: Vertex): Iterable<Edge<E>>;
  vertices(): Iterable<Vertex>;
  edges(): Iterable<Edge<E>>;
  degree(vertex: Vertex): number;
  inDegree(vertex: Vertex): number;
  outDegree(vertex: Vertex): number;
  transpose(): Graph<V, E>;
  clone(): Graph<V, E>;
  validate(): true | string;
}

export interface GraphAlgorithmOptions {
  directed?: boolean;
  weight?: (edge: Edge) => number;
}

export interface MSTOptions extends GraphAlgorithmOptions {
  algorithm?: 'prim' | 'kruskal';
}
```

`Graph` is a two-element ADT (vertices and edges) and therefore does not
implement the generic [`Container`](./00-common-contract.md#container)
contract. It exposes `order`, `size`, `vertices()`, `edges()`, and `validate()`
directly. `size` is the number of edges; `order` is the number of vertices.
`addVertex`/`addEdge` return `true` only when the element was new.
Self-loops and parallel edges are allowed unless the implementation documents
otherwise. `transpose()` returns a new graph; it is a no-op copy for undirected
graphs.

### Algorithms

```ts
export function bfs(g: Graph, start: Vertex, options?: GraphAlgorithmOptions): Vertex[];
export function dfs(g: Graph, start: Vertex, options?: GraphAlgorithmOptions): Vertex[];
export function connectedComponents(g: Graph, options?: GraphAlgorithmOptions): Vertex[][];
export function topologicalSort(g: Graph, options?: GraphAlgorithmOptions): Vertex[];
export function dijkstra(g: Graph, source: Vertex, options?: GraphAlgorithmOptions): Map<Vertex, number>;
export function bellmanFord(g: Graph, source: Vertex, options?: GraphAlgorithmOptions): Map<Vertex, number>;
export function floydWarshall(g: Graph, options?: GraphAlgorithmOptions): number[][];
export function minimumSpanningTree(g: Graph, options?: MSTOptions): Edge[];
export function maxFlow(g: Graph, source: Vertex, sink: Vertex, options?: GraphAlgorithmOptions): number;
export function stronglyConnectedComponents(g: Graph): Vertex[][];
export function bridges(g: Graph): Edge[];
export function articulationPoints(g: Graph): Vertex[];
export function biconnectedComponents(g: Graph): Edge[][];
export function eulerPath(g: Graph, options?: GraphAlgorithmOptions): Vertex[] | undefined;
export function aStar(
  g: Graph, source: Vertex, target: Vertex,
  heuristic: (v: Vertex) => number, options?: GraphAlgorithmOptions,
): { distance: number; path: Vertex[] };
export function bipartiteMatching(g: Graph, left: Iterable<Vertex>): Edge[];
export function minCostMaxFlow(
  g: Graph, source: Vertex, sink: Vertex,
  options?: GraphAlgorithmOptions & { cost?: (edge: Edge) => number },
): { flow: number; cost: number };
export function twoSat(clauses: Iterable<[number, number]>, variables: number): boolean[] | undefined;
```

All algorithms accept an optional `GraphAlgorithmOptions`; weighted algorithms
use its `weight` selector, defaulting to `edge.weight`. `dijkstra` throws
`RangeError` on a negative weight. `bellmanFord` supports negative weights and
throws `RangeError` when it detects a negative cycle. On a directed graph,
`connectedComponents` returns weakly connected components and
`stronglyConnectedComponents` (Tarjan) returns components in reverse
topological order of the condensation. `bridges`, `articulationPoints`, and
`biconnectedComponents` require an undirected graph. `eulerPath` returns a
circuit when one exists, a path otherwise, and `undefined` when neither does.
`aStar` requires a non-negative, admissible heuristic and returns the exact
shortest path when the heuristic is consistent. `bipartiteMatching` takes the
left vertex set and returns a maximum matching. `minCostMaxFlow` reads edge
costs from `options.cost` (default `edge.data.cost`) and capacities from the
weight selector. `twoSat` takes clauses over literals `±(i + 1)` for variable
`i` and returns a satisfying assignment or `undefined`.

## Implementations and complexity

### Representation operations

| Operation | Adjacency list | Adjacency matrix | Edge list | CSR (immutable) |
|-----------|----------------|------------------|-----------|-----------------|
| `addVertex` | O(1) | O(V) to grow | O(1) | — |
| `removeVertex` | O(V + E) | O(V²) | O(E) | — |
| `addEdge` | O(1) | O(1) | O(1) | — |
| `removeEdge` | O(deg) | O(1) | O(E) | — |
| `hasEdge` / `getEdge` | O(deg), O(1) with a hash set | O(1) | O(E) | O(log deg) |
| `neighbors` | O(deg) | O(V) | O(E) | O(deg) |
| `degree` | O(1) | O(V) | O(E) | O(1) |
| `vertices` / `edges` | O(V) / O(E) | O(V²) | O(E) | O(V + E) |
| Space | O(V + E) | O(V²) | O(E) | O(V + E) |

Definitions: `V` vertices, `E` edges, `deg` degree of the queried vertex. CSR
is built once from another representation and is read-only.

### Algorithm complexity (adjacency list / adjacency matrix)

| Algorithm | Adjacency list | Adjacency matrix |
|-----------|----------------|------------------|
| BFS / DFS | O(V + E) | O(V²) |
| Connected components | O(V + E) | O(V²) |
| Topological sort | O(V + E) | O(V²) |
| Dijkstra (binary heap) | O((V + E) log V) | O(V²) |
| Bellman-Ford | O(V·E) | O(V³) |
| Floyd-Warshall | O(V³) | O(V³) |
| Prim MST (binary heap) | O((V + E) log V) | O(V²) |
| Kruskal MST | O(E log E) | O(E log E) |
| Edmonds-Karp max flow | O(V·E²) | O(V³·E) |
| Dinic max flow | O(V²·E) | O(V²·E) |
| Tarjan SCC | O(V + E) | O(V²) |
| Bridges / articulation points / biconnected components | O(V + E) | O(V²) |
| Euler path (Hierholzer) | O(V + E) | O(V²) |
| A* (binary heap) | O((V + E) log V) worst, heuristic-dependent | O(V²) |
| Hopcroft-Karp matching | O(E·√V) | O(V^{2.5}) |
| Min-cost max-flow (successive shortest paths, Johnson potentials) | O(F·(V + E) log V) | O(F·V²) |
| 2-SAT (SCC on the implication graph) | O(variables + clauses) | O(variables + clauses) |

`F` is the value of the maximum flow; min-cost flow is pseudo-polynomial in
it. `minimumSpanningTree` requires an undirected graph and uses Prim by default;
`{ algorithm: 'kruskal' }` in `MSTOptions` selects Kruskal. `maxFlow` requires
non-negative capacities and a directed graph.

### Notes

- Adjacency list is the default representation.
- Adjacency matrix is preferred for dense graphs and O(1) edge tests.
- Edge list is preferred for algorithms that stream edges (Kruskal).
- CSR is preferred for repeated traversals over a static graph.
- `validate()` checks vertex existence, edge endpoint validity, weight
  finiteness, and (for undirected graphs) symmetry.

## Example

```js
import { AdjacencyList, dijkstra } from 'ds-app/graphs';

const g = new AdjacencyList();
g.addEdge('a', 'b', 2);
g.addEdge('a', 'c', 5);
g.addEdge('b', 'c', 1);

const distances = dijkstra(g, 'a');
distances.get('c'); // 3
g.validate();       // true
```

## Conformance checklist

- Every representation passes the same algorithm suite on random graphs.
- Directed and undirected semantics are tested separately, including self-loops
  and parallel edges.
- Dijkstra rejects negative weights; Bellman-Ford reports a negative cycle.
- Heavy graphs (10^5 vertices, 10^6 edges) run without recursion overflow.
- `validate()` detects a missing endpoint and a non-symmetric undirected edge.
- SCC, bridges, articulation points, Euler paths, matching, min-cost flow, and
  2-SAT are differential-tested against brute-force references on small graphs
  and against known answers on standard families (cycles, complete bipartite
  graphs, grids, DAGs).
- `aStar` with a zero heuristic reproduces Dijkstra; with Euclidean heuristics
  on grid graphs it expands fewer vertices.
