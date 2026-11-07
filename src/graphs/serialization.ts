import {
  parseSerialized,
  readArray,
  readNumber,
  readObject,
  readValue,
  serializeRecord,
} from "../core/index.ts";
import type { Edge, Vertex } from "./types.ts";
import { assertVertex } from "./shared.ts";

export interface SerializedVertex<V> {
  vertex: Vertex;
  data?: V;
}

export interface ParsedGraph<V, E> {
  directed: boolean;
  vertices: Array<{ vertex: Vertex; data: V | undefined }>;
  edges: Array<Edge<E>>;
}

/**
 * O(V+E): validates and copies every vertex/edge into plain records (dropping undefined
 * `data` keys), then JSON.stringify. Output size is O(V+E); the caller's `edges` iterable
 * cost is extra (O(V^2) for AdjacencyMatrix.edges()).
 */
export function serializeGraph<V, E>(
  type: string,
  directed: boolean,
  vertices: Iterable<{ vertex: Vertex; data?: V }>,
  edges: Iterable<Edge<E>>,
): string {
  const vertexEntries: SerializedVertex<V>[] = [];
  for (const entry of vertices) {
    assertVertex(entry.vertex);
    if (entry.data === undefined) {
      vertexEntries.push({ vertex: entry.vertex });
    } else {
      vertexEntries.push({ vertex: entry.vertex, data: entry.data });
    }
  }
  const edgeEntries: Edge<E>[] = [];
  for (const edge of edges) {
    assertVertex(edge.from);
    assertVertex(edge.to);
    if (!Number.isFinite(edge.weight)) {
      throw new TypeError("Edge weight must be a finite number");
    }
    if (edge.data === undefined) {
      edgeEntries.push({
        from: edge.from,
        to: edge.to,
        weight: edge.weight,
      });
    } else {
      edgeEntries.push({
        from: edge.from,
        to: edge.to,
        weight: edge.weight,
        data: edge.data,
      });
    }
  }
  return serializeRecord(type, {
    directed,
    vertices: vertexEntries,
    edges: edgeEntries,
  });
}

/**
 * O(V+E) expected: duplicate vertices are caught with a Set and duplicate edges (either
 * orientation when undirected) with a Map<Vertex, Set<Vertex>>, so each check is O(1)
 * rather than a scan. Throws TypeError on the first fault. Returns plain arrays; the
 * representation's deserialize then pays its own insert costs (O(E^2) for EdgeList,
 * O(V^2) for AdjacencyMatrix, O(V+E) for AdjacencyList and CSR).
 */
export function parseGraph<V, E>(
  json: unknown,
  type: string,
): ParsedGraph<V, E> {
  const record = parseSerialized(json, type);
  if (typeof record.directed !== "boolean") {
    throw new TypeError("directed must be a boolean");
  }
  const rawVertices = readArray(record, "vertices");
  const vertices: ParsedGraph<V, E>["vertices"] = [];
  const seen = new Set<Vertex>();
  for (let index = 0; index < rawVertices.length; index++) {
    const entry = readObject(rawVertices[index], `vertices[${index}]`);
    const vertex = entry.vertex;
    if (typeof vertex !== "string" && typeof vertex !== "number") {
      throw new TypeError(`vertices[${index}].vertex must be a string or number`);
    }
    assertVertex(vertex, `vertices[${index}].vertex`);
    if (seen.has(vertex)) {
      throw new TypeError(`vertices[${index}].vertex is duplicated`);
    }
    seen.add(vertex);
    const data = entry.data === undefined
      ? undefined
      : readValue<V>(entry.data, `vertices[${index}].data`);
    vertices.push({ vertex, data });
  }
  const rawEdges = readArray(record, "edges");
  const edges: Edge<E>[] = [];
  const edgeSeen = new Map<Vertex, Set<Vertex>>();
  const hasEdge = (from: Vertex, to: Vertex): boolean =>
    edgeSeen.get(from)?.has(to) ?? false;
  const markEdge = (from: Vertex, to: Vertex): void => {
    let targets = edgeSeen.get(from);
    if (targets === undefined) {
      targets = new Set();
      edgeSeen.set(from, targets);
    }
    targets.add(to);
  };
  for (let index = 0; index < rawEdges.length; index++) {
    const entry = readObject(rawEdges[index], `edges[${index}]`);
    const from = entry.from;
    const to = entry.to;
    if (typeof from !== "string" && typeof from !== "number") {
      throw new TypeError(`edges[${index}].from must be a string or number`);
    }
    if (typeof to !== "string" && typeof to !== "number") {
      throw new TypeError(`edges[${index}].to must be a string or number`);
    }
    assertVertex(from, `edges[${index}].from`);
    assertVertex(to, `edges[${index}].to`);
    if (!seen.has(from) || !seen.has(to)) {
      throw new TypeError(`edges[${index}] has an unknown endpoint`);
    }
    if (
      hasEdge(from, to) ||
      (record.directed === false && hasEdge(to, from))
    ) {
      throw new TypeError(`edges[${index}] duplicates an existing edge`);
    }
    markEdge(from, to);
    if (record.directed === false) {
      markEdge(to, from);
    }
    const weight = readNumber(entry, "weight");
    const data = entry.data === undefined
      ? undefined
      : readValue<E>(entry.data, `edges[${index}].data`);
    if (data === undefined) {
      edges.push({ from, to, weight });
    } else {
      edges.push({ from, to, weight, data });
    }
  }
  return { directed: record.directed, vertices, edges };
}

