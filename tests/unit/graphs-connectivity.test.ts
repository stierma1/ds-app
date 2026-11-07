import test from "node:test";
import assert from "node:assert/strict";
import {
  AdjacencyList,
  articulationPoints,
  biconnectedComponents,
  bridges,
  eulerPath,
  stronglyConnectedComponents,
} from "../../src/index.ts";

function componentsAsSets(components: unknown[][]): string[][] {
  return components
    .map((component) => [...component].map(String).sort())
    .sort((a, b) => a.join(",").localeCompare(b.join(",")));
}

test("stronglyConnectedComponents finds Tarjan components", () => {
  const graph = new AdjacencyList(true);
  graph.addEdge("a", "b");
  graph.addEdge("b", "c");
  graph.addEdge("c", "a");
  graph.addEdge("d", "c");
  graph.addEdge("d", "e");
  graph.addEdge("e", "d");
  assert.deepEqual(componentsAsSets(stronglyConnectedComponents(graph)), [
    ["a", "b", "c"],
    ["d", "e"],
  ]);

  const chain = new AdjacencyList(true);
  chain.addEdge("a", "b");
  chain.addEdge("b", "c");
  assert.deepEqual(stronglyConnectedComponents(chain), [["c"], ["b"], ["a"]]);
});

test("bridges and articulation points match a known graph", () => {
  const graph = new AdjacencyList();
  graph.addEdge("a", "b");
  graph.addEdge("b", "c");
  graph.addEdge("b", "d");
  graph.addEdge("c", "d");
  const bridgeEdges = bridges(graph);
  assert.equal(bridgeEdges.length, 1);
  assert.deepEqual(
    [bridgeEdges[0].from, bridgeEdges[0].to].sort(),
    ["a", "b"],
  );
  assert.deepEqual(articulationPoints(graph), ["b"]);

  const components = biconnectedComponents(graph);
  assert.equal(components.length, 2);
  const sizes = components.map((component) => component.length).sort();
  assert.deepEqual(sizes, [1, 3]);

  assert.throws(() => bridges(new AdjacencyList(true)), TypeError);
  assert.throws(() => articulationPoints(new AdjacencyList(true)), TypeError);
});

test("low-link algorithms do not overflow on deep graphs", () => {
  const graph = new AdjacencyList();
  const depth = 10000;
  for (let i = 0; i < depth; i++) {
    graph.addEdge(i, i + 1);
  }
  assert.equal(bridges(graph).length, depth);
  assert.deepEqual(articulationPoints(graph), Array.from(
    { length: depth - 1 },
    (_, index) => index + 1,
  ));
});

test("eulerPath finds circuits and trails", () => {
  const triangle = new AdjacencyList();
  triangle.addEdge("a", "b");
  triangle.addEdge("b", "c");
  triangle.addEdge("c", "a");
  const circuit = eulerPath(triangle)!;
  assert.equal(circuit.length, 4);
  assert.equal(circuit[0], circuit[circuit.length - 1]);

  const path = new AdjacencyList();
  path.addEdge("a", "b");
  path.addEdge("b", "c");
  path.addEdge("c", "d");
  assert.deepEqual(eulerPath(path), ["a", "b", "c", "d"]);

  const star = new AdjacencyList();
  star.addEdge("a", "b");
  star.addEdge("a", "c");
  star.addEdge("a", "d");
  assert.equal(eulerPath(star), undefined);

  const disconnected = new AdjacencyList();
  disconnected.addEdge("a", "b");
  disconnected.addEdge("c", "d");
  assert.equal(eulerPath(disconnected), undefined);
  assert.deepEqual(eulerPath(new AdjacencyList()), []);
});

test("eulerPath handles directed graphs", () => {
  const cycle = new AdjacencyList(true);
  cycle.addEdge("a", "b");
  cycle.addEdge("b", "c");
  cycle.addEdge("c", "a");
  const circuit = eulerPath(cycle)!;
  assert.equal(circuit.length, 4);
  assert.equal(circuit[0], circuit[circuit.length - 1]);

  const trail = new AdjacencyList(true);
  trail.addEdge("a", "b");
  trail.addEdge("b", "c");
  assert.deepEqual(eulerPath(trail), ["a", "b", "c"]);

  const mismatch = new AdjacencyList(true);
  mismatch.addEdge("a", "b");
  mismatch.addEdge("a", "c");
  assert.equal(eulerPath(mismatch), undefined);
});
