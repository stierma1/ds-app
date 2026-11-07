import type {
  Graph,
  GraphAlgorithmOptions,
  Vertex,
} from "./types.ts";
import {
  buildAdjacency,
  edgeWeight,
  effectiveDirected,
  endpointIndex,
  MinHeap,
  orientedEdges,
} from "./shared.ts";

/**
 * Single-source shortest distances with a binary MinHeap and lazy deletion (no
 * decrease-key): O((V+E) log V) time, O(V+E) space (the heap can hold one entry per
 * relaxation, up to E). Precondition: non-negative weights, enforced by an up-front O(E)
 * scan (which also allocates an O(E) oriented-edge array and calls the weight selector a
 * second time per edge) that throws RangeError. Returns a Map over ALL V vertices with
 * Infinity for unreachable ones; there is no early exit for a target (use aStar with a zero
 * heuristic for that). Use bellmanFord when weights can be negative.
 */
export function dijkstra(
  graph: Graph,
  source: Vertex,
  options?: GraphAlgorithmOptions,
): Map<Vertex, number> {
  const view = buildAdjacency(graph, effectiveDirected(graph, options));
  const start = endpointIndex(view, source, "source");
  const edges = orientedEdges(view);
  for (const entry of edges) {
    if (edgeWeight(entry.edge, options) < 0) {
      throw new RangeError("dijkstra requires non-negative edge weights");
    }
  }
  const distances = new Float64Array(view.vertices.length);
  distances.fill(Infinity);
  distances[start] = 0;
  const heap = new MinHeap<{ vertex: number; distance: number }>((a, b) => {
    if (a.distance !== b.distance) {
      return a.distance - b.distance;
    }
    return a.vertex - b.vertex;
  });
  heap.push({ vertex: start, distance: 0 });
  while (!heap.isEmpty()) {
    const current = heap.pop()!;
    if (current.distance !== distances[current.vertex]) {
      continue;
    }
    for (const entry of view.out[current.vertex]) {
      const weight = edgeWeight(entry.edge, options);
      const next = current.distance + weight;
      if (next < distances[entry.to]) {
        distances[entry.to] = next;
        heap.push({ vertex: entry.to, distance: next });
      }
    }
  }
  const result = new Map<Vertex, number>();
  for (let i = 0; i < view.vertices.length; i++) {
    result.set(view.vertices[i], distances[i]);
  }
  return result;
}

/**
 * Single-source shortest distances allowing negative weights. O(V*E) worst case, O(V+E)
 * space; stops early once a full relaxation round changes nothing, so graphs whose shortest
 * paths use at most k edges finish in O(k*E). Weights are evaluated once per oriented edge
 * into a Float64Array before the rounds. Throws RangeError on a negative cycle reachable
 * from `source` (one extra O(E) pass). Roughly V/log V slower than dijkstra when weights
 * are non-negative.
 */
