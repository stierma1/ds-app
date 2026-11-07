import { UnsupportedError } from "../core/index.ts";
import type { Edge, Graph, Vertex } from "./types.ts";
import { snapshotIterator, uniqueEdges } from "./shared.ts";
import { parseGraph, serializeGraph } from "./serialization.ts";

/**
 * Immutable Compressed Sparse Row graph: Int32Array offsets/targets for out-adjacency (and
 * a second pair for in-adjacency), parallel arrays of shared Edge refs, a vertex array and
 * a Map from vertex to index.
 *
 * Static by design: addVertex/removeVertex/addEdge/removeEdge ALWAYS throw UnsupportedError;
 * to change the graph, mutate a source graph and rebuild with CSR.from (O(V+E)). In return
 * it has the smallest footprint (4 bytes per adjacency slot plus one pointer) and the best
 * locality: a vertex's neighbors are one contiguous slice, all degree queries are O(1)
 * offset subtractions (AdjacencyMatrix needs O(V)), and edges() is an O(E) copy of a flat
 * array with no dedupe pass, which makes it the cheapest input to every algorithm.
 * Each row is sorted by target index at build time, so hasEdge/getEdge are O(log deg)
 * binary searches over the slice; AdjacencyList (O(1) expected) is still better for
 * membership-heavy workloads. Because rows are sorted, neighbors() yields vertices in
 * vertex-index order (the order of the source graph's vertices()), not edge-insertion
 * order. Undirected graphs store
 * each edge twice in both the out and in arrays (4 slots). Every iterable is an eager
 * snapshot.
 */
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

  /**
   * O(V+E) two-pass counting build, plus the source's vertices()/edges() cost (O(V^2) for an
   * AdjacencyMatrix). Edge objects are shared with the source, not copied.
   */
  static from<V, E>(graph: Graph<V, E>): CSR<V, E> {
    return CSR.create(
      [...graph.vertices()],
      [...graph.edges()],
      graph.directed,
    );
  }

  /**
   * Counting-sort layout: one pass to count out/in degrees, prefix sums for offsets, one pass
   * to scatter targets. O(V+E) time, no per-vertex allocations, so builds are cheap enough to
   * redo after each batch of mutations to a source graph.
   */
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
    // Rows are filled in (row, target) order so each slice is sorted by target index and
    // hasEdge/getEdge can binary search. Costs O(E log E) once at build time.
    const byOut = oriented.slice().sort((a, b) => a.from - b.from || a.to - b.to);
    for (const entry of byOut) {
      const out = outCursor[entry.from]++;
      targets[out] = entry.to;
      refs[out] = entry.edge;
    }
    const byIn = oriented.sort((a, b) => a.to - b.to || a.from - b.from);
    for (const entry of byIn) {
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

  /** O(1). */
  get order(): number {
    return this._vertices.length;
  }

  /** O(1). */
  get size(): number {
    return this._edges.length;
  }

  /** Always throws UnsupportedError: CSR is immutable. Rebuild via CSR.from (O(V+E)). */
  addVertex(_vertex: Vertex, _data?: V): boolean {
    throw new UnsupportedError("CSR graphs are immutable");
  }

  /** Always throws UnsupportedError: CSR is immutable. */
  removeVertex(_vertex: Vertex): boolean {
    throw new UnsupportedError("CSR graphs are immutable");
  }

  /** O(1) expected. */
  hasVertex(vertex: Vertex): boolean {
    return this._index.has(vertex);
  }

  /** Always throws UnsupportedError: CSR is immutable. */
  addEdge(
    _from: Vertex,
    _to: Vertex,
    _weight?: number,
    _data?: E,
  ): boolean {
    throw new UnsupportedError("CSR graphs are immutable");
  }

  /** Always throws UnsupportedError: CSR is immutable. */
  removeEdge(_from: Vertex, _to: Vertex): boolean {
    throw new UnsupportedError("CSR graphs are immutable");
  }

  /**
   * Lower-bound binary search for `target` in the sorted out-row of `source`. Returns the
   * matching slot index, or -1.
   */
  private findSlot(source: number, target: number): number {
    let lo = this._offsets[source];
    let hi = this._offsets[source + 1];
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this._targets[mid] < target) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo < this._offsets[source + 1] && this._targets[lo] === target ? lo : -1;
  }

  /**
   * O(log outdeg(from)): binary search over the sorted contiguous target slice, after two
   * O(1) Map lookups. O(1) in AdjacencyList/AdjacencyMatrix; far cheaper than EdgeList.
   */
  hasEdge(from: Vertex, to: Vertex): boolean {
    const source = this._index.get(from);
    const target = this._index.get(to);
    if (source === undefined || target === undefined) {
      return false;
    }
    return this.findSlot(source, target) !== -1;
  }

  /** O(log outdeg(from)) binary search; returns the shared Edge object. */
  getEdge(from: Vertex, to: Vertex): Edge<E> | undefined {
    const source = this._index.get(from);
    const target = this._index.get(to);
    if (source === undefined || target === undefined) {
      return undefined;
    }
    const slot = this.findSlot(source, target);
    return slot === -1 ? undefined : this._refs[slot];
  }

  /**
   * O(deg): walks one contiguous Int32Array slice; allocates the snapshot array. Yields in
   * vertex-index order because rows are kept sorted for hasEdge/getEdge.
   */
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

  /** Undirected: O(deg) slice copy. Directed: O(in+out) plus a Set pass to dedupe self-loops. */
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

  /** O(V) snapshot copy. */
  vertices(): Iterable<Vertex> {
    return snapshotIterator(this._vertices);
  }

  /** O(E): copies the stored edge array; no scanning or dedupe. Cheapest edges() of the four. */
  edges(): Iterable<Edge<E>> {
    return snapshotIterator(this._edges);
  }

  /** O(1): offset subtraction (plus a precomputed self-loop flag when undirected). */
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

  /** O(1): offset subtraction on the in-adjacency arrays. */
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

  /** O(1): offset subtraction. */
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

  /** O(V+E): allocates reversed Edge objects and rebuilds; an undirected graph is just cloned. */
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

  /** O(V+E) rebuild sharing the same Edge objects and vertex array. */
  clone(): Graph<V, E> {
    return CSR.create(this._vertices, this._edges, this._directed);
  }

  /** O(V+E); vertex data is not retained by CSR, so only vertex keys are written. */
  serialize(): string {
    return serializeGraph(
      "CSR",
      this._directed,
      this._vertices.map((vertex) => ({ vertex })),
      this._edges,
    );
  }

  /** O(V+E) after parsing; no per-insert overhead because the arrays are built in one pass. */
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

  /**
   * O(V+E): checks offset monotonicity, endpoint membership, target ranges, and that every
   * out-row and in-row is sorted (the invariant hasEdge/getEdge's binary search relies on).
   */
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
    for (let v = 0; v < this._vertices.length; v++) {
      for (let i = this._offsets[v] + 1; i < this._offsets[v + 1]; i++) {
        if (this._targets[i - 1] > this._targets[i]) {
          return `out-row ${v} is not sorted by target`;
        }
      }
      for (let i = this._inOffsets[v] + 1; i < this._inOffsets[v + 1]; i++) {
        if (this._inTargets[i - 1] > this._inTargets[i]) {
          return `in-row ${v} is not sorted by source`;
        }
      }
    }
    return true;
  }
}
