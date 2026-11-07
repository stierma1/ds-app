import type {
  Edge,
  Graph,
  GraphAlgorithmOptions,
  Vertex,
} from "./types.ts";

export type AnyEdge = Edge<unknown>;

export interface AdjacencyEntry {
  to: number;
  edge: AnyEdge;
}

/**
 * Index-based adjacency built once per algorithm call by buildAdjacency: O(V+E) memory,
 * with each undirected edge present in both `out` lists (2E entries).
 */
export interface AdjacencyView {
  vertices: Vertex[];
  index: Map<Vertex, number>;
  out: AdjacencyEntry[][];
  incoming: AdjacencyEntry[][];
  directed: boolean;
}

export interface OrientedEdge {
  from: number;
  to: number;
  edge: AnyEdge;
}

/**
 * O(n) eagerly: copies the source into an array, so the result is immune to later mutation
 * and each next() is O(1). Every graph iterable in this module goes through here.
 */
export function snapshotIterator<T>(values: Iterable<T>): IterableIterator<T> {
  const items = [...values];
  let index = 0;
  const iterator: IterableIterator<T> = {
    next(): IteratorResult<T> {
      if (index >= items.length) {
        return { done: true, value: undefined };
      }
      return { done: false, value: items[index++] };
    },
    [Symbol.iterator]() {
      return iterator;
    },
  };
  return iterator;
}

/** O(1). */
export function effectiveDirected(
  graph: Graph,
  options?: GraphAlgorithmOptions,
): boolean {
  return options?.directed ?? graph.directed;
}

/**
 * O(V+E) time and space, plus the cost of graph.vertices() and graph.edges() on the source
 * representation (O(V+E) for AdjacencyList/CSR/EdgeList, O(V^2) for AdjacencyMatrix). This
 * is the floor cost of every algorithm; the representation's neighbors()/hasEdge() speed is
 * irrelevant to algorithm run time. Undirected edges are inserted in both out lists.
 */
export function buildAdjacency(
  graph: Graph,
  directed: boolean,
): AdjacencyView {
  const vertices = [...graph.vertices()];
  const index = new Map<Vertex, number>();
  for (let i = 0; i < vertices.length; i++) {
    index.set(vertices[i], i);
  }
  const out: AdjacencyEntry[][] = vertices.map(() => []);
  const incoming: AdjacencyEntry[][] = vertices.map(() => []);
  const add = (from: number, to: number, edge: AnyEdge): void => {
    out[from].push({ to, edge });
    incoming[to].push({ to: from, edge });
  };
  for (const edge of graph.edges()) {
    const from = index.get(edge.from);
    const to = index.get(edge.to);
    if (from === undefined || to === undefined) {
      throw new TypeError("Edge endpoint is not a vertex");
    }
    add(from, to, edge);
    if (!directed && from !== to) {
      add(to, from, edge);
    }
  }
  return { vertices, index, out, incoming, directed };
}

/** O(E) allocation: flattens the out lists (2E entries for an undirected view). */
export function orientedEdges(view: AdjacencyView): OrientedEdge[] {
  const result: OrientedEdge[] = [];
  for (let from = 0; from < view.out.length; from++) {
    for (const entry of view.out[from]) {
      result.push({ from, to: entry.to, edge: entry.edge });
    }
  }
  return result;
}

/** O(1) Map lookup; throws RangeError for an unknown vertex. */
export function endpointIndex(
  view: AdjacencyView,
  vertex: Vertex,
  name = "vertex",
): number {
  const index = view.index.get(vertex);
  if (index === undefined) {
    throw new RangeError(`${name} is not in the graph`);
  }
  return index;
}

/** O(1) plus one call of the optional weight selector. */
export function edgeWeight(
  edge: AnyEdge,
  options?: GraphAlgorithmOptions,
): number {
  const value = options?.weight === undefined
    ? edge.weight
    : options.weight(edge);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError("Edge weight must be a finite number");
  }
  return value;
}

/** O(1): optional selector, else `data.cost` when numeric, else 0. */
export function edgeCost(
  edge: AnyEdge,
  select?: (edge: Edge) => number,
): number {
  if (select !== undefined) {
    const value = select(edge);
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TypeError("Edge cost must be a finite number");
    }
    return value;
  }
  const data = edge.data;
  if (
    data !== null &&
    typeof data === "object" &&
    "cost" in data &&
    typeof (data as { cost?: unknown }).cost === "number"
  ) {
    const value = (data as { cost: number }).cost;
    if (!Number.isFinite(value)) {
      throw new TypeError("Edge cost must be a finite number");
    }
    return value;
  }
  return 0;
}

