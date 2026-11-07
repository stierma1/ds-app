import type {
  Graph,
  GraphAlgorithmOptions,
  Vertex,
} from "./types.ts";
import {
  buildAdjacency,
  effectiveDirected,
  endpointIndex,
} from "./shared.ts";

/**
 * Breadth-first order from `start`. O(V+E) time and space (buildAdjacency plus a visited
 * bitmap). Iterative: the queue is an array read by a moving head index, so there is no
 * O(n) shift() per dequeue. Only vertices reachable from `start` are returned; weights are
 * ignored. Respects `options.directed`.
 */
export function bfs(
  graph: Graph,
  start: Vertex,
  options?: GraphAlgorithmOptions,
): Vertex[] {
  const view = buildAdjacency(graph, effectiveDirected(graph, options));
  const source = endpointIndex(view, start, "start");
  const visited = new Uint8Array(view.vertices.length);
  const queue: number[] = [source];
  visited[source] = 1;
  const result: Vertex[] = [];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    result.push(view.vertices[current]);
    for (const entry of view.out[current]) {
      if (visited[entry.to] === 0) {
        visited[entry.to] = 1;
        queue.push(entry.to);
      }
    }
  }
  return result;
}

/**
 * Depth-first preorder from `start`. O(V+E) time and space. ITERATIVE with an explicit
 * stack, so deep or long-path graphs cannot overflow the call stack. Neighbors are pushed
 * in reverse so the visit order matches the recursive formulation, and vertices are marked
 * at push time so the stack never exceeds V entries. Respects `options.directed`.
 */
export function dfs(
  graph: Graph,
  start: Vertex,
  options?: GraphAlgorithmOptions,
): Vertex[] {
  const view = buildAdjacency(graph, effectiveDirected(graph, options));
  const source = endpointIndex(view, start, "start");
  const visited = new Uint8Array(view.vertices.length);
  const stack: number[] = [source];
  visited[source] = 1;
  const result: Vertex[] = [];
  while (stack.length > 0) {
    const current = stack.pop()!;
    result.push(view.vertices[current]);
    const edges = view.out[current];
    for (let i = edges.length - 1; i >= 0; i--) {
      const next = edges[i].to;
      if (visited[next] === 0) {
        visited[next] = 1;
        stack.push(next);
      }
    }
  }
  return result;
}

/**
 * Components of the UNDIRECTED view of the graph (direction and `options` are ignored, so a
 * directed graph yields weakly connected components; use stronglyConnectedComponents for
 * strong ones). O(V+E) time and space; iterative BFS from each unvisited vertex, with
 * components emitted in vertex insertion order.
 */
export function connectedComponents(
  graph: Graph,
  _options?: GraphAlgorithmOptions,
): Vertex[][] {
  const view = buildAdjacency(graph, false);
  const visited = new Uint8Array(view.vertices.length);
  const components: Vertex[][] = [];
  for (let start = 0; start < view.vertices.length; start++) {
    if (visited[start] !== 0) {
      continue;
    }
    const component: Vertex[] = [];
    const queue: number[] = [start];
    visited[start] = 1;
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head];
      component.push(view.vertices[current]);
      for (const entry of view.out[current]) {
        if (visited[entry.to] === 0) {
          visited[entry.to] = 1;
          queue.push(entry.to);
        }
      }
    }
    components.push(component);
  }
  return components;
}

/**
 * Kahn's algorithm: O(V+E) time and space, iterative (in-degree array plus an array queue),
 * no recursion. Requires a directed graph (TypeError otherwise). A cycle is only detected
 * after the full pass, by comparing output length to V, and throws RangeError; there is no
 * early exit. Ties are broken by vertex insertion order, so output is deterministic.
 */
export function topologicalSort(
  graph: Graph,
  options?: GraphAlgorithmOptions,
): Vertex[] {
  const directed = effectiveDirected(graph, options);
  if (!directed) {
    throw new TypeError("topologicalSort requires a directed graph");
  }
  const view = buildAdjacency(graph, true);
  const indegree = new Int32Array(view.vertices.length);
  for (const entries of view.out) {
    for (const entry of entries) {
      indegree[entry.to]++;
    }
  }
  const queue: number[] = [];
  for (let i = 0; i < indegree.length; i++) {
    if (indegree[i] === 0) {
      queue.push(i);
    }
  }
  const result: Vertex[] = [];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    result.push(view.vertices[current]);
    for (const entry of view.out[current]) {
      indegree[entry.to]--;
      if (indegree[entry.to] === 0) {
        queue.push(entry.to);
      }
    }
  }
  if (result.length !== view.vertices.length) {
    throw new RangeError("graph contains a directed cycle");
  }
  return result;
}
