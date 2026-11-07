import type { Edge, Graph, MSTOptions } from "./types.ts";
import {
  buildAdjacency,
  edgeWeight,
  effectiveDirected,
  MinHeap,
  UnionFind,
} from "./shared.ts";

function requireUndirected(graph: Graph, options?: MSTOptions): boolean {
  const directed = effectiveDirected(graph, options);
  if (directed) {
    throw new TypeError("minimumSpanningTree requires an undirected graph");
  }
  return directed;
}

/**
 * Minimum spanning forest (one tree per component) of an undirected graph; throws
 * TypeError when the effective direction is directed. Default `algorithm` is "prim".
 * Prim: lazy binary heap, O(E log V) time, O(E) heap space (every edge is pushed from both
 * ends and stale entries are skipped on pop). Kruskal: sort O(E log E) = O(E log V) plus
 * near-linear union-find, O(V+E) space. Same asymptotics; Kruskal's output is weight-sorted
 * and it does less heap churn on sparse graphs, Prim avoids the full sort and tends to win
 * on dense graphs. Both call buildAdjacency, so both are at least O(V+E).
 */
export function minimumSpanningTree(
  graph: Graph,
  options?: MSTOptions,
): Edge[] {
  requireUndirected(graph, options);
  const algorithm = options?.algorithm ?? "prim";
  if (algorithm !== "prim" && algorithm !== "kruskal") {
    throw new TypeError("algorithm must be 'prim' or 'kruskal'");
  }
  return algorithm === "kruskal"
    ? kruskal(graph, options)
    : prim(graph, options);
}

/**
 * Lazy Prim: O(E log V) time, O(E) heap entries in the worst case because there is no
 * decrease-key; restarted from each unvisited vertex to cover every component.
 */
function prim(graph: Graph, options?: MSTOptions): Edge[] {
  const view = buildAdjacency(graph, false);
  const visited = new Uint8Array(view.vertices.length);
  const result: Edge[] = [];
  for (let start = 0; start < view.vertices.length; start++) {
    if (visited[start] === 1) {
      continue;
    }
    visited[start] = 1;
    const heap = new MinHeap<{
      to: number;
      weight: number;
      edge: Edge;
    }>((a, b) => {
      if (a.weight !== b.weight) {
        return a.weight - b.weight;
      }
      return a.to - b.to;
    });
    for (const entry of view.out[start]) {
      heap.push({
        to: entry.to,
        weight: edgeWeight(entry.edge, options),
        edge: entry.edge,
      });
    }
    while (!heap.isEmpty()) {
      const current = heap.pop()!;
      if (visited[current.to] === 1) {
        continue;
      }
      visited[current.to] = 1;
      result.push(current.edge);
      for (const entry of view.out[current.to]) {
        heap.push({
          to: entry.to,
          weight: edgeWeight(entry.edge, options),
          edge: entry.edge,
        });
      }
    }
  }
  return result;
}

/**
 * Kruskal: O(E log E) sort (Array.prototype.sort, stable) dominates; then E union-find
 * operations at O(alpha(V)) each. Self-loops are skipped without touching the sets.
 */
function kruskal(graph: Graph, options?: MSTOptions): Edge[] {
  const view = buildAdjacency(graph, false);
  const edges = [...graph.edges()].map((edge) => {
    const from = view.index.get(edge.from);
    const to = view.index.get(edge.to);
    if (from === undefined || to === undefined) {
      throw new TypeError("Edge endpoint is not a vertex");
    }
    return {
      from,
      to,
      weight: edgeWeight(edge, options),
      edge,
    };
  });
  edges.sort((a, b) => a.weight - b.weight);
  const sets = new UnionFind(view.vertices.length);
  const result: Edge[] = [];
  for (const entry of edges) {
    if (entry.from === entry.to) {
      continue;
    }
    if (sets.union(entry.from, entry.to)) {
      result.push(entry.edge);
    }
  }
  return result;
}
