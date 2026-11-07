import test from "node:test";
import assert from "node:assert/strict";
import {
  AdjacencyList,
  AdjacencyMatrix,
  CSR,
  EdgeList,
  UnsupportedError,
} from "../../src/index.ts";
import type { Graph } from "../../src/graphs/types.ts";

type Factory = () => Graph;

const undirectedFactories: Array<[string, Factory]> = [
  ["AdjacencyList", () => new AdjacencyList()],
  ["AdjacencyMatrix", () => new AdjacencyMatrix()],
  ["EdgeList", () => new EdgeList()],
];

const directedFactories: Array<[string, Factory]> = [
  ["AdjacencyList", () => new AdjacencyList(true)],
  ["AdjacencyMatrix", () => new AdjacencyMatrix(true)],
  ["EdgeList", () => new EdgeList(true)],
];

for (const [name, factory] of undirectedFactories) {
  test(`${name} satisfies the undirected graph contract`, () => {
    const graph = factory();
    assert.equal(graph.order, 0);
    assert.equal(graph.size, 0);
    assert.equal(graph.directed, false);
    assert.equal(graph.validate(), true);

    assert.equal(graph.addVertex("a"), true);
    assert.equal(graph.addVertex("a"), false);
    assert.equal(graph.addVertex("b"), true);
    assert.equal(graph.order, 2);
    assert.equal(graph.hasVertex("a"), true);
    assert.equal(graph.removeVertex("missing"), false);

    assert.equal(graph.addEdge("a", "b", 2), true);
    assert.equal(graph.addEdge("a", "b", 9), false);
    assert.equal(graph.size, 1);
    assert.equal(graph.hasEdge("a", "b"), true);
    assert.equal(graph.hasEdge("b", "a"), true);
    assert.equal(graph.getEdge("b", "a")?.weight, 2);
    assert.deepEqual([...graph.neighbors("a")], ["b"]);
    assert.deepEqual([...graph.neighbors("b")], ["a"]);
    assert.equal(graph.degree("a"), 1);
    assert.equal(graph.inDegree("a"), 1);
    assert.equal(graph.outDegree("a"), 1);

    assert.equal(graph.addEdge("a", "a", 3), true);
    assert.equal(graph.order, 2);
    assert.equal(graph.size, 2);
    assert.equal(graph.degree("a"), 3);
    assert.equal([...graph.incidentEdges("a")].length, 2);
    assert.deepEqual(
      [...graph.edges()].map((edge) => `${edge.from}-${edge.to}`).sort(),
      ["a-a", "a-b"],
    );

    const transpose = graph.transpose();
    assert.equal(transpose.directed, false);
    assert.equal(transpose.size, 2);
    assert.equal(transpose.hasEdge("a", "b"), true);
    assert.equal(transpose.validate(), true);

    const clone = graph.clone();
    clone.addEdge("a", "c");
    assert.equal(clone.order, 3);
    assert.equal(graph.order, 2);
    assert.equal(graph.validate(), true);

    assert.equal(graph.removeEdge("a", "b"), true);
    assert.equal(graph.removeEdge("a", "b"), false);
    assert.equal(graph.size, 1);
    assert.equal(graph.removeVertex("a"), true);
    assert.equal(graph.size, 0);
    assert.equal(graph.order, 1);
    assert.equal(graph.validate(), true);
  });
}

for (const [name, factory] of directedFactories) {
  test(`${name} satisfies the directed graph contract`, () => {
    const graph = factory();
    assert.equal(graph.directed, true);
    assert.equal(graph.addEdge("a", "b", 4), true);
    assert.equal(graph.order, 2);
    assert.equal(graph.size, 1);
    assert.equal(graph.hasEdge("a", "b"), true);
    assert.equal(graph.hasEdge("b", "a"), false);
    assert.deepEqual([...graph.neighbors("a")], ["b"]);
    assert.deepEqual([...graph.neighbors("b")], []);
    assert.equal(graph.degree("a"), 1);
    assert.equal(graph.outDegree("a"), 1);
    assert.equal(graph.inDegree("a"), 0);
    assert.equal(graph.inDegree("b"), 1);
    assert.equal([...graph.incidentEdges("b")].length, 1);

    assert.equal(graph.addEdge("b", "a", 7), true);
    assert.equal(graph.size, 2);
    assert.equal(graph.addEdge("c", "c", 1), true);
    assert.equal(graph.order, 3);
    assert.equal(graph.degree("c"), 2);
    assert.equal(graph.inDegree("c"), 1);
    assert.equal(graph.outDegree("c"), 1);

    const transpose = graph.transpose();
    assert.equal(transpose.directed, true);
    assert.equal(transpose.hasEdge("b", "a"), true);
    assert.equal(transpose.getEdge("b", "a")?.weight, 4);
    assert.equal(transpose.hasEdge("a", "b"), true);
    assert.equal(transpose.getEdge("a", "b")?.weight, 7);
    assert.equal(transpose.hasEdge("c", "c"), true);
    assert.equal(transpose.validate(), true);

    assert.equal(graph.removeVertex("b"), true);
    assert.equal(graph.order, 2);
    assert.equal(graph.size, 1);
    assert.equal(graph.hasEdge("a", "b"), false);
    assert.equal(graph.hasEdge("b", "a"), false);
    assert.equal(graph.validate(), true);
  });
}

