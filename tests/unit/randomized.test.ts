import test from "node:test";
import assert from "node:assert/strict";
import {
  BinaryHeap,
  ConcurrentModificationError,
  ConsumedError,
  createRandomSource,
  PairingHeap,
  RandomizedBST,
  RandomizedMeldableHeap,
  resolveRandomSource,
  SeededRandom,
  SkipList,
  Treap,
  UnsupportedError,
} from "../../src/index.ts";
import type { RandomizedMap, RandomOptions } from "../../src/randomized/index.ts";

const asc = (a: number, b: number): number => a - b;

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

interface TreeUnderTest extends RandomizedMap<number, string> {
  readonly height: number;
}

interface TreeVariant {
  name: string;
  type: string;
  create(seed?: number): TreeUnderTest;
  deserialize(json: unknown, seed?: number): TreeUnderTest;
}

function options(seed?: number): RandomOptions {
  return seed === undefined ? {} : { rng: seed };
}

const variants: TreeVariant[] = [
  {
    name: "Treap",
    type: "Treap",
    create: (seed) => new Treap<number, string>(asc, options(seed)),
    deserialize: (json, seed) =>
      Treap.deserialize<number, string>(json, asc, options(seed)),
  },
  {
    name: "RandomizedBST",
    type: "RandomizedBST",
    create: (seed) => new RandomizedBST<number, string>(asc, options(seed)),
    deserialize: (json, seed) =>
      RandomizedBST.deserialize<number, string>(json, asc, options(seed)),
  },
  {
    name: "SkipList",
    type: "SkipList",
    create: (seed) => new SkipList<number, string>(asc, options(seed)),
    deserialize: (json, seed) =>
      SkipList.deserialize<number, string>(json, asc, options(seed)),
  },
];

function makeTree(variant: TreeVariant): TreeUnderTest {
  const tree = variant.create(0x51a7);
  for (const key of [5, 2, 8, 1, 9, 3, 7]) {
    tree.set(key, `v${key}`);
  }
  return tree;
}

function keysOf(tree: RandomizedMap<number, unknown>): number[] {
  return [...tree.keys()];
}

function keysOfRange(iterator: IterableIterator<[number, string]>): number[] {
  return [...iterator].map((entry) => entry[0]);
}

test("SeededRandom is deterministic, seeded, and validated", () => {
  const first = new SeededRandom(42);
  const second = new SeededRandom(42);
  const other = new SeededRandom(43);
  const left = Array.from({ length: 16 }, () => first.next());
  const right = Array.from({ length: 16 }, () => second.next());
  const different = Array.from({ length: 16 }, () => other.next());

  assert.deepEqual(left, right);
  assert.notDeepEqual(left, different);
  for (const value of left) {
    assert.equal(value >= 0 && value < 1, true);
  }

  const pinned = new SeededRandom(42);
  assert.deepEqual(
    Array.from({ length: 4 }, () => pinned.nextUint32()),
    [660444221, 3652823732, 77672526, 910233633],
  );

  const words = new SeededRandom(7);
  for (let index = 0; index < 100; index++) {
    const word = words.nextUint32();
    assert.equal(Number.isInteger(word) && word >= 0 && word <= 0xffffffff, true);
  }
  assert.equal(words.boolean(0), false);
  assert.equal(words.boolean(1), true);
  assert.throws(() => words.boolean(1.5), RangeError);
  assert.throws(() => words.integer(0, 0), RangeError);
  assert.throws(() => words.integer(0.5, 2), TypeError);
  assert.throws(() => new SeededRandom(1.5), TypeError);
  assert.throws(() => resolveRandomSource("nope" as never), TypeError);

  assert.equal(createRandomSource(9).seed, 9);
  const custom = { next: () => 0.25 };
  assert.equal(resolveRandomSource(custom), custom);
  assert.equal(new SeededRandom().seed >= 0, true);
});

