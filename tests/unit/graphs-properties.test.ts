import test from "node:test";
import assert from "node:assert/strict";
import {
  AdjacencyList,
  articulationPoints,
  bellmanFord,
  bipartiteMatching,
  bridges,
  dijkstra,
  floydWarshall,
  maxFlow,
  minCostMaxFlow,
  minimumSpanningTree,
  stronglyConnectedComponents,
  twoSat,
} from "../../src/index.ts";

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function reachable(
  count: number,
  edges: Array<[number, number]>,
  source: number,
): Uint8Array {
  const adjacency: number[][] = Array.from({ length: count }, () => []);
  for (const [from, to] of edges) {
    adjacency[from].push(to);
  }
  const seen = new Uint8Array(count);
  const queue: number[] = [source];
  seen[source] = 1;
  for (let head = 0; head < queue.length; head++) {
    for (const next of adjacency[queue[head]]) {
      if (seen[next] === 0) {
        seen[next] = 1;
        queue.push(next);
      }
    }
  }
  return seen;
}

function bruteScc(
  count: number,
  edges: Array<[number, number]>,
): number[][] {
  const forward = Array.from(
    { length: count },
    (_, source) => reachable(count, edges, source),
  );
  const reverse = Array.from(
    { length: count },
    (_, source) => reachable(count, edges.map(([a, b]) => [b, a]), source),
  );
  const assigned = new Uint8Array(count);
  const components: number[][] = [];
  for (let i = 0; i < count; i++) {
    if (assigned[i] === 1) {
      continue;
    }
    const component: number[] = [];
    for (let j = 0; j < count; j++) {
      if (assigned[j] === 0 && forward[i][j] === 1 && reverse[i][j] === 1) {
        assigned[j] = 1;
        component.push(j);
      }
    }
    components.push(component);
  }
  return components;
}

function normalize(components: number[][]): string[] {
  return components
    .map((component) => [...component].sort((a, b) => a - b).join(","))
    .sort();
}

function componentsWithout(
  count: number,
  edges: Array<[number, number]>,
  removedVertex: number,
  removedEdge: number,
): number {
  const parent = Array.from({ length: count }, (_, index) => index);
  const find = (value: number): number => {
    while (parent[value] !== value) {
      parent[value] = parent[parent[value]];
      value = parent[value];
    }
    return value;
  };
  for (let i = 0; i < edges.length; i++) {
    if (i === removedEdge) {
      continue;
    }
    const [from, to] = edges[i];
    if (from === removedVertex || to === removedVertex) {
      continue;
    }
    const left = find(from);
    const right = find(to);
    if (left !== right) {
      parent[left] = right;
    }
  }
  const roots = new Set<number>();
  for (let i = 0; i < count; i++) {
    if (i !== removedVertex) {
      roots.add(find(i));
    }
  }
  return roots.size;
}

test("SCC matches a reachability reference on random digraphs", () => {
  const next = random(0x51cc);
  for (let round = 0; round < 60; round++) {
    const count = 2 + Math.floor(next() * 5);
    const edges: Array<[number, number]> = [];
    const seen = new Set<string>();
    for (let i = 0; i < count; i++) {
      for (let j = 0; j < count; j++) {
        if (next() < 0.3) {
          const key = `${i}:${j}`;
          if (!seen.has(key)) {
            seen.add(key);
            edges.push([i, j]);
          }
        }
      }
    }
    const graph = new AdjacencyList(true);
    for (let i = 0; i < count; i++) {
      graph.addVertex(i);
    }
    for (const [from, to] of edges) {
      graph.addEdge(from, to);
    }
    const actual = stronglyConnectedComponents(graph).map((component) =>
      component.map(Number)
    );
    assert.deepEqual(normalize(actual), normalize(bruteScc(count, edges)));
  }
});

test("bridges and articulation points match removal references", () => {
  const next = random(0xb21d);
  for (let round = 0; round < 60; round++) {
    const count = 3 + Math.floor(next() * 5);
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        if (next() < 0.35) {
          pairs.push([i, j]);
        }
      }
    }
    const graph = new AdjacencyList();
    for (const [from, to] of pairs) {
      graph.addEdge(from, to);
    }
    const base = componentsWithout(count, pairs, -1, -1);
    const expectedBridges = pairs
      .filter((_, index) =>
        componentsWithout(count, pairs, -1, index) > base
      )
      .map(([from, to]) => [from, to].sort((a, b) => a - b).join(":"))
      .sort();
    const actualBridges = bridges(graph)
      .map((edge) =>
        [Number(edge.from), Number(edge.to)].sort((a, b) => a - b).join(":")
      )
      .sort();
    assert.deepEqual(actualBridges, expectedBridges);

    const expectedPoints: string[] = [];
    for (let vertex = 0; vertex < count; vertex++) {
      if (componentsWithout(count, pairs, vertex, -1) > base) {
        expectedPoints.push(String(vertex));
      }
    }
    assert.deepEqual(
      articulationPoints(graph).map(String).sort(),
      expectedPoints.sort(),
    );
  }
});

