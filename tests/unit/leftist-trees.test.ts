import test from "node:test";
import assert from "node:assert/strict";
import {
  ConcurrentModificationError,
  ConsumedError,
  DoubleEndedLeftistTree,
  HeightBiasedLeftistHeap,
  LeftistHeap,
  WeightBiasedLeftistHeap,
} from "../../src/index.ts";
import type { LeftistHeap as LeftistHeapContract } from "../../src/leftist-trees/types.ts";

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function drain(heap: LeftistHeapContract<number>): number[] {
  const values: number[] = [];
  while (!heap.isEmpty()) {
    values.push(heap.popMin() as number);
    assert.equal(heap.validate(), true);
  }
  return values;
}

interface Factory {
  name: string;
  create(): LeftistHeapContract<number>;
  deserialize(json: unknown): LeftistHeapContract<number>;
}

const factories: Factory[] = [
  {
    name: "LeftistHeap",
    create: () => new LeftistHeap<number>((a, b) => a - b),
    deserialize: (json) => LeftistHeap.deserialize<number>(json, (a, b) => a - b),
  },
  {
    name: "WeightBiasedLeftistHeap",
    create: () => new WeightBiasedLeftistHeap<number>((a, b) => a - b),
    deserialize: (json) =>
      WeightBiasedLeftistHeap.deserialize<number>(json, (a, b) => a - b),
  },
];

for (const factory of factories) {
  test(`${factory.name} implements the leftist heap contract`, () => {
    const heap = factory.create();
    assert.equal(heap.size, 0);
    assert.equal(heap.isEmpty(), true);
    assert.equal(heap.peek(), undefined);
    assert.equal(heap.peekMin(), undefined);
    assert.equal(heap.pop(), undefined);
    assert.equal(heap.popMin(), undefined);
    assert.equal(heap.rank, 0);
    assert.equal(heap.validate(), true);

    for (const value of [5, 1, 4, 2, 3, 3]) {
      heap.push(value);
      assert.equal(heap.validate(), true, `${factory.name} after push ${value}`);
      assert.equal(heap.rank >= 1, true);
    }
    assert.equal(heap.size, 6);
    assert.equal(heap.peek(), 1);
    assert.equal(heap.peekMin(), 1);
    assert.deepEqual(drain(heap), [1, 2, 3, 3, 4, 5]);
    assert.equal(heap.rank, 0);
    assert.equal(heap.validate(), true);
    assert.throws(() => heap.push(undefined as never), TypeError);
  });

  test(`${factory.name} build is bottom-up and replaces contents`, () => {
    const heap = factory.create();
    heap.push(100);
    heap.push(200);
    heap.build([7, 1, 5, 2, 9, 3]);
    assert.equal(heap.size, 6);
    assert.equal(heap.validate(), true);
    assert.equal(heap.peek(), 1);
    assert.deepEqual(heap.toArray().slice().sort((a, b) => a - b), [1, 2, 3, 5, 7, 9]);

    const repeated = factory.create();
    for (const value of [7, 1, 5, 2, 9, 3]) {
      repeated.push(value);
    }
    assert.deepEqual(drain(heap), drain(repeated));

    heap.build([4, 2, 8, 1]);
    assert.equal(heap.validate(), true);
    assert.deepEqual(drain(heap), [1, 2, 4, 8]);

    heap.build([]);
    assert.equal(heap.size, 0);
    assert.equal(heap.rank, 0);
    assert.equal(heap.validate(), true);

    heap.push(0);
    assert.throws(() => heap.build([1, undefined as never, 2]), TypeError);
    assert.equal(heap.size, 1);
    assert.equal(heap.validate(), true);
  });

  test(`${factory.name} merge consumes the argument`, () => {
    const heap = factory.create();
    [5, 1, 9].forEach((value) => heap.push(value));
    const other = factory.create();
    [7, 3].forEach((value) => other.push(value));

    const merged = heap.merge(other);
    assert.equal(merged, heap);
    assert.equal(heap.size, 5);
    assert.equal(heap.validate(), true);
    assert.deepEqual(drain(heap), [1, 3, 5, 7, 9]);

    assert.throws(() => other.push(1), ConsumedError);
    assert.throws(() => other.pop(), ConsumedError);
    assert.throws(() => other.peek(), ConsumedError);
    assert.throws(() => other.size, ConsumedError);
    assert.throws(() => other.rank, ConsumedError);
    assert.throws(() => other.isEmpty(), ConsumedError);
    assert.throws(() => other.toArray(), ConsumedError);
    assert.throws(() => other.serialize(), ConsumedError);
    assert.throws(() => other.validate(), ConsumedError);
    assert.throws(() => other.clear(), ConsumedError);
    assert.throws(() => other.merge(factory.create()), ConsumedError);
    assert.throws(() => [...other], ConsumedError);

    const single = factory.create();
    assert.throws(() => single.merge(single), TypeError);

    const empty = factory.create();
    heap.push(11);
    heap.merge(empty);
    assert.equal(heap.validate(), true);
    assert.deepEqual(drain(heap), [11]);
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
        assert.equal(heap.popMin(), reference.shift());
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
        assert.equal(heap.popMin(), reference.shift());
        assert.equal(heap.validate(), true);
      }
    }
    reference.sort((a, b) => a - b);
    assert.deepEqual(drain(heap), reference);
  });

  test(`${factory.name} serialization round-trips`, () => {
    const heap = factory.create();
    heap.build([4, 2, 8, 1]);
    const serialized = JSON.parse(heap.serialize()) as {
      type: string;
      version: number;
      values: number[];
    };
    assert.equal(serialized.type, factory.name);
    assert.equal(serialized.version, 1);

    const restored = factory.deserialize(heap.serialize());
    assert.equal(restored.validate(), true);
    assert.equal(restored.size, 4);
    assert.deepEqual(drain(restored), [1, 2, 4, 8]);

    assert.throws(
      () => factory.deserialize({ type: "BinaryHeap", version: 1, values: [] }),
      TypeError,
    );
    assert.throws(
      () => factory.deserialize({ type: factory.name, version: 2, values: [] }),
      TypeError,
    );
    assert.throws(
      () => factory.deserialize({ type: factory.name, version: 1, values: [1, undefined] }),
      TypeError,
    );
  });

  test(`${factory.name} supports a reversed comparator and iterator invalidation`, () => {
    const heap = factory.create();
    const maxHeap = new (heap.constructor as new (
      compare: (a: number, b: number) => number,
    ) => LeftistHeapContract<number>)((a, b) => b - a);
    [5, 1, 9, 3].forEach((value) => maxHeap.push(value));
    assert.equal(maxHeap.peek(), 9);
    assert.deepEqual(drain(maxHeap), [9, 5, 3, 1]);

    const iterator = heap[Symbol.iterator]();
    heap.push(1);
    assert.throws(() => iterator.next(), ConcurrentModificationError);
  });
}

