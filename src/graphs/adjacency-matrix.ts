import type { Edge, Graph, Vertex } from "./types.ts";
import {
  assertVertex,
  makeEdge,
  snapshotIterator,
  uniqueEdges,
} from "./shared.ts";
import { parseGraph, serializeGraph } from "./serialization.ts";

interface MatrixVertex<V> {
  vertex: Vertex;
  data: V | undefined;
}

export class AdjacencyMatrix<V = unknown, E = unknown>
  implements Graph<V, E>
{
  private readonly _directed: boolean;
  private readonly _vertices: MatrixVertex<V>[] = [];
  private readonly _index = new Map<Vertex, number>();
  private readonly _matrix: Array<Array<Edge<E> | undefined>> = [];
  private _size = 0;

  constructor(directed = false) {
    this._directed = directed;
  }

  get directed(): boolean {
    return this._directed;
  }

  get order(): number {
    return this._vertices.length;
  }

  get size(): number {
    return this._size;
  }

  addVertex(vertex: Vertex, data?: V): boolean {
    assertVertex(vertex);
    if (this._index.has(vertex)) {
      return false;
    }
    const index = this._vertices.length;
    this._vertices.push({ vertex, data });
    this._index.set(vertex, index);
    for (const row of this._matrix) {
      row.push(undefined);
    }
    this._matrix.push(new Array<Edge<E> | undefined>(index + 1).fill(undefined));
    return true;
  }

  removeVertex(vertex: Vertex): boolean {
    const index = this._index.get(vertex);
    if (index === undefined) {
      return false;
    }
    const edges = new Set<Edge<E>>();
    for (const edge of this._matrix[index]) {
      if (edge !== undefined) {
        edges.add(edge);
      }
    }
    if (this._directed) {
      for (const row of this._matrix) {
        const edge = row[index];
        if (edge !== undefined) {
          edges.add(edge);
        }
      }
    }
    for (const edge of edges) {
      this.removeEdge(edge.from, edge.to);
    }
    this._matrix.splice(index, 1);
    for (const row of this._matrix) {
      row.splice(index, 1);
    }
    this._vertices.splice(index, 1);
    this._index.clear();
    for (let i = 0; i < this._vertices.length; i++) {
      this._index.set(this._vertices[i].vertex, i);
    }
    return true;
  }

  hasVertex(vertex: Vertex): boolean {
    return this._index.has(vertex);
  }

  addEdge(
    from: Vertex,
    to: Vertex,
    weight?: number,
    data?: E,
  ): boolean {
    this.addVertex(from);
    this.addVertex(to);
    const source = this._index.get(from)!;
    const target = this._index.get(to)!;
    if (this._matrix[source][target] !== undefined) {
      return false;
    }
    const edge = makeEdge(from, to, weight, data);
    this._matrix[source][target] = edge;
    if (!this._directed && source !== target) {
      this._matrix[target][source] = edge;
    }
    this._size++;
    return true;
  }

  removeEdge(from: Vertex, to: Vertex): boolean {
    const source = this._index.get(from);
    const target = this._index.get(to);
    if (source === undefined || target === undefined) {
      return false;
    }
    if (this._matrix[source][target] === undefined) {
      return false;
    }
    this._matrix[source][target] = undefined;
    if (!this._directed && source !== target) {
      this._matrix[target][source] = undefined;
    }
    this._size--;
    return true;
  }

  hasEdge(from: Vertex, to: Vertex): boolean {
    const source = this._index.get(from);
    const target = this._index.get(to);
    if (source === undefined || target === undefined) {
      return false;
    }
    return this._matrix[source][target] !== undefined;
  }

  getEdge(from: Vertex, to: Vertex): Edge<E> | undefined {
    const source = this._index.get(from);
    const target = this._index.get(to);
    if (source === undefined || target === undefined) {
      return undefined;
    }
    return this._matrix[source][target];
  }

  neighbors(vertex: Vertex): Iterable<Vertex> {
    const index = this._index.get(vertex);
    if (index === undefined) {
      throw new RangeError("vertex is not in the graph");
    }
    const result: Vertex[] = [];
    const row = this._matrix[index];
    for (let i = 0; i < row.length; i++) {
      if (row[i] !== undefined) {
        result.push(this._vertices[i].vertex);
      }
    }
    return snapshotIterator(result);
  }

  incidentEdges(vertex: Vertex): Iterable<Edge<E>> {
    const index = this._index.get(vertex);
    if (index === undefined) {
      throw new RangeError("vertex is not in the graph");
    }
    const row = this._matrix[index].filter(
      (edge): edge is Edge<E> => edge !== undefined,
    );
    if (!this._directed) {
      return snapshotIterator(row);
    }
    const edges = [...row];
    for (let i = 0; i < this._matrix.length; i++) {
      const edge = this._matrix[i][index];
      if (edge !== undefined) {
        edges.push(edge);
      }
    }
    return snapshotIterator(uniqueEdges(edges) as Edge<E>[]);
  }

  vertices(): Iterable<Vertex> {
    return snapshotIterator(this._vertices.map((entry) => entry.vertex));
  }

  edges(): Iterable<Edge<E>> {
    const result: Edge<E>[] = [];
    for (let i = 0; i < this._matrix.length; i++) {
      const row = this._matrix[i];
      const start = this._directed ? 0 : i;
      for (let j = start; j < row.length; j++) {
        const edge = row[j];
        if (edge !== undefined) {
          result.push(edge);
        }
      }
    }
    return snapshotIterator(result);
  }

  degree(vertex: Vertex): number {
    const index = this._index.get(vertex);
    if (index === undefined) {
      throw new RangeError("vertex is not in the graph");
    }
    if (this._directed) {
      return this.outDegree(vertex) + this.inDegree(vertex);
    }
    let count = 0;
    for (const edge of this._matrix[index]) {
      if (edge !== undefined) {
        count++;
      }
    }
    if (this._matrix[index][index] !== undefined) {
      count++;
    }
    return count;
  }

  inDegree(vertex: Vertex): number {
    const index = this._index.get(vertex);
    if (index === undefined) {
      throw new RangeError("vertex is not in the graph");
    }
    if (!this._directed) {
      return this.degree(vertex);
    }
    let count = 0;
    for (const row of this._matrix) {
      if (row[index] !== undefined) {
        count++;
      }
    }
    return count;
  }

  outDegree(vertex: Vertex): number {
    const index = this._index.get(vertex);
    if (index === undefined) {
      throw new RangeError("vertex is not in the graph");
    }
    if (!this._directed) {
      return this.degree(vertex);
    }
    let count = 0;
    for (const edge of this._matrix[index]) {
      if (edge !== undefined) {
        count++;
      }
    }
    return count;
  }

  transpose(): Graph<V, E> {
    const result = new AdjacencyMatrix<V, E>(this._directed);
    for (const record of this._vertices) {
      result.addVertex(record.vertex, record.data);
    }
    for (const edge of this.edges()) {
      if (this._directed) {
        result.addEdge(edge.to, edge.from, edge.weight, edge.data);
      } else {
        result.addEdge(edge.from, edge.to, edge.weight, edge.data);
      }
    }
    return result;
  }

  clone(): Graph<V, E> {
    const result = new AdjacencyMatrix<V, E>(this._directed);
    for (const record of this._vertices) {
      result.addVertex(record.vertex, record.data);
    }
    for (const edge of this.edges()) {
      result.addEdge(edge.from, edge.to, edge.weight, edge.data);
    }
    return result;
  }

  serialize(): string {
    return serializeGraph(
      "AdjacencyMatrix",
      this._directed,
      this._vertices.map((record) => ({
        vertex: record.vertex,
        data: record.data,
      })),
      this.edges(),
    );
  }

  static deserialize<V = unknown, E = unknown>(
    json: unknown,
  ): AdjacencyMatrix<V, E> {
    const parsed = parseGraph<V, E>(json, "AdjacencyMatrix");
    const graph = new AdjacencyMatrix<V, E>(parsed.directed);
    for (const entry of parsed.vertices) {
      graph.addVertex(entry.vertex, entry.data);
    }
    for (const edge of parsed.edges) {
      graph.addEdge(edge.from, edge.to, edge.weight, edge.data);
    }
    return graph;
  }

  validate(): true | string {
    for (let i = 0; i < this._matrix.length; i++) {
      if (this._matrix[i].length !== this._vertices.length) {
        return "adjacency matrix is not rectangular";
      }
    }
    let edgeCount = 0;
    for (let i = 0; i < this._matrix.length; i++) {
      const row = this._matrix[i];
      for (let j = 0; j < row.length; j++) {
        const edge = row[j];
        if (edge === undefined) {
          continue;
        }
        if (!this._index.has(edge.from) || !this._index.has(edge.to)) {
          return "edge endpoint is not a vertex";
        }
        if (!Number.isFinite(edge.weight)) {
          return "edge weight is not finite";
        }
        if (this._directed) {
          if (edge.from !== this._vertices[i].vertex) {
            return "edge endpoints do not match its vertices";
          }
          if (edge.to !== this._vertices[j].vertex) {
            return "edge endpoints do not match its vertices";
          }
          edgeCount++;
        } else {
          if (this._matrix[j][i] !== edge) {
            return "undirected edge is not symmetric";
          }
          const forward =
            edge.from === this._vertices[i].vertex &&
            edge.to === this._vertices[j].vertex;
          const backward =
            edge.from === this._vertices[j].vertex &&
            edge.to === this._vertices[i].vertex;
          if (!forward && !backward) {
            return "edge endpoints do not match its vertices";
          }
          if (j >= i) {
            edgeCount++;
          }
        }
      }
    }
    if (edgeCount !== this._size) {
      return "edge count does not match";
    }
    return true;
  }
}
