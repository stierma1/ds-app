import type {
  Edge,
  Graph,
  GraphAlgorithmOptions,
  Vertex,
} from "./types.ts";
import {
  buildAdjacency,
  edgeCost,
  edgeWeight,
  effectiveDirected,
  endpointIndex,
  MinHeap,
  orientedEdges,
} from "./shared.ts";

interface ResidualEdge {
  to: number;
  rev: number;
  capacity: number;
  cost: number;
}

type MinCostOptions = GraphAlgorithmOptions & {
  cost?: (edge: Edge) => number;
};

function addResidual(
  residual: ResidualEdge[][],
  from: number,
  to: number,
  capacity: number,
  cost: number,
): void {
  const forwardRev = residual[to].length + (from === to ? 1 : 0);
  const backwardRev = residual[from].length;
  residual[from].push({
    to,
    rev: forwardRev,
    capacity,
    cost,
  });
  residual[to].push({
    to: from,
    rev: backwardRev,
    capacity: 0,
    cost: -cost,
  });
}

function buildLevels(
  residual: ResidualEdge[][],
  source: number,
  sink: number,
): Int32Array | undefined {
  const level = new Int32Array(residual.length);
  level.fill(-1);
  level[source] = 0;
  const queue: number[] = [source];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    for (const edge of residual[current]) {
      if (edge.capacity > 0 && level[edge.to] === -1) {
        level[edge.to] = level[current] + 1;
        queue.push(edge.to);
      }
    }
  }
  return level[sink] === -1 ? undefined : level;
}

function blockingFlow(
  residual: ResidualEdge[][],
  level: Int32Array,
  source: number,
  sink: number,
): number {
  const cursor = new Int32Array(residual.length);
  const vertices: number[] = [source];
  const path: ResidualEdge[] = [];
  let flow = 0;
  while (vertices.length > 0) {
    const current = vertices[vertices.length - 1];
    if (current === sink) {
      let bottleneck = Infinity;
      for (const edge of path) {
        if (edge.capacity < bottleneck) {
          bottleneck = edge.capacity;
        }
      }
      for (const edge of path) {
        edge.capacity -= bottleneck;
        residual[edge.to][edge.rev].capacity += bottleneck;
      }
      flow += bottleneck;
      let cut = 0;
      while (cut < path.length && path[cut].capacity > 0) {
        cut++;
      }
      if (cut === path.length) {
        break;
      }
      path.length = cut;
      vertices.length = cut + 1;
      continue;
    }
    let advanced = false;
    while (cursor[current] < residual[current].length) {
      const edge = residual[current][cursor[current]];
      if (edge.capacity > 0 && level[edge.to] === level[current] + 1) {
        vertices.push(edge.to);
        path.push(edge);
        advanced = true;
        break;
      }
      cursor[current]++;
    }
    if (!advanced) {
      level[current] = -1;
      vertices.pop();
      if (path.length > 0) {
        path.pop();
        const parent = vertices[vertices.length - 1];
        cursor[parent]++;
      }
    }
  }
  return flow;
}

export function maxFlow(
  graph: Graph,
  source: Vertex,
  sink: Vertex,
  options?: GraphAlgorithmOptions,
): number {
  if (!effectiveDirected(graph, options)) {
    throw new TypeError("maxFlow requires a directed graph");
  }
  const view = buildAdjacency(graph, true);
  const start = endpointIndex(view, source, "source");
  const target = endpointIndex(view, sink, "sink");
  if (start === target) {
    return 0;
  }
  const residual: ResidualEdge[][] = view.vertices.map(() => []);
  for (const entry of orientedEdges(view)) {
    const capacity = edgeWeight(entry.edge, options);
    if (capacity < 0) {
      throw new RangeError("maxFlow requires non-negative capacities");
    }
    addResidual(residual, entry.from, entry.to, capacity, 0);
  }
  let total = 0;
  while (true) {
    const level = buildLevels(residual, start, target);
    if (level === undefined) {
      break;
    }
    const flow = blockingFlow(residual, level, start, target);
    if (flow === 0) {
      break;
    }
    total += flow;
  }
  return total;
}

