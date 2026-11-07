import test from "node:test";
import assert from "node:assert/strict";
import {
  ConcurrentModificationError,
  ArrayList,
  CircularList,
  CursorList,
  DoublyLinkedList,
  SinglyLinkedList,
  XorLinkedList,
} from "../../src/index.ts";
import type { ListLike } from "../../src/lists/types.ts";
import { assertListContract } from "./list-model.ts";

const factories: Array<[string, () => ListLike<number>]> = [
  ["ArrayList", () => new ArrayList<number>()],
  ["SinglyLinkedList", () => new SinglyLinkedList<number>()],
  ["DoublyLinkedList", () => new DoublyLinkedList<number>()],
  ["CircularList", () => new CircularList<number>()],
  ["CursorList", () => new CursorList<number>()],
  ["XorLinkedList", () => new XorLinkedList<number>()],
];

for (const [name, factory] of factories) {
  test(`${name} satisfies the positional list contract`, () => {
    assertListContract(factory(), name.length, 400);
  });
}

test("ArrayList boundary and error semantics", () => {
  const list = new ArrayList<number>();
  assert.equal(list.get(0), undefined);
  assert.equal(list.remove(0), undefined);
  assert.equal(list.pop(), undefined);
  assert.equal(list.shift(), undefined);
  assert.equal(list.first(), undefined);
  assert.equal(list.last(), undefined);
  assert.equal(list.indexOf(1), -1);
  assert.throws(() => list.get(1.5), TypeError);
  assert.throws(() => list.set(0, 1), RangeError);
  assert.throws(() => list.insert(1, 1), RangeError);
  assert.throws(() => list.push(undefined as never), TypeError);
  assert.throws(() => list.slice(0.5), TypeError);
  list.push(1);
  list.push(2);
  list.push(3);
  assert.deepEqual(list.splice(1, 1, 9), [2]);
  assert.deepEqual(list.toArray(), [1, 9, 3]);
  assert.deepEqual(list.splice(-1, 1), [3]);
  assert.deepEqual(list.toArray(), [1, 9]);
  assert.deepEqual(list.slice(-1), [9]);
  assert.equal(list.validate(), true);
});

test("ArrayList iterators are invalidated by mutation", () => {
  const list = new ArrayList<number>();
  list.push(1);
  list.push(2);
  list.push(3);
  const iterator = list[Symbol.iterator]();
  assert.deepEqual(iterator.next(), { done: false, value: 1 });
  list.push(4);
  assert.throws(() => iterator.next(), ConcurrentModificationError);
});

test("ArrayList sort and reverse mutate in place", () => {
  const list = new ArrayList<number>();
  list.push(3);
  list.push(1);
  list.push(2);
  assert.equal(list.sort((a, b) => a - b), list);
  assert.deepEqual(list.toArray(), [1, 2, 3]);
  assert.equal(list.reverse(), list);
  assert.deepEqual(list.toArray(), [3, 2, 1]);
  assert.equal(list.validate(), true);
});

test("CircularList rotates in both directions", () => {
  const list = new CircularList<number>();
  [1, 2, 3, 4, 5].forEach((value) => list.push(value));
  assert.equal(list.rotate(2), list);
  assert.deepEqual(list.toArray(), [4, 5, 1, 2, 3]);
  list.rotate(-1);
  assert.deepEqual(list.toArray(), [5, 1, 2, 3, 4]);
  list.rotate(5);
  assert.deepEqual(list.toArray(), [5, 1, 2, 3, 4]);
  list.rotate(0);
  assert.deepEqual(list.toArray(), [5, 1, 2, 3, 4]);
  assert.throws(() => list.rotate(1.5), TypeError);
  assert.equal(list.validate(), true);
});

test("linked lists report broken links through validate", () => {
  const list = new DoublyLinkedList<number>();
  list.push(1);
  list.push(2);
  const root = (list as unknown as { _head: { next: { prev: unknown } } })._head;
  root.next.prev = null;
  assert.notEqual(list.validate(), true);
});
