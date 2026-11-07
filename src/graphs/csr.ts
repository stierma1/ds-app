import { UnsupportedError } from "../core/index.ts";
import type { Edge, Graph, Vertex } from "./types.ts";
import { snapshotIterator, uniqueEdges } from "./shared.ts";
import { parseGraph, serializeGraph } from "./serialization.ts";

export class CSR<V = unknown, E = unknown> implements Graph<V, E> {
  private readonly _directed: boolean;
  private readonly _vertices: Vertex[];
  private readonly _index: Map<Vertex, number>;
  private readonly _offsets: Int32Array;
  private readonly _targets: Int32Array;
  private readonly _refs: Edge<E>[];
  private readonly _inOffsets: Int32Array;
  private readonly _inTargets: Int32Array;
  private readonly _inRefs: Edge<E>[];
  private readonly _edges: Edge<E>[];
  private readonly _loops: Uint8Array;

  private constructor(
    directed: boolean,
    vertices: Vertex[],
    index: Map<Vertex, number>,
    offsets: Int32Array,
    targets: Int32Array,
    refs: Edge<E>[],
    inOffsets: Int32Array,
    inTargets: Int32Array,
    inRefs: Edge<E>[],
    edges: Edge<E>[],
    loops: Uint8Array,
  ) {
    this._directed = directed;
    this._vertices = vertices;
    this._index = index;
    this._offsets = offsets;
    this._targets = targets;
    this._refs = refs;
    this._inOffsets = inOffsets;
    this._inTargets = inTargets;
    this._inRefs = inRefs;
    this._edges = edges;
    this._loops = loops;
  }

  static from<V, E>(graph: Graph<V, E>): CSR<V, E> {
    return CSR.create(
      [...graph.vertices()],
      [...graph.edges()],
      graph.directed,
    );
  }

  private static create<V, E>(
    vertices: Vertex[],
    edges: Edge<E>[],
    directed: boolean,
  ): CSR<V, E> {
    const count = vertices.length;
    const index = new Map<Vertex, number>();
    for (let i = 0; i < count; i++) {
      index.set(vertices[i], i);
    }
    const outCounts = new Int32Array(count);
    const inCounts = new Int32Array(count);
    const loops = new Uint8Array(count);
    const oriented: Array<{
      from: number;
      to: number;
      edge: Edge<E>;
    }> = [];
    for (const edge of edges) {
      const from = index.get(edge.from);
      const to = index.get(edge.to);
      if (from === undefined || to === undefined) {
        throw new TypeError("Edge endpoint is not a vertex");
      }
      oriented.push({ from, to, edge });
      outCounts[from]++;
      inCounts[to]++;
      if (from === to) {
        loops[from] = 1;
      }
      if (!directed && from !== to) {
        oriented.push({ from: to, to: from, edge });
        outCounts[to]++;
        inCounts[from]++;
      }
    }
    const offsets = new Int32Array(count + 1);
    for (let i = 0; i < count; i++) {
      offsets[i + 1] = offsets[i] + outCounts[i];
    }
    const inOffsets = new Int32Array(count + 1);
    for (let i = 0; i < count; i++) {
      inOffsets[i + 1] = inOffsets[i] + inCounts[i];
    }
    const targets = new Int32Array(offsets[count]);
    const refs = new Array<Edge<E>>(offsets[count]);
    const inTargets = new Int32Array(inOffsets[count]);
    const inRefs = new Array<Edge<E>>(inOffsets[count]);
    const outCursor = offsets.slice(0, count);
    const inCursor = inOffsets.slice(0, count);
    for (const entry of oriented) {
      const out = outCursor[entry.from]++;
      targets[out] = entry.to;
      refs[out] = entry.edge;
      const incoming = inCursor[entry.to]++;
      inTargets[incoming] = entry.from;
      inRefs[incoming] = entry.edge;
    }
    return new CSR(
      directed,
      vertices,
      index,
      offsets,
      targets,
      refs,
      inOffsets,
      inTargets,
      inRefs,
      edges,
      loops,
    );
  }

  get directed(): boolean {
    return this._directed;
  }

  get order(): number {
    return this._vertices.length;
  }

  get size(): number {
    return this._edges.length;
  }

  addVertex(_vertex: Vertex, _data?: V): boolean {
    throw new UnsupportedError("CSR graphs are immutable");
  }

  removeVertex(_vertex: Vertex): boolean {
    throw new UnsupportedError("CSR graphs are immutable");
  }

  hasVertex(vertex: Vertex): boolean {
    return this._index.has(vertex);
  }

  addEdge(
    _from: Vertex,
    _to: Vertex,
    _weight?: number,
    _data?: E,
  ): boolean {
    throw new UnsupportedError("CSR graphs are immutable");
  }

  removeEdge(_from: Vertex, _to: Vertex): boolean {
    throw new UnsupportedError("CSR graphs are immutable");
  }

