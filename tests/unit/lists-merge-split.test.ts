import test from "node:test";
import assert from "node:assert/strict";
import {
  ArrayDeque,
  ArrayList,
  CircularList,
  CursorList,
  DoublyLinkedList,
  SinglyLinkedList,
  SortedLinkedList,
  SortedList,
  XorLinkedList,
} from "../../src/index.ts";
import type { ListLike } from "../../src/lists/types.ts";

const factories: Array<[string, () => ListLike<number>]> = [
  ["ArrayList", () => new ArrayList<number>()],
  ["ArrayDeque", () => new ArrayDeque<number>()],
  ["SinglyLinkedList", () => new SinglyLinkedList<number>()],
  ["DoublyLinkedList", () => new DoublyLinkedList<number>()],
  ["CircularList", () => new CircularList<number>()],
  ["CursorList", () => new CursorList<number>()],
  ["XorLinkedList", () => new XorLinkedList<number>()],
];

for (const [name, create] of factories) {
  test(`${name} merge appends in iteration order`, () => {
    const list = create();
    list.push(1);
    list.push(2);
    const returned = list.merge([3, 4]);
    assert.equal(returned, list);
    assert.deepEqual(list.toArray(), [1, 2, 3, 4]);
    assert.equal(list.size, 4);
    assert.equal(list.validate(), true);

    list.merge([5, 6]);
    assert.deepEqual(list.toArray(), [1, 2, 3, 4, 5, 6]);

    const self = create();
    self.merge([1, 2]);
    self.merge(self);
    assert.deepEqual(self.toArray(), [1, 2, 1, 2]);
    assert.equal(self.validate(), true);
    assert.throws(() => list.merge([undefined as never]), TypeError);
  });

  test(`${name} split preserves both halves`, () => {
    const list = create();
    list.merge([0, 1, 2, 3, 4, 5]);
    const right = list.split(3);
    assert.deepEqual(list.toArray(), [0, 1, 2]);
    assert.deepEqual(right.toArray(), [3, 4, 5]);
    assert.equal(list.size, 3);
    assert.equal(right.size, 3);
    assert.equal(list.validate(), true);
    assert.equal(right.validate(), true);

    list.merge(right);
    assert.deepEqual(list.toArray(), [0, 1, 2, 3, 4, 5]);
    assert.equal(list.validate(), true);

    const empty = create();
    empty.merge([1, 2]);
    const all = empty.split(0);
    assert.deepEqual(empty.toArray(), []);
    assert.deepEqual(all.toArray(), [1, 2]);
    assert.equal(empty.validate(), true);
    assert.equal(all.validate(), true);

    const none = create();
    none.merge([1, 2]);
    const tail = none.split(2);
    assert.deepEqual(none.toArray(), [1, 2]);
    assert.deepEqual(tail.toArray(), []);
    assert.equal(none.validate(), true);
    assert.equal(tail.validate(), true);

    assert.throws(() => none.split(-1), RangeError);
    assert.throws(() => none.split(3), RangeError);
    assert.throws(() => none.split(1.5), TypeError);
  });
}

test("CircularList split returns a CircularList", () => {
  const list = new CircularList<number>();
  list.merge([1, 2, 3, 4]);
  const right = list.split(2);
  assert.equal(right instanceof CircularList, true);
  assert.deepEqual(right.toArray(), [3, 4]);
  assert.equal(right.validate(), true);
});

test("sorted lists merge in order and drop duplicates", () => {
  for (const list of [new SortedList<number>(), new SortedLinkedList<number>()]) {
    list.add(3);
    list.add(1);
    const returned = list.merge([4, 2, 3, 0]);
    assert.equal(returned, list);
    assert.deepEqual(list.toArray(), [0, 1, 2, 3, 4]);
    assert.equal(list.validate(), true);

    list.merge(list);
    assert.deepEqual(list.toArray(), [0, 1, 2, 3, 4]);
    assert.throws(() => list.merge([undefined as never]), TypeError);
  }

  const descending = new SortedList<number>((a, b) => b - a);
  descending.merge([1, 4, 2, 3]);
  assert.deepEqual(descending.toArray(), [4, 3, 2, 1]);
  assert.equal(descending.validate(), true);
});
