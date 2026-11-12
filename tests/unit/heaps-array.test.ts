import test from "node:test";
import assert from "node:assert/strict";
import {
  BinaryHeap,
  DaryHeap,
  SortedArrayHeap,
} from "../../src/index.ts";
import { ConsumedError } from "../../src/core/index.ts";
import type { Heap } from "../../src/heaps/types.ts";

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function drain(heap: Heap<number>): number[] {
  const values: number[] = [];
  while (!heap.isEmpty()) {
    values.push(heap.pop() as number);
    assert.equal(heap.validate(), true);
  }
  return values;
}

function ascending(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}

test("BinaryHeap implements the heap contract", () => {
  const heap = new BinaryHeap<number>();
  assert.equal(heap.peek(), undefined);
  assert.equal(heap.pop(), undefined);
  assert.equal(heap.height, 0);
  for (const value of [5, 1, 4, 2, 3, 3]) {
    heap.push(value);
    assert.equal(heap.validate(), true);
  }
  assert.equal(heap.size, 6);
  assert.equal(heap.peek(), 1);
  assert.equal(heap.height, 2);
  assert.deepEqual(drain(heap), [1, 2, 3, 3, 4, 5]);
  assert.equal(heap.validate(), true);

  assert.throws(() => heap.push(undefined as never), TypeError);
  assert.throws(() => new BinaryHeap<number>(null as never), TypeError);
});

test("BinaryHeap build is Floyd heapification and matches pushes", () => {
  const values = Array.from({ length: 100 }, (_, index) => (index * 37) % 100);
  const built = new BinaryHeap<number>();
  built.build(values);
  assert.equal(built.size, values.length);
  assert.equal(built.validate(), true);
  assert.deepEqual(drain(built), ascending(100));

  const pushed = new BinaryHeap<number>();
  for (const value of values) {
    pushed.push(value);
  }
  assert.equal(pushed.validate(), true);
  assert.deepEqual(drain(pushed), ascending(100));

  built.build([]);
  assert.equal(built.size, 0);
  assert.equal(built.height, 0);
});

test("BinaryHeap merges destructively and consumes the argument", () => {
  const left = new BinaryHeap<number>();
  const right = new BinaryHeap<number>();
  for (const value of [9, 1, 7]) {
    left.push(value);
  }
  for (const value of [8, 2, 6]) {
    right.push(value);
  }
  const merged = left.merge(right);
  assert.equal(merged, left);
  assert.equal(left.validate(), true);
  assert.deepEqual(drain(left), [1, 2, 6, 7, 8, 9]);
  assert.throws(() => right.push(3), ConsumedError);
  assert.throws(() => right.toArray(), ConsumedError);
  assert.throws(() => left.merge(left), TypeError);

  const empty = new BinaryHeap<number>();
  const other = new BinaryHeap<number>();
  other.push(4);
  empty.merge(other);
  assert.deepEqual(drain(empty), [4]);
});

test("BinaryHeap honours custom comparators and serialization", () => {
  const descending = (a: number, b: number): number => b - a;
  const heap = new BinaryHeap<number>(descending);
  for (const value of [1, 5, 3, 2, 4]) {
    heap.push(value);
  }
  assert.deepEqual(drain(heap), [5, 4, 3, 2, 1]);

  const restored = BinaryHeap.deserialize<number>(heap.serialize(), descending);
  assert.equal(restored.validate(), true);
  assert.equal(restored.size, 0);
  const source = new BinaryHeap<number>(descending);
  source.build([1, 5, 3, 2, 4]);
  const roundTrip = BinaryHeap.deserialize<number>(source.serialize(), descending);
  assert.deepEqual(drain(roundTrip), [5, 4, 3, 2, 1]);
  assert.throws(() => BinaryHeap.deserialize("not json"), TypeError);
});

test("BinaryHeap iteration is a fail-fast snapshot", () => {
  const heap = new BinaryHeap<number>();
  heap.build([3, 1, 2]);
  assert.equal([...heap].length, 3);
  const iterator = heap[Symbol.iterator]();
  iterator.next();
  heap.push(0);
  assert.throws(() => iterator.next(), /modified/);
  heap.clear();
  assert.equal(heap.validate(), true);
  assert.equal(heap.size, 0);
});

