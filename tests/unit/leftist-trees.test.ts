import test from "node:test";
import assert from "node:assert/strict";
import {
  ConcurrentModificationError,
  ConsumedError,
  DoubleEndedLeftistTree,
  HeightBiasedLeftistHeap,
  LeftistHeap,
  PairingHeap,
  SkewHeap,
  takeForMerge,
  UnsupportedError,
  WeightBiasedLeftistHeap,
} from "../../src/index.ts";
import type { LeftistHeap as LeftistHeapContract } from "../../src/leftist-trees/types.ts";

/** One shared comparator: merge requires both heaps to use the same comparator function. */
const asc = (a: number, b: number): number => a - b;

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
    create: () => new LeftistHeap<number>(asc),
    deserialize: (json) => LeftistHeap.deserialize<number>(json, asc),
  },
  {
    name: "WeightBiasedLeftistHeap",
    create: () => new WeightBiasedLeftistHeap<number>(asc),
    deserialize: (json) =>
      WeightBiasedLeftistHeap.deserialize<number>(json, asc),
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
  const heap = new HeightBiasedLeftistHeap<number>(asc);
  assert.equal(heap instanceof LeftistHeap, true);
  heap.build([3, 1, 2]);
  assert.equal(heap.validate(), true);
  assert.equal(heap.rank, 2);
  const restored = HeightBiasedLeftistHeap.deserialize<number>(heap.serialize());
  assert.deepEqual(drain(restored), [1, 2, 3]);
});

