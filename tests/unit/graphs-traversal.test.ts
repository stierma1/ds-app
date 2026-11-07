import test from "node:test";
import assert from "node:assert/strict";
import {
  AdjacencyList,
  AdjacencyMatrix,
  CSR,
  EdgeList,
  bfs,
  connectedComponents,
  dfs,
  topologicalSort,
} from "../../src/index.ts";
import type { Graph } from "../../src/graphs/types.ts";

function undirectedSample(): AdjacencyList {
  const graph = new AdjacencyList();
  graph.addEdge("a", "b");
  graph.addEdge("a", "c");
  graph.addEdge("b", "d");
  graph.addEdge("c", "d");
  graph.addEdge("e", "f");
  return graph;
}

function directedSample(): AdjacencyList {
  const graph = new AdjacencyList(true);
  graph.addEdge("a", "b");
  graph.addEdge("a", "c");
  graph.addEdge("b", "d");
  graph.addEdge("c", "d");
  return graph;
}

test("bfs and dfs traverse in deterministic order", () => {
  const graph = undirectedSample();
  assert.deepEqual(bfs(graph, "a"), ["a", "b", "c", "d"]);
  assert.deepEqual(dfs(graph, "a"), ["a", "b", "d", "c"]);
  assert.deepEqual(bfs(graph, "e"), ["e", "f"]);
  assert.deepEqual(dfs(graph, "e"), ["e", "f"]);
  assert.throws(() => bfs(graph, "missing"), RangeError);
  assert.throws(() => dfs(graph, "missing"), RangeError);
});

test("connectedComponents returns weak components of directed graphs", () => {
  const graph = undirectedSample();
  assert.deepEqual(connectedComponents(graph), [
    ["a", "b", "c", "d"],
    ["e", "f"],
  ]);
  const directed = new AdjacencyList(true);
  directed.addEdge("a", "b");
  directed.addEdge("c", "b");
  assert.deepEqual(connectedComponents(directed), [["a", "b", "c"]]);
});

test("topologicalSort handles DAGs and rejects cycles", () => {
  const graph = directedSample();
  assert.deepEqual(topologicalSort(graph), ["a", "b", "c", "d"]);
  assert.throws(() => topologicalSort(new AdjacencyList()), TypeError);

  const cyclic = new AdjacencyList(true);
  cyclic.addEdge("a", "b");
  cyclic.addEdge("b", "a");
  assert.throws(() => topologicalSort(cyclic), RangeError);
});

test("dfs and bfs do not overflow on deep graphs", () => {
  const graph = new AdjacencyList(true);
  const depth = 20000;
  for (let i = 0; i < depth; i++) {
    graph.addEdge(i, i + 1);
  }
  assert.equal(bfs(graph, 0).length, depth + 1);
  assert.equal(dfs(graph, 0).length, depth + 1);
  assert.equal(connectedComponents(graph)[0].length, depth + 1);
});

test("all representations agree on traversal algorithms", () => {
  const build = (target: Graph): void => {
    target.addEdge("a", "b", 1);
    target.addEdge("a", "c", 2);
    target.addEdge("b", "d", 3);
    target.addEdge("c", "d", 1);
    target.addEdge("d", "e", 1);
  };
  const list = new AdjacencyList();
  build(list);
  const matrix = new AdjacencyMatrix();
  build(matrix);
  const edges = new EdgeList();
  build(edges);
  const csr = CSR.from(list);
  const expected = {
    bfs: bfs(list, "a"),
    dfs: dfs(list, "a"),
    components: connectedComponents(list),
  };
  for (const graph of [matrix, edges, csr]) {
    assert.deepEqual(bfs(graph, "a"), expected.bfs);
    assert.deepEqual(dfs(graph, "a"), expected.dfs);
    assert.deepEqual(connectedComponents(graph), expected.components);
  }
});
