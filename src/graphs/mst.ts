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