test("WeightBiasedLeftistHeap tracks subtree weights", () => {
  const heap = new WeightBiasedLeftistHeap<number>(asc);
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

test("leftist merges across implementations throw UnsupportedError and leave both heaps intact", () => {
  const classes = [LeftistHeap, WeightBiasedLeftistHeap, DoubleEndedLeftistTree] as const;
  for (const Target of classes) {
    for (const Source of classes) {
      if (Target === Source) {
        continue;
      }
      const target = new Target<number>(asc);
      const source = new Source<number>(asc);
      target.build([5, 1, 9]);
      source.build([7, 3]);
      assert.throws(
        () => target.merge(source),
        UnsupportedError,
        `${Target.name} <- ${Source.name}`,
      );
      assert.equal(target.size, 3);
      assert.equal(source.size, 2);
      assert.equal(target.validate(), true);
      assert.equal(source.validate(), true);
      assert.deepEqual(drain(target), [1, 5, 9]);
      assert.deepEqual(drain(source), [3, 7]);
    }
  }
});

test("leftist merge rejects skew heaps, src/heaps heaps, and plain objects without copying", () => {
  const foreign: unknown[] = [];
  const skew = new SkewHeap<number>(asc);
  skew.build([2, 4]);
  foreign.push(skew);
  const pairing = new PairingHeap<number>(asc);
  pairing.push(2);
  pairing.push(4);
  foreign.push(pairing);
  const values = [2, 4];
  const plain = { compare: asc, toArray: () => values, get size() { return values.length; } };
  foreign.push(plain);
  for (const Target of [LeftistHeap, WeightBiasedLeftistHeap, DoubleEndedLeftistTree]) {
    for (const other of foreign) {
      const target = new Target<number>(asc);
      target.build([3, 1]);
      assert.throws(
        () => target.merge(other as LeftistHeapContract<number>),
        UnsupportedError,
      );
      assert.equal(target.size, 2);
      assert.equal(target.validate(), true);
    }
  }
  assert.equal(skew.size, 2);
  assert.equal(pairing.size, 2);
  assert.equal(values.length, 2);
});

test("leftist merge with a different comparator throws TypeError and corrupts nothing", () => {
  const desc = (a: number, b: number): number => b - a;
  for (const Heap of [LeftistHeap, WeightBiasedLeftistHeap, DoubleEndedLeftistTree]) {
    const a = new Heap<number>(asc);
    const b = new Heap<number>(desc);
    [1, 5, 9].forEach((value) => a.push(value));
    [2, 6, 10].forEach((value) => b.push(value));
    assert.throws(() => a.merge(b), TypeError, Heap.name);
    assert.equal(a.validate(), true);
    assert.equal(b.validate(), true);
    assert.deepEqual(drain(a), [1, 5, 9]);
    assert.deepEqual(drain(b), [10, 6, 2]);

    // An equivalent but distinct function is still a different comparator.
    const c = new Heap<number>(asc);
    const d = new Heap<number>((x, y) => x - y);
    c.push(1);
    d.push(2);
    assert.throws(() => c.merge(d), TypeError);
    assert.equal(d.size, 1);

    // Two default comparators are the same shared function.
    const e = new Heap<number>();
    const f = new Heap<number>();
    e.push(3);
    f.push(1);
    e.merge(f);
    assert.deepEqual(drain(e), [1, 3]);
    assert.throws(() => f.size, ConsumedError);
  }
});

test("leftist heaps hand their elements over through takeForMerge", () => {
  for (const Heap of [LeftistHeap, WeightBiasedLeftistHeap, DoubleEndedLeftistTree]) {
    const heap = new Heap<number>(asc);
    heap.build([4, 2, 8]);
    if (heap instanceof DoubleEndedLeftistTree) {
      heap.popMax();
    }
    const values = heap[takeForMerge]();
    assert.deepEqual(values.slice().sort(asc), heap instanceof DoubleEndedLeftistTree ? [2, 4] : [2, 4, 8]);
    assert.throws(() => heap.size, ConsumedError);
    assert.throws(() => heap[takeForMerge](), ConsumedError);
  }
});

test("DoubleEndedLeftistTree basics and aliases", () => {
  const tree = new DoubleEndedLeftistTree<number>(asc);
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
  const minTree = new DoubleEndedLeftistTree<number>(asc);
  minTree.push(42);
  assert.equal(minTree.popMin(), 42);
  assert.equal(minTree.peekMax(), undefined);
  assert.equal(minTree.validate(), true);

  const maxTree = new DoubleEndedLeftistTree<number>(asc);
  maxTree.push(42);
  assert.equal(maxTree.popMax(), 42);
  assert.equal(maxTree.peekMin(), undefined);
  assert.equal(maxTree.validate(), true);
});

test("DoubleEndedLeftistTree removes the twin entry from the other side", () => {
  const tree = new DoubleEndedLeftistTree<number>(asc);
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
  const tree = new DoubleEndedLeftistTree<number>(asc);
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
  const tree = new DoubleEndedLeftistTree<number>(asc);
  for (let round = 0; round < 50; round++) {
    const other = new DoubleEndedLeftistTree<number>(asc);
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
  const tree = new DoubleEndedLeftistTree<number>(asc);
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

test("DoubleEndedLeftistTree merges double-ended trees", () => {
  const a = new DoubleEndedLeftistTree<number>(asc);
  const b = new DoubleEndedLeftistTree<number>(asc);
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

  const f = new DoubleEndedLeftistTree<number>(asc);
  f.build([1, 2]);
  assert.throws(() => f.merge(f), TypeError);
});

test("DoubleEndedLeftistTree rank ignores removed elements", () => {
  const tree = new DoubleEndedLeftistTree<number>(asc);
  [1, 2, 3].forEach((value) => tree.push(value));
  tree.popMax();
  tree.popMax();
  assert.equal(tree.size, 1);
  assert.equal(tree.rank, 1);
  tree.popMin();
  assert.equal(tree.rank, 0);

  const random = seeded(0x7a2c);
  const other = new DoubleEndedLeftistTree<number>(asc);
  for (let step = 0; step < 300; step++) {
    if (other.size === 0 || random() < 0.6) {
      other.push(step);
    } else if (random() < 0.5) {
      other.popMax();
    } else {
      other.popMin();
    }
    assert.equal(other.rank <= Math.log2(other.size + 1), true, `step ${step}`);
    assert.equal(other.validate(), true, `step ${step}`);
  }
});

test("DoubleEndedLeftistTree peeks are O(1) after many pops from the other side", () => {
  let calls = 0;
  const counting = (a: number, b: number): number => {
    calls++;
    return a - b;
  };
  const tree = new DoubleEndedLeftistTree<number>(counting);
  for (let value = 0; value < 20_000; value++) {
    tree.push(value);
    tree.popMax();
  }
  tree.push(1e9);
  calls = 0;
  assert.equal(tree.peekMin(), 1e9);
  assert.equal(tree.peekMax(), 1e9);
  assert.equal(calls, 0);
});

test("DoubleEndedLeftistTree space is O(n), not O(total pushes)", () => {
  let calls = 0;
  const counting = (a: number, b: number): number => {
    calls++;
    return a - b;
  };
  const tree = new DoubleEndedLeftistTree<number>(counting);
  tree.push(1e9);
  for (let value = 0; value < 20_000; value++) {
    tree.push(value);
    assert.equal(tree.popMin(), value);
  }
  assert.equal(tree.size, 1);
  calls = 0;
  assert.equal(tree.validate(), true);
  // validate walks both internal trees; with stale entries retained it would visit 20 001 nodes.
  assert.equal(calls <= 4, true, `validate made ${calls} comparisons`);
  assert.deepEqual(tree.toArray(), [1e9]);
  assert.deepEqual(JSON.parse(tree.serialize()).values, [1e9]);
  assert.equal(tree.popMax(), 1e9);
  assert.equal(tree.isEmpty(), true);
});

test("DoubleEndedLeftistTree pops stay logarithmic on adversarial sequences", () => {
  let calls = 0;
  const counting = (a: number, b: number): number => {
    calls++;
    return a - b;
  };
  const random = seeded(0xadd5);
  const tree = new DoubleEndedLeftistTree<number>(counting);
  tree.build(Array.from({ length: 1 << 14 }, () => Math.floor(random() * 1e6)));
  let worst = 0;
  for (let step = 0; step < 4000; step++) {
    calls = 0;
    if (step % 3 === 0) {
      tree.popMin();
    } else if (step % 3 === 1) {
      tree.popMax();
    } else {
      tree.push(Math.floor(random() * 1e6));
    }
    worst = Math.max(worst, calls);
  }
  // Each pop melds two right spines in both trees: a small multiple of log2(n) = 14.
  assert.equal(worst <= 8 * 15, true, `worst operation made ${worst} comparisons`);
  assert.equal(tree.validate(), true);
});

test("DoubleEndedLeftistTree clear and iterator invalidation", () => {
  const tree = new DoubleEndedLeftistTree<number>(asc);
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