test("bipartiteMatching matches an exhaustive reference", () => {
  const next = random(0x3a1e);
  for (let round = 0; round < 60; round++) {
    const leftCount = 1 + Math.floor(next() * 4);
    const rightCount = 1 + Math.floor(next() * 4);
    const adjacency: number[][] = Array.from(
      { length: leftCount },
      () => [],
    );
    const graph = new AdjacencyList();
    for (let u = 0; u < leftCount; u++) {
      graph.addVertex(`l${u}`);
    }
    for (let v = 0; v < rightCount; v++) {
      graph.addVertex(`r${v}`);
    }
    for (let u = 0; u < leftCount; u++) {
      for (let v = 0; v < rightCount; v++) {
        if (next() < 0.45) {
          adjacency[u].push(v);
          graph.addEdge(`l${u}`, `r${v}`);
        }
      }
    }
    const brute = (
      u: number,
      used: boolean[],
    ): number => {
      if (u === leftCount) {
        return 0;
      }
      let best = brute(u + 1, used);
      for (const v of adjacency[u]) {
        if (!used[v]) {
          used[v] = true;
          best = Math.max(best, 1 + brute(u + 1, used));
          used[v] = false;
        }
      }
      return best;
    };
    const left = Array.from({ length: leftCount }, (_, u) => `l${u}`);
    assert.equal(
      bipartiteMatching(graph, left).length,
      brute(0, new Array(rightCount).fill(false)),
    );
  }
});

test("twoSat assignments are valid and unsatisfiable cases are proven", () => {
  const next = random(0x25a7);
  for (let round = 0; round < 100; round++) {
    const variables = 1 + Math.floor(next() * 3);
    const clauseCount = Math.floor(next() * 7);
    const clauses: Array<[number, number]> = [];
    for (let i = 0; i < clauseCount; i++) {
      const literal = (): number => {
        const variable = 1 + Math.floor(next() * variables);
        return next() < 0.5 ? variable : -variable;
      };
      clauses.push([literal(), literal()]);
    }
    const assignment = twoSat(clauses, variables);
    const satisfies = (values: boolean[]): boolean =>
      clauses.every(([a, b]) => {
        const left = a > 0 ? values[a - 1] : !values[-a - 1];
        const right = b > 0 ? values[b - 1] : !values[-b - 1];
        return left || right;
      });
    if (assignment !== undefined) {
      assert.equal(assignment.length, variables);
      assert.equal(satisfies(assignment), true);
    } else {
      let possible = false;
      for (let mask = 0; mask < 1 << variables; mask++) {
        const values = Array.from(
          { length: variables },
          (_, index) => (mask & (1 << index)) !== 0,
        );
        if (satisfies(values)) {
          possible = true;
          break;
        }
      }
      assert.equal(possible, false);
    }
  }
});

test("dijkstra agrees with Floyd-Warshall on random non-negative graphs", () => {
  const next = random(0xd1a5);
  for (let round = 0; round < 60; round++) {
    const count = 2 + Math.floor(next() * 5);
    const graph = new AdjacencyList(true);
    for (let i = 0; i < count; i++) {
      graph.addVertex(i);
    }
    for (let i = 0; i < count; i++) {
      for (let j = 0; j < count; j++) {
        if (i !== j && next() < 0.3) {
          graph.addEdge(i, j, Math.floor(next() * 10));
        }
      }
    }
    const distances = dijkstra(graph, 0);
    const matrix = floydWarshall(graph);
    for (let i = 0; i < count; i++) {
      assert.equal(distances.get(i), matrix[0][i]);
    }
  }
});

test("Prim and Kruskal agree on random weighted forests", () => {
  const next = random(0x9a1b);
  for (let round = 0; round < 60; round++) {
    const count = 2 + Math.floor(next() * 6);
    const graph = new AdjacencyList();
    for (let i = 0; i < count; i++) {
      graph.addVertex(i);
    }
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        if (next() < 0.4) {
          graph.addEdge(i, j, Math.floor(next() * 10));
        }
      }
    }
    const total = (edges: Array<{ weight: number }>): number =>
      edges.reduce((sum, edge) => sum + edge.weight, 0);
    assert.equal(
      total(minimumSpanningTree(graph)),
      total(minimumSpanningTree(graph, { algorithm: "kruskal" })),
    );
  }
});

