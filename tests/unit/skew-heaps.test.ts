import test from "node:test";
import assert from "node:assert/strict";
import {
  ConcurrentModificationError,
  ConsumedError,
  IterativeSkewHeap,
  LeftistHeap,
  PairingHeap,
  RecursiveSkewHeap,
  SkewHeap,
  takeForMerge,
  UnsupportedError,
} from "../../src/index.ts";
import type { SkewHeap as SkewHeapContract } from "../../src/skew-heaps/types.ts";

/** One shared comparator: merge requires both heaps to use the same comparator function. */
const asc = (a: number, b: number): number => a - b;

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function drain(heap: SkewHeapContract<number>): number[] {
  const values: number[] = [];
  while (!heap.isEmpty()) {
    values.push(heap.pop() as number);
    assert.equal(heap.validate(), true);
  }
  return values;
}

interface Factory {
  name: string;
  create(): SkewHeapContract<number>;
  deserialize(json: unknown): SkewHeapContract<number>;
}

const factories: Factory[] = [
  {
    name: "SkewHeap",
    create: () => new SkewHeap<number>(asc),
    deserialize: (json) => SkewHeap.deserialize<number>(json, asc),
  },
  {
    name: "RecursiveSkewHeap",
    create: () => new RecursiveSkewHeap<number>(asc),
    deserialize: (json) =>
      RecursiveSkewHeap.deserialize<number>(json, asc),
  },
];

for (const factory of factories) {
  test(`${factory.name} implements the skew heap contract`, () => {
    const heap = factory.create();
    assert.equal(heap.size, 0);
    assert.equal(heap.isEmpty(), true);
    assert.equal(heap.peek(), undefined);
    assert.equal(heap.pop(), undefined);
    assert.equal(heap.validate(), true);

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
    assert.throws(() => other.isEmpty(), ConsumedError);
    assert.throws(() => other.toArray(), ConsumedError);
    assert.throws(() => other.serialize(), ConsumedError);
    assert.throws(() => other.validate(), ConsumedError);
    assert.throws(() => other.clear(), ConsumedError);
    assert.throws(() => other.build([]), ConsumedError);
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
    ) => SkewHeapContract<number>)((a, b) => b - a);
    [5, 1, 9, 3].forEach((value) => maxHeap.push(value));
    assert.equal(maxHeap.peek(), 9);
    assert.deepEqual(drain(maxHeap), [9, 5, 3, 1]);

    const iterator = heap[Symbol.iterator]();
    heap.push(1);
    assert.throws(() => iterator.next(), ConcurrentModificationError);
  });
}

test("IterativeSkewHeap is the default SkewHeap implementation", () => {
  assert.equal(IterativeSkewHeap, SkewHeap);
  const heap = new IterativeSkewHeap<number>();
  heap.build([3, 1, 2]);
  assert.equal(heap.validate(), true);
  assert.deepEqual(drain(heap), [1, 2, 3]);
});

test("skew heap clear releases elements and iteration is a snapshot", () => {
  const heap = new SkewHeap<number>();
  heap.build([3, 1, 2]);
  const snapshot = [...heap];
  assert.deepEqual(snapshot.slice().sort((a, b) => a - b), [1, 2, 3]);
  heap.clear();
  assert.equal(heap.size, 0);
  assert.equal(heap.peek(), undefined);
  assert.equal(heap.validate(), true);
  assert.deepEqual([...heap], []);
});

test("iterative and recursive melds agree on random workloads", () => {
  const random = seeded(0x5c3e);
  const iterative = new SkewHeap<number>();
  const recursive = new RecursiveSkewHeap<number>();
  for (let step = 0; step < 400; step++) {
    const value = Math.floor(random() * 500);
    iterative.push(value);
    recursive.push(value);
    if (random() < 0.3) {
      assert.equal(iterative.pop(), recursive.pop());
    }
    assert.equal(iterative.validate(), true);
    assert.equal(recursive.validate(), true);
  }
  assert.deepEqual(drain(iterative), drain(recursive));
});