test("HeightBiasedLeftistHeap is the LeftistHeap implementation", () => {
  const heap = new HeightBiasedLeftistHeap<number>((a, b) => a - b);
  assert.equal(heap instanceof LeftistHeap, true);
  heap.build([3, 1, 2]);
  assert.equal(heap.validate(), true);
  assert.equal(heap.rank, 2);
  const restored = HeightBiasedLeftistHeap.deserialize<number>(heap.serialize());
  assert.deepEqual(drain(restored), [1, 2, 3]);
});

test("WeightBiasedLeftistHeap tracks subtree weights", () => {
  const heap = new WeightBiasedLeftistHeap<number>((a, b) => a - b);
  assert.equal(heap.weight, 0);
  heap.push(10);
  assert.equal(heap.weight, 1);
  heap.push(5);
  heap.push(15);
  assert.equal(heap.weight, heap.size);
  assert.equal(heap.rank >= 1, true);
  assert.equal(heap.validate(), true);
  heap.pop();
  assert.equal(heap.weight, heap.size);
  assert.equal(heap.validate(), true);
});

test("single-ended heaps merge across implementations", () => {
  const a = new LeftistHeap<number>((x, y) => x - y);
  const b = new WeightBiasedLeftistHeap<number>((x, y) => x - y);
  a.build([5, 1, 9]);
  b.build([7, 3]);
  a.merge(b);
  assert.equal(a.validate(), true);
  assert.deepEqual(drain(a), [1, 3, 5, 7, 9]);
  assert.throws(() => b.push(2), ConsumedError);

  const c = new WeightBiasedLeftistHeap<number>((x, y) => x - y);
  const d = new LeftistHeap<number>((x, y) => x - y);
  c.build([4, 2]);
  d.build([3, 1]);
  c.merge(d);
  assert.equal(c.validate(), true);
  assert.deepEqual(drain(c), [1, 2, 3, 4]);
  assert.throws(() => d.push(0), ConsumedError);
});

