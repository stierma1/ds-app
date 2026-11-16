import test from "node:test";
import assert from "node:assert/strict";
import {
  BinarySearchTree,
  BottomUpSplayTree,
  ConcurrentModificationError,
  ConsumedError,
  SplayTree,
  TopDownSplayTree,
  UnsupportedError,
} from "../../src/index.ts";
import type { SplayTreeLike } from "../../src/splay-trees/index.ts";

const asc = (a: number, b: number): number => a - b;

interface Variant {
  name: string;
  type: string;
  create(): SplayTreeLike<number, string>;
  deserialize(json: unknown): SplayTreeLike<number, string>;
}

const variants: Variant[] = [
  {
    name: "SplayTree",
    type: "SplayTree",
    create: () => new SplayTree<number, string>(asc),
    deserialize: (json) => SplayTree.deserialize<number, string>(json, asc),
  },
  {
    name: "BottomUpSplayTree",
    type: "SplayTree",
    create: () => new BottomUpSplayTree<number, string>(asc),
    deserialize: (json) => BottomUpSplayTree.deserialize<number, string>(json, asc),
  },
  {
    name: "TopDownSplayTree",
    type: "TopDownSplayTree",
    create: () => new TopDownSplayTree<number, string>(asc),
    deserialize: (json) => TopDownSplayTree.deserialize<number, string>(json, asc),
  },
];

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function makeTree(variant: Variant): SplayTreeLike<number, string> {
  const tree = variant.create();
  for (const key of [5, 2, 8, 1, 9, 3, 7]) {
    tree.set(key, `v${key}`);
  }
  return tree;
}

function keysOf(tree: SplayTreeLike<number, unknown>): number[] {
  return [...tree.keys()];
}

function keysOfRange(iterator: IterableIterator<[number, string]>): number[] {
  return [...iterator].map((entry) => entry[0]);
}

function rootKey(tree: SplayTreeLike<number, unknown>): number | undefined {
  const root = tree.root as { key: number } | null;
  return root === null ? undefined : root.key;
}