for (const variant of variants) {
  test(`${variant.name} empty state and basic operations`, () => {
    const tree = variant.create(1);
    assert.equal(tree.size, 0);
    assert.equal(tree.isEmpty(), true);
    assert.equal(tree.min(), undefined);
    assert.equal(tree.max(), undefined);
    assert.equal(tree.predecessor(1), undefined);
    assert.equal(tree.successor(1), undefined);
    assert.equal(tree.at(0), undefined);
    assert.equal(tree.indexOf(1), -1);
    assert.deepEqual([...tree.range()], []);
    assert.equal(tree.validate(), true);

    assert.equal(tree.set(5, "v5"), tree);
    assert.equal(tree.size, 1);
    assert.deepEqual(tree.min(), [5, "v5"]);
    assert.deepEqual(tree.max(), [5, "v5"]);
    assert.deepEqual(tree.at(0), [5, "v5"]);
    assert.equal(tree.indexOf(5), 0);
    assert.equal(tree.validate(), true);
  });

  test(`${variant.name} maintains ordering, order statistics, and ranges`, () => {
    const tree = makeTree(variant);
    assert.equal(tree.size, 7);
    assert.deepEqual(keysOf(tree), [1, 2, 3, 5, 7, 8, 9]);
    assert.deepEqual([...tree.values()], ["v1", "v2", "v3", "v5", "v7", "v8", "v9"]);
    assert.deepEqual(tree.toArray(), [
      [1, "v1"],
      [2, "v2"],
      [3, "v3"],
      [5, "v5"],
      [7, "v7"],
      [8, "v8"],
      [9, "v9"],
    ]);

    assert.equal(tree.get(5), "v5");
    assert.equal(tree.get(4), undefined);
    assert.equal(tree.has(9), true);
    assert.equal(tree.has(4), false);
    assert.deepEqual(tree.min(), [1, "v1"]);
    assert.deepEqual(tree.max(), [9, "v9"]);
    assert.deepEqual(tree.predecessor(5), [3, "v3"]);
    assert.deepEqual(tree.successor(5), [7, "v7"]);
    assert.deepEqual(tree.predecessor(4), [3, "v3"]);
    assert.deepEqual(tree.successor(4), [5, "v5"]);
    assert.equal(tree.predecessor(1), undefined);
    assert.equal(tree.successor(9), undefined);

    assert.deepEqual(tree.at(0), [1, "v1"]);
    assert.deepEqual(tree.at(3), [5, "v5"]);
    assert.deepEqual(tree.at(6), [9, "v9"]);
    assert.equal(tree.at(-1), undefined);
    assert.equal(tree.at(7), undefined);
    assert.throws(() => tree.at(0.5), TypeError);
    assert.equal(tree.indexOf(1), 0);
    assert.equal(tree.indexOf(5), 3);
    assert.equal(tree.indexOf(9), 6);
    assert.equal(tree.indexOf(4), -1);

    assert.deepEqual(keysOfRange(tree.range()), [1, 2, 3, 5, 7, 8, 9]);
    assert.deepEqual(keysOfRange(tree.range(3, 7)), [3, 5, 7]);
    assert.deepEqual(
      keysOfRange(tree.range(3, 7, { lo: "exclusive", hi: "exclusive" })),
      [5],
    );
    assert.deepEqual(keysOfRange(tree.range(undefined, 3)), [1, 2, 3]);
    assert.deepEqual(keysOfRange(tree.range(7, undefined)), [7, 8, 9]);
    assert.deepEqual(keysOfRange(tree.range(7, 3)), []);
    assert.throws(() => tree.range(1, 2, { lo: "bad" as never }), TypeError);
    assert.throws(() => tree.range(1, 2, { hi: "bad" as never }), TypeError);
    assert.equal(tree.validate(), true);
  });

  test(`${variant.name} replaces values and clears`, () => {
    const tree = makeTree(variant);
    tree.set(5, "updated");
    assert.equal(tree.size, 7);
    assert.equal(tree.get(5), "updated");
    assert.equal(tree.validate(), true);

    tree.clear();
    assert.equal(tree.size, 0);
    assert.equal(tree.isEmpty(), true);
    assert.equal(tree.min(), undefined);
    assert.deepEqual([...tree.range()], []);
    assert.equal(tree.validate(), true);
  });

  test(`${variant.name} deletion drains every key in order`, () => {
    const tree = makeTree(variant);
    for (const key of [1, 9, 7, 5, 2, 8, 3]) {
      assert.equal(tree.delete(key), true);
      assert.equal(tree.validate(), true, `after deleting ${key}`);
    }
    assert.equal(tree.size, 0);
    assert.equal(tree.delete(1), false);
    assert.equal(tree.validate(), true);

    const drained = variant.create(0x77);
    const random = seeded(0x51a7);
    const keys = Array.from({ length: 300 }, () => Math.floor(random() * 500));
    for (const key of keys) {
      drained.set(key, `v${key}`);
    }
    const sorted = [...new Set(keys)].sort(asc);
    const observed: number[] = [];
    while (!drained.isEmpty()) {
      const entry = drained.min() as [number, string];
      observed.push(entry[0]);
      assert.equal(drained.delete(entry[0]), true);
      assert.equal(drained.validate(), true);
    }
    assert.deepEqual(observed, sorted);
  });

  test(`${variant.name} matches a sorted reference over random operations`, () => {
    const random = seeded(0xa571);
    const tree = variant.create(0x1234);
    const model = new Map<number, string>();
    const sortedKeys = (): number[] => [...model.keys()].sort(asc);

    for (let step = 0; step < 900; step++) {
      const key = Math.floor(random() * 70);
      const choice = random();
      if (choice < 0.4) {
        const value = `v${step}`;
        tree.set(key, value);
        model.set(key, value);
      } else if (choice < 0.6) {
        assert.equal(tree.delete(key), model.delete(key));
      } else if (choice < 0.72) {
        assert.equal(tree.get(key), model.get(key));
        assert.equal(tree.has(key), model.has(key));
      } else if (choice < 0.82) {
        const keys = sortedKeys();
        const index = Math.floor(random() * (keys.length + 2)) - 1;
        const expected =
          index >= 0 && index < keys.length ? keys[index] : undefined;
        assert.equal(tree.at(index)?.[0], expected);
      } else if (choice < 0.9) {
        const keys = sortedKeys();
        assert.equal(tree.indexOf(key), keys.indexOf(key));
      } else {
        const keys = sortedKeys();
        const below = keys.filter((item) => item < key).at(-1);
        const above = keys.find((item) => item > key);
        assert.deepEqual(
          tree.predecessor(key),
          below === undefined ? undefined : [below, model.get(below)],
        );
        assert.deepEqual(
          tree.successor(key),
          above === undefined ? undefined : [above, model.get(above)],
        );
      }

      assert.equal(tree.validate(), true, `step ${step}`);
      assert.equal(tree.size, model.size);
      const keys = sortedKeys();
      assert.deepEqual(keysOf(tree), keys);
      assert.deepEqual(
        tree.toArray(),
        keys.map((item) => [item, model.get(item)]),
      );
    }
  });

  test(`${variant.name} is reproducible from a seed and stays expected-height`, () => {
    const sequence = Array.from({ length: 600 }, (_, index) => (index * 37) % 601);
    const first = variant.create(0xbeef);
    const second = variant.create(0xbeef);
    for (const key of sequence) {
      first.set(key, `v${key}`);
      second.set(key, `v${key}`);
      assert.equal(first.has(key), true);
      assert.equal(first.delete((key * 7) % 601), second.delete((key * 7) % 601));
    }
    assert.deepEqual(keysOf(first), keysOf(second));
    assert.equal(first.height, second.height);
    if (first instanceof SkipList) {
      assert.equal(first.level, (second as SkipList<number, string>).level);
    }

    const large = variant.create(0xf00d);
    const random = seeded(0x9e37);
    for (let key = 0; key < 2_048; key++) {
      large.set(key, `v${key}`);
    }
    assert.equal(large.validate(), true);
    assert.equal(large.height <= 80, true, `${variant.name} height ${large.height}`);
    for (let index = 0; index < 2_048; index++) {
      assert.equal(large.get(Math.floor(random() * 2_048)) !== undefined, true);
    }

    const sorted = variant.create(0x5151);
    for (let key = 0; key < 1_500; key++) {
      sorted.set(key, `v${key}`);
    }
    assert.equal(sorted.validate(), true);
    assert.equal(sorted.height <= 80, true, `${variant.name} sorted height ${sorted.height}`);
  });

  test(`${variant.name} serialization round-trips and rejects malformed payloads`, () => {
    const tree = makeTree(variant);
    const serialized = JSON.parse(tree.serialize()) as {
      type: string;
      version: number;
      entries: Array<[number, string]>;
    };
    assert.equal(serialized.type, variant.type);
    assert.equal(serialized.version, 1);
    assert.deepEqual(serialized.entries, tree.toArray());

    const restored = variant.deserialize(tree.serialize(), 0x42);
    assert.equal(restored.validate(), true);
    assert.equal(restored.size, tree.size);
    assert.deepEqual(restored.toArray(), tree.toArray());
    assert.equal(restored.get(5), "v5");

    assert.throws(
      () => variant.deserialize({ type: "BinarySearchTree", version: 1, entries: [] }),
      TypeError,
    );
    assert.throws(
      () => variant.deserialize({ type: variant.type, version: 2, entries: [] }),
      TypeError,
    );
    assert.throws(
      () => variant.deserialize({ type: variant.type, version: 1, entries: [[1]] }),
      TypeError,
    );
    assert.throws(
      () =>
        variant.deserialize({
          type: variant.type,
          version: 1,
          entries: [[1, undefined]],
        }),
      TypeError,
    );
    assert.throws(() => tree.set(undefined as never, "x"), TypeError);
    assert.throws(() => tree.set(1, undefined as never), TypeError);
  });

  test(`${variant.name} iterators are invalidated by mutation`, () => {
    const tree = makeTree(variant);
    const iterator = tree.entries();
    assert.deepEqual(iterator.next(), { done: false, value: [1, "v1"] });
    tree.set(10, "v10");
    assert.throws(() => iterator.next(), ConcurrentModificationError);
  });
}

