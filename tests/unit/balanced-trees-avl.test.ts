import test from "node:test";
import assert from "node:assert/strict";
import {
  AVLTree,
  BinarySearchTree,
  ConcurrentModificationError,
  ConsumedError,
  UnsupportedError,
} from "../../src/index.ts";

const asc = (a: number, b: number): number => a - b;

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function makeTree(): AVLTree<number, string> {
  const tree = new AVLTree<number, string>(asc);
  for (const key of [5, 2, 8, 1, 9, 3, 7]) {
    tree.set(key, `v${key}`);
  }
  return tree;
}

function keysOf(tree: AVLTree<number, unknown>): number[] {
  return [...tree.keys()];
}

test("AVLTree empty state and basic operations", () => {
  const tree = new AVLTree<number, string>(asc);
  assert.equal(tree.size, 0);
  assert.equal(tree.isEmpty(), true);
  assert.equal(tree.height, -1);
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
});

test("AVLTree maintains ordering, order statistics, and range queries", () => {
  const tree = makeTree();
  assert.equal(tree.size, 7);
  assert.equal(tree.height, 2);
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
  assert.deepEqual(keysOfRange(tree.range(3, 7, { lo: "exclusive", hi: "exclusive" })), [5]);
  assert.deepEqual(keysOfRange(tree.range(undefined, 3)), [1, 2, 3]);
  assert.deepEqual(keysOfRange(tree.range(7, undefined)), [7, 8, 9]);
  assert.deepEqual(keysOfRange(tree.range(7, 3)), []);
  assert.throws(() => tree.range(1, 2, { lo: "bad" as never }), TypeError);
  assert.throws(() => tree.range(1, 2, { hi: "bad" as never }), TypeError);
  assert.equal(tree.validate(), true);
});

function keysOfRange(iterator: IterableIterator<[number, string]>): number[] {
  return [...iterator].map((entry) => entry[0]);
}

