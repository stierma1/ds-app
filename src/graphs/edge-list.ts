import type { Edge, Graph, Vertex } from "./types.ts";
import {
  assertVertex,
  makeEdge,
  snapshotIterator,
} from "./shared.ts";
import { parseGraph, serializeGraph } from "./serialization.ts";

export class EdgeList<V = unknown, E = unknown> implements Graph<V, E> {
  private readonly _directed: boolean;
  private readonly _vertices = new Map<Vertex, V | undefined>();
  private readonly _edges: Array<Edge<E>> = [];

  constructor(directed = false) {
    this._directed = directed;
  }

  get directed(): boolean {
    return this._directed;
  }

  get order(): number {
    return this._vertices.size;
  }

  get size(): number {
    return this._edges.length;
  }

  addVertex(vertex: Vertex, data?: V): boolean {
    assertVertex(vertex);
    if (this._vertices.has(vertex)) {
      return false;
    }
    this._vertices.set(vertex, data);
    return true;
  }

  removeVertex(vertex: Vertex): boolean {
    if (!this._vertices.has(vertex)) {
      return false;
    }
    for (let i = this._edges.length - 1; i >= 0; i--) {
      const edge = this._edges[i];
      if (edge.from === vertex || edge.to === vertex) {
        this._edges.splice(i, 1);
      }
    }
    this._vertices.delete(vertex);
    return true;
  }

  hasVertex(vertex: Vertex): boolean {
    return this._vertices.has(vertex);
  }

  addEdge(
    from: Vertex,
    to: Vertex,
    weight?: number,
    data?: E,
  ): boolean {
    this.addVertex(from);
    this.addVertex(to);
    if (this.hasEdge(from, to)) {
      return false;
    }
    this._edges.push(makeEdge(from, to, weight, data));
    return true;
  }

  private indexOfEdge(from: Vertex, to: Vertex): number {
    for (let i = 0; i < this._edges.length; i++) {
      const edge = this._edges[i];
      if (edge.from === from && edge.to === to) {
        return i;
      }
      if (!this._directed && edge.from === to && edge.to === from) {
        return i;
      }
    }
    return -1;
  }

  removeEdge(from: Vertex, to: Vertex): boolean {
    const index = this.indexOfEdge(from, to);
    if (index < 0) {
      return false;
    }
    this._edges.splice(index, 1);
    return true;
  }

  hasEdge(from: Vertex, to: Vertex): boolean {
    return this.indexOfEdge(from, to) >= 0;
  }

  getEdge(from: Vertex, to: Vertex): Edge<E> | undefined {
    const index = this.indexOfEdge(from, to);
    return index < 0 ? undefined : this._edges[index];
  }

  neighbors(vertex: Vertex): Iterable<Vertex> {
    if (!this._vertices.has(vertex)) {
      throw new RangeError("vertex is not in the graph");
    }
    const result: Vertex[] = [];
    for (const edge of this._edges) {
      if (edge.from === vertex) {
        result.push(edge.to);
      } else if (!this._directed && edge.to === vertex) {
        result.push(edge.from);
      }
    }
    return snapshotIterator(result);
  }

  incidentEdges(vertex: Vertex): Iterable<Edge<E>> {
    if (!this._vertices.has(vertex)) {
      throw new RangeError("vertex is not in the graph");
    }
    return snapshotIterator(this._edges.filter(
      (edge) => edge.from === vertex || edge.to === vertex,
    ));
  }

  vertices(): Iterable<Vertex> {
    return snapshotIterator(this._vertices.keys());
  }

  edges(): Iterable<Edge<E>> {
    return snapshotIterator(this._edges);
  }

  degree(vertex: Vertex): number {
    if (!this._vertices.has(vertex)) {
      throw new RangeError("vertex is not in the graph");
    }
    if (!this._directed) {
      let count = 0;
      for (const edge of this._edges) {
        if (edge.from === vertex) {
          count += edge.to === vertex ? 2 : 1;
        } else if (edge.to === vertex) {
          count++;
        }
      }
      return count;
    }
    return this.inDegree(vertex) + this.outDegree(vertex);
  }

  inDegree(vertex: Vertex): number {
    if (!this._vertices.has(vertex)) {
      throw new RangeError("vertex is not in the graph");
    }
    if (!this._directed) {
      return this.degree(vertex);
    }
    let count = 0;
    for (const edge of this._edges) {
      if (edge.to === vertex) {
        count++;
      }
    }
    return count;
  }

  outDegree(vertex: Vertex): number {
    if (!this._vertices.has(vertex)) {
      throw new RangeError("vertex is not in the graph");
    }
    if (!this._directed) {
      return this.degree(vertex);
    }
    let count = 0;
    for (const edge of this._edges) {
      if (edge.from === vertex) {
        count++;
      }
    }
    return count;
  }

  transpose(): Graph<V, E> {
    const result = new EdgeList<V, E>(this._directed);
    for (const [vertex, data] of this._vertices) {
      result.addVertex(vertex, data);
    }
    for (const edge of this._edges) {
      if (this._directed) {
        result.addEdge(edge.to, edge.from, edge.weight, edge.data);
      } else {
        result.addEdge(edge.from, edge.to, edge.weight, edge.data);
      }
    }
    return result;
  }

  clone(): Graph<V, E> {
    const result = new EdgeList<V, E>(this._directed);
    for (const [vertex, data] of this._vertices) {
      result.addVertex(vertex, data);
    }
    for (const edge of this._edges) {
      result.addEdge(edge.from, edge.to, edge.weight, edge.data);
    }
    return result;
  }

  serialize(): string {
    const vertices = [...this._vertices].map(([vertex, data]) => ({
      vertex,
      data,
    }));
    return serializeGraph(
      "EdgeList",
      this._directed,
      vertices,
      this._edges,
    );
  }

  static deserialize<V = unknown, E = unknown>(
    json: unknown,
  ): EdgeList<V, E> {
    const parsed = parseGraph<V, E>(json, "EdgeList");
    const graph = new EdgeList<V, E>(parsed.directed);
    for (const entry of parsed.vertices) {
      graph.addVertex(entry.vertex, entry.data);
    }
    for (const edge of parsed.edges) {
      graph.addEdge(edge.from, edge.to, edge.weight, edge.data);
    }
    return graph;
  }

  validate(): true | string {
    for (const edge of this._edges) {
      if (!this._vertices.has(edge.from) || !this._vertices.has(edge.to)) {
        return "edge endpoint is not a vertex";
      }
      if (!Number.isFinite(edge.weight)) {
        return "edge weight is not finite";
      }
    }
    return true;
  }
}
