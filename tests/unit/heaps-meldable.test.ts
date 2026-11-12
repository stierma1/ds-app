import test from "node:test";
import assert from "node:assert/strict";
import {
  BinomialHeap,
  FibonacciHeap,
  PairingHeap,
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

interface Factory {
  name: string;
  create(): Heap<number>;
  deserialize(json: unknown): Heap<number>;
}

const factories: Factory[] = [
  {
    name: "PairingHeap",
    create: () => new PairingHeap<number>((a, b) => a - b),
    deserialize: (json) => PairingHeap.deserialize<number>(json, (a, b) => a - b),
  },
  {
    name: "BinomialHeap",
    create: () => new BinomialHeap<number>((a, b) => a - b),
    deserialize: (json) => BinomialHeap.deserialize<number>(json, (a, b) => a - b),
  },
  {
    name: "FibonacciHeap",
    create: () => new FibonacciHeap<number>((a, b) => a - b),
    deserialize: (json) => FibonacciHeap.deserialize<number>(json, (a, b) => a - b),
  },
];

for (const factory of factories) {
  test(`${factory.name} implements the heap contract`, () => {
    const heap = factory.create();
    assert.equal(heap.peek(), undefined);
    assert.equal(heap.pop(), undefined);
    assert.equal(heap.height, 0);
    for (const value of [5, 1, 4, 2, 3, 3]) {
      heap.push(value);
      assert.equal(heap.validate(), true, `${factory.name} after push ${value}`);
    }
    assert.equal(heap.size, 6);
    assert.equal(heap.peek(), 1);
    assert.deepEqual(drain(heap), [1, 2, 3, 3, 4, 5]);
    assert.equal(heap.validate(), true);
    assert.throws(() => heap.push(undefined as never), TypeError);
  });

  test(`${factory.name} build, merge, and serialization`, () => {
    const heap = factory.create();
    heap.build([7, 1, 5, 2, 9, 3]);
    assert.equal(heap.validate(), true);
    assert.equal(heap.peek(), 1);
    assert.deepEqual(heap.toArray().slice().sort((a, b) => a - b), [1, 2, 3, 5, 7, 9]);

    const other = factory.create();
    other.build([0, 8, 4]);
    heap.merge(other);
    assert.equal(heap.validate(), true);
    assert.deepEqual(drain(heap), [0, 1, 2, 3, 4, 5, 7, 8, 9]);
    assert.throws(() => other.push(1), ConsumedError);
    assert.throws(() => heap.merge(heap), TypeError);

    const restored = factory.deserialize(heap.serialize());
    assert.equal(restored.validate(), true);
    assert.deepEqual(drain(restored), []);

    const source = factory.create();
    source.build([4, 2, 8, 1]);
    const roundTrip = factory.deserialize(source.serialize());
    assert.deepEqual(drain(roundTrip), [1, 2, 4, 8]);
  });

  test(`${factory.name} matches a sorted reference over random operations`, () => {
    const random = seeded(factory.name.length * 31);
    const heap = factory.create();
    const reference: number[] = [];
    for (let step = 0; step < 500; step++) {
      if (reference.length === 0 || random() < 0.62) {
        const value = Math.floor(random() * 100);
        heap.push(value);
        reference.push(value);
        reference.sort((a, b) => a - b);
      } else {
        assert.equal(heap.pop(), reference.shift());
      }
      assert.equal(heap.size, reference.length);
      assert.equal(heap.validate(), true, `${factory.name} step ${step}`);
    }
    assert.deepEqual(drain(heap), reference);
  });

  test(`${factory.name} merges random heaps without losing elements`, () => {
    const random = seeded(97);
    const reference: number[] = [];
    let heap = factory.create();
    for (let round = 0; round < 40; round++) {
      const other = factory.create();
      const count = Math.floor(random() * 20);
      for (let index = 0; index < count; index++) {
        const value = Math.floor(random() * 1000);
        other.push(value);
        reference.push(value);
      }
      heap.merge(other);
      assert.equal(heap.size, reference.length);
      assert.equal(heap.validate(), true);
      if (random() < 0.3) {
        reference.sort((a, b) => a - b);
        assert.equal(heap.pop(), reference.shift());
        assert.equal(heap.validate(), true);
      }
    }
    reference.sort((a, b) => a - b);
    assert.deepEqual(drain(heap), reference);
  });
}

test("PairingHeap decreaseKey cuts and re-melds", () => {
  const heap = new PairingHeap<number>((a, b) => a - b);
  heap.build([10, 20, 30, 40, 50]);
  assert.equal(heap.validate(), true);
  assert.equal(heap.decreaseKey(40, 5), true);
  assert.equal(heap.validate(), true);
  assert.equal(heap.peek(), 5);
  assert.equal(heap.decreaseKey(40, 5), false);
  assert.equal(heap.decreaseKey(999, 1), false);
  assert.equal(heap.decreaseKey(10, 100), false);
  assert.deepEqual(drain(heap), [5, 10, 20, 30, 50]);
});

test("FibonacciHeap decreaseKey cuts and cascades", () => {
  const heap = new FibonacciHeap<number>((a, b) => a - b);
  heap.build(Array.from({ length: 40 }, (_, index) => index + 10));
  assert.equal(heap.validate(), true);
  for (let index = 10; index < 30; index++) {
    assert.equal(heap.decreaseKey(index, index - 10), true);
    assert.equal(heap.validate(), true);
  }
  assert.equal(heap.peek(), 0);
  assert.equal(heap.decreaseKey(39, 1), true);
  assert.equal(heap.validate(), true);
  assert.equal(heap.decreaseKey(999, 1), false);
  assert.equal(heap.decreaseKey(38, 100), false);
  const drained = drain(heap);
  assert.deepEqual(drained, drained.slice().sort((a, b) => a - b));
  assert.equal(drained[0], 0);
});

test("meldable heaps expose height and clear", () => {
  for (const factory of factories) {
    const heap = factory.create();
    heap.build([4, 2, 6, 1, 3, 5, 7]);
    assert.equal(heap.height >= 0, true, factory.name);
    assert.equal(heap.validate(), true);
    heap.clear();
    assert.equal(heap.size, 0);
    assert.equal(heap.height, 0);
    assert.equal(heap.validate(), true);
  }
});