test("DoubleEndedLeftistTree basics and aliases", () => {
  const tree = new DoubleEndedLeftistTree<number>((a, b) => a - b);
  assert.equal(tree.size, 0);
  assert.equal(tree.rank, 0);
  assert.equal(tree.peek(), undefined);
  assert.equal(tree.peekMin(), undefined);
  assert.equal(tree.peekMax(), undefined);
  assert.equal(tree.pop(), undefined);
  assert.equal(tree.popMin(), undefined);
  assert.equal(tree.popMax(), undefined);
  assert.equal(tree.validate(), true);

  for (const value of [5, 1, 9, 3, 7, 3]) {
    tree.push(value);
    assert.equal(tree.validate(), true);
  }
  assert.equal(tree.size, 6);
  assert.equal(tree.peek(), 1);
  assert.equal(tree.peekMin(), 1);
  assert.equal(tree.peekMax(), 9);
  assert.equal(tree.popMin(), 1);
  assert.equal(tree.popMax(), 9);
  assert.equal(tree.pop(), 3);
  assert.equal(tree.validate(), true);
  assert.equal(tree.size, 3);

  assert.deepEqual(tree.toArray().slice().sort((a, b) => a - b), [3, 5, 7]);
  assert.deepEqual(
    [tree.popMin(), tree.popMax(), tree.popMin(), tree.popMax()],
    [3, 7, 5, undefined],
  );
  assert.equal(tree.size, 0);
  assert.equal(tree.validate(), true);
});

test("DoubleEndedLeftistTree keeps one element consistent", () => {
  const minTree = new DoubleEndedLeftistTree<number>((a, b) => a - b);
  minTree.push(42);
  assert.equal(minTree.popMin(), 42);
  assert.equal(minTree.peekMax(), undefined);
  assert.equal(minTree.validate(), true);

  const maxTree = new DoubleEndedLeftistTree<number>((a, b) => a - b);
  maxTree.push(42);
  assert.equal(maxTree.popMax(), 42);
  assert.equal(maxTree.peekMin(), undefined);
  assert.equal(maxTree.validate(), true);
});

test("DoubleEndedLeftistTree purges stale entries lazily", () => {
  const tree = new DoubleEndedLeftistTree<number>((a, b) => a - b);
  for (let value = 0; value < 100; value++) {
    tree.push(value);
  }
  for (let step = 0; step < 50; step++) {
    assert.equal(tree.popMax(), 99 - step);
    assert.equal(tree.validate(), true);
  }
  assert.equal(tree.peekMin(), 0);
  assert.equal(tree.peekMax(), 49);
  assert.equal(tree.size, 50);
  assert.equal(tree.validate(), true);
  for (let value = 0; value < 50; value++) {
    assert.equal(tree.popMin(), value);
    assert.equal(tree.validate(), true);
  }
  assert.equal(tree.isEmpty(), true);
  assert.equal(tree.validate(), true);
});

test("DoubleEndedLeftistTree matches a sorted reference over random operations", () => {
  const random = seeded(0x5eed);
  const tree = new DoubleEndedLeftistTree<number>((a, b) => a - b);
  const reference: number[] = [];
  for (let step = 0; step < 800; step++) {
    const choice = random();
    if (reference.length === 0 || choice < 0.55) {
      const value = Math.floor(random() * 50);
      tree.push(value);
      reference.push(value);
      reference.sort((a, b) => a - b);
    } else if (choice < 0.78) {
      assert.equal(tree.popMin(), reference.shift());
    } else {
      assert.equal(tree.popMax(), reference.pop());
    }
    assert.equal(tree.size, reference.length);
    assert.equal(tree.peekMin(), reference[0]);
    assert.equal(tree.peekMax(), reference[reference.length - 1]);
    assert.equal(tree.validate(), true, `step ${step}`);
  }
  while (reference.length > 0) {
    assert.equal(tree.popMin(), reference.shift());
  }
  assert.equal(tree.validate(), true);
});