test("CSR mirrors a source graph and is read-only", () => {
  const source = new AdjacencyList<string, { label: string }>(true);
  source.addVertex("a", "A");
  source.addVertex("b", "B");
  source.addVertex("c", "C");
  source.addEdge("a", "b", 2, { label: "ab" });
  source.addEdge("b", "c", 3, { label: "bc" });
  source.addEdge("c", "a", 4, { label: "ca" });
  const csr = CSR.from(source);
  assert.equal(csr.order, 3);
  assert.equal(csr.size, 3);
  assert.equal(csr.directed, true);
  assert.equal(csr.validate(), true);
  assert.deepEqual([...csr.vertices()], ["a", "b", "c"]);
  assert.deepEqual([...csr.neighbors("a")], ["b"]);
  assert.deepEqual([...csr.neighbors("b")], ["c"]);
  assert.equal(csr.degree("c"), 2);
  assert.equal(csr.inDegree("c"), 1);
  assert.equal(csr.outDegree("c"), 1);
  assert.equal(csr.getEdge("a", "b")?.data?.label, "ab");
  assert.equal(csr.hasEdge("a", "c"), false);
  assert.equal([...csr.incidentEdges("a")].length, 2);

  assert.throws(() => csr.addVertex("d"), UnsupportedError);
  assert.throws(() => csr.addEdge("a", "c"), UnsupportedError);
  assert.throws(() => csr.removeVertex("a"), UnsupportedError);
  assert.throws(() => csr.removeEdge("a", "b"), UnsupportedError);

  const transpose = csr.transpose();
  assert.equal(transpose.hasEdge("b", "a"), true);
  assert.equal(transpose.getEdge("b", "a")?.weight, 2);
  assert.equal(transpose.validate(), true);

  const clone = csr.clone();
  assert.notEqual(clone, csr);
  assert.equal(clone.validate(), true);
});

test("CSR handles undirected symmetry and self-loops", () => {
  const source = new AdjacencyList();
  source.addEdge("a", "b", 1);
  source.addEdge("a", "a", 2);
  const csr = CSR.from(source);
  assert.equal(csr.order, 2);
  assert.equal(csr.size, 2);
  assert.deepEqual([...csr.neighbors("a")].sort(), ["a", "b"]);
  assert.deepEqual([...csr.neighbors("b")], ["a"]);
  assert.equal(csr.degree("a"), 3);
  assert.equal([...csr.incidentEdges("a")].length, 2);
  assert.equal(csr.transpose().size, 2);
  assert.equal(csr.validate(), true);
});

test("validate detects corrupted representations", () => {
  const list = new AdjacencyList();
  list.addEdge("a", "b");
  (list as unknown as {
    _vertices: Map<string, { out: Map<string, { from: string }> }>;
  })._vertices.get("a")!.out.get("b")!.from = "missing";
  assert.notEqual(list.validate(), true);

  const asymmetric = new AdjacencyList();
  asymmetric.addEdge("a", "b");
  const record = (asymmetric as unknown as {
    _vertices: Map<string, { out: Map<string, unknown> }>;
  })._vertices.get("a")!;
  const edge = record.out.get("b");
  record.out.set("b", { ...(edge as object) });
  assert.notEqual(asymmetric.validate(), true);

  const matrix = new AdjacencyMatrix();
  matrix.addEdge("a", "b");
  (matrix as unknown as {
    _matrix: Array<Array<{ from: string } | undefined>>;
  })._matrix[0][1]!.from = "missing";
  assert.notEqual(matrix.validate(), true);

  const edges = new EdgeList();
  edges.addEdge("a", "b");
  (edges as unknown as { _vertices: Map<string, unknown> })._vertices.delete("b");
  assert.notEqual(edges.validate(), true);
});

test("invalid arguments are rejected", () => {
  const list = new AdjacencyList();
  list.addVertex("a");
  assert.throws(() => list.addVertex(Number.NaN), TypeError);
  assert.throws(() => list.addEdge("a", "b", Number.NaN), TypeError);
  assert.throws(() => list.neighbors("missing"), RangeError);
  assert.throws(() => list.degree("missing"), RangeError);
});