test("Treap validate detects a priority or size violation", () => {
  const tree = new Treap<number, string>(asc, { rng: 11 });
  for (let key = 0; key < 40; key++) {
    tree.set(key, `v${key}`);
  }
  assert.equal(tree.validate(), true);

  const root = (tree as unknown as {
    _root: {
      priority: number;
      size: number;
      left: { priority: number } | null;
    };
  })._root;
  const child = root.left;
  if (child !== null) {
    root.priority = child.priority + 1;
    assert.match(tree.validate() as string, /heap order/);
  }

  const sized = new Treap<number, string>(asc, { rng: 12 });
  sized.set(1, "a").set(2, "b");
  (sized as unknown as { _root: { size: number } })._root.size = 99;
  assert.match(sized.validate() as string, /stale subtree size/);
});

test("SkipList validate detects broken spans, ordering, and size", () => {
  const list = new SkipList<number, string>(asc, { rng: 21 });
  for (let key = 0; key < 100; key++) {
    list.set(key, `v${key}`);
  }
  assert.equal(list.validate(), true);

  const head = (list as unknown as {
    _head: {
      forward: Array<{ key: number } | null>;
      span: number[];
    };
  })._head;
  const original = head.span[0] as number;
  head.span[0] = original + 2;
  assert.match(list.validate() as string, /span mismatch/);
  head.span[0] = original;
  assert.equal(list.validate(), true);

  (list as unknown as { _size: number })._size = 99;
  assert.match(list.validate() as string, /size/);
});

