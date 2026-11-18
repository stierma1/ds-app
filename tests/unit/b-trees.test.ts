import test from "node:test";
import assert from "node:assert/strict";
import { BTree, ConcurrentModificationError } from "../../src/index.ts";

const asc = (a: number, b: number): number => a - b;

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function makeTree(order = 5): BTree<number, string> {
  const tree = new BTree<number, string>({ order, compare: asc });
  for (const key of [5, 2, 8, 1, 9, 3, 7]) {
    tree.set(key, `v${key}`);
  }
  return tree;
}

function keysOf(tree: BTree<number, unknown>): number[] {
  return [...tree.keys()];
}

function rangeKeys(
  iterator: IterableIterator<[number, string]>,
): number[] {
  return [...iterator].map((entry) => entry[0]);
}

test("BTree empty state and configuration", () => {
  const tree = new BTree<number, string>(asc);
  assert.equal(tree.size, 0);
  assert.equal(tree.isEmpty(), true);
  assert.equal(tree.height, -1);
  assert.equal(tree.order, 4);
  assert.equal(tree.minFill, 2);
  assert.equal(tree.min(), undefined);
  assert.equal(tree.max(), undefined);
  assert.equal(tree.predecessor(1), undefined);
  assert.equal(tree.successor(1), undefined);
  assert.equal(tree.at(0), undefined);
  assert.equal(tree.indexOf(1), -1);
  assert.deepEqual([...tree.range()], []);
  assert.equal(tree.validate(), true);

  tree.set(5, "v5");
  assert.equal(tree.size, 1);
  assert.equal(tree.height, 0);
  assert.deepEqual(tree.min(), [5, "v5"]);
  assert.deepEqual(tree.max(), [5, "v5"]);
  assert.equal(tree.validate(), true);

  const fromOptions = new BTree<number, string>({ compare: asc });
  fromOptions.set(1, "one");
  assert.equal(fromOptions.get(1), "one");

  const orderThree = new BTree<number, string>({ order: 3, compare: asc });
  assert.equal(orderThree.order, 3);
  assert.equal(orderThree.minFill, 2);

  const orderSeven = new BTree<number, string>({ order: 7, compare: asc });
  assert.equal(orderSeven.order, 7);
  assert.equal(orderSeven.minFill, 4);

  assert.throws(() => new BTree<number, string>({ order: 2 }), RangeError);
  assert.throws(() => new BTree<number, string>({ order: 0 }), RangeError);
  assert.throws(() => new BTree<number, string>({ order: 2.5 }), TypeError);
  assert.throws(() => new BTree<number, string>({ order: Number.NaN }), TypeError);
});

test("BTree maintains ordering, ranges, and order statistics", () => {
  const tree = makeTree();
  assert.equal(tree.size, 7);
  assert.deepEqual(keysOf(tree), [1, 2, 3, 5, 7, 8, 9]);
  assert.deepEqual([...tree.values()], [
    "v1",
    "v2",
    "v3",
    "v5",
    "v7",
    "v8",
    "v9",
  ]);
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

  assert.deepEqual(rangeKeys(tree.range()), [1, 2, 3, 5, 7, 8, 9]);
  assert.deepEqual(rangeKeys(tree.range(3, 7)), [3, 5, 7]);
  assert.deepEqual(
    rangeKeys(tree.range(3, 7, { lo: "exclusive", hi: "exclusive" })),
    [5],
  );
  assert.deepEqual(rangeKeys(tree.range(undefined, 3)), [1, 2, 3]);
  assert.deepEqual(rangeKeys(tree.range(7, undefined)), [7, 8, 9]);
  assert.deepEqual(rangeKeys(tree.range(7, 3)), []);
  assert.deepEqual(
    rangeKeys(tree.range(4, 8, { lo: "exclusive", hi: "exclusive" })),
    [5, 7],
  );
  assert.throws(() => tree.range(1, 2, { lo: "bad" as never }), TypeError);
  assert.throws(() => tree.range(1, 2, { hi: "bad" as never }), TypeError);
  assert.equal(tree.validate(), true);
});