test("skew heaps merge across iterative and recursive implementations", () => {
  const iterative = new SkewHeap<number>(asc);
  const recursive = new RecursiveSkewHeap<number>(asc);
  iterative.build([5, 1, 9]);
  recursive.build([7, 3, 5]);
  iterative.merge(recursive);
  assert.equal(iterative.validate(), true);
  assert.equal(iterative.size, 6);
  assert.throws(() => recursive.push(0), ConsumedError);
  assert.deepEqual(drain(iterative), [1, 3, 5, 5, 7, 9]);

  const other = new RecursiveSkewHeap<number>(asc);
  const target = new SkewHeap<number>(asc);
  other.build([8, 2, 6]);
  target.build([4, 0]);
  other.merge(target);
  assert.equal(other.validate(), true);
  assert.throws(() => target.size, ConsumedError);
  assert.deepEqual(drain(other), [0, 2, 4, 6, 8]);
});

test("skew merge rejects leftist heaps, src/heaps heaps, and plain objects without copying", () => {
  const leftist = new LeftistHeap<number>(asc);
  leftist.build([2, 4]);
  const pairing = new PairingHeap<number>(asc);
  pairing.push(2);
  pairing.push(4);
  const values = [2, 4];
  const plain = { compare: asc, toArray: () => values, get size() { return values.length; } };
  for (const Heap of [SkewHeap, RecursiveSkewHeap]) {
    for (const other of [leftist, pairing, plain] as unknown[]) {
      const target = new Heap<number>(asc);
      target.build([3, 1]);
      assert.throws(() => target.merge(other as SkewHeapContract<number>), UnsupportedError);
      assert.equal(target.size, 2);
      assert.equal(target.validate(), true);
    }
  }
  assert.equal(leftist.size, 2);
  assert.equal(leftist.validate(), true);
  assert.equal(pairing.size, 2);
  assert.equal(values.length, 2);
});

test("skew merge with a different comparator throws TypeError and corrupts nothing", () => {
  const desc = (a: number, b: number): number => b - a;
  const classes = [SkewHeap, RecursiveSkewHeap] as const;
  for (const Target of classes) {
    for (const Source of classes) {
      const a = new Target<number>(asc);
      const b = new Source<number>(desc);
      [1, 5, 9].forEach((value) => a.push(value));
      [2, 6, 10].forEach((value) => b.push(value));
      assert.throws(() => a.merge(b), TypeError, `${Target.name} <- ${Source.name}`);
      assert.equal(a.validate(), true);
      assert.equal(b.validate(), true);
      assert.deepEqual(drain(a), [1, 5, 9]);
      assert.deepEqual(drain(b), [10, 6, 2]);

      const c = new Target<number>(asc);
      const d = new Source<number>((x, y) => x - y);
      d.push(2);
      assert.throws(() => c.merge(d), TypeError);
      assert.equal(d.size, 1);

      const e = new Target<number>();
      const f = new Source<number>();
      e.push(3);
      f.push(1);
      e.merge(f);
      assert.deepEqual(drain(e), [1, 3]);
      assert.throws(() => f.size, ConsumedError);
    }
  }
});

test("skew heaps hand their elements over through takeForMerge", () => {
  for (const Heap of [SkewHeap, RecursiveSkewHeap]) {
    const heap = new Heap<number>(asc);
    heap.build([4, 2, 8]);
    assert.deepEqual(heap[takeForMerge]().sort(asc), [2, 4, 8]);
    assert.throws(() => heap.size, ConsumedError);
    assert.throws(() => heap[takeForMerge](), ConsumedError);
  }
});

test("iterative SkewHeap melds a long right spine without recursion", () => {
  // Alternating-sign inserts leave a right spine of n/2 nodes; a push larger than every key then
  // walks all of it. RecursiveSkewHeap recurses once per spine node here (see doc 05).
  const heap = new SkewHeap<number>();
  const count = 200_000;
  for (let index = 0; index < count; index++) {
    heap.push(index % 2 ? index : -index);
  }
  heap.push(1e12);
  heap.push(2e12);
  assert.equal(heap.size, count + 2);
  assert.equal(heap.validate(), true);
  assert.equal(heap.peek(), -(count - 2));
});

test("iterative SkewHeap handles degenerate monotone insertion without recursion", () => {
  const heap = new SkewHeap<number>();
  const count = 30_000;
  for (let value = count; value >= 1; value--) {
    heap.push(value);
  }
  assert.equal(heap.size, count);
  assert.equal(heap.validate(), true);
  assert.equal(heap.peek(), 1);
  let previous = 0;
  while (!heap.isEmpty()) {
    const value = heap.pop() as number;
    assert.equal(value, previous + 1);
    previous = value;
  }
  assert.equal(heap.validate(), true);
});