/** O(1); omits the `data` key entirely when undefined to keep edge objects monomorphic. */
export function makeEdge<E>(
  from: Vertex,
  to: Vertex,
  weight?: number,
  data?: E,
): Edge<E> {
  let value = weight === undefined ? 1 : weight;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError("Edge weight must be a finite number");
  }
  if (data === undefined) {
    return { from, to, weight: value };
  }
  return { from, to, weight: value, data };
}

/** O(1). */
export function assertVertex(vertex: Vertex, name = "vertex"): void {
  if (typeof vertex !== "string" && typeof vertex !== "number") {
    throw new TypeError(`${name} must be a string or number`);
  }
  if (typeof vertex === "number" && !Number.isFinite(vertex)) {
    throw new TypeError(`${name} must be finite`);
  }
}

/** O(n) via a Set keyed by object identity; preserves first-seen order and allocates. */
export function uniqueEdges(edges: Iterable<AnyEdge>): AnyEdge[] {
  return [...new Set(edges)];
}

/**
 * Binary min-heap over a plain array with a caller-supplied comparator.
 *
 * push/pop are O(log n) worst case, peek O(1). There is NO decrease-key: Dijkstra, A*,
 * Prim and min-cost flow use lazy deletion (push a fresh entry on every relaxation and skip
 * stale ones on pop), so the heap holds up to O(E) entries and their bounds are
 * O(E log E) = O(E log V) rather than the O(E + V log V) of a Fibonacci heap.
 * Sift steps swap via array destructuring, which costs a small temporary per level.
 */
export class MinHeap<T> {
  private readonly _items: T[] = [];
  private readonly _compare: (a: T, b: T) => number;

  constructor(compare: (a: T, b: T) => number) {
    this._compare = compare;
  }

  get size(): number {
    return this._items.length;
  }

  isEmpty(): boolean {
    return this._items.length === 0;
  }

  /** O(log n): append and sift up. */
  push(value: T): void {
    const items = this._items;
    items.push(value);
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this._compare(items[index], items[parent]) >= 0) {
        break;
      }
      [items[index], items[parent]] = [items[parent], items[index]];
      index = parent;
    }
  }

  /** O(log n): move the last item to the root and sift down; undefined when empty. */
  pop(): T | undefined {
    const items = this._items;
    if (items.length === 0) {
      return undefined;
    }
    const result = items[0];
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < items.length && this._compare(items[left], items[smallest]) < 0) {
          smallest = left;
        }
        if (right < items.length && this._compare(items[right], items[smallest]) < 0) {
          smallest = right;
        }
        if (smallest === index) {
          break;
        }
        [items[index], items[smallest]] = [items[smallest], items[index]];
        index = smallest;
      }
    }
    return result;
  }

  /** O(1). */
  peek(): T | undefined {
    return this._items[0];
  }
}

/**
 * Disjoint-set forest over two Int32Arrays (parent, rank) of fixed size n.
 *
 * find/union are O(alpha(n)) amortized (effectively constant) thanks to union by rank plus
 * full path compression, done iteratively in two passes so deep chains cannot overflow the
 * call stack. Capacity is fixed at construction: there is no makeSet, so index sets must be
 * known up front (Kruskal sizes it to V). Memory is 8 bytes per element.
 */
export class UnionFind {
  private readonly _parent: Int32Array;
  private readonly _rank: Int32Array;

  constructor(size: number) {
    this._parent = new Int32Array(size);
    this._rank = new Int32Array(size);
    for (let i = 0; i < size; i++) {
      this._parent[i] = i;
    }
  }

  /** O(alpha(n)) amortized; iterative two-pass path compression, O(depth) on the first touch. */
  find(value: number): number {
    let root = value;
    while (this._parent[root] !== root) {
      root = this._parent[root];
    }
    let current = value;
    while (this._parent[current] !== root) {
      const next = this._parent[current];
      this._parent[current] = root;
      current = next;
    }
    return root;
  }

  /** O(alpha(n)) amortized (two finds + O(1) link); false when already in the same set. */
  union(a: number, b: number): boolean {
    let left = this.find(a);
    let right = this.find(b);
    if (left === right) {
      return false;
    }
    if (this._rank[left] < this._rank[right]) {
      [left, right] = [right, left];
    }
    this._parent[right] = left;
    if (this._rank[left] === this._rank[right]) {
      this._rank[left]++;
    }
    return true;
  }
}