  hasEdge(from: Vertex, to: Vertex): boolean {
    const source = this._index.get(from);
    const target = this._index.get(to);
    if (source === undefined || target === undefined) {
      return false;
    }
    for (let i = this._offsets[source]; i < this._offsets[source + 1]; i++) {
      if (this._targets[i] === target) {
        return true;
      }
    }
    return false;
  }

  getEdge(from: Vertex, to: Vertex): Edge<E> | undefined {
    const source = this._index.get(from);
    const target = this._index.get(to);
    if (source === undefined || target === undefined) {
      return undefined;
    }
    for (let i = this._offsets[source]; i < this._offsets[source + 1]; i++) {
      if (this._targets[i] === target) {
        return this._refs[i];
      }
    }
    return undefined;
  }

  neighbors(vertex: Vertex): Iterable<Vertex> {
    const source = this._index.get(vertex);
    if (source === undefined) {
      throw new RangeError("vertex is not in the graph");
    }
    const result: Vertex[] = [];
    for (let i = this._offsets[source]; i < this._offsets[source + 1]; i++) {
      result.push(this._vertices[this._targets[i]]);
    }
    return snapshotIterator(result);
  }

  incidentEdges(vertex: Vertex): Iterable<Edge<E>> {
    const source = this._index.get(vertex);
    if (source === undefined) {
      throw new RangeError("vertex is not in the graph");
    }
    const result: Edge<E>[] = [];
    for (let i = this._offsets[source]; i < this._offsets[source + 1]; i++) {
      result.push(this._refs[i]);
    }
    if (this._directed) {
      for (let i = this._inOffsets[source]; i < this._inOffsets[source + 1]; i++) {
        result.push(this._inRefs[i]);
      }
      return snapshotIterator(uniqueEdges(result) as Edge<E>[]);
    }
    return snapshotIterator(result);
  }

  vertices(): Iterable<Vertex> {
    return snapshotIterator(this._vertices);
  }

  edges(): Iterable<Edge<E>> {
    return snapshotIterator(this._edges);
  }

  degree(vertex: Vertex): number {
    const index = this._index.get(vertex);
    if (index === undefined) {
      throw new RangeError("vertex is not in the graph");
    }
    const out = this._offsets[index + 1] - this._offsets[index];
    if (this._directed) {
      return out + this.inDegree(vertex);
    }
    return out + (this._loops[index] === 1 ? 1 : 0);
  }

  inDegree(vertex: Vertex): number {
    const index = this._index.get(vertex);
    if (index === undefined) {
      throw new RangeError("vertex is not in the graph");
    }
    if (!this._directed) {
      return this.degree(vertex);
    }
    return this._inOffsets[index + 1] - this._inOffsets[index];
  }

  outDegree(vertex: Vertex): number {
    const index = this._index.get(vertex);
    if (index === undefined) {
      throw new RangeError("vertex is not in the graph");
    }
    if (!this._directed) {
      return this.degree(vertex);
    }
    return this._offsets[index + 1] - this._offsets[index];
  }

  transpose(): Graph<V, E> {
    if (!this._directed) {
      return this.clone();
    }
    const edges: Edge<E>[] = this._edges.map((edge) => ({
      from: edge.to,
      to: edge.from,
      weight: edge.weight,
      ...(edge.data === undefined ? {} : { data: edge.data }),
    }));
    return CSR.create(this._vertices, edges, true);
  }

  clone(): Graph<V, E> {
    return CSR.create(this._vertices, this._edges, this._directed);
  }

  serialize(): string {
    return serializeGraph(
      "CSR",
      this._directed,
      this._vertices.map((vertex) => ({ vertex })),
      this._edges,
    );
  }

  static deserialize<V = unknown, E = unknown>(
    json: unknown,
  ): CSR<V, E> {
    const parsed = parseGraph<V, E>(json, "CSR");
    return CSR.create(
      parsed.vertices.map((entry) => entry.vertex),
      parsed.edges,
      parsed.directed,
    );
  }

  validate(): true | string {
    if (this._offsets[0] !== 0) {
      return "offsets do not start at zero";
    }
    if (this._offsets[this._vertices.length] !== this._targets.length) {
      return "offsets do not match target count";
    }
    for (let i = 0; i < this._vertices.length; i++) {
      if (this._offsets[i] > this._offsets[i + 1]) {
        return "offsets are not monotonic";
      }
    }
    for (const edge of this._edges) {
      if (!this._index.has(edge.from) || !this._index.has(edge.to)) {
        return "edge endpoint is not a vertex";
      }
      if (!Number.isFinite(edge.weight)) {
        return "edge weight is not finite";
      }
    }
    for (let i = 0; i < this._targets.length; i++) {
      if (this._targets[i] < 0 || this._targets[i] >= this._vertices.length) {
        return "target index is out of range";
      }
    }
    return true;
  }
}
