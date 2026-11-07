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