test("AVLTree replaces values for comparator-equal keys and supports clear", () => {
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

test("AVLTree deletion covers every shape and keeps balance", () => {
  const tree = makeTree();
  for (const key of [1, 9, 7, 5, 2, 8, 3]) {
    assert.equal(tree.delete(key), true);
    assert.equal(tree.validate(), true, `after deleting ${key}`);
  }
  assert.equal(tree.size, 0);
  assert.equal(tree.height, -1);
  assert.equal(tree.delete(1), false);
  assert.equal(tree.validate(), true);

  const drained = new AVLTree<number, string>(asc);
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

test("AVLTree matches a sorted reference over random operations", () => {
  const random = seeded(0xa571);
  const tree = new AVLTree<number, string>(asc);
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
      assert.deepEqual(tree.predecessor(key), below === undefined ? undefined : [below, model.get(below)]);
      assert.deepEqual(tree.successor(key), above === undefined ? undefined : [above, model.get(above)]);
    }

    assert.equal(tree.validate(), true, `step ${step}`);
    assert.equal(tree.size, model.size);
    const keys = sortedKeys();
    assert.deepEqual(keysOf(tree), keys);
    assert.deepEqual(
      tree.toArray(),
      keys.map((item) => [item, model.get(item)]),
    );
    if (tree.size > 0) {
      assert.equal(
        tree.height <= 1.4405 * Math.log2(tree.size + 2),
        true,
        `height ${tree.height} at step ${step} for size ${tree.size}`,
      );
    }
  }

  const keys = sortedKeys();
  const observed: number[] = [];
  while (!tree.isEmpty()) {
    const entry = tree.min() as [number, string];
    observed.push(entry[0]);
    tree.delete(entry[0]);
    assert.equal(tree.validate(), true);
  }
  assert.deepEqual(observed, keys);
});

test("AVLTree height stays logarithmic on sorted input", () => {
  const tree = new AVLTree<number, number>(asc);
  const count = 5_000;
  for (let key = 0; key < count; key++) {
    tree.set(key, key);
  }
  assert.equal(tree.size, count);
  assert.equal(tree.validate(), true);
  assert.equal(tree.height <= 1.4405 * Math.log2(count + 2), true);

  for (let key = 0; key < count; key += 2) {
    assert.equal(tree.delete(key), true);
  }
  assert.equal(tree.size, count / 2);
  assert.equal(tree.validate(), true);
  assert.equal(tree.height <= 1.4405 * Math.log2(tree.size + 2), true);
  assert.deepEqual(keysOf(tree).slice(0, 3), [1, 3, 5]);
  assert.deepEqual(keysOf(tree).slice(-3), [4995, 4997, 4999]);
});

test("AVLTree join consumes both inputs and preserves order", () => {
  const left = new AVLTree<number, string>(asc);
  const right = new AVLTree<number, string>(asc);
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

  const empty = new AVLTree<number, string>(asc);
  const only = new AVLTree<number, string>(asc);
  only.set(42, "x");
  const mergedEmpty = empty.join(only);
  assert.deepEqual(keysOf(mergedEmpty), [42]);
  assert.throws(() => empty.size, ConsumedError);
  assert.throws(() => only.size, ConsumedError);

  const otherEmpty = new AVLTree<number, string>(asc);
  const base = new AVLTree<number, string>(asc);
  base.set(42, "x");
  const mergedOtherEmpty = base.join(otherEmpty);
  assert.deepEqual(keysOf(mergedOtherEmpty), [42]);
  assert.throws(() => base.size, ConsumedError);
  assert.throws(() => otherEmpty.size, ConsumedError);
});

test("AVLTree join rejects invalid order, self-joins, and foreign trees without consuming", () => {
  const left = new AVLTree<number, string>(asc);
  const right = new AVLTree<number, string>(asc);
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

  const single = new AVLTree<number, string>(asc);
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

test("AVLTree split consumes the receiver and balances both sides", () => {
  const tree = new AVLTree<number, string>(asc);
  for (let key = 1; key <= 10; key++) {
    tree.set(key, `v${key}`);
  }
  const [left, right] = tree.split(5);
  assert.deepEqual(keysOf(left), [1, 2, 3, 4]);
  assert.deepEqual(keysOf(right), [5, 6, 7, 8, 9, 10]);
  assert.equal(left.validate(), true);
  assert.equal(right.validate(), true);
  assert.throws(() => tree.size, ConsumedError);

  const below = new AVLTree<number, string>(asc);
  for (const key of [1, 2, 3]) {
    below.set(key, `v${key}`);
  }
  const [emptyLeft, allRight] = below.split(0);
  assert.equal(emptyLeft.size, 0);
  assert.deepEqual(keysOf(allRight), [1, 2, 3]);
  assert.equal(emptyLeft.validate(), true);
  assert.equal(allRight.validate(), true);
  assert.throws(() => below.size, ConsumedError);

  const above = new AVLTree<number, string>(asc);
  for (const key of [1, 2, 3]) {
    above.set(key, `v${key}`);
  }
  const [allLeft, emptyRight] = above.split(4);
  assert.deepEqual(keysOf(allLeft), [1, 2, 3]);
  assert.equal(emptyRight.size, 0);
  assert.equal(allLeft.validate(), true);
  assert.equal(emptyRight.validate(), true);

  const empty = new AVLTree<number, string>(asc);
  const [emptyLeft2, emptyRight2] = empty.split(5);
  assert.equal(emptyLeft2.size, 0);
  assert.equal(emptyRight2.size, 0);
  assert.equal(emptyLeft2.validate(), true);
  assert.equal(emptyRight2.validate(), true);
  assert.throws(() => empty.size, ConsumedError);
});

test("AVLTree split at a missing key partitions without loss", () => {
  const tree = new AVLTree<number, string>(asc);
  for (const key of [10, 20, 30, 40, 50]) {
    tree.set(key, `v${key}`);
  }
  const [left, right] = tree.split(25);
  assert.deepEqual(keysOf(left), [10, 20]);
  assert.deepEqual(keysOf(right), [30, 40, 50]);
  assert.equal(left.validate(), true);
  assert.equal(right.validate(), true);

  const repeated = new AVLTree<number, string>(asc);
  for (const key of [10, 20, 30, 40, 50]) {
    repeated.set(key, `v${key}`);
  }
  const [splitLeft, splitRight] = repeated.split(30);
  assert.deepEqual(keysOf(splitLeft), [10, 20]);
  assert.deepEqual(keysOf(splitRight), [30, 40, 50]);
  assert.equal(splitLeft.validate(), true);
  assert.equal(splitRight.validate(), true);
});

test("AVLTree split is correct and balanced for every cut point", () => {
  const random = seeded(0x5b11);
  for (let round = 0; round < 30; round++) {
    const values = new Set<number>();
    while (values.size < 120) {
      values.add(Math.floor(random() * 1_000));
    }
    const sorted = [...values].sort(asc);
    const cut = Math.floor(random() * 1_100) - 50;

    const tree = new AVLTree<number, number>(asc);
    for (const key of sorted) {
      tree.set(key, key);
    }
    const [left, right] = tree.split(cut);
    assert.equal(left.validate(), true, `left round ${round}`);
    assert.equal(right.validate(), true, `right round ${round}`);
    assert.deepEqual(keysOf(left), sorted.filter((key) => key < cut));
    assert.deepEqual(keysOf(right), sorted.filter((key) => key >= cut));
    assert.equal(left.size + right.size, sorted.length);
  }
});

test("AVLTree join is correct for random disjoint ranges", () => {
  const random = seeded(0x1017);
  for (let round = 0; round < 40; round++) {
    const leftKeys = new Set<number>();
    const rightKeys = new Set<number>();
    while (leftKeys.size < 40) {
      leftKeys.add(Math.floor(random() * 1_000));
    }
    while (rightKeys.size < 40) {
      rightKeys.add(1_000 + Math.floor(random() * 1_000));
    }
    const left = new AVLTree<number, number>(asc);
    const right = new AVLTree<number, number>(asc);
    for (const key of leftKeys) {
      left.set(key, key);
    }
    for (const key of rightKeys) {
      right.set(key, key);
    }
    const joined = left.join(right);
    const expected = [...leftKeys, ...rightKeys].sort(asc);
    assert.equal(joined.validate(), true, `round ${round}`);
    assert.deepEqual(keysOf(joined), expected);
    assert.throws(() => left.size, ConsumedError);
    assert.throws(() => right.size, ConsumedError);
  }
});

test("AVLTree serialization round-trips and rejects malformed payloads", () => {
  const tree = makeTree();
  const serialized = JSON.parse(tree.serialize()) as {
    type: string;
    version: number;
    entries: Array<[number, string]>;
  };
  assert.equal(serialized.type, "AVLTree");
  assert.equal(serialized.version, 1);
  assert.deepEqual(serialized.entries, tree.toArray());

  const restored = AVLTree.deserialize<number, string>(tree.serialize(), asc);
  assert.equal(restored.validate(), true);
  assert.equal(restored.size, tree.size);
  assert.deepEqual(restored.toArray(), tree.toArray());
  assert.equal(restored.get(5), "v5");

  assert.throws(
    () => AVLTree.deserialize({ type: "BinarySearchTree", version: 1, entries: [] }),
    TypeError,
  );
  assert.throws(
    () => AVLTree.deserialize({ type: "AVLTree", version: 2, entries: [] }),
    TypeError,
  );
  assert.throws(
    () => AVLTree.deserialize({ type: "AVLTree", version: 1, entries: [[1]] }),
    TypeError,
  );
  assert.throws(
    () => AVLTree.deserialize({ type: "AVLTree", version: 1, entries: [[1, undefined]] }),
    TypeError,
  );
  assert.throws(() => tree.set(undefined as never, "x"), TypeError);
  assert.throws(() => tree.set(1, undefined as never), TypeError);
});

test("AVLTree iterators are invalidated by mutation", () => {
  const tree = makeTree();
  const iterator = tree.entries();
  assert.deepEqual(iterator.next(), { done: false, value: [1, "v1"] });
  tree.set(10, "v10");
  assert.throws(() => iterator.next(), ConcurrentModificationError);

  const rangeIterator = tree.range(1, 10);
  tree.delete(1);
  assert.throws(() => rangeIterator.next(), ConcurrentModificationError);
});

test("AVLTree work per operation stays logarithmic", () => {
  let calls = 0;
  const counting = (a: number, b: number): number => {
    calls++;
    return a - b;
  };
  const tree = new AVLTree<number, number>(counting);
  const count = 4_096;
  for (let key = 0; key < count; key++) {
    tree.set(key, key);
  }
  assert.equal(tree.validate(), true);
  assert.equal(calls / count <= 20, true, `${calls / count} comparisons per insert`);

  calls = 0;
  assert.equal(tree.height <= 1.4405 * Math.log2(count + 2), true);
  assert.equal(calls, 0);

  calls = 0;
  tree.at(count >> 1);
  tree.min();
  tree.max();
  assert.equal(calls, 0);

  calls = 0;
  tree.indexOf(count >> 1);
  assert.equal(calls <= 20, true, `${calls} comparisons for indexOf`);
});
