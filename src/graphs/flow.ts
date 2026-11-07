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

/**
 * `algorithm` defaults to "dinic" (O(V^2 E), O(E sqrt V) on unit capacities);
 * "edmonds-karp" is O(V E^2). Capacities come from edge.weight or `options.weight`.
 */
export interface MaxFlowOptions extends GraphAlgorithmOptions {
  algorithm?: "dinic" | "edmonds-karp";
}

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

/** BFS level graph over edges with residual capacity: O(V+E) per Dinic phase, iterative. */
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

/**
 * Dinic blocking flow, ITERATIVE: an explicit vertex/edge path stack with a per-vertex
 * current-arc cursor so each residual edge is examined O(1) times per phase, and a dead
 * end is pruned by setting its level to -1. After an augmentation the path is truncated at
 * the first saturated edge rather than restarted from the source. O(V*E) per phase.
 */
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

/**
 * O(V+E): fresh residual graph (two ResidualEdge objects per edge) built on every call;
 * requires a directed view and non-negative capacities (RangeError otherwise).
 */
function buildFlowResidual(
  graph: Graph,
  source: Vertex,
  sink: Vertex,
  options?: GraphAlgorithmOptions,
): { residual: ResidualEdge[][]; start: number; target: number } {
  if (!effectiveDirected(graph, options)) {
    throw new TypeError("maxFlow requires a directed graph");
  }
  const view = buildAdjacency(graph, true);
  const start = endpointIndex(view, source, "source");
  const target = endpointIndex(view, sink, "sink");
  const residual: ResidualEdge[][] = view.vertices.map(() => []);
  for (const entry of orientedEdges(view)) {
    const capacity = edgeWeight(entry.edge, options);
    if (capacity < 0) {
      throw new RangeError("maxFlow requires non-negative capacities");
    }
    addResidual(residual, entry.from, entry.to, capacity, 0);
  }
  return { residual, start, target };
}

/**
 * Edmonds-Karp max flow: O(V * E^2) worst case (at most O(V*E) augmentations, each an O(V+E)
 * BFS), O(V+E) space; iterative, allocating a parent array per augmentation. Requires a
 * directed graph and non-negative capacities. Simpler than Dinic but asymptotically slower;
 * prefer it only on tiny graphs or when a shortest-augmenting-path order matters. Returns
 * 0 immediately when source === sink.
 */
export function edmondsKarp(
  graph: Graph,
  source: Vertex,
  sink: Vertex,
  options?: GraphAlgorithmOptions,
): number {
  const { residual, start, target } = buildFlowResidual(
    graph,
    source,
    sink,
    options,
  );
  if (start === target) {
    return 0;
  }
  let total = 0;
  while (true) {
    const parent = new Array<
      { from: number; edge: ResidualEdge } | undefined
    >(residual.length);
    const seen = new Uint8Array(residual.length);
    seen[start] = 1;
    const queue: number[] = [start];
    let found = false;
    for (let head = 0; head < queue.length && !found; head++) {
      const current = queue[head];
      for (const edge of residual[current]) {
        if (edge.capacity <= 0 || seen[edge.to] === 1) {
          continue;
        }
        seen[edge.to] = 1;
        parent[edge.to] = { from: current, edge };
        if (edge.to === target) {
          found = true;
          break;
        }
        queue.push(edge.to);
      }
    }
    if (!found) {
      break;
    }
    let bottleneck = Infinity;
    for (let current = target; current !== start;) {
      const step = parent[current]!;
      if (step.edge.capacity < bottleneck) {
        bottleneck = step.edge.capacity;
      }
      current = step.from;
    }
    for (let current = target; current !== start;) {
      const step = parent[current]!;
      step.edge.capacity -= bottleneck;
      residual[step.edge.to][step.edge.rev].capacity += bottleneck;
      current = step.from;
    }
    total += bottleneck;
  }
  return total;
}

/**
 * Max flow, default Dinic: O(V^2 * E) general bound; O(E * sqrt(V)) on unit-capacity
 * networks (bipartite-matching reductions) and O(E * min(V^(2/3), sqrt(E))) on unit networks,
 * versus O(V * E^2) for `algorithm: "edmonds-karp"`. Each phase is one O(V+E) BFS plus
 * one iterative blocking flow; there are at most V-1 phases. O(V+E) space; the residual
 * graph is rebuilt on each call. Requires a directed graph and non-negative capacities.
 * Real-valued capacities work but can take many more phases than integer ones.
 */
export function maxFlow(
  graph: Graph,
  source: Vertex,
  sink: Vertex,
  options?: MaxFlowOptions,
): number {
  const algorithm = options?.algorithm ?? "dinic";
  if (algorithm !== "dinic" && algorithm !== "edmonds-karp") {
    throw new TypeError("algorithm must be 'dinic' or 'edmonds-karp'");
  }
  if (algorithm === "edmonds-karp") {
    return edmondsKarp(graph, source, sink, options);
  }
  const { residual, start, target } = buildFlowResidual(
    graph,
    source,
    sink,
    options,
  );
  if (start === target) {
    return 0;
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

/**
 * Bellman-Ford over the residual graph for Johnson potentials: O(V*E) worst case with early
 * exit, so negative edge costs are allowed; throws RangeError on a negative-cost cycle.
 */
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

/**
 * Successive shortest paths with Johnson potentials: one O(V*E) Bellman-Ford to initialise
 * potentials (so negative costs are accepted, negative cycles throw RangeError), then one
 * binary-heap Dijkstra on reduced costs, O((V+E) log V), per augmenting path. With integer
 * capacities the number of augmentations is at most the max-flow value F, giving
 * O(V*E + F*(V+E) log V): pseudo-polynomial, so large capacities on long paths are the
 * slow case. O(V+E) space. Cost per edge is `options.cost(edge)`, else `edge.data.cost`,
 * else 0; capacity is the edge weight. Respects `options.directed`: an undirected edge
 * becomes two independent arcs.
 */
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