for (const variant of variants) {
  test(`${variant.name} empty state and basic operations`, () => {
    const tree = variant.create();
    assert.equal(tree.size, 0);
    assert.equal(tree.isEmpty(), true);
    assert.equal(tree.root, null);
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
    assert.deepEqual(tree.min(), [5, "v5"]);
    assert.deepEqual(tree.max(), [5, "v5"]);
    assert.equal(rootKey(tree), 5);
    assert.equal(tree.validate(), true);
  });

  test(`${variant.name} maintains ordering, order statistics, and range queries`, () => {
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
    assert.equal(rootKey(tree), 5);
    assert.equal(tree.get(4), undefined);
    assert.equal(tree.has(9), true);
    assert.equal(rootKey(tree), 9);
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
    assert.deepEqual(keysOfRange(tree.range(3, 7, { lo: "exclusive", hi: "exclusive" })), [5]);
    assert.deepEqual(keysOfRange(tree.range(undefined, 3)), [1, 2, 3]);
    assert.deepEqual(keysOfRange(tree.range(7, undefined)), [7, 8, 9]);
    assert.deepEqual(keysOfRange(tree.range(7, 3)), []);
    assert.throws(() => tree.range(1, 2, { lo: "bad" as never }), TypeError);
    assert.throws(() => tree.range(1, 2, { hi: "bad" as never }), TypeError);
    assert.equal(tree.validate(), true);
  });

  test(`${variant.name} replaces values for comparator-equal keys and supports clear`, () => {
    const tree = makeTree(variant);
    tree.set(5, "updated");
    assert.equal(tree.size, 7);
    assert.equal(tree.get(5), "updated");
    assert.deepEqual(tree.at(3), [5, "updated"]);
    assert.equal(rootKey(tree), 5);
    assert.equal(tree.validate(), true);

    tree.clear();
    assert.equal(tree.size, 0);
    assert.equal(tree.isEmpty(), true);
    assert.equal(tree.min(), undefined);
    assert.deepEqual([...tree.range()], []);
    assert.equal(tree.validate(), true);
  });

  test(`${variant.name} deletion covers every shape and drains in order`, () => {
    const tree = makeTree(variant);
    for (const key of [1, 9, 7, 5, 2, 8, 3]) {
      assert.equal(tree.delete(key), true);
      assert.equal(tree.validate(), true, `after deleting ${key}`);
    }
    assert.equal(tree.size, 0);
    assert.equal(tree.delete(1), false);
    assert.equal(tree.validate(), true);

    const drained = variant.create();
    const random = seeded(0x51a7);
    const keys = Array.from({ length: 200 }, () => Math.floor(random() * 500));
    for (const key of keys) {
      drained.set(key, `v${key}`);
    }
    const sorted = [...new Set(keys)].sort((a, b) => a - b);
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
    const tree = variant.create();
    const model = new Map<number, string>();
    const sortedKeys = (): number[] => [...model.keys()].sort(asc);

    for (let step = 0; step < 1_200; step++) {
      const key = Math.floor(random() * 70);
      const choice = random();
      if (choice < 0.42) {
        const value = `v${step}`;
        tree.set(key, value);
        model.set(key, value);
      } else if (choice < 0.62) {
        assert.equal(tree.delete(key), model.delete(key));
      } else if (choice < 0.72) {
        assert.equal(tree.get(key), model.get(key));
        assert.equal(tree.has(key), model.has(key));
      } else if (choice < 0.82) {
        const keys = sortedKeys();
        const index = Math.floor(random() * (keys.length + 2)) - 1;
        const expected = index >= 0 && index < keys.length ? keys[index] : undefined;
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

  test(`${variant.name} splay and locality move accessed keys to the root`, () => {
    const tree = variant.create();
    for (let key = 0; key < 64; key++) {
      tree.set(key, `v${key}`);
    }
    tree.splay(17);
    assert.equal(rootKey(tree), 17);
    tree.get(17);
    assert.equal(rootKey(tree), 17);
    tree.get(40);
    assert.equal(rootKey(tree), 40);
    tree.get(40);
    assert.equal(rootKey(tree), 40);
    tree.splay(1_000);
    assert.equal(rootKey(tree), 63);
    assert.equal(tree.validate(), true);
  });

  test(`${variant.name} handles a deep path without recursion`, () => {
    const count = 4_000;
    const tree = variant.create();
    for (let key = 0; key < count; key++) {
      tree.set(key, `v${key}`);
    }
    assert.equal(tree.size, count);
    assert.equal(tree.validate(), true);
    assert.deepEqual(tree.min(), [0, "v0"]);
    assert.equal(rootKey(tree), 0);
    assert.equal(tree.toArray().length, count);
    assert.equal(tree.validate(), true);
  });

  test(`${variant.name} join consumes both inputs and preserves order`, () => {
    const left = variant.create();
    const right = variant.create();
    for (const key of [1, 2, 3]) {
      left.set(key, `l${key}`);
    }
    for (const key of [4, 5, 6]) {
      right.set(key, `r${key}`);
    }

    const joined = left.join(right);
    assert.equal(joined.size, 6);
    assert.equal(joined.validate(), true);
    assert.deepEqual(keysOf(joined), [1, 2, 3, 4, 5, 6]);
    assert.equal(joined.get(2), "l2");
    assert.equal(joined.get(5), "r5");
    assert.throws(() => left.size, ConsumedError);
    assert.throws(() => right.size, ConsumedError);
    assert.throws(() => left.validate(), ConsumedError);

    const empty = variant.create();
    const only = variant.create();
    only.set(42, "x");
    const mergedEmpty = empty.join(only);
    assert.deepEqual(keysOf(mergedEmpty), [42]);
    assert.equal(mergedEmpty.validate(), true);
    assert.throws(() => empty.size, ConsumedError);
    assert.throws(() => only.size, ConsumedError);

    const otherEmpty = variant.create();
    const base = variant.create();
    base.set(42, "x");
    const mergedOtherEmpty = base.join(otherEmpty);
    assert.deepEqual(keysOf(mergedOtherEmpty), [42]);
    assert.equal(mergedOtherEmpty.validate(), true);
    assert.throws(() => base.size, ConsumedError);
    assert.throws(() => otherEmpty.size, ConsumedError);
  });

  test(`${variant.name} join rejects invalid order, self-joins, and foreign trees without consuming`, () => {
    const left = variant.create();
    const right = variant.create();
    for (const key of [1, 5, 10]) {
      left.set(key, `l${key}`);
    }
    for (const key of [5, 8, 12]) {
      right.set(key, `r${key}`);
    }
    assert.throws(() => left.join(right), TypeError);
    assert.equal(left.size, 3);
    assert.equal(right.size, 3);
    assert.equal(left.validate(), true);
    assert.equal(right.validate(), true);

    const single = variant.create();
    single.set(1, "a");
    assert.throws(() => single.join(single), TypeError);
    assert.equal(single.size, 1);
    assert.equal(single.validate(), true);

    const foreign = new BinarySearchTree<number, string>(asc);
    foreign.set(100, "x");
    assert.throws(() => single.join(foreign as never), UnsupportedError);
    assert.equal(single.size, 1);
    assert.equal(foreign.size, 1);
  });

  test(`${variant.name} split consumes the receiver and partitions both sides`, () => {
    const tree = variant.create();
    for (let key = 1; key <= 10; key++) {
      tree.set(key, `v${key}`);
    }
    const [left, right] = tree.split(5);
    assert.deepEqual(keysOf(left), [1, 2, 3, 4]);
    assert.deepEqual(keysOf(right), [5, 6, 7, 8, 9, 10]);
    assert.equal(left.validate(), true);
    assert.equal(right.validate(), true);
    assert.throws(() => tree.size, ConsumedError);

    const below = variant.create();
    for (const key of [1, 2, 3]) {
      below.set(key, `v${key}`);
    }
    const [emptyLeft, allRight] = below.split(0);
    assert.equal(emptyLeft.size, 0);
    assert.deepEqual(keysOf(allRight), [1, 2, 3]);
    assert.equal(emptyLeft.validate(), true);
    assert.equal(allRight.validate(), true);
    assert.throws(() => below.size, ConsumedError);

    const above = variant.create();
    for (const key of [1, 2, 3]) {
      above.set(key, `v${key}`);
    }
    const [allLeft, emptyRight] = above.split(4);
    assert.deepEqual(keysOf(allLeft), [1, 2, 3]);
    assert.equal(emptyRight.size, 0);
    assert.equal(allLeft.validate(), true);
    assert.equal(emptyRight.validate(), true);

    const empty = variant.create();
    const [emptyLeft2, emptyRight2] = empty.split(5);
    assert.equal(emptyLeft2.size, 0);
    assert.equal(emptyRight2.size, 0);
    assert.equal(emptyLeft2.validate(), true);
    assert.equal(emptyRight2.validate(), true);
    assert.throws(() => empty.size, ConsumedError);
  });

  test(`${variant.name} split partitions correctly at every cut point`, () => {
    const random = seeded(0x5b11);
    for (let round = 0; round < 30; round++) {
      const values = new Set<number>();
      while (values.size < 120) {
        values.add(Math.floor(random() * 1_000));
      }
      const sorted = [...values].sort(asc);
      const cut = Math.floor(random() * 1_100) - 50;

      const tree = variant.create();
      for (const key of sorted) {
        tree.set(key, `v${key}`);
      }
      const [left, right] = tree.split(cut);
      assert.equal(left.validate(), true, `left round ${round}`);
      assert.equal(right.validate(), true, `right round ${round}`);
      assert.deepEqual(keysOf(left), sorted.filter((key) => key < cut));
      assert.deepEqual(keysOf(right), sorted.filter((key) => key >= cut));
      assert.equal(left.size + right.size, sorted.length);
    }
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

    const restored = variant.deserialize(tree.serialize());
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
      () => variant.deserialize({ type: variant.type, version: 1, entries: [[1, undefined]] }),
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

    const rangeIterator = tree.range(1, 10);
    tree.get(1);
    assert.throws(() => rangeIterator.next(), ConcurrentModificationError);
  });
}

test("bottom-up and top-down variants agree on contents over random operations", () => {
  const random = seeded(0x5011);
  const bottom = new SplayTree<number, number>(asc);
  const top = new TopDownSplayTree<number, number>(asc);
  for (let step = 0; step < 2_000; step++) {
    const key = Math.floor(random() * 100);
    const choice = random();
    if (choice < 0.45) {
      bottom.set(key, step);
      top.set(key, step);
    } else if (choice < 0.7) {
      assert.equal(bottom.delete(key), top.delete(key));
    } else {
      assert.equal(bottom.get(key), top.get(key));
    }
    assert.equal(bottom.validate(), true, `bottom step ${step}`);
    assert.equal(top.validate(), true, `top step ${step}`);
    assert.deepEqual(keysOf(bottom), keysOf(top));
    assert.equal(bottom.size, top.size);
  }
});

const countingVariants: Array<{
  name: string;
  create(compare: (a: number, b: number) => number): SplayTreeLike<number, number>;
}> = [
  { name: "SplayTree", create: (compare) => new SplayTree<number, number>(compare) },
  {
    name: "TopDownSplayTree",
    create: (compare) => new TopDownSplayTree<number, number>(compare),
  },
];

for (const variant of countingVariants) {
  test(`${variant.name} stays within its amortized comparison bound`, () => {
    let calls = 0;
    const counting = (a: number, b: number): number => {
      calls++;
      return a - b;
    };
    const count = 2_048;
    const tree = variant.create(counting);
    for (let key = 0; key < count; key++) {
      tree.set(key, key);
    }
    assert.equal(tree.validate(), true);

    const random = seeded(0xc011);
    calls = 0;
    const accesses = 10_000;
    for (let step = 0; step < accesses; step++) {
      tree.get(Math.floor(random() * count));
    }
    const randomBound = 5 * accesses * Math.log2(count + 2);
    assert.equal(calls <= randomBound, true, `${calls} comparisons for ${accesses} gets`);

    calls = 0;
    for (let key = 0; key < count; key++) {
      tree.get(key);
    }
    const sequentialBound = 5 * count * Math.log2(count + 2);
    assert.equal(
      calls <= sequentialBound,
      true,
      `${calls} comparisons for a sequential sweep`,
    );
    assert.equal(tree.validate(), true);
  });
}
