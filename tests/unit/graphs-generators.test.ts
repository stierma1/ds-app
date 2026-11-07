import test from "node:test";
import assert from "node:assert/strict";
import {
  AdjacencyList,
  AdjacencyMatrix,
  completeBipartiteGraph,
  completeGraph,
  cycleGraph,
  gridGraph,
  pathGraph,
  randomDag,
  randomGraph,
  starGraph,
  topologicalSort,
} from "../../src/index.ts";
import type { Graph } from "../../src/graphs/types.ts";

function edgeKeys(graph: Graph): string[] {
  return [...graph.edges()]
    .map((edge) => `${String(edge.from)}->${String(edge.to)}:${edge.weight}`)
    .sort();
}

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test("structured generators produce the expected orders and sizes", () => {
  const path = pathGraph(5);
  assert.equal(path.order, 5);
  assert.equal(path.size, 4);
  assert.equal(path.directed, false);

  const directedPath = pathGraph(4, { directed: true });
  assert.equal(directedPath.directed, true);
  assert.deepEqual(edgeKeys(directedPath), ["0->1:1", "1->2:1", "2->3:1"]);

  const cycle = cycleGraph(5);
  assert.equal(cycle.order, 5);
  assert.equal(cycle.size, 5);
  assert.equal(cycleGraph(2).size, 1);
  assert.equal(cycleGraph(2, { directed: true }).size, 2);
  assert.equal(cycleGraph(0).size, 0);

  const star = starGraph(5);
  assert.equal(star.size, 4);
  assert.deepEqual(
    [...star.vertices()].filter((vertex) => star.degree(vertex) === 4),
    [0],
  );

  assert.equal(completeGraph(4).size, 6);
  assert.equal(completeGraph(4, { directed: true }).size, 12);
  assert.equal(completeBipartiteGraph(2, 3).size, 6);
  assert.equal(gridGraph(2, 3).order, 6);
  assert.equal(gridGraph(2, 3).size, 7);
});

test("generators honour a target graph and weight function", () => {
  const matrix = new AdjacencyMatrix();
  const generated = gridGraph(2, 2, {
    graph: matrix,
    weight: (from, to) => from * 10 + to,
  });
  assert.equal(generated, matrix);
  assert.equal(matrix.order, 4);
  assert.equal(matrix.size, 4);
  assert.equal(matrix.getEdge(0, 1)?.weight, 1);
  assert.equal(matrix.getEdge(2, 3)?.weight, 23);
  assert.equal(matrix.validate(), true);

  const weighted = pathGraph(3, { weight: () => 7 });
  assert.deepEqual(
    [...weighted.edges()].map((edge) => edge.weight),
    [7, 7],
  );
});

test("randomGraph is reproducible with a seeded source", () => {
  const first = randomGraph(8, 0.4, { random: seeded(0x51cc) });
  const second = randomGraph(8, 0.4, { random: seeded(0x51cc) });
  assert.deepEqual(edgeKeys(first), edgeKeys(second));
  assert.equal(first.order, 8);
  assert.equal(first.validate(), true);

  const dense = randomGraph(5, 1);
  assert.equal(dense.size, 10);
  assert.equal(randomGraph(5, 0).size, 0);

  const directed = randomGraph(4, 1, { directed: true });
  assert.equal(directed.size, 12);
});

test("randomDag always produces a DAG", () => {
  const graph = randomDag(30, 0.25, { random: seeded(0xd46a) });
  assert.equal(graph.directed, true);
  const order = topologicalSort(graph);
  assert.equal(order.length, 30);
  const position = new Map(order.map((vertex, index) => [vertex, index]));
  for (const edge of graph.edges()) {
    assert.ok(position.get(edge.from)! < position.get(edge.to)!);
  }
  assert.throws(
    () => randomDag(4, 0.5, { graph: new AdjacencyList() }),
    TypeError,
  );
});

test("generators reject invalid arguments", () => {
  assert.throws(() => pathGraph(-1), RangeError);
  assert.throws(() => cycleGraph(1.5), RangeError);
  assert.throws(() => starGraph(Number.NaN), RangeError);
  assert.throws(() => completeGraph(-2), RangeError);
  assert.throws(() => completeBipartiteGraph(-1, 2), RangeError);
  assert.throws(() => gridGraph(2, -1), RangeError);
  assert.throws(() => randomGraph(4, -0.1), RangeError);
  assert.throws(() => randomGraph(4, 1.1), RangeError);
  assert.throws(() => randomDag(4, 2), RangeError);
  assert.throws(
    () => randomGraph(4, 0.5, { random: () => 1 }),
    RangeError,
  );
  assert.throws(
    () => pathGraph(2, { weight: () => Number.POSITIVE_INFINITY }),
    TypeError,
  );
});