test("Randomized meldable heap implements the priority-queue contract", () => {
  const heap = new RandomizedMeldableHeap<number>(asc, { rng: 31 });
  assert.equal(heap.size, 0);
  assert.equal(heap.isEmpty(), true);
  assert.equal(heap.peek(), undefined);
  assert.equal(heap.pop(), undefined);
  assert.equal(heap.height, 0);
  assert.equal(heap.validate(), true);

  for (const value of [5, 1, 4, 2, 2, 9]) {
    heap.push(value);
    assert.equal(heap.validate(), true, `after push ${value}`);
  }
  assert.equal(heap.size, 6);
  assert.equal(heap.peek(), 1);
  const drained: number[] = [];
  while (!heap.isEmpty()) {
    drained.push(heap.pop() as number);
    assert.equal(heap.validate(), true);
  }
  assert.deepEqual(drained, [1, 2, 2, 4, 5, 9]);
  assert.throws(() => heap.push(undefined as never), TypeError);
});

test("Randomized meldable heap build, merge, and reproducibility", () => {
  const heap = new RandomizedMeldableHeap<number>(asc, { rng: 41 });
  heap.push(100);
  heap.build([7, 1, 5, 2, 9, 3]);
  assert.equal(heap.size, 6);
  assert.equal(heap.validate(), true);
  assert.equal(heap.peek(), 1);
  assert.deepEqual(
    heap.toArray().slice().sort(asc),
    [1, 2, 3, 5, 7, 9],
  );

  const other = new RandomizedMeldableHeap<number>(asc, { rng: 42 });
  [8, 4, 6].forEach((value) => other.push(value));
  const merged = heap.merge(other);
  assert.equal(merged, heap);
  assert.equal(heap.size, 9);
  assert.equal(heap.validate(), true);
  assert.throws(() => other.size, ConsumedError);
  assert.throws(() => other.peek(), ConsumedError);
  assert.throws(() => other.push(1), ConsumedError);
  assert.throws(() => other.validate(), ConsumedError);

  const reference: number[] = [];
  while (!heap.isEmpty()) {
    reference.push(heap.pop() as number);
  }
  assert.deepEqual(reference, [1, 2, 3, 4, 5, 6, 7, 8, 9]);

  const left = new RandomizedMeldableHeap<number>(asc, { rng: 51 });
  const right = new RandomizedMeldableHeap<number>(asc, { rng: 51 });
  const values = [9, 3, 7, 1, 8, 2, 6, 4, 5, 0];
  for (const value of values) {
    left.push(value);
    right.push(value);
  }
  assert.deepEqual(left.toArray(), right.toArray());
  assert.equal(left.height, right.height);
});

