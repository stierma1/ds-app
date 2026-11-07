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
