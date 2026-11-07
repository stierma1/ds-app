import type { Edge, Graph, Vertex } from "./types.ts";
import {
  assertVertex,
  makeEdge,
  snapshotIterator,
  uniqueEdges,
} from "./shared.ts";
import { parseGraph, serializeGraph } from "./serialization.ts";

interface VertexRecord<V, E> {
  data: V | undefined;
  out: Map<Vertex, Edge<E>>;
  in: Map<Vertex, Edge<E>>;
}

/**
 * Mutable adjacency list: Map<Vertex, {out: Map<Vertex, Edge>, in: Map<Vertex, Edge>}>.
 *
 * The general-purpose default. addVertex, addEdge, removeEdge, hasEdge, getEdge and all
 * three degree queries are O(1) expected because adjacency is a Map, not a list to scan
 * (CSR binary-searches, EdgeList scans). neighbors()/incidentEdges() are O(deg) snapshots.
 * Memory is O(V+E) but heavy: two Maps per vertex and, for undirected graphs, four Map
 * entries per edge (out+in on both ends) all pointing at one shared Edge object.
 * Versus siblings: AdjacencyMatrix wins only when E ~ V^2 (dense); CSR is 3-5x smaller and
 * cache-friendlier for read-only algorithm workloads; EdgeList is O(E) for everything.
 * Every iterable is an eager O(k) snapshot, so mutation during iteration is safe but
 * neighbors() inside a hot loop allocates each call.
 */