test("Randomized meldable heap merges random heaps without losing elements", () => {
  const random = seeded(97);
  const reference: number[] = [];
  const heap = new RandomizedMeldableHeap<number>(asc, { rng: 73 });
  for (let round = 0; round < 40; round++) {
    const other = new RandomizedMeldableHeap<number>(asc, { rng: 1_000 + round });
    const count = Math.floor(random() * 20);
    for (let index = 0; index < count; index++) {
      const value = Math.floor(random() * 1_000);
      other.push(value);
      reference.push(value);
    }
    heap.merge(other);
    assert.equal(heap.size, reference.length);
    assert.equal(heap.validate(), true);
    assert.throws(() => other.size, ConsumedError);
    if (reference.length > 0 && random() < 0.3) {
      reference.sort(asc);
      assert.equal(heap.pop(), reference.shift());
      assert.equal(heap.validate(), true);
    }
  }
  reference.sort(asc);
  const observed: number[] = [];
  while (!heap.isEmpty()) {
    observed.push(heap.pop() as number);
  }
  assert.deepEqual(observed, reference);

  const empty = new RandomizedMeldableHeap<number>(asc, { rng: 74 });
  heap.push(1);
  heap.merge(empty);
  assert.equal(heap.size, 1);
  assert.throws(() => empty.size, ConsumedError);
});

