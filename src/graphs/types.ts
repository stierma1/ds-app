import type { Serializable } from "../core/index.ts";

/**
 * Vertex key. Representations key Maps by SameValueZero, so `1` and `"1"` are distinct
 * vertices and lookups are O(1) expected without any hashing of user objects.
 */
export type Vertex = string | number;

/**
 * Plain edge record. Representations store ONE object per logical edge and share it by
 * reference between both directions of an undirected graph, so `edges()` can dedupe by
 * identity and mutating `weight` on a returned edge is visible everywhere.
 */
export interface Edge<E = unknown> {
  from: Vertex;
  to: Vertex;
  weight: number;
  data?: E;
}

/**
 * Common graph contract. Costs depend entirely on the representation (see the class
 * comments on AdjacencyList, AdjacencyMatrix, CSR and EdgeList). Two properties hold for
 * all four: every Iterable returned by neighbors/incidentEdges/vertices/edges is an eager
 * snapshot (allocates its full length up front, safe to mutate during iteration), and every
 * algorithm in this module starts by calling vertices() and edges() once, so those two are
 * the costs a representation contributes to algorithm run time (O(V^2) for the matrix).
 */
export interface Graph<V = unknown, E = unknown> extends Serializable {
  readonly order: number;
  readonly size: number;
  readonly directed: boolean;
  addVertex(vertex: Vertex, data?: V): boolean;
  removeVertex(vertex: Vertex): boolean;
  hasVertex(vertex: Vertex): boolean;
  addEdge(from: Vertex, to: Vertex, weight?: number, data?: E): boolean;
  removeEdge(from: Vertex, to: Vertex): boolean;
  hasEdge(from: Vertex, to: Vertex): boolean;
  getEdge(from: Vertex, to: Vertex): Edge<E> | undefined;
  neighbors(vertex: Vertex): Iterable<Vertex>;
  incidentEdges(vertex: Vertex): Iterable<Edge<E>>;
  vertices(): Iterable<Vertex>;
  edges(): Iterable<Edge<E>>;
  degree(vertex: Vertex): number;
  inDegree(vertex: Vertex): number;
  outDegree(vertex: Vertex): number;
  transpose(): Graph<V, E>;
  clone(): Graph<V, E>;
  validate(): true | string;
}

/**
 * `directed` overrides graph.directed for one call (no copy is made). `weight` is called
 * once per oriented edge per pass; keep it O(1) because it sits inside every inner loop.
 */
export interface GraphAlgorithmOptions {
  directed?: boolean;
  weight?: (edge: Edge) => number;
}

/** `algorithm` defaults to "prim"; both are O(E log V). See minimumSpanningTree. */
export interface MSTOptions extends GraphAlgorithmOptions {
  algorithm?: "prim" | "kruskal";
}