test("BinaryHeap matches a sorted reference over random operations", () => {
  const random = seeded(11);
  const heap = new BinaryHeap<number>((a, b) => a - b);
  const reference: number[] = [];
  for (let step = 0; step < 800; step++) {
    if (reference.length === 0 || random() < 0.6) {
      const value = Math.floor(random() * 200);
      heap.push(value);
      reference.push(value);
      reference.sort((a, b) => a - b);
    } else {
      assert.equal(heap.pop(), reference.shift());
    }
    assert.equal(heap.size, reference.length);
    assert.equal(heap.validate(), true);
  }
  assert.deepEqual(drain(heap), reference);
});

test("DaryHeap supports every arity and matches BinaryHeap", () => {
  for (const arity of [2, 3, 4, 8]) {
    const heap = new DaryHeap<number>((a, b) => a - b, { arity });
    assert.equal(heap.arity, arity);
    for (const value of [9, 4, 7, 1, 8, 2, 6, 3, 5]) {
      heap.push(value);
      assert.equal(heap.validate(), true);
    }
    assert.equal(heap.peek(), 1);
    assert.deepEqual(drain(heap), Array.from({ length: 9 }, (_, index) => index + 1));
  }
  assert.throws(() => new DaryHeap<number>(undefined, { arity: 1 }), RangeError);
  assert.throws(() => new DaryHeap<number>(undefined, { arity: 2.5 }), TypeError);
});

test("DaryHeap build, merge, serialization, and height", () => {
  const heap = new DaryHeap<number>((a, b) => a - b, { arity: 3 });
  heap.build(Array.from({ length: 40 }, (_, index) => 39 - index));
  assert.equal(heap.validate(), true);
  const restored = DaryHeap.deserialize<number>(heap.serialize(), (a, b) => a - b);
  assert.equal(restored.arity, 3);
  assert.deepEqual(drain(restored), ascending(40));

  const other = new DaryHeap<number>((a, b) => a - b, { arity: 3 });
  other.build([100, -1, 50]);
  heap.merge(other);
  assert.equal(heap.validate(), true);
  assert.equal(heap.peek(), -1);
  assert.throws(() => other.pop(), ConsumedError);
  assert.equal(heap.height, 4);
});

test("SortedArrayHeap keeps sorted iteration and O(1) pops", () => {
  const heap = new SortedArrayHeap<number>();
  for (const value of [5, 1, 4, 2, 3]) {
    heap.push(value);
    assert.equal(heap.validate(), true);
  }
  assert.deepEqual(heap.toArray(), [1, 2, 3, 4, 5]);
  assert.equal(heap.height, 0);
  assert.equal(heap.peek(), 1);
  assert.equal(heap.pop(), 1);
  assert.equal(heap.pop(), 2);
  assert.equal(heap.validate(), true);
  heap.push(0);
  assert.deepEqual(drain(heap), [0, 3, 4, 5]);

  heap.build([9, 2, 5, 1, 5]);
  assert.deepEqual(heap.toArray(), [1, 2, 5, 5, 9]);
  const restored = SortedArrayHeap.deserialize<number>(heap.serialize());
  assert.deepEqual(drain(restored), [1, 2, 5, 5, 9]);
});

test("SortedArrayHeap merges sorted runs destructively", () => {
  const left = new SortedArrayHeap<number>();
  const right = new SortedArrayHeap<number>();
  left.build([1, 4, 9]);
  right.build([2, 3, 10]);
  left.merge(right);
  assert.deepEqual(left.toArray(), [1, 2, 3, 4, 9, 10]);
  assert.throws(() => right.peek(), ConsumedError);
  const foreign = new BinaryHeap<number>();
  foreign.build([0, 5]);
  left.merge(foreign);
  assert.deepEqual(left.toArray(), [0, 1, 2, 3, 4, 5, 9, 10]);
  assert.equal(left.validate(), true);
});

test("SortedArrayHeap compacts after many pops", () => {
  const heap = new SortedArrayHeap<number>();
  heap.build(Array.from({ length: 500 }, (_, index) => index));
  for (let index = 0; index < 400; index++) {
    assert.equal(heap.pop(), index);
    assert.equal(heap.validate(), true);
  }
  assert.equal(heap.size, 100);
  for (let index = 400; index < 500; index++) {
    assert.equal(heap.pop(), index);
  }
  assert.equal(heap.isEmpty(), true);
  assert.equal(heap.validate(), true);
});