test("Randomized meldable heap merge rejects invalid operands before mutation", () => {
  const heap = new RandomizedMeldableHeap<number>(asc, { rng: 61 });
  [3, 1, 2].forEach((value) => heap.push(value));
  assert.throws(() => heap.merge(heap), TypeError);

  const differentOrder = new RandomizedMeldableHeap<number>(
    (a, b) => b - a,
    { rng: 62 },
  );
  [4, 5].forEach((value) => differentOrder.push(value));
  assert.throws(() => heap.merge(differentOrder), TypeError);
  assert.equal(heap.size, 3);
  assert.equal(differentOrder.size, 2);

  const foreign = new PairingHeap<number>(asc);
  for (const value of [8, 6]) {
    foreign.push(value);
  }
  assert.throws(() => heap.merge(foreign), UnsupportedError);
  assert.equal(heap.size, 3);
  assert.equal(foreign.size, 2);
  assert.equal(heap.validate(), true);
  assert.equal(foreign.validate(), true);
});

test("Randomized meldable heap matches a reference over random operations", () => {
  const random = seeded(0x8888);
  const heap = new RandomizedMeldableHeap<number>(asc, { rng: 71 });
  const reference: number[] = [];
  for (let step = 0; step < 800; step++) {
    if (reference.length === 0 || random() < 0.6) {
      const value = Math.floor(random() * 100);
      heap.push(value);
      reference.push(value);
      reference.sort(asc);
    } else {
      assert.equal(heap.pop(), reference.shift());
    }
    assert.equal(heap.size, reference.length);
    assert.equal(heap.validate(), true, `step ${step}`);
  }
  assert.deepEqual(
    heap.toArray().slice().sort(asc),
    reference,
  );
});

test("Randomized meldable heap serializes, validates corruption, and invalidates iterators", () => {
  const heap = new RandomizedMeldableHeap<number>(asc, { rng: 81 });
  heap.build([4, 2, 8, 1]);
  const serialized = JSON.parse(heap.serialize()) as {
    type: string;
    version: number;
    values: number[];
  };
  assert.equal(serialized.type, "RandomizedMeldableHeap");
  assert.equal(serialized.version, 1);
  assert.deepEqual(serialized.values.slice().sort(asc), [1, 2, 4, 8]);

  const restored = RandomizedMeldableHeap.deserialize<number>(
    heap.serialize(),
    asc,
    { rng: 82 },
  );
  assert.equal(restored.validate(), true);
  assert.deepEqual(restored.toArray().slice().sort(asc), [1, 2, 4, 8]);

  assert.throws(
    () => RandomizedMeldableHeap.deserialize({ type: "BinaryHeap", version: 1, values: [] }),
    TypeError,
  );
  assert.throws(
    () =>
      RandomizedMeldableHeap.deserialize({
        type: "RandomizedMeldableHeap",
        version: 2,
        values: [1],
      }),
    TypeError,
  );
  assert.throws(
    () =>
      RandomizedMeldableHeap.deserialize({
        type: "RandomizedMeldableHeap",
        version: 1,
        values: [1, undefined],
      }),
    TypeError,
  );

  const iterator = heap[Symbol.iterator]();
  iterator.next();
  heap.push(99);
  assert.throws(() => iterator.next(), ConcurrentModificationError);

  const sized = new RandomizedMeldableHeap<number>(asc, { rng: 83 });
  [5, 1, 9].forEach((value) => sized.push(value));
  (sized as unknown as { _size: number })._size = 99;
  assert.match(sized.validate() as string, /size/);
});

test("Randomized meldable heap can be consumed by another heap's merge", () => {
  const randomized = new RandomizedMeldableHeap<number>(asc, { rng: 91 });
  [5, 3, 1].forEach((value) => randomized.push(value));
  const binary = new BinaryHeap<number>(asc);
  binary.build([8, 4, 2]);
  binary.merge(randomized);
  assert.equal(binary.size, 6);
  assert.equal(binary.validate(), true);
  assert.throws(() => randomized.size, ConsumedError);
});
