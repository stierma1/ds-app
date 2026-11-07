import type {
  Edge,
  Graph,
  GraphAlgorithmOptions,
  Vertex,
} from "./types.ts";
import {
  buildAdjacency,
  effectiveDirected,
  orientedEdges,
} from "./shared.ts";

/**
 * Tarjan's SCC. O(V+E) time and space, ITERATIVE: an explicit frame stack (vertex + next
 * edge cursor) replaces recursion, so graphs with million-vertex chains are safe. Uses
 * graph.directed (no options); on an undirected graph each connected component is one SCC.
 * Components are emitted in reverse topological order of the condensation DAG (a sink SCC
 * first), which callers can rely on instead of sorting.
 */
export function stronglyConnectedComponents(graph: Graph): Vertex[][] {
  const view = buildAdjacency(graph, graph.directed);
  const count = view.vertices.length;
  const discovery = new Int32Array(count);
  discovery.fill(-1);
  const low = new Int32Array(count);
  const onStack = new Uint8Array(count);
  const stack: number[] = [];
  const components: Vertex[][] = [];
  let timer = 0;
  for (let root = 0; root < count; root++) {
    if (discovery[root] !== -1) {
      continue;
    }
    discovery[root] = timer;
    low[root] = timer;
    timer++;
    stack.push(root);
    onStack[root] = 1;
    const frames: Array<{ vertex: number; edge: number }> = [
      { vertex: root, edge: 0 },
    ];
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const entries = view.out[frame.vertex];
      if (frame.edge < entries.length) {
        const next = entries[frame.edge++].to;
        if (discovery[next] === -1) {
          discovery[next] = timer;
          low[next] = timer;
          timer++;
          stack.push(next);
          onStack[next] = 1;
          frames.push({ vertex: next, edge: 0 });
        } else if (onStack[next] === 1 && discovery[next] < low[frame.vertex]) {
          low[frame.vertex] = discovery[next];
        }
        continue;
      }
      frames.pop();
      if (frames.length > 0) {
        const parent = frames[frames.length - 1].vertex;
        if (low[frame.vertex] < low[parent]) {
          low[parent] = low[frame.vertex];
        }
      }
      if (low[frame.vertex] === discovery[frame.vertex]) {
        const component: Vertex[] = [];
        while (true) {
          const member = stack.pop()!;
          onStack[member] = 0;
          component.push(view.vertices[member]);
          if (member === frame.vertex) {
            break;
          }
        }
        components.push(component);
      }
    }
  }
  return components;
}

interface LowlinkResult {
  bridges: Edge[];
  articulationPoints: Vertex[];
  biconnectedComponents: Edge[][];
}

/**
 * Shared iterative lowlink DFS for undirected graphs: one O(V+E) pass computes bridges,
 * articulation points and biconnected components together. Each public wrapper below runs
 * the full pass and discards the other two results, so calling all three costs three passes.
 * Parent edges are skipped by Edge identity (not by vertex), and self-loops become their
 * own single-edge component.
 */
function lowlink(graph: Graph): LowlinkResult {
  if (graph.directed) {
    throw new TypeError("operation requires an undirected graph");
  }
  const view = buildAdjacency(graph, false);
  const count = view.vertices.length;
  const discovery = new Int32Array(count);
  discovery.fill(-1);
  const low = new Int32Array(count);
  const parent = new Int32Array(count);
  parent.fill(-1);
  const parentEdge: Array<Edge | undefined> = new Array(count);
  const articulation = new Set<number>();
  const bridges: Edge[] = [];
  const components: Edge[][] = [];
  const edgeStack: Edge[] = [];
  let timer = 0;
  for (let root = 0; root < count; root++) {
    if (discovery[root] !== -1) {
      continue;
    }
    discovery[root] = timer;
    low[root] = timer;
    timer++;
    const frames: Array<{
      vertex: number;
      next: number;
      children: number;
    }> = [{ vertex: root, next: 0, children: 0 }];
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const entries = view.out[frame.vertex];
      if (frame.next < entries.length) {
        const entry = entries[frame.next++];
        if (entry.edge === parentEdge[frame.vertex]) {
          continue;
        }
        const next = entry.to;
        if (discovery[next] === -1) {
          frame.children++;
          parent[next] = frame.vertex;
          parentEdge[next] = entry.edge;
          discovery[next] = timer;
          low[next] = timer;
          timer++;
          edgeStack.push(entry.edge);
          frames.push({ vertex: next, next: 0, children: 0 });
        } else if (next === frame.vertex) {
          components.push([entry.edge]);
        } else if (discovery[next] < discovery[frame.vertex]) {
          edgeStack.push(entry.edge);
          if (discovery[next] < low[frame.vertex]) {
            low[frame.vertex] = discovery[next];
          }
        }
        continue;
      }
      frames.pop();
      const vertex = frame.vertex;
      if (parent[vertex] === -1) {
        if (frame.children > 1) {
          articulation.add(vertex);
        }
        if (edgeStack.length > 0) {
          components.push(edgeStack.splice(0, edgeStack.length));
        }
        continue;
      }
      const parentVertex = parent[vertex];
      if (low[vertex] < low[parentVertex]) {
        low[parentVertex] = low[vertex];
      }
      if (low[vertex] > discovery[parentVertex]) {
        bridges.push(parentEdge[vertex]!);
      }
      if (low[vertex] >= discovery[parentVertex]) {
        if (parent[parentVertex] !== -1) {
          articulation.add(parentVertex);
        }
        const component: Edge[] = [];
        while (edgeStack.length > 0) {
          const edge = edgeStack.pop()!;
          component.push(edge);
          if (edge === parentEdge[vertex]) {
            break;
          }
        }
        if (component.length > 0) {
          components.push(component);
        }
      }
    }
  }
  return {
    bridges,
    articulationPoints: view.vertices.filter((_, index) =>
      articulation.has(index)
    ),
    biconnectedComponents: components,
  };
}

