import test from "node:test";
import assert from "node:assert/strict";
import {
  AdjacencyList,
  edmondsKarp,
  maxFlow,
  minCostMaxFlow,
  minimumSpanningTree,
} from "../../src/index.ts";

function square(): AdjacencyList {
  const graph = new AdjacencyList();
  graph.addEdge("a", "b", 1);
  graph.addEdge("b", "c", 2);
  graph.addEdge("c", "d", 3);
  graph.addEdge("d", "a", 4);
  graph.addEdge("a", "c", 5);
  return graph;
}

function totalWeight(edges: Array<{ weight: number }>): number {
  return edges.reduce((sum, edge) => sum + edge.weight, 0);
}

test("minimumSpanningTree matches for Prim and Kruskal", () => {
  const graph = square();
  const prim = minimumSpanningTree(graph);
  const kruskal = minimumSpanningTree(graph, { algorithm: "kruskal" });
  assert.equal(prim.length, 3);
  assert.equal(kruskal.length, 3);
  assert.equal(totalWeight(prim), 6);
  assert.equal(totalWeight(kruskal), 6);
  assert.equal(graph.validate(), true);
});

test("minimumSpanningTree returns a forest when disconnected", () => {
  const graph = new AdjacencyList();
  graph.addEdge("a", "b", 1);
  graph.addEdge("c", "d", 2);
  graph.addVertex("e");
  assert.equal(minimumSpanningTree(graph).length, 2);
  assert.equal(
    minimumSpanningTree(graph, { algorithm: "kruskal" }).length,
    2,
  );
  assert.throws(() => minimumSpanningTree(new AdjacencyList(true)), TypeError);
  assert.throws(
    () => minimumSpanningTree(graph, { algorithm: "bad" as "prim" }),
    TypeError,
  );
});

test("minimumSpanningTree honors a weight selector", () => {
  const graph = new AdjacencyList();
  graph.addEdge("a", "b", 100);
  graph.addEdge("b", "c", 1);
  graph.addEdge("a", "c", 2);
  const edges = minimumSpanningTree(graph, { weight: () => 1 });
  assert.equal(edges.length, 2);
});

function flowNetwork(): AdjacencyList {
  const graph = new AdjacencyList<unknown, { cost?: number }>(true);
  graph.addEdge("s", "v1", 16, {});
  graph.addEdge("s", "v2", 13, {});
  graph.addEdge("v1", "v2", 10, {});
  graph.addEdge("v2", "v1", 4, {});
  graph.addEdge("v1", "v3", 12, {});
  graph.addEdge("v3", "v2", 9, {});
  graph.addEdge("v2", "v4", 14, {});
  graph.addEdge("v4", "v3", 7, {});
  graph.addEdge("v3", "t", 20, {});
  graph.addEdge("v4", "t", 4, {});
  return graph;
}

test("maxFlow computes the Edmonds-Karp/Dinic value", () => {
  assert.equal(maxFlow(flowNetwork(), "s", "t"), 23);
  assert.equal(
    maxFlow(flowNetwork(), "s", "t", { weight: (edge) => edge.weight }),
    23,
  );
  assert.equal(
    maxFlow(flowNetwork(), "s", "t", { algorithm: "edmonds-karp" }),
    23,
  );
  assert.equal(edmondsKarp(flowNetwork(), "s", "t"), 23);
  assert.throws(() => maxFlow(new AdjacencyList(), "s", "t"), TypeError);
  assert.throws(() => edmondsKarp(new AdjacencyList(), "s", "t"), TypeError);
  assert.throws(
    () => maxFlow(flowNetwork(), "s", "t", { algorithm: "bad" as "dinic" }),
    TypeError,
  );

  const negative = new AdjacencyList(true);
  negative.addEdge("s", "t", -1);
  assert.throws(() => maxFlow(negative, "s", "t"), RangeError);
  assert.throws(() => edmondsKarp(negative, "s", "t"), RangeError);
});

test("minCostMaxFlow finds the cheapest maximum flow", () => {
  const graph = new AdjacencyList<unknown, { cost: number }>(true);
  graph.addEdge("s", "a", 1, { cost: 1 });
  graph.addEdge("a", "t", 1, { cost: 1 });
  graph.addEdge("s", "b", 1, { cost: 5 });
  graph.addEdge("b", "t", 1, { cost: 0 });
  assert.deepEqual(minCostMaxFlow(graph, "s", "t"), { flow: 2, cost: 7 });

  const negative = new AdjacencyList<unknown, { cost: number }>(true);
  negative.addEdge("s", "a", 2, { cost: -1 });
  negative.addEdge("a", "t", 2, { cost: 0 });
  assert.deepEqual(minCostMaxFlow(negative, "s", "t"), {
    flow: 2,
    cost: -2,
  });

  const selected = minCostMaxFlow(graph, "s", "t", { cost: () => 2 });
  assert.deepEqual(selected, { flow: 2, cost: 8 });
});