test("BTree supports arbitrary orders with valid occupancy", () => {
  const random = seeded(0x0b7ee);
  for (const order of [3, 4, 5, 6, 7, 8, 16, 32]) {
    const tree = new BTree<number, string>({ order, compare: asc });
    assert.equal(tree.minFill, Math.ceil(order / 2), `order ${order}`);
    for (let step = 0; step < 400; step++) {
      const key = Math.floor(random() * 600);
      if (step % 5 === 4) {
        tree.delete(key);
      } else {
        tree.set(key, `v${step}`);
      }
      assert.equal(tree.validate(), true, `order ${order} step ${step}`);
    }
    assert.deepEqual(keysOf(tree), [...tree.keys()].sort(asc));
    assert.equal(tree.toArray().length, tree.size);
  }
});

test("BTree replaces values for comparator-equal keys and clears", () => {
  const tree = makeTree();
  tree.set(5, "updated");
  assert.equal(tree.size, 7);
  assert.equal(tree.get(5), "updated");
  assert.deepEqual(tree.at(3), [5, "updated"]);
  assert.equal(tree.validate(), true);

  tree.clear();
  assert.equal(tree.size, 0);
  assert.equal(tree.isEmpty(), true);
  assert.equal(tree.height, -1);
  assert.equal(tree.min(), undefined);
  assert.deepEqual([...tree.range()], []);
  assert.equal(tree.validate(), true);
});

