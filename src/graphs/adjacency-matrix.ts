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

/**
 * Dense V x V matrix of Edge | undefined (array of row arrays) plus a Map from vertex to
 * row index.
 *
 * Fast: hasEdge/getEdge/addEdge/removeEdge are O(1) with no Map-of-Maps indirection.
 * Slow: memory is O(V^2) regardless of E; neighbors(), incidentEdges() and every degree
 * query scan a whole row (or column) in O(V) even for a degree-1 vertex; edges() is O(V^2),
 * so EVERY algorithm run on a matrix pays O(V^2) up front in buildAdjacency; addVertex is
 * O(V) (appends a cell to every row) and removeVertex is O(V^2) (splices every row and
 * rebuilds the index). Only worth it when the graph is dense (E close to V^2) or when
 * hasEdge dominates and V is small; otherwise prefer AdjacencyList. No growth policy: rows
 * grow one cell per addVertex via array push, and nothing shrinks except on removeVertex.
 * Every iterable is an eager snapshot.
 */
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

  /** O(1). */
  get order(): number {
    return this._vertices.length;
  }

  /** O(1). */
  get size(): number {
    return this._size;
  }

  /**
   * O(V): pushes an undefined cell onto every existing row and allocates a new V+1 row, so
   * building V vertices costs O(V^2) total. Rejecting a duplicate is O(1).
   */
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

  /**
   * O(V^2): scans the row (and column when directed), splices the column out of every row,
   * splices the row, and rebuilds the whole vertex->index Map because indices shift.
   */
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

  /** O(1) expected. */
  hasVertex(vertex: Vertex): boolean {
    return this._index.has(vertex);
  }

  /** O(1) when both endpoints exist; otherwise O(V) per auto-created endpoint (see addVertex). */
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

  /** O(1): clears one cell (two when undirected). */
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

  /**
   * O(1): two Map lookups and one cell read, independent of degree. The matrix's headline
   * advantage.
   */
  hasEdge(from: Vertex, to: Vertex): boolean {
    const source = this._index.get(from);
    const target = this._index.get(to);
    if (source === undefined || target === undefined) {
      return false;
    }
    return this._matrix[source][target] !== undefined;
  }

  /** O(1); returns the shared Edge object. */
  getEdge(from: Vertex, to: Vertex): Edge<E> | undefined {
    const source = this._index.get(from);
    const target = this._index.get(to);
    if (source === undefined || target === undefined) {
      return undefined;
    }
    return this._matrix[source][target];
  }

  /**
   * O(V): scans the full row regardless of degree and allocates the result array. Prefer
   * AdjacencyList or CSR (O(deg)) when neighbor iteration dominates.
   */
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

  /**
   * O(V) row filter; directed graphs also scan the column (strided across all rows, cache-
   * unfriendly) and dedupe through a Set.
   */
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

  /** O(V) snapshot copy in insertion order. */
  vertices(): Iterable<Vertex> {
    return snapshotIterator(this._vertices.map((entry) => entry.vertex));
  }

  /**
   * O(V^2): scans every cell (upper triangle for undirected). This is the floor cost of any
   * algorithm, transpose, clone or serialize on a matrix, even when E is tiny.
   */
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

  /** O(V): row scan (undirected) or row + column scan (directed). Not cached. */
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

  /** O(V): directed graphs scan one column across all rows. */
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

  /** O(V): row scan. */
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

  /** O(V^2): V addVertex calls at O(V) each plus the O(V^2) edges() scan. */
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

  /** O(V^2): same shape of work as transpose; allocates a fresh V x V matrix. */
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

  /** O(V^2) to scan for edges; the output itself is O(V+E). */
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

  /** O(V^2 + E): rebuilding the matrix costs O(V) per vertex even for a sparse payload. */
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

  /** O(V^2): checks every cell, with an O(1) symmetric-cell lookup per edge when undirected. */
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
