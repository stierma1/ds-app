import { AdjacencyList } from "./adjacency-list.ts";
import type { Graph } from "./types.ts";

/**
 * `graph` supplies the container to fill (default: a fresh AdjacencyList, where addEdge is
 * O(1)). Passing an EdgeList makes construction O(E^2) and an AdjacencyMatrix O(V^2),
 * because of their addEdge/addVertex costs. `weight` is called once per edge. `random`
 * (for randomGraph/randomDag) must return values in [0, 1); supply a seeded PRNG for
 * reproducible output, since the default is Math.random.
 */
export interface GraphGeneratorOptions {
  directed?: boolean;
  weight?: (from: number, to: number) => number;
  random?: () => number;
  graph?: Graph;
}

function requireInteger(value: number, name: string, minimum = 0): void {
  if (!Number.isInteger(value) || value < minimum) {
    throw new RangeError(`${name} must be an integer >= ${minimum}`);
  }
}

function createGraph(options?: GraphGeneratorOptions): Graph {
  return options?.graph ?? new AdjacencyList(options?.directed ?? false);
}

function addVertices(graph: Graph, count: number): void {
  for (let vertex = 0; vertex < count; vertex++) {
    graph.addVertex(vertex);
  }
}

function addEdge(
  graph: Graph,
  from: number,
  to: number,
  options?: GraphGeneratorOptions,
): void {
  const weight = options?.weight === undefined
    ? 1
    : options.weight(from, to);
  if (typeof weight !== "number" || !Number.isFinite(weight)) {
    throw new TypeError("generated edge weight must be a finite number");
  }
  graph.addEdge(from, to, weight);
}

function nextRandom(
  random: (() => number) | undefined,
): () => number {
  const source = random ?? Math.random;
  return () => {
    const value = source();
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value >= 1) {
      throw new RangeError("random source must return a number in [0, 1)");
    }
    return value;
  };
}

/**
 * V = order, E = order - 1. O(order) with the default container. Deterministic; vertices
 * are 0..order-1 with edges i -> i+1.
 */
export function pathGraph(
  order: number,
  options?: GraphGeneratorOptions,
): Graph {
  requireInteger(order, "order");
  const graph = createGraph(options);
  addVertices(graph, order);
  for (let vertex = 0; vertex + 1 < order; vertex++) {
    addEdge(graph, vertex, vertex + 1, options);
  }
  return graph;
}

/**
 * V = order, E = order for order > 2 (order 2: 1 undirected edge or 2 directed arcs; order
 * 0 or 1: no edges). O(order). Deterministic.
 */
export function cycleGraph(
  order: number,
  options?: GraphGeneratorOptions,
): Graph {
  requireInteger(order, "order");
  const graph = createGraph(options);
  addVertices(graph, order);
  for (let vertex = 0; vertex + 1 < order; vertex++) {
    addEdge(graph, vertex, vertex + 1, options);
  }
  if (order > 2) {
    addEdge(graph, order - 1, 0, options);
  } else if (graph.directed && order === 2) {
    addEdge(graph, 1, 0, options);
  }
  return graph;
}

/** V = order, E = order - 1, all incident to vertex 0. O(order). Deterministic. */
export function starGraph(
  order: number,
  options?: GraphGeneratorOptions,
): Graph {
  requireInteger(order, "order");
  const graph = createGraph(options);
  addVertices(graph, order);
  for (let vertex = 1; vertex < order; vertex++) {
    addEdge(graph, 0, vertex, options);
  }
  return graph;
}

/**
 * V = order, E = V(V-1)/2 undirected or V(V-1) directed, no self-loops. O(V^2) time and
 * output. Deterministic.
 */
export function completeGraph(
  order: number,
  options?: GraphGeneratorOptions,
): Graph {
  requireInteger(order, "order");
  const graph = createGraph(options);
  addVertices(graph, order);
  for (let from = 0; from < order; from++) {
    const first = graph.directed ? 0 : from + 1;
    for (let to = first; to < order; to++) {
      if (from !== to) {
        addEdge(graph, from, to, options);
      }
    }
  }
  return graph;
}

/**
 * V = leftSize + rightSize, E = leftSize * rightSize; left vertices are 0..leftSize-1.
 * O(leftSize * rightSize). Deterministic.
 */
export function completeBipartiteGraph(
  leftSize: number,
  rightSize: number,
  options?: GraphGeneratorOptions,
): Graph {
  requireInteger(leftSize, "leftSize");
  requireInteger(rightSize, "rightSize");
  const graph = createGraph(options);
  addVertices(graph, leftSize + rightSize);
  for (let left = 0; left < leftSize; left++) {
    for (let right = leftSize; right < leftSize + rightSize; right++) {
      addEdge(graph, left, right, options);
    }
  }
  return graph;
}

/**
 * V = rows * columns, E = 2*rows*columns - rows - columns (4-neighbour lattice); vertex
 * id is row * columns + column. O(rows * columns). Deterministic.
 */
export function gridGraph(
  rows: number,
  columns: number,
  options?: GraphGeneratorOptions,
): Graph {
  requireInteger(rows, "rows");
  requireInteger(columns, "columns");
  const graph = createGraph(options);
  addVertices(graph, rows * columns);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const vertex = row * columns + column;
      if (column + 1 < columns) {
        addEdge(graph, vertex, vertex + 1, options);
      }
      if (row + 1 < rows) {
        addEdge(graph, vertex, vertex + columns, options);
      }
    }
  }
  return graph;
}

/**
 * Erdos-Renyi G(V, p). ALWAYS O(V^2) time: every pair is drawn (twice per pair when
 * directed) with no geometric skipping, even for tiny p. Expected E = p*V(V-1)/2
 * (undirected) or p*V(V-1) (directed); worst-case output O(V^2). Deterministic only when
 * `options.random` is a seeded PRNG; by default it uses Math.random.
 */
export function randomGraph(
  order: number,
  probability: number,
  options?: GraphGeneratorOptions,
): Graph {
  requireInteger(order, "order");
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new RangeError("probability must be a number in [0, 1]");
  }
  const graph = createGraph(options);
  addVertices(graph, order);
  const random = nextRandom(options?.random);
  for (let from = 0; from < order; from++) {
    for (let to = from + 1; to < order; to++) {
      if (random() < probability) {
        addEdge(graph, from, to, options);
      }
      if (graph.directed && random() < probability) {
        addEdge(graph, to, from, options);
      }
    }
  }
  return graph;
}

/**
 * Random DAG: forces `directed: true` (throws TypeError if a supplied undirected `graph`
 * is passed) and only adds arcs from lower to higher index, so 0..V-1 is already a
 * topological order. O(V^2) draws regardless of p; expected E = p*V(V-1)/2. Deterministic
 * only with a seeded `options.random`.
 */
export function randomDag(
  order: number,
  probability: number,
  options?: GraphGeneratorOptions,
): Graph {
  requireInteger(order, "order");
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new RangeError("probability must be a number in [0, 1]");
  }
  const graph = createGraph({ ...options, directed: true });
  if (!graph.directed) {
    throw new TypeError("randomDag requires a directed graph");
  }
  addVertices(graph, order);
  const random = nextRandom(options?.random);
  for (let from = 0; from < order; from++) {
    for (let to = from + 1; to < order; to++) {
      if (random() < probability) {
        addEdge(graph, from, to, options);
      }
    }
  }
  return graph;
}
