import test from "node:test";
import assert from "node:assert/strict";
import {
  AdjacencyList,
  AdjacencyMatrix,
  CSR,
  EdgeList,
} from "../../src/index.ts";
import type { Graph } from "../../src/graphs/types.ts";

interface EdgeData {
  label: string;
}

interface GraphCase {
  name: string;
  create: (directed?: boolean) => Graph<string, EdgeData>;
  empty: () => Graph<string, EdgeData>;
  deserialize: (json: unknown) => Graph<string, EdgeData>;
}

const cases: GraphCase[] = [
  {
    name: "AdjacencyList",
    create: (directed = true) =>
      build(new AdjacencyList<string, EdgeData>(directed)),
    empty: () => new AdjacencyList<string, EdgeData>(true),
    deserialize: (json) => AdjacencyList.deserialize<string, EdgeData>(json),
  },
  {
    name: "AdjacencyMatrix",
    create: (directed = true) =>
      build(new AdjacencyMatrix<string, EdgeData>(directed)),
    empty: () => new AdjacencyMatrix<string, EdgeData>(true),
    deserialize: (json) =>
      AdjacencyMatrix.deserialize<string, EdgeData>(json),
  },
  {
    name: "EdgeList",
    create: (directed = true) =>
      build(new EdgeList<string, EdgeData>(directed)),
    empty: () => new EdgeList<string, EdgeData>(true),
    deserialize: (json) => EdgeList.deserialize<string, EdgeData>(json),
  },
  {
    name: "CSR",
    create: (directed = true) =>
      CSR.from(build(new AdjacencyList<string, EdgeData>(directed))),
    empty: () => CSR.from(new AdjacencyList<string, EdgeData>(true)),
    deserialize: (json) => CSR.deserialize<string, EdgeData>(json),
  },
];

function build(
  graph: Graph<string, EdgeData>,
): Graph<string, EdgeData> {
  graph.addVertex("a", "A");
  graph.addVertex("b", "B");
  graph.addVertex("c", "C");
  graph.addVertex("isolated", "I");
  graph.addEdge("a", "b", 2, { label: "ab" });
  graph.addEdge("b", "c", 3, { label: "bc" });
  graph.addEdge("c", "c", 1, { label: "loop" });
  return graph;
}

function snapshot(graph: Graph): unknown {
  return {
    directed: graph.directed,
    order: graph.order,
    size: graph.size,
    vertices: [...graph.vertices()],
    edges: [...graph.edges()]
      .map((edge) => ({
        from: edge.from,
        to: edge.to,
        weight: edge.weight,
        data: edge.data,
      }))
      .sort((a, b) => {
        const left = `${String(a.from)}:${String(a.to)}:${a.weight}`;
        const right = `${String(b.from)}:${String(b.to)}:${b.weight}`;
        return left.localeCompare(right);
      }),
  };
}

for (const graphCase of cases) {
  test(`${graphCase.name} serializes and deserializes directed graphs`, () => {
    const original = graphCase.create();
    const expected = snapshot(original);
    const json = original.serialize();
    const record = JSON.parse(json);
    assert.equal(record.type, graphCase.name);
    assert.equal(record.version, 1);
    assert.equal(record.directed, true);

    for (const input of [json, record]) {
      const restored = graphCase.deserialize(input);
      assert.deepEqual(snapshot(restored), expected);
      assert.equal(restored.validate(), true);
      assert.equal(restored.getEdge("a", "b")?.data?.label, "ab");
    }
  });
}

test("serialization preserves undirected graphs", () => {
  const expected = snapshot(cases[0].create(false));
  for (const graphCase of cases) {
    const graph = graphCase.create(false);
    const restored = graphCase.deserialize(graph.serialize());
    assert.equal(restored.directed, false);
    assert.deepEqual(snapshot(restored), expected);
    assert.equal(restored.validate(), true);
  }
});

test("empty graphs round-trip for every representation", () => {
  for (const graphCase of cases) {
    const original = graphCase.empty();
    const restored = graphCase.deserialize(original.serialize());
    assert.equal(restored.order, 0);
    assert.equal(restored.size, 0);
    assert.equal(restored.validate(), true);
  }
});

test("deserialization rejects malformed graph records", () => {
  const original = build(new AdjacencyList<string, EdgeData>(true));
  const valid = JSON.parse(original.serialize());
  const clone = (): Record<string, unknown> =>
    JSON.parse(JSON.stringify(valid));

  const wrongType = clone();
  wrongType.type = "EdgeList";
  assert.throws(
    () => AdjacencyList.deserialize(wrongType),
    TypeError,
  );

  const wrongVersion = clone();
  wrongVersion.version = 99;
  assert.throws(() => AdjacencyList.deserialize(wrongVersion), TypeError);

  const wrongDirected = clone();
  wrongDirected.directed = "yes";
  assert.throws(() => AdjacencyList.deserialize(wrongDirected), TypeError);

  const duplicateVertex = clone();
  (duplicateVertex.vertices as unknown[]).push({ vertex: "a" });
  assert.throws(() => AdjacencyList.deserialize(duplicateVertex), TypeError);

  const unknownEndpoint = clone();
  (unknownEndpoint.edges as Array<Record<string, unknown>>)[0].to = "missing";
  assert.throws(() => AdjacencyList.deserialize(unknownEndpoint), TypeError);

  const duplicateEdge = clone();
  (duplicateEdge.edges as unknown[]).push({
    from: "a",
    to: "b",
    weight: 9,
  });
  assert.throws(() => AdjacencyList.deserialize(duplicateEdge), TypeError);

  const reversedDuplicate = clone();
  reversedDuplicate.directed = false;
  const edges = reversedDuplicate.edges as Array<Record<string, unknown>>;
  edges.push({ from: "b", to: "a", weight: 9 });
  assert.throws(
    () => AdjacencyList.deserialize(reversedDuplicate),
    TypeError,
  );

  const badWeight = clone();
  (badWeight.edges as Array<Record<string, unknown>>)[0].weight = Infinity;
  assert.throws(() => AdjacencyList.deserialize(badWeight), TypeError);

  const badVertex = clone();
  (badVertex.vertices as unknown[]).push({ vertex: true });
  assert.throws(() => AdjacencyList.deserialize(badVertex), TypeError);
});
