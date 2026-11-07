import type { Serializable } from "../core/index.ts";

export type Vertex = string | number;

export interface Edge<E = unknown> {
  from: Vertex;
  to: Vertex;
  weight: number;
  data?: E;
}

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

export interface GraphAlgorithmOptions {
  directed?: boolean;
  weight?: (edge: Edge) => number;
}

export interface MSTOptions extends GraphAlgorithmOptions {
  algorithm?: "prim" | "kruskal";
}