function edmondsKarp(
  count: number,
  edges: Array<[number, number, number]>,
  source: number,
  sink: number,
): number {
  const capacity: number[][] = Array.from(
    { length: count },
    () => new Array<number>(count).fill(0),
  );
  for (const [from, to, cap] of edges) {
    capacity[from][to] += cap;
  }
  let flow = 0;
  while (true) {
    const parent = new Int32Array(count);
    parent.fill(-1);
    parent[source] = source;
    const queue: number[] = [source];
    for (let head = 0; head < queue.length && parent[sink] === -1; head++) {
      const current = queue[head];
      for (let next = 0; next < count; next++) {
        if (parent[next] === -1 && capacity[current][next] > 0) {
          parent[next] = current;
          queue.push(next);
        }
      }
    }
    if (parent[sink] === -1) {
      break;
    }
    let add = Infinity;
    for (let current = sink; current !== source; current = parent[current]) {
      add = Math.min(add, capacity[parent[current]][current]);
    }
    for (let current = sink; current !== source; current = parent[current]) {
      capacity[parent[current]][current] -= add;
      capacity[current][parent[current]] += add;
    }
    flow += add;
  }
  return flow;
}

test("maxFlow matches an Edmonds-Karp reference", () => {
  const next = random(0xf10a);
  for (let round = 0; round < 60; round++) {
    const count = 2 + Math.floor(next() * 4);
    const edges: Array<[number, number, number]> = [];
    const graph = new AdjacencyList(true);
    for (let i = 0; i < count; i++) {
      graph.addVertex(i);
      for (let j = 0; j < count; j++) {
        if (i !== j && next() < 0.35) {
          const capacity = Math.floor(next() * 6);
          edges.push([i, j, capacity]);
          graph.addEdge(i, j, capacity);
        }
      }
    }
    assert.equal(
      maxFlow(graph, 0, count - 1),
      edmondsKarp(count, edges, 0, count - 1),
    );
  }
});

test("minCostMaxFlow matches an exhaustive throughput reference", () => {
  const next = random(0xc057);
  for (let round = 0; round < 40; round++) {
    const count = 3 + Math.floor(next() * 2);
    const source = 0;
    const sink = count - 1;
    const edges: Array<[number, number, number, number]> = [];
    const graph = new AdjacencyList<unknown, { cost: number }>(true);
    for (let i = 0; i < count; i++) {
      graph.addVertex(i);
    }
    for (let i = 0; i < count; i++) {
      for (let j = 0; j < count; j++) {
        if (i !== j && next() < 0.35) {
          const capacity = 1 + Math.floor(next() * 2);
          const cost = Math.floor(next() * 5);
          edges.push([i, j, capacity, cost]);
          graph.addEdge(i, j, capacity, { cost });
        }
      }
    }
    let bestFlow = 0;
    let bestCost = 0;
    const flows = new Array<number>(edges.length).fill(0);
    const evaluate = (): void => {
      const balance = new Array<number>(count).fill(0);
      let cost = 0;
      for (let i = 0; i < edges.length; i++) {
        const [from, to, , edgeCost] = edges[i];
        const amount = flows[i];
        balance[from] -= amount;
        balance[to] += amount;
        cost += amount * edgeCost;
      }
      for (let vertex = 0; vertex < count; vertex++) {
        if (vertex !== source && vertex !== sink && balance[vertex] !== 0) {
          return;
        }
      }
      const flow = -balance[source];
      if (flow < 0 || balance[sink] !== flow) {
        return;
      }
      if (flow > bestFlow || (flow === bestFlow && cost < bestCost)) {
        bestFlow = flow;
        bestCost = cost;
      }
    };
    const search = (index: number): void => {
      if (index === edges.length) {
        evaluate();
        return;
      }
      for (let amount = 0; amount <= edges[index][2]; amount++) {
        flows[index] = amount;
        search(index + 1);
      }
    };
    search(0);
    assert.deepEqual(minCostMaxFlow(graph, source, sink), {
      flow: bestFlow,
      cost: bestCost,
    });
  }
});

test("bellmanFord agrees with Floyd-Warshall on graphs without negative cycles", () => {
  const next = random(0xbe11);
  for (let round = 0; round < 40; round++) {
    const count = 2 + Math.floor(next() * 4);
    const graph = new AdjacencyList(true);
    for (let i = 0; i < count; i++) {
      graph.addVertex(i);
    }
    for (let i = 0; i < count; i++) {
      for (let j = 0; j < count; j++) {
        if (i !== j && next() < 0.25) {
          graph.addEdge(i, j, Math.floor(next() * 7) - 3);
        }
      }
    }
    let hasNegativeCycle = false;
    try {
      bellmanFord(graph, 0);
    } catch {
      hasNegativeCycle = true;
    }
    if (hasNegativeCycle) {
      continue;
    }
    const distances = bellmanFord(graph, 0);
    const matrix = floydWarshall(graph);
    for (let i = 0; i < count; i++) {
      assert.equal(distances.get(i), matrix[0][i]);
    }
  }
});