test("BTree deletion covers leaf, internal, borrow, and merge paths", () => {
  const tree = makeTree(6);
  for (const key of [1, 9, 7, 5, 2, 8, 3]) {
    assert.equal(tree.delete(key), true, `delete ${key}`);
    assert.equal(tree.validate(), true, `after deleting ${key}`);
  }
  assert.equal(tree.size, 0);
  assert.equal(tree.height, -1);
  assert.equal(tree.delete(1), false);
  assert.equal(tree.validate(), true);

  const drained = new BTree<number, string>({ order: 7, compare: asc });
  const random = seeded(0x51a7);
  const keys = Array.from({ length: 500 }, () =>
    Math.floor(random() * 1_000),
  );
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

test("BTree matches a sorted reference over randomized operations", () => {
  for (const order of [3, 4, 5, 7]) {
    const random = seeded(0xa234 + order);
    const tree = new BTree<number, string>({ order, compare: asc });
    const model = new Map<number, string>();
    const sortedKeys = (): number[] => [...model.keys()].sort(asc);

    for (let step = 0; step < 1_500; step++) {
      const key = Math.floor(random() * 220);
      const choice = random();
      if (choice < 0.42) {
        const value = `v${step}`;
        tree.set(key, value);
        model.set(key, value);
      } else if (choice < 0.66) {
        assert.equal(tree.delete(key), model.delete(key), `delete ${key}`);
      } else if (choice < 0.76) {
        assert.equal(tree.get(key), model.get(key));
        assert.equal(tree.has(key), model.has(key));
      } else if (choice < 0.86) {
        const keys = sortedKeys();
        const index = Math.floor(random() * (keys.length + 2)) - 1;
        const expected =
          index >= 0 && index < keys.length ? keys[index] : undefined;
        assert.equal(tree.at(index)?.[0], expected);
        if (expected !== undefined) {
          assert.equal(tree.indexOf(expected), index);
        }
      } else if (choice < 0.92) {
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
      } else {
        const keys = sortedKeys();
        const lo = Math.floor(random() * 240) - 10;
        const hi = Math.floor(random() * 240) - 10;
        assert.deepEqual(
          rangeKeys(tree.range(lo, hi)),
          keys.filter((item) => item >= lo && item <= hi),
        );
      }

      assert.equal(tree.validate(), true, `order ${order} step ${step}`);
      assert.equal(tree.size, model.size);
      const keys = sortedKeys();
      assert.deepEqual(keysOf(tree), keys);
      assert.deepEqual(
        tree.toArray(),
        keys.map((item) => [item, model.get(item)]),
      );
    }
  }
});

test("BTree bulkLoad is sorted, linear, and leaves the tree intact on error", () => {
  const random = seeded(0xb234);
  for (const order of [3, 4, 5, 6, 7, 8, 16]) {
    const counts = [
      0,
      1,
      2,
      order - 1,
      order,
      order + 1,
      order * 2,
      order * 2 + 1,
      100,
      300,
    ];
    for (const count of counts) {
      const values = new Set<number>();
      while (values.size < count) {
        values.add(Math.floor(random() * 10_000));
      }
      const sorted = [...values].sort(asc);
      const tree = new BTree<number, string>({ order, compare: asc });
      const model = new Map<number, string>();
      for (const key of sorted) {
        model.set(key, `v${key}`);
      }
      tree.bulkLoad(sorted.map((key) => [key, `v${key}`]));
      assert.equal(tree.size, count, `order ${order} count ${count}`);
      assert.equal(
        tree.validate(),
        true,
        `order ${order} validate count ${count}`,
      );
      assert.deepEqual(keysOf(tree), sorted, `order ${order} count ${count}`);
      assert.deepEqual(
        tree.toArray(),
        sorted.map((key) => [key, model.get(key)]),
        `order ${order} entries count ${count}`,
      );
    }
  }

  const tree = makeTree();
  const before = tree.toArray();
  assert.throws(
    () => tree.bulkLoad([
      [1, "a"],
      [3, "c"],
      [2, "b"],
    ]),
    RangeError,
  );
  assert.deepEqual(tree.toArray(), before);
  assert.equal(tree.validate(), true);

  tree.bulkLoad([
    [10, "first"],
    [10, "last"],
    [11, "eleven"],
  ]);
  assert.deepEqual(tree.toArray(), [
    [10, "last"],
    [11, "eleven"],
  ]);
  assert.equal(tree.validate(), true);

  tree.bulkLoad([]);
  assert.equal(tree.size, 0);
  assert.equal(tree.height, -1);
  assert.equal(tree.validate(), true);
});

test("BTree serialization round-trips and rejects malformed payloads", () => {
  const tree = makeTree(7);
  const serialized = JSON.parse(tree.serialize()) as {
    type: string;
    version: number;
    entries: Array<[number, string]>;
  };
  assert.equal(serialized.type, "BTree");
  assert.equal(serialized.version, 1);
  assert.deepEqual(serialized.entries, tree.toArray());

  const restored = BTree.deserialize<number, string>(
    tree.serialize(),
    { order: 7, compare: asc },
  );
  assert.equal(restored.order, 7);
  assert.equal(restored.validate(), true);
  assert.equal(restored.size, tree.size);
  assert.equal(restored.height, tree.height);
  assert.deepEqual(restored.toArray(), tree.toArray());
  assert.equal(restored.get(5), "v5");

  assert.throws(
    () =>
      BTree.deserialize({
        type: "AVLTree",
        version: 1,
        entries: [],
      }),
    TypeError,
  );
  assert.throws(
    () =>
      BTree.deserialize({
        type: "BTree",
        version: 2,
        entries: [],
      }),
    TypeError,
  );
  assert.throws(
    () =>
      BTree.deserialize({
        type: "BTree",
        version: 1,
        entries: [[1]],
      }),
    TypeError,
  );
  assert.throws(
    () =>
      BTree.deserialize({
        type: "BTree",
        version: 1,
        entries: [[1, undefined]],
      }),
    TypeError,
  );
  assert.throws(
    () =>
      BTree.deserialize({
        type: "BTree",
        version: 1,
        entries: [
          [2, "b"],
          [1, "a"],
        ],
      }),
    TypeError,
  );
});

test("BTree iterators are invalidated by mutation", () => {
  const tree = makeTree();
  const iterator = tree.entries();
  assert.deepEqual(iterator.next(), { done: false, value: [1, "v1"] });
  tree.set(20, "v20");
  assert.throws(() => iterator.next(), ConcurrentModificationError);

  const rangeIterator = tree.range(0, 10);
  tree.get(0);
  assert.equal(rangeIterator.next().done, false);
  tree.delete(1);
  assert.throws(() => rangeIterator.next(), ConcurrentModificationError);
});

test("BTree rejects undefined keys and values", () => {
  const tree = new BTree<number, string>(asc);
  assert.throws(() => tree.set(undefined as never, "x"), TypeError);
  assert.throws(() => tree.set(1, undefined as never), TypeError);
  assert.throws(() => tree.get(undefined as never), TypeError);
  assert.throws(() => tree.has(undefined as never), TypeError);
  assert.throws(() => tree.delete(undefined as never), TypeError);
  assert.throws(() => tree.predecessor(undefined as never), TypeError);
  assert.throws(() => tree.successor(undefined as never), TypeError);
  assert.throws(
    () => tree.bulkLoad([[undefined, "x"] as never]),
    TypeError,
  );
});