function initialPotentials(
  residual: ResidualEdge[][],
  source: number,
): Float64Array {
  const count = residual.length;
  const distance = new Float64Array(count);
  distance.fill(Infinity);
  distance[source] = 0;
  for (let round = 0; round < count - 1; round++) {
    let changed = false;
    for (let from = 0; from < count; from++) {
      if (distance[from] === Infinity) {
        continue;
      }
      for (const edge of residual[from]) {
        if (edge.capacity <= 0) {
          continue;
        }
        const next = distance[from] + edge.cost;
        if (next < distance[edge.to]) {
          distance[edge.to] = next;
          changed = true;
        }
      }
    }
    if (!changed) {
      break;
    }
  }
  for (let from = 0; from < count; from++) {
    if (distance[from] === Infinity) {
      continue;
    }
    for (const edge of residual[from]) {
      if (edge.capacity > 0 && distance[from] + edge.cost < distance[edge.to]) {
        throw new RangeError("graph contains a negative-cost cycle");
      }
    }
  }
  const potentials = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    potentials[i] = distance[i] === Infinity ? 0 : distance[i];
  }
  return potentials;
}

export function minCostMaxFlow(
  graph: Graph,
  source: Vertex,
  sink: Vertex,
  options?: MinCostOptions,
): { flow: number; cost: number } {
  const view = buildAdjacency(
    graph,
    effectiveDirected(graph, options),
  );
  const start = endpointIndex(view, source, "source");
  const target = endpointIndex(view, sink, "sink");
  if (start === target) {
    return { flow: 0, cost: 0 };
  }
  const residual: ResidualEdge[][] = view.vertices.map(() => []);
  for (const entry of orientedEdges(view)) {
    const capacity = edgeWeight(entry.edge, options);
    if (capacity < 0) {
      throw new RangeError("minCostMaxFlow requires non-negative capacities");
    }
    const cost = edgeCost(entry.edge, options?.cost);
    addResidual(residual, entry.from, entry.to, capacity, cost);
  }
  const potentials = initialPotentials(residual, start);
  let totalFlow = 0;
  let totalCost = 0;
  while (true) {
    const distance = new Float64Array(view.vertices.length);
    distance.fill(Infinity);
    distance[start] = 0;
    const parent = new Array<
      { from: number; edge: ResidualEdge } | undefined
    >(view.vertices.length);
    const heap = new MinHeap<{ vertex: number; distance: number }>((a, b) => {
      if (a.distance !== b.distance) {
        return a.distance - b.distance;
      }
      return a.vertex - b.vertex;
    });
    heap.push({ vertex: start, distance: 0 });
    while (!heap.isEmpty()) {
      const current = heap.pop()!;
      if (current.distance !== distance[current.vertex]) {
        continue;
      }
      for (const edge of residual[current.vertex]) {
        if (edge.capacity <= 0) {
          continue;
        }
        const reduced =
          edge.cost +
          potentials[current.vertex] -
          potentials[edge.to];
        const next = current.distance + reduced;
        if (next < distance[edge.to]) {
          distance[edge.to] = next;
          parent[edge.to] = { from: current.vertex, edge };
          heap.push({ vertex: edge.to, distance: next });
        }
      }
    }
    if (distance[target] === Infinity) {
      break;
    }
    for (let i = 0; i < distance.length; i++) {
      if (distance[i] !== Infinity) {
        potentials[i] += distance[i];
      }
    }
    let bottleneck = Infinity;
    let pathCost = 0;
    let current = target;
    while (current !== start) {
      const step = parent[current];
      if (step === undefined) {
        bottleneck = 0;
        break;
      }
      if (step.edge.capacity < bottleneck) {
        bottleneck = step.edge.capacity;
      }
      pathCost += step.edge.cost;
      current = step.from;
    }
    if (bottleneck === 0 || bottleneck === Infinity) {
      break;
    }
    current = target;
    while (current !== start) {
      const step = parent[current]!;
      step.edge.capacity -= bottleneck;
      residual[step.edge.to][step.edge.rev].capacity += bottleneck;
      current = step.from;
    }
    totalFlow += bottleneck;
    totalCost += bottleneck * pathCost;
  }
  return { flow: totalFlow, cost: totalCost };
}
