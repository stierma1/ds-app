import type { Edge, Graph, Vertex } from "./types.ts";
import { buildAdjacency } from "./shared.ts";

export function bipartiteMatching(
  graph: Graph,
  left: Iterable<Vertex>,
): Edge[] {
  const view = buildAdjacency(graph, false);
  const leftVertices: Vertex[] = [];
  const leftIndex = new Map<Vertex, number>();
  for (const vertex of left) {
    if (!view.index.has(vertex)) {
      throw new RangeError("left vertex is not in the graph");
    }
    if (!leftIndex.has(vertex)) {
      leftIndex.set(vertex, leftVertices.length);
      leftVertices.push(vertex);
    }
  }
  const rightIndex = new Map<number, number>();
  const rightVertices: number[] = [];
  for (let i = 0; i < view.vertices.length; i++) {
    if (!leftIndex.has(view.vertices[i])) {
      rightIndex.set(i, rightVertices.length);
      rightVertices.push(i);
    }
  }
  const adjacency: Array<Array<{ v: number; edge: Edge }>> =
    leftVertices.map(() => []);
  const seen = new Set<string>();
  for (const edge of graph.edges()) {
    const from = view.index.get(edge.from);
    const to = view.index.get(edge.to);
    if (from === undefined || to === undefined) {
      throw new TypeError("Edge endpoint is not a vertex");
    }
    let u: number | undefined;
    let v: number | undefined;
    if (leftIndex.has(edge.from) && !leftIndex.has(edge.to)) {
      u = leftIndex.get(edge.from);
      v = rightIndex.get(to);
    } else if (leftIndex.has(edge.to) && !leftIndex.has(edge.from)) {
      u = leftIndex.get(edge.to);
      v = rightIndex.get(from);
    }
    if (u === undefined || v === undefined) {
      continue;
    }
    const key = `${u}:${v}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    adjacency[u].push({ v, edge });
  }
  const leftCount = leftVertices.length;
  const rightCount = rightVertices.length;
  const pairLeft = new Int32Array(leftCount);
  pairLeft.fill(-1);
  const pairRight = new Int32Array(rightCount);
  pairRight.fill(-1);
  const distance = new Int32Array(leftCount);
  const matchedEdge: Array<Edge | undefined> = new Array(leftCount);

  const findLayers = (): boolean => {
    const queue: number[] = [];
    let found = false;
    for (let u = 0; u < leftCount; u++) {
      if (pairLeft[u] === -1) {
        distance[u] = 0;
        queue.push(u);
      } else {
        distance[u] = -1;
      }
    }
    for (let head = 0; head < queue.length; head++) {
      const u = queue[head];
      for (const { v } of adjacency[u]) {
        const matched = pairRight[v];
        if (matched === -1) {
          found = true;
        } else if (distance[matched] === -1) {
          distance[matched] = distance[u] + 1;
          queue.push(matched);
        }
      }
    }
    return found;
  };

  const augment = (start: number): boolean => {
    const stackLeft: number[] = [start];
    const cursor: number[] = [0];
    const chosenV: number[] = [];
    const chosenEdge: Edge[] = [];
    while (stackLeft.length > 0) {
      const u = stackLeft[stackLeft.length - 1];
      if (cursor[cursor.length - 1] >= adjacency[u].length) {
        distance[u] = -1;
        stackLeft.pop();
        cursor.pop();
        chosenV.length = Math.max(0, stackLeft.length - 1);
        chosenEdge.length = Math.max(0, stackLeft.length - 1);
        continue;
      }
      const entry = adjacency[u][cursor[cursor.length - 1]++];
      if (pairRight[entry.v] === -1) {
        let currentV = entry.v;
        let currentEdge = entry.edge;
        for (let i = stackLeft.length - 1; i >= 0; i--) {
          pairLeft[stackLeft[i]] = currentV;
          pairRight[currentV] = stackLeft[i];
          matchedEdge[stackLeft[i]] = currentEdge;
          if (i > 0) {
            currentV = chosenV[i - 1];
            currentEdge = chosenEdge[i - 1];
          }
        }
        return true;
      }
      const next = pairRight[entry.v];
      if (distance[next] === distance[u] + 1) {
        stackLeft.push(next);
        cursor.push(0);
        chosenV.push(entry.v);
        chosenEdge.push(entry.edge);
      }
    }
    return false;
  };

  while (findLayers()) {
    for (let u = 0; u < leftCount; u++) {
      if (pairLeft[u] === -1) {
        augment(u);
      }
    }
  }
  const result: Edge[] = [];
  for (let u = 0; u < leftCount; u++) {
    const edge = matchedEdge[u];
    if (pairLeft[u] !== -1 && edge !== undefined) {
      result.push(edge);
    }
  }
  return result;
}