test("DoubleEndedLeftistTree merges random trees without losing elements", () => {
  const random = seeded(0xb1e5);
  const reference: number[] = [];
  const tree = new DoubleEndedLeftistTree<number>((a, b) => a - b);
  for (let round = 0; round < 50; round++) {
    const other = new DoubleEndedLeftistTree<number>((a, b) => a - b);
    const count = Math.floor(random() * 15);
    for (let index = 0; index < count; index++) {
      const value = Math.floor(random() * 200);
      other.push(value);
      reference.push(value);
    }
    if (random() < 0.3 && !other.isEmpty()) {
      let expected = -Infinity;
      for (const value of other.toArray()) {
        expected = Math.max(expected, value);
      }
      assert.equal(other.popMax(), expected);
      reference.sort((a, b) => a - b);
      reference.splice(reference.lastIndexOf(expected), 1);
    }
    tree.merge(other);
    reference.sort((a, b) => a - b);
    assert.equal(tree.size, reference.length);
    assert.equal(tree.validate(), true, `round ${round}`);
    assert.throws(() => other.size, ConsumedError);
    const choice = random();
    if (reference.length > 0 && choice < 0.3) {
      assert.equal(tree.popMin(), reference.shift());
    } else if (reference.length > 0 && choice < 0.6) {
      assert.equal(tree.popMax(), reference.pop());
    }
    assert.equal(tree.size, reference.length);
    assert.equal(tree.validate(), true, `round ${round} after pop`);
  }
  assert.deepEqual(tree.toArray().slice().sort((a, b) => a - b), reference);
  while (reference.length > 0) {
    assert.equal(tree.popMin(), reference.shift());
  }
  assert.equal(tree.validate(), true);
});

test("DoubleEndedLeftistTree build and serialization", () => {
  const tree = new DoubleEndedLeftistTree<number>((a, b) => a - b);
  tree.build([7, 1, 5, 2, 9, 3, 2]);
  assert.equal(tree.size, 7);
  assert.equal(tree.validate(), true);
  assert.equal(tree.peekMin(), 1);
  assert.equal(tree.peekMax(), 9);
  assert.deepEqual(tree.toArray().slice().sort((a, b) => a - b), [1, 2, 2, 3, 5, 7, 9]);

  tree.popMin();
  tree.popMax();
  const restored = DoubleEndedLeftistTree.deserialize<number>(
    tree.serialize(),
    (a, b) => a - b,
  );
  assert.equal(restored.validate(), true);
  assert.equal(restored.size, 5);
  assert.equal(restored.peekMin(), 2);
  assert.equal(restored.peekMax(), 7);
  assert.deepEqual(
    [restored.popMin(), restored.popMax(), restored.popMin()],
    [2, 7, 2],
  );

  assert.throws(
    () =>
      DoubleEndedLeftistTree.deserialize({
        type: "LeftistHeap",
        version: 1,
        values: [],
      }),
    TypeError,
  );
});

test("DoubleEndedLeftistTree merges double-ended and single-ended heaps", () => {
  const a = new DoubleEndedLeftistTree<number>((x, y) => x - y);
  const b = new DoubleEndedLeftistTree<number>((x, y) => x - y);
  a.build([5, 1, 9]);
  b.build([7, 3]);
  b.popMax();
  a.merge(b);
  assert.equal(a.size, 4);
  assert.equal(a.peekMin(), 1);
  assert.equal(a.peekMax(), 9);
  assert.equal(a.validate(), true);
  assert.throws(() => b.push(0), ConsumedError);
  assert.throws(() => b.size, ConsumedError);
  assert.deepEqual([a.popMin(), a.popMax(), a.popMin(), a.popMin()], [1, 9, 3, 5]);

  const c = new DoubleEndedLeftistTree<number>((x, y) => x - y);
  const d = new LeftistHeap<number>((x, y) => x - y);
  d.build([8, 2, 6]);
  c.merge(d);
  assert.equal(c.validate(), true);
  assert.equal(c.peekMin(), 2);
  assert.equal(c.peekMax(), 8);
  assert.throws(() => d.peek(), ConsumedError);

  const e = new WeightBiasedLeftistHeap<number>((x, y) => x - y);
  e.build([10, 0]);
  c.merge(e);
  assert.equal(c.validate(), true);
  assert.equal(c.size, 5);
  assert.deepEqual(
    [c.popMin(), c.popMax(), c.popMin(), c.popMax(), c.popMin()],
    [0, 10, 2, 8, 6],
  );
  assert.throws(() => e.size, ConsumedError);

  const f = new DoubleEndedLeftistTree<number>((x, y) => x - y);
  f.build([1, 2]);
  assert.throws(() => f.merge(f), TypeError);
});

test("DoubleEndedLeftistTree clear and iterator invalidation", () => {
  const tree = new DoubleEndedLeftistTree<number>((a, b) => a - b);
  tree.build([3, 1, 2]);
  const iterator = tree[Symbol.iterator]();
  tree.push(4);
  assert.throws(() => iterator.next(), ConcurrentModificationError);

  tree.clear();
  assert.equal(tree.size, 0);
  assert.equal(tree.rank, 0);
  assert.equal(tree.peekMin(), undefined);
  assert.equal(tree.peekMax(), undefined);
  assert.equal(tree.validate(), true);
});