/** O(V+E), iterative (explicit stack). Throws TypeError on a directed graph. */
export function bridges(graph: Graph): Edge[] {
  return lowlink(graph).bridges;
}

/**
 * O(V+E), iterative; the result is filtered into vertex insertion order (an extra O(V)).
 * Throws TypeError on a directed graph.
 */
export function articulationPoints(graph: Graph): Vertex[] {
  return lowlink(graph).articulationPoints;
}

/**
 * O(V+E), iterative; returns edge groups, with bridges as single-edge components.
 * Throws TypeError on a directed graph.
 */
export function biconnectedComponents(graph: Graph): Edge[][] {
  return lowlink(graph).biconnectedComponents;
}

/**
 * Hierholzer's algorithm, ITERATIVE (explicit vertex stack plus per-vertex edge cursors).
 * O(V+E) time and space, but with a high constant: it builds the directed view, an
 * undirected view for the connectivity check, and a third per-edge-id adjacency. Returns an
 * Euler circuit when one exists, otherwise a path, [] for an edgeless graph, and undefined
 * when the degree conditions fail or the non-isolated vertices are not connected (both
 * checked up front before any walking). Respects `options.directed`.
 */
export function eulerPath(
  graph: Graph,
  options?: GraphAlgorithmOptions,
): Vertex[] | undefined {
  const directed = effectiveDirected(graph, options);
  const view = buildAdjacency(graph, directed);
  const count = view.vertices.length;
  const edges = [...graph.edges()];
  if (edges.length === 0) {
    return [];
  }
  const outward = new Int32Array(count);
  const inward = new Int32Array(count);
  const undirectedDegree = new Int32Array(count);
  const oriented = orientedEdges(view);
  for (const entry of oriented) {
    outward[entry.from]++;
    inward[entry.to]++;
  }
  for (const edge of edges) {
    const from = view.index.get(edge.from);
    const to = view.index.get(edge.to);
    if (from === undefined || to === undefined) {
      throw new TypeError("Edge endpoint is not a vertex");
    }
    if (from === to) {
      undirectedDegree[from] += 2;
    } else {
      undirectedDegree[from]++;
      undirectedDegree[to]++;
    }
  }
  let start = -1;
  if (directed) {
    let starts = 0;
    let ends = 0;
    for (let i = 0; i < count; i++) {
      const difference = outward[i] - inward[i];
      if (difference === 1) {
        if (starts > 0) {
          return undefined;
        }
        starts++;
        start = i;
      } else if (difference === -1) {
        ends++;
      } else if (difference !== 0) {
        return undefined;
      }
    }
    if (starts !== ends) {
      return undefined;
    }
    if (starts === 0) {
      start = -1;
      for (let i = 0; i < count; i++) {
        if (outward[i] > 0) {
          start = i;
          break;
        }
      }
      if (start === -1) {
        return undefined;
      }
    }
  } else {
    const odd: number[] = [];
    for (let i = 0; i < count; i++) {
      if (undirectedDegree[i] % 2 === 1) {
        odd.push(i);
      }
    }
    if (odd.length !== 0 && odd.length !== 2) {
      return undefined;
    }
    if (odd.length === 2) {
      start = odd[0];
    } else {
      start = -1;
      for (let i = 0; i < count; i++) {
        if (undirectedDegree[i] > 0) {
          start = i;
          break;
        }
      }
    }
  }
  if (start === -1) {
    return undefined;
  }
  const underlying = buildAdjacency(graph, false);
  const seen = new Uint8Array(count);
  const queue: number[] = [start];
  seen[start] = 1;
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    for (const entry of underlying.out[current]) {
      if (seen[entry.to] === 0) {
        seen[entry.to] = 1;
        queue.push(entry.to);
      }
    }
  }
  for (let i = 0; i < count; i++) {
    if (undirectedDegree[i] > 0 && seen[i] === 0) {
      return undefined;
    }
  }
  const adjacency: Array<Array<{ to: number; edge: number }>> = [];
  for (let i = 0; i < count; i++) {
    adjacency.push([]);
  }
  for (let id = 0; id < edges.length; id++) {
    const edge = edges[id];
    const from = view.index.get(edge.from);
    const to = view.index.get(edge.to);
    if (from === undefined || to === undefined) {
      throw new TypeError("Edge endpoint is not a vertex");
    }
    adjacency[from].push({ to, edge: id });
    if (!directed && from !== to) {
      adjacency[to].push({ to: from, edge: id });
    }
  }
  const used = new Uint8Array(edges.length);
  const cursor = new Int32Array(count);
  const stack: number[] = [start];
  const circuit: number[] = [];
  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    let advanced = false;
    while (cursor[current] < adjacency[current].length) {
      const entry = adjacency[current][cursor[current]++];
      if (used[entry.edge] === 1) {
        continue;
      }
      used[entry.edge] = 1;
      stack.push(entry.to);
      advanced = true;
      break;
    }
    if (!advanced) {
      circuit.push(stack.pop()!);
    }
  }
  if (circuit.length !== edges.length + 1) {
    return undefined;
  }
  circuit.reverse();
  return circuit.map((index) => view.vertices[index]);
}