export class AdjacencyList<V = unknown, E = unknown>
  implements Graph<V, E>
{
  private readonly _directed: boolean;
  private readonly _vertices = new Map<Vertex, VertexRecord<V, E>>();
  private _size = 0;

  constructor(directed = false) {
    this._directed = directed;
  }

  get directed(): boolean {
    return this._directed;
  }

  /** O(1). */
  get order(): number {
    return this._vertices.size;
  }

  /** O(1): maintained counter (each undirected edge counts once). */
  get size(): number {
    return this._size;
  }

  /** O(1) expected; allocates two empty Maps per new vertex. */
  addVertex(vertex: Vertex, data?: V): boolean {
    assertVertex(vertex);
    if (this._vertices.has(vertex)) {
      return false;
    }
    this._vertices.set(vertex, {
      data,
      out: new Map(),
      in: new Map(),
    });
    return true;
  }

  /** O(deg): snapshots the incident edges, then removes each with O(1) removeEdge. */
  removeVertex(vertex: Vertex): boolean {
    if (!this._vertices.has(vertex)) {
      return false;
    }
    for (const edge of uniqueEdges(this.incidentEdges(vertex))) {
      this.removeEdge(edge.from, edge.to);
    }
    this._vertices.delete(vertex);
    return true;
  }

  /** O(1) expected. */
  hasVertex(vertex: Vertex): boolean {
    return this._vertices.has(vertex);
  }

  /**
   * O(1) expected; auto-creates missing endpoints. Duplicates return false before the Edge is
   * allocated. Undirected edges write four Map entries sharing one Edge object.
   */
  addEdge(
    from: Vertex,
    to: Vertex,
    weight?: number,
    data?: E,
  ): boolean {
    this.addVertex(from);
    this.addVertex(to);
    const source = this._vertices.get(from)!;
    if (source.out.has(to)) {
      return false;
    }
    const target = this._vertices.get(to)!;
    const edge = makeEdge(from, to, weight, data);
    source.out.set(to, edge);
    target.in.set(from, edge);
    if (!this._directed && from !== to) {
      target.out.set(from, edge);
      source.in.set(to, edge);
    } else if (!this._directed) {
      source.in.set(from, edge);
    }
    this._size++;
    return true;
  }

  /** O(1) expected: up to four Map deletes, no scanning or compaction. */
  removeEdge(from: Vertex, to: Vertex): boolean {
    const source = this._vertices.get(from);
    const target = this._vertices.get(to);
    if (source === undefined || target === undefined) {
      return false;
    }
    if (!source.out.has(to)) {
      return false;
    }
    source.out.delete(to);
    target.in.delete(from);
    if (!this._directed && from !== to) {
      target.out.delete(from);
      source.in.delete(to);
    } else if (!this._directed) {
      source.in.delete(from);
    }
    this._size--;
    return true;
  }

  /** O(1) expected (two Map lookups); the headline advantage over CSR/EdgeList's O(deg)/O(E). */
  hasEdge(from: Vertex, to: Vertex): boolean {
    return this._vertices.get(from)?.out.has(to) ?? false;
  }

  /** O(1) expected; returns the shared Edge object, not a copy. */
  getEdge(from: Vertex, to: Vertex): Edge<E> | undefined {
    return this._vertices.get(from)?.out.get(to);
  }

  /** O(deg): copies the out-Map keys into a fresh array (snapshot). A self-loop appears once. */
  neighbors(vertex: Vertex): Iterable<Vertex> {
    const record = this._vertices.get(vertex);
    if (record === undefined) {
      throw new RangeError("vertex is not in the graph");
    }
    return snapshotIterator(record.out.keys());
  }

  /** Undirected: O(deg) copy. Directed: O(in+out) copy plus a Set pass to dedupe self-loops. */
  incidentEdges(vertex: Vertex): Iterable<Edge<E>> {
    const record = this._vertices.get(vertex);
    if (record === undefined) {
      throw new RangeError("vertex is not in the graph");
    }
    if (!this._directed) {
      return snapshotIterator(record.out.values());
    }
    return snapshotIterator(uniqueEdges([
      ...record.out.values(),
      ...record.in.values(),
    ]) as Edge<E>[]);
  }

  /** O(V) snapshot copy in insertion order. */
  vertices(): Iterable<Vertex> {
    return snapshotIterator(this._vertices.keys());
  }

  /**
   * O(V+E): walks every out-Map, then dedupes through a Set (undirected graphs scan 2E
   * entries). Called by every algorithm via buildAdjacency, and by transpose/clone/serialize.
   */
  edges(): Iterable<Edge<E>> {
    const result: Edge<E>[] = [];
    for (const record of this._vertices.values()) {
      for (const edge of record.out.values()) {
        result.push(edge);
      }
    }
    return snapshotIterator(uniqueEdges(result) as Edge<E>[]);
  }

  /** O(1): Map sizes; an undirected self-loop counts twice. */
  degree(vertex: Vertex): number {
    const record = this._vertices.get(vertex);
    if (record === undefined) {
      throw new RangeError("vertex is not in the graph");
    }
    if (this._directed) {
      return record.out.size + record.in.size;
    }
    return record.out.size + (record.out.has(vertex) ? 1 : 0);
  }

  /** O(1). */
  inDegree(vertex: Vertex): number {
    const record = this._vertices.get(vertex);
    if (record === undefined) {
      throw new RangeError("vertex is not in the graph");
    }
    return this._directed ? record.in.size : this.degree(vertex);
  }

  /** O(1). */
  outDegree(vertex: Vertex): number {
    const record = this._vertices.get(vertex);
    if (record === undefined) {
      throw new RangeError("vertex is not in the graph");
    }
    return this._directed ? record.out.size : this.degree(vertex);
  }

  /** O(V+E): builds a fresh AdjacencyList with O(1) inserts; an undirected graph is cloned. */
  transpose(): Graph<V, E> {
    const result = new AdjacencyList<V, E>(this._directed);
    for (const [vertex, record] of this._vertices) {
      result.addVertex(vertex, record.data);
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

  /** O(V+E); shallow with respect to vertex/edge `data` (new Edge objects, same payloads). */
  clone(): Graph<V, E> {
    const result = new AdjacencyList<V, E>(this._directed);
    for (const [vertex, record] of this._vertices) {
      result.addVertex(vertex, record.data);
    }
    for (const edge of this.edges()) {
      result.addEdge(edge.from, edge.to, edge.weight, edge.data);
    }
    return result;
  }

  /** O(V+E) to collect entries plus JSON.stringify of the O(V+E) output. */
  serialize(): string {
    const vertices = [...this._vertices].map(([vertex, record]) => ({
      vertex,
      data: record.data,
    }));
    return serializeGraph(
      "AdjacencyList",
      this._directed,
      vertices,
      this.edges(),
    );
  }

  /**
   * O(V+E) expected after parsing: parseGraph validates/dedupes in O(1) per entry, then each
   * vertex and edge is an O(1) insert.
   */
  static deserialize<V = unknown, E = unknown>(
    json: unknown,
  ): AdjacencyList<V, E> {
    const parsed = parseGraph<V, E>(json, "AdjacencyList");
    const graph = new AdjacencyList<V, E>(parsed.directed);
    for (const entry of parsed.vertices) {
      graph.addVertex(entry.vertex, entry.data);
    }
    for (const edge of parsed.edges) {
      graph.addEdge(edge.from, edge.to, edge.weight, edge.data);
    }
    return graph;
  }

  /** O(V+E): walks every out and in Map with O(1) cross-lookups; returns on the first fault. */
  validate(): true | string {
    let edgeCount = 0;
    let loopCount = 0;
    for (const [vertex, record] of this._vertices) {
      if (!this._directed) {
        if (record.out.has(vertex)) {
          loopCount++;
        }
        for (const [neighbor, edge] of record.out) {
          if (!this._vertices.has(neighbor)) {
            return "edge endpoint is not a vertex";
          }
          if (!Number.isFinite(edge.weight)) {
            return "edge weight is not finite";
          }
          const reverse = this._vertices.get(neighbor)!.out.get(vertex);
          if (reverse !== edge) {
            return "undirected edge is not symmetric";
          }
          const forward =
            edge.from === vertex && edge.to === neighbor;
          const backward =
            edge.from === neighbor && edge.to === vertex;
          if (!forward && !backward) {
            return "edge endpoints do not match its vertices";
          }
        }
        for (const [neighbor, edge] of record.in) {
          if (record.out.get(neighbor) !== edge) {
            return "incoming and outgoing adjacency differ";
          }
        }
        edgeCount += record.out.size;
        continue;
      }
      for (const [neighbor, edge] of record.out) {
        if (!this._vertices.has(neighbor)) {
          return "edge endpoint is not a vertex";
        }
        if (!Number.isFinite(edge.weight)) {
          return "edge weight is not finite";
        }
        if (edge.from !== vertex || edge.to !== neighbor) {
          return "edge endpoints do not match its vertices";
        }
        if (this._vertices.get(neighbor)!.in.get(vertex) !== edge) {
          return "directed edge is not recorded in both directions";
        }
      }
      for (const [neighbor, edge] of record.in) {
        if (!this._vertices.has(neighbor)) {
          return "edge endpoint is not a vertex";
        }
        if (edge.from !== neighbor || edge.to !== vertex) {
          return "edge endpoints do not match its vertices";
        }
        if (this._vertices.get(neighbor)!.out.get(vertex) !== edge) {
          return "directed edge is not recorded in both directions";
        }
      }
      edgeCount += record.out.size;
    }
    if (this._directed) {
      if (edgeCount !== this._size) {
        return "edge count does not match";
      }
    } else if ((edgeCount + loopCount) / 2 !== this._size) {
      return "edge count does not match";
    }
    return true;
  }
}
