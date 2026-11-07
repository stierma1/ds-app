import test from "node:test";
import assert from "node:assert/strict";
import { GeneralizedList, OrthogonalList } from "../../src/index.ts";
import type { SparseMatrix } from "../../src/index.ts";

function exerciseMatrix(matrix: SparseMatrix): void {
  assert.equal(matrix.size, 0);
  matrix.set(0, 1, 2);
  matrix.set(1, 0, 3);
  matrix.set(1, 2, 4);
  assert.equal(matrix.size, 3);
  assert.equal(matrix.get(0, 1), 2);
  assert.equal(matrix.get(2, 2), undefined);
  assert.equal(matrix.has(1, 0), true);
  assert.equal(matrix.delete(1, 0), true);
  assert.equal(matrix.delete(1, 0), false);
  assert.deepEqual(matrix.row(1), [[2, 4]]);
  assert.deepEqual(matrix.column(1), [[0, 2]]);
  assert.deepEqual(matrix.entries(), [
    [0, 1, 2],
    [1, 2, 4],
  ]);
  assert.equal(matrix.validate(), true);
  matrix.clear();
  assert.equal(matrix.size, 0);
  assert.equal(matrix.validate(), true);
}

test("GeneralizedList sparse matrix operations", () => {
  exerciseMatrix(new GeneralizedList());
});

test("OrthogonalList sparse matrix operations", () => {
  exerciseMatrix(new OrthogonalList());
});

test("sparse matrices transpose and multiply", () => {
  const left = new OrthogonalList(2, 3);
  left.set(0, 0, 1);
  left.set(0, 2, 2);
  left.set(1, 1, 3);
  const transposed = left.transpose();
  assert.ok(transposed instanceof OrthogonalList);
  assert.equal(transposed.rows, 3);
  assert.equal(transposed.cols, 2);
  assert.deepEqual(transposed.entries(), [
    [0, 0, 1],
    [1, 1, 3],
    [2, 0, 2],
  ]);

  const right = new OrthogonalList(3, 2);
  right.set(0, 0, 4);
  right.set(1, 1, 5);
  right.set(2, 0, 6);
  const product = left.multiply(right);
  assert.deepEqual(product.entries(), [
    [0, 0, 16],
    [1, 1, 15],
  ]);
  assert.equal(product.validate(), true);
  assert.throws(() => left.multiply(new OrthogonalList(2, 2)), RangeError);
});

test("sparse matrices validate arguments", () => {
  const matrix = new GeneralizedList(2, 2);
  assert.throws(() => matrix.set(-1, 0, 1), RangeError);
  assert.throws(() => matrix.set(2, 0, 1), RangeError);
  assert.throws(() => matrix.set(0, 0.5, 1), TypeError);
  assert.throws(() => matrix.set(0, 0, Number.NaN), TypeError);
  assert.throws(() => matrix.row(-1), RangeError);
  assert.throws(() => matrix.column(2), RangeError);
  assert.throws(() => new GeneralizedList(1, undefined), TypeError);
  assert.throws(() => new GeneralizedList(-1, 1), RangeError);
});
