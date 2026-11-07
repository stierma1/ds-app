import test from "node:test";
import assert from "node:assert/strict";
import { SortedLinkedList, SortedList } from "../../src/index.ts";

function exerciseSorted(
  list: SortedList<number> | SortedLinkedList<number>,
): void {
  assert.equal(list.isEmpty(), true);
  assert.equal(list.min(), undefined);
  assert.equal(list.max(), undefined);
  assert.equal(list.find(1), undefined);
  assert.equal(list.indexOf(1), -1);

  for (const value of [5, 1, 3, 3, 2, 4, 5]) {
    list.add(value);
    assert.equal(list.validate(), true);
  }
  assert.deepEqual(list.toArray(), [1, 2, 3, 4, 5]);
  assert.equal(list.size, 5);
  assert.equal(list.min(), 1);
  assert.equal(list.max(), 5);
  assert.equal(list.find(3), 3);
  assert.equal(list.indexOf(1), 0);
  assert.equal(list.indexOf(3), 2);
  assert.equal(list.indexOf(5), 4);
  assert.equal(list.indexOf(99), -1);
  assert.equal(list.add(3), false);
  assert.equal(list.remove(3), true);
  assert.equal(list.remove(3), false);
  assert.deepEqual(list.toArray(), [1, 2, 4, 5]);
  assert.equal(list.validate(), true);
  list.clear();
  assert.equal(list.size, 0);
  assert.equal(list.validate(), true);
}

test("SortedList implements the sorted-set contract", () => {
  exerciseSorted(new SortedList());
});

test("SortedLinkedList implements the sorted-set contract", () => {
  exerciseSorted(new SortedLinkedList());
});

test("sorted lists honour custom comparators", () => {
  const list = new SortedList<number>((a, b) => b - a);
  [1, 5, 3, 2, 4].forEach((value) => list.add(value));
  assert.deepEqual(list.toArray(), [5, 4, 3, 2, 1]);
  assert.equal(list.min(), 5);
  assert.equal(list.max(), 1);
  assert.equal(list.indexOf(3), 2);
  assert.equal(list.validate(), true);
});

test("SortedList rejects undefined and unsupported default values", () => {
  const list = new SortedList<number>();
  assert.throws(() => list.add(undefined as never), TypeError);
  const objects = new SortedList<object>();
  objects.add({});
  assert.throws(() => objects.add({}), TypeError);
});
