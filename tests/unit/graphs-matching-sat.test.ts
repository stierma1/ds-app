import test from "node:test";
import assert from "node:assert/strict";
import {
  AdjacencyList,
  bipartiteMatching,
  twoSat,
} from "../../src/index.ts";

test("bipartiteMatching finds a maximum matching", () => {
  const complete = new AdjacencyList();
  for (const left of ["a", "b", "c"]) {
    for (const right of ["x", "y", "z"]) {
      complete.addEdge(left, right);
    }
  }
  const matching = bipartiteMatching(complete, ["a", "b", "c"]);
  assert.equal(matching.length, 3);
  assert.equal(
    new Set(matching.flatMap((edge) => [edge.from, edge.to])).size,
    6,
  );

  const path = new AdjacencyList();
  path.addEdge("a", "b");
  path.addEdge("c", "b");
  path.addEdge("c", "d");
  assert.equal(bipartiteMatching(path, ["a", "c"]).length, 2);

  assert.equal(bipartiteMatching(path, []).length, 0);
  assert.throws(() => bipartiteMatching(path, ["missing"]), RangeError);
});

test("twoSat returns satisfying assignments", () => {
  assert.deepEqual(twoSat([[1, 1]], 1), [true]);
  assert.deepEqual(twoSat([[-1, -1]], 1), [false]);
  assert.equal(twoSat([[1, 1], [-1, -1]], 1), undefined);
  assert.deepEqual(twoSat([], 0), []);

  const clauses: Array<[number, number]> = [
    [1, 2],
    [-1, 3],
    [-2, -3],
    [4, -1],
    [-4, -2],
  ];
  const assignment = twoSat(clauses, 4);
  assert.ok(assignment);
  for (const [a, b] of clauses) {
    const left: boolean = a > 0 ? assignment![a - 1] : !assignment![-a - 1];
    const right: boolean = b > 0 ? assignment![b - 1] : !assignment![-b - 1];
    assert.equal(left || right, true);
  }
});

test("twoSat validates its input", () => {
  assert.throws(() => twoSat([[1, 2]], -1), RangeError);
  assert.throws(() => twoSat([[1, 2]], 1), RangeError);
  assert.throws(() => twoSat([[0, 1]], 1), TypeError);
  assert.throws(() => twoSat([[1.5, 1]], 2), TypeError);
  assert.throws(
    () => twoSat(([[1]] as unknown) as Array<[number, number]>, 2),
    TypeError,
  );
});