export function bellmanFord(
  graph: Graph,
  source: Vertex,
  options?: GraphAlgorithmOptions,
): Map<Vertex, number> {
  const view = buildAdjacency(graph, effectiveDirected(graph, options));
  const start = endpointIndex(view, source, "source");
  const edges = orientedEdges(view);
  const weights = edges.map((entry) => edgeWeight(entry.edge, options));
  const distances = new Float64Array(view.vertices.length);
  distances.fill(Infinity);
  distances[start] = 0;
  for (let round = 0; round < view.vertices.length - 1; round++) {
    let changed = false;
    for (let i = 0; i < edges.length; i++) {
      const entry = edges[i];
      if (distances[entry.from] === Infinity) {
        continue;
      }
      const next = distances[entry.from] + weights[i];
      if (next < distances[entry.to]) {
        distances[entry.to] = next;
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }
  for (let i = 0; i < edges.length; i++) {
    const entry = edges[i];
    if (distances[entry.from] === Infinity) {
      continue;
    }
    if (distances[entry.from] + weights[i] < distances[entry.to]) {
      throw new RangeError("graph contains a negative-weight cycle");
    }
  }
  const result = new Map<Vertex, number>();
  for (let i = 0; i < view.vertices.length; i++) {
    result.set(view.vertices[i], distances[i]);
  }
  return result;
}

/**
 * All-pairs shortest distances. O(V^3) time, O(V^2) space, returned as a V x V number
 * matrix indexed by the order of graph.vertices() (not a Map). Rows whose intermediate
 * distance is Infinity are skipped, which helps on sparse or disconnected inputs but does
 * not change the cubic bound. Negative weights are allowed but negative cycles are NOT
 * detected (the diagonal just goes negative). For a single source, dijkstra is
 * O((V+E) log V); V runs of it beat this whenever E << V^2.
 */
export function floydWarshall(
  graph: Graph,
  options?: GraphAlgorithmOptions,
): number[][] {
  const view = buildAdjacency(graph, effectiveDirected(graph, options));
  const count = view.vertices.length;
  const distances: number[][] = new Array(count);
  for (let i = 0; i < count; i++) {
    const row = new Array<number>(count).fill(Infinity);
    row[i] = 0;
    distances[i] = row;
  }
  for (const entry of orientedEdges(view)) {
    const weight = edgeWeight(entry.edge, options);
    if (weight < distances[entry.from][entry.to]) {
      distances[entry.from][entry.to] = weight;
    }
  }
  for (let k = 0; k < count; k++) {
    const through = distances[k];
    for (let i = 0; i < count; i++) {
      const toK = distances[i][k];
      if (toK === Infinity) {
        continue;
      }
      const row = distances[i];
      for (let j = 0; j < count; j++) {
        const candidate = toK + through[j];
        if (candidate < row[j]) {
          row[j] = candidate;
        }
      }
    }
  }
  return distances;
}

/**
 * Point-to-point shortest path ordered by f = g + heuristic, with a binary MinHeap, lazy
 * deletion and a closed set. Worst case equals dijkstra, O((V+E) log V) time and O(V+E)
 * space, but stops as soon as `target` is popped, so a good heuristic visits far fewer
 * vertices. Preconditions: non-negative weights (up-front O(E) check, RangeError) and a
 * finite non-negative heuristic; it must be consistent for the closed set to be safe, since
 * a closed vertex is never reopened. The heuristic is called once per heap push (up to E
 * times). Returns {Infinity, []} when unreachable; path reconstruction is O(path length).
 */
export function aStar(
  graph: Graph,
  source: Vertex,
  target: Vertex,
  heuristic: (v: Vertex) => number,
  options?: GraphAlgorithmOptions,
): { distance: number; path: Vertex[] } {
  if (typeof heuristic !== "function") {
    throw new TypeError("heuristic must be a function");
  }
  const view = buildAdjacency(graph, effectiveDirected(graph, options));
  const start = endpointIndex(view, source, "source");
  const goal = endpointIndex(view, target, "target");
  for (const entry of orientedEdges(view)) {
    if (edgeWeight(entry.edge, options) < 0) {
      throw new RangeError("aStar requires non-negative edge weights");
    }
  }
  const score = (index: number): number => {
    const value = heuristic(view.vertices[index]);
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new RangeError("heuristic must be a finite non-negative number");
    }
    return value;
  };
  if (start === goal) {
    return { distance: 0, path: [view.vertices[start]] };
  }
  const distances = new Float64Array(view.vertices.length);
  distances.fill(Infinity);
  distances[start] = 0;
  const cameFrom = new Int32Array(view.vertices.length);
  cameFrom.fill(-1);
  const closed = new Uint8Array(view.vertices.length);
  const heap = new MinHeap<{
    vertex: number;
    distance: number;
    estimate: number;
  }>((a, b) => {
    if (a.estimate !== b.estimate) {
      return a.estimate - b.estimate;
    }
    return a.vertex - b.vertex;
  });
  heap.push({
    vertex: start,
    distance: 0,
    estimate: score(start),
  });
  while (!heap.isEmpty()) {
    const current = heap.pop()!;
    if (current.distance !== distances[current.vertex]) {
      continue;
    }
    if (closed[current.vertex] === 1) {
      continue;
    }
    closed[current.vertex] = 1;
    if (current.vertex === goal) {
      break;
    }
    for (const entry of view.out[current.vertex]) {
      const next = current.distance + edgeWeight(entry.edge, options);
      if (next < distances[entry.to]) {
        distances[entry.to] = next;
        cameFrom[entry.to] = current.vertex;
        heap.push({
          vertex: entry.to,
          distance: next,
          estimate: next + score(entry.to),
        });
      }
    }
  }
  if (distances[goal] === Infinity) {
    return { distance: Infinity, path: [] };
  }
  const path: Vertex[] = [];
  let current = goal;
  while (current !== -1) {
    path.push(view.vertices[current]);
    if (current === start) {
      break;
    }
    current = cameFrom[current];
  }
  path.reverse();
  return { distance: distances[goal], path };
}
