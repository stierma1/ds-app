import test from "node:test";
import assert from "node:assert/strict";
import {
  AdjacencyList,
  aStar,
  bellmanFord,
  dijkstra,
  floydWarshall,
} from "../../src/index.ts";
import type { Vertex } from "../../src/graphs/types.ts";

test("dijkstra computes shortest distances", () => {
  const graph = new AdjacencyList();
  graph.addEdge("a", "b", 2);
  graph.addEdge("a", "c", 5);
  graph.addEdge("b", "c", 1);
  const distances = dijkstra(graph, "a");
  assert.equal(distances.get("a"), 0);
  assert.equal(distances.get("b"), 2);
  assert.equal(distances.get("c"), 3);
  assert.equal(distances.get("missing"), undefined);
  assert.equal(graph.validate(), true);
});

test("dijkstra reports unreachable vertices and rejects negative weights", () => {
  const graph = new AdjacencyList();
  graph.addEdge("a", "b", 1);
  graph.addVertex("c");
  const distances = dijkstra(graph, "a");
  assert.equal(distances.get("b"), 1);
  assert.equal(distances.get("c"), Infinity);

  graph.addEdge("b", "c", -1);
  assert.throws(() => dijkstra(graph, "a"), RangeError);
  assert.throws(() => dijkstra(new AdjacencyList(), "missing"), RangeError);
});

test("dijkstra honors a weight selector and directedness", () => {
  const graph = new AdjacencyList(true);
  graph.addEdge("a", "b", 100);
  graph.addEdge("b", "a", 1);
  const distances = dijkstra(graph, "a", { weight: () => 2 });
  assert.equal(distances.get("b"), 2);
  assert.equal(dijkstra(graph, "b").get("a"), 1);
  assert.equal(dijkstra(graph, "b").get("b"), 0);
});

test("bellmanFord supports negative edges and detects negative cycles", () => {
  const graph = new AdjacencyList(true);
  graph.addEdge("a", "b", 4);
  graph.addEdge("a", "c", 5);
  graph.addEdge("b", "c", -2);
  graph.addEdge("c", "d", 3);
  const distances = bellmanFord(graph, "a");
  assert.equal(distances.get("c"), 2);
  assert.equal(distances.get("d"), 5);

  const cycle = new AdjacencyList(true);
  cycle.addEdge("a", "b", 1);
  cycle.addEdge("b", "c", -3);
  cycle.addEdge("c", "a", 1);
  assert.throws(() => bellmanFord(cycle, "a"), RangeError);
});

test("floydWarshall builds an all-pairs matrix", () => {
  const graph = new AdjacencyList(true);
  graph.addEdge(0, 1, 3);
  graph.addEdge(1, 2, 1);
  graph.addEdge(0, 2, 10);
  const matrix = floydWarshall(graph);
  assert.deepEqual(matrix, [
    [0, 3, 4],
    [Infinity, 0, 1],
    [Infinity, Infinity, 0],
  ]);
});

test("aStar finds an exact path on a grid", () => {
  const graph = new AdjacencyList();
  const size = 4;
  const key = (x: number, y: number): string => `${x},${y}`;
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      if (x + 1 < size) graph.addEdge(key(x, y), key(x + 1, y), 1);
      if (y + 1 < size) graph.addEdge(key(x, y), key(x, y + 1), 1);
    }
  }
  const heuristic = (vertex: Vertex): number => {
    const [x, y] = String(vertex).split(",").map(Number);
    return Math.abs(x - 3) + Math.abs(y - 3);
  };
  const result = aStar(graph, key(0, 0), key(3, 3), heuristic);
  assert.equal(result.distance, 6);
  assert.equal(result.path.length, 7);
  assert.equal(result.path[0], key(0, 0));
  assert.equal(result.path[result.path.length - 1], key(3, 3));

  const zero = aStar(graph, key(0, 0), key(3, 3), () => 0);
  assert.equal(zero.distance, 6);
  assert.throws(() => aStar(graph, key(0, 0), key(3, 3), () => -1), RangeError);
});
