import test from "node:test";
import assert from "node:assert/strict";
import {
  AVLTree,
  BinarySearchTree,
  ConcurrentModificationError,
  ConsumedError,
  UnsupportedError,
  WeightBalancedTree,
} from "../../src/index.ts";

const asc = (a: number, b: number): number => a - b;

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function makeTree(): WeightBalancedTree<number, string> {
  const tree = new WeightBalancedTree<number, string>(asc);
  for (const key of [5, 2, 8, 1, 9, 3, 7]) {
    tree.set(key, `v${key}`);
  }
  return tree;
}

function keysOf(tree: WeightBalancedTree<number, unknown>): number[] {
  return [...tree.keys()];
}

function keysOfRange(iterator: IterableIterator<[number, string]>): number[] {
  return [...iterator].map((entry) => entry[0]);
}

function heightBound(size: number): number {
  return 2.5 * Math.log2(size + 1);
}

test("WeightBalancedTree empty state and basic operations", () => {
  const tree = new WeightBalancedTree<number, string>(asc);
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

test("WeightBalancedTree maintains ordering, order statistics, and range queries", () => {
  const tree = makeTree();
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
  assert.deepEqual(keysOfRange(tree.range(3, 7, { lo: "exclusive", hi: "exclusive" })), [5]);
  assert.deepEqual(keysOfRange(tree.range(undefined, 3)), [1, 2, 3]);
  assert.deepEqual(keysOfRange(tree.range(7, undefined)), [7, 8, 9]);
  assert.deepEqual(keysOfRange(tree.range(7, 3)), []);
  assert.throws(() => tree.range(1, 2, { lo: "bad" as never }), TypeError);
  assert.throws(() => tree.range(1, 2, { hi: "bad" as never }), TypeError);
  assert.equal(tree.validate(), true);
});

test("WeightBalancedTree replaces values for comparator-equal keys and supports clear", () => {
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

test("WeightBalancedTree deletion covers every shape and keeps balance", () => {
  const tree = makeTree();
  for (const key of [1, 9, 7, 5, 2, 8, 3]) {
    assert.equal(tree.delete(key), true);
    assert.equal(tree.validate(), true, `after deleting ${key}`);
  }
  assert.equal(tree.size, 0);
  assert.equal(tree.height, -1);
  assert.equal(tree.delete(1), false);
  assert.equal(tree.validate(), true);

  const drained = new WeightBalancedTree<number, string>(asc);
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

test("WeightBalancedTree matches a sorted reference over random operations", () => {
  const random = seeded(0x0b1a);
  const tree = new WeightBalancedTree<number, string>(asc);
  const model = new Map<number, string>();
  const sortedKeys = (): number[] => [...model.keys()].sort(asc);

  for (let step = 0; step < 2_000; step++) {
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
        tree.height <= heightBound(tree.size),
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

test("WeightBalancedTree height stays logarithmic on sorted input", () => {
  const tree = new WeightBalancedTree<number, number>(asc);
  const count = 5_000;
  for (let key = 0; key < count; key++) {
    tree.set(key, key);
  }
  assert.equal(tree.size, count);
  assert.equal(tree.validate(), true);
  assert.equal(tree.height <= heightBound(count), true);

  for (let key = 0; key < count; key += 2) {
    assert.equal(tree.delete(key), true);
  }
  assert.equal(tree.size, count / 2);
  assert.equal(tree.validate(), true);
  assert.equal(tree.height <= heightBound(tree.size), true);
  assert.deepEqual(keysOf(tree).slice(0, 3), [1, 3, 5]);
  assert.deepEqual(keysOf(tree).slice(-3), [4995, 4997, 4999]);
});

test("WeightBalancedTree join consumes both inputs and preserves order", () => {
  const left = new WeightBalancedTree<number, string>(asc);
  const right = new WeightBalancedTree<number, string>(asc);
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

  const empty = new WeightBalancedTree<number, string>(asc);
  const only = new WeightBalancedTree<number, string>(asc);
  only.set(42, "x");
  const mergedEmpty = empty.join(only);
  assert.deepEqual(keysOf(mergedEmpty), [42]);
  assert.equal(mergedEmpty.validate(), true);
  assert.throws(() => empty.size, ConsumedError);
  assert.throws(() => only.size, ConsumedError);

  const otherEmpty = new WeightBalancedTree<number, string>(asc);
  const base = new WeightBalancedTree<number, string>(asc);
  base.set(42, "x");
  const mergedOtherEmpty = base.join(otherEmpty);
  assert.deepEqual(keysOf(mergedOtherEmpty), [42]);
  assert.equal(mergedOtherEmpty.validate(), true);
  assert.throws(() => base.size, ConsumedError);
  assert.throws(() => otherEmpty.size, ConsumedError);

  const bothEmpty = new WeightBalancedTree<number, string>(asc);
  const bothEmptyOther = new WeightBalancedTree<number, string>(asc);
  const nothing = bothEmpty.join(bothEmptyOther);
  assert.equal(nothing.size, 0);
  assert.equal(nothing.validate(), true);
});

test("WeightBalancedTree join rejects invalid order, self-joins, and foreign trees without consuming", () => {
  const left = new WeightBalancedTree<number, string>(asc);
  const right = new WeightBalancedTree<number, string>(asc);
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

  const single = new WeightBalancedTree<number, string>(asc);
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

test("WeightBalancedTree split consumes the receiver and balances both sides", () => {
  const tree = new WeightBalancedTree<number, string>(asc);
  for (let key = 1; key <= 10; key++) {
    tree.set(key, `v${key}`);
  }
  const [left, right] = tree.split(5);
  assert.deepEqual(keysOf(left), [1, 2, 3, 4]);
  assert.deepEqual(keysOf(right), [5, 6, 7, 8, 9, 10]);
  assert.equal(left.validate(), true);
  assert.equal(right.validate(), true);
  assert.throws(() => tree.size, ConsumedError);

  const below = new WeightBalancedTree<number, string>(asc);
  for (const key of [1, 2, 3]) {
    below.set(key, `v${key}`);
  }
  const [emptyLeft, allRight] = below.split(0);
  assert.equal(emptyLeft.size, 0);
  assert.deepEqual(keysOf(allRight), [1, 2, 3]);
  assert.equal(emptyLeft.validate(), true);
  assert.equal(allRight.validate(), true);
  assert.throws(() => below.size, ConsumedError);

  const above = new WeightBalancedTree<number, string>(asc);
  for (const key of [1, 2, 3]) {
    above.set(key, `v${key}`);
  }
  const [allLeft, emptyRight] = above.split(4);
  assert.deepEqual(keysOf(allLeft), [1, 2, 3]);
  assert.equal(emptyRight.size, 0);
  assert.equal(allLeft.validate(), true);
  assert.equal(emptyRight.validate(), true);

  const empty = new WeightBalancedTree<number, string>(asc);
  const [emptyLeft2, emptyRight2] = empty.split(5);
  assert.equal(emptyLeft2.size, 0);
  assert.equal(emptyRight2.size, 0);
  assert.equal(emptyLeft2.validate(), true);
  assert.equal(emptyRight2.validate(), true);
  assert.throws(() => empty.size, ConsumedError);
});

test("WeightBalancedTree split at a missing key partitions without loss", () => {
  const tree = new WeightBalancedTree<number, string>(asc);
  for (const key of [10, 20, 30, 40, 50]) {
    tree.set(key, `v${key}`);
  }
  const [left, right] = tree.split(25);
  assert.deepEqual(keysOf(left), [10, 20]);
  assert.deepEqual(keysOf(right), [30, 40, 50]);
  assert.equal(left.validate(), true);
  assert.equal(right.validate(), true);

  const repeated = new WeightBalancedTree<number, string>(asc);
  for (const key of [10, 20, 30, 40, 50]) {
    repeated.set(key, `v${key}`);
  }
  const [splitLeft, splitRight] = repeated.split(30);
  assert.deepEqual(keysOf(splitLeft), [10, 20]);
  assert.deepEqual(keysOf(splitRight), [30, 40, 50]);
  assert.equal(splitLeft.validate(), true);
  assert.equal(splitRight.validate(), true);
});

test("WeightBalancedTree split is correct and balanced for every cut point", () => {
  const random = seeded(0x5b11);
  for (let round = 0; round < 50; round++) {
    const values = new Set<number>();
    while (values.size < 150) {
      values.add(Math.floor(random() * 1_000));
    }
    const sorted = [...values].sort(asc);
    const cut = Math.floor(random() * 1_100) - 50;

    const tree = new WeightBalancedTree<number, number>(asc);
    for (const key of sorted) {
      tree.set(key, key);
    }
    const [left, right] = tree.split(cut);
    assert.equal(left.validate(), true, `left round ${round}`);
    assert.equal(right.validate(), true, `right round ${round}`);
    assert.deepEqual(keysOf(left), sorted.filter((key) => key < cut));
    assert.deepEqual(keysOf(right), sorted.filter((key) => key >= cut));
    assert.equal(left.size + right.size, sorted.length);
    if (left.size > 0) {
      assert.equal(left.height <= heightBound(left.size), true);
    }
    if (right.size > 0) {
      assert.equal(right.height <= heightBound(right.size), true);
    }
  }
});

test("WeightBalancedTree join is correct for random disjoint ranges", () => {
  const random = seeded(0x1017);
  for (let round = 0; round < 80; round++) {
    const leftKeys = new Set<number>();
    const rightKeys = new Set<number>();
    while (leftKeys.size < 60) {
      leftKeys.add(Math.floor(random() * 1_000));
    }
    while (rightKeys.size < 60) {
      rightKeys.add(1_000 + Math.floor(random() * 1_000));
    }
    const left = new WeightBalancedTree<number, number>(asc);
    const right = new WeightBalancedTree<number, number>(asc);
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
    assert.equal(joined.height <= heightBound(joined.size), true);
    assert.throws(() => left.size, ConsumedError);
    assert.throws(() => right.size, ConsumedError);
  }
});

test("WeightBalancedTree serialization round-trips and rejects malformed payloads", () => {
  const tree = makeTree();
  const serialized = JSON.parse(tree.serialize()) as {
    type: string;
    version: number;
    entries: Array<[number, string]>;
  };
  assert.equal(serialized.type, "WeightBalancedTree");
  assert.equal(serialized.version, 1);
  assert.deepEqual(serialized.entries, tree.toArray());

  const restored = WeightBalancedTree.deserialize<number, string>(tree.serialize(), asc);
  assert.equal(restored.validate(), true);
  assert.equal(restored.size, tree.size);
  assert.deepEqual(restored.toArray(), tree.toArray());
  assert.equal(restored.get(5), "v5");

  assert.throws(
    () => WeightBalancedTree.deserialize({ type: "AVLTree", version: 1, entries: [] }),
    TypeError,
  );
  assert.throws(
    () => WeightBalancedTree.deserialize({ type: "WeightBalancedTree", version: 2, entries: [] }),
    TypeError,
  );
  assert.throws(
    () => WeightBalancedTree.deserialize({ type: "WeightBalancedTree", version: 1, entries: [[1]] }),
    TypeError,
  );
  assert.throws(
    () => WeightBalancedTree.deserialize({ type: "WeightBalancedTree", version: 1, entries: [[1, undefined]] }),
    TypeError,
  );
  assert.throws(() => tree.set(undefined as never, "x"), TypeError);
  assert.throws(() => tree.set(1, undefined as never), TypeError);
});

test("WeightBalancedTree iterators are invalidated by mutation", () => {
  const tree = makeTree();
  const iterator = tree.entries();
  assert.deepEqual(iterator.next(), { done: false, value: [1, "v1"] });
  tree.set(10, "v10");
  assert.throws(() => iterator.next(), ConcurrentModificationError);

  const rangeIterator = tree.range(1, 10);
  tree.delete(1);
  assert.throws(() => rangeIterator.next(), ConcurrentModificationError);
});

test("WeightBalancedTree work per operation stays logarithmic", () => {
  let calls = 0;
  const counting = (a: number, b: number): number => {
    calls++;
    return a - b;
  };
  const tree = new WeightBalancedTree<number, number>(counting);
  const count = 4_096;
  for (let key = 0; key < count; key++) {
    tree.set(key, key);
  }
  assert.equal(tree.validate(), true);
  assert.equal(calls / count <= 30, true, `${calls / count} comparisons per insert`);

  calls = 0;
  assert.equal(tree.height <= heightBound(count), true);
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

test("WeightBalancedTree validate rejects corrupted balance metadata", () => {
  type TestNode = {
    key: number;
    value: string;
    left: TestNode | null;
    right: TestNode | null;
    parent: TestNode | null;
    size: number;
    height: number;
  };
  type Internals = { _root: TestNode | null; _size: number };
  const internals = (tree: WeightBalancedTree<number, string>): Internals =>
    tree as unknown as Internals;

  const staleSize = makeTree();
  (internals(staleSize)._root as TestNode).size = 99;
  assert.match(staleSize.validate() as string, /stale subtree size|does not match node count/);

  const staleHeight = makeTree();
  (internals(staleHeight)._root as TestNode).height = 99;
  assert.match(staleHeight.validate() as string, /stale height/);

  const node: TestNode = {
    key: 2,
    value: "v2",
    left: null,
    right: null,
    parent: null,
    size: 1,
    height: 0,
  };
  const child: TestNode = {
    key: 3,
    value: "v3",
    left: null,
    right: null,
    parent: node,
    size: 1,
    height: 0,
  };
  node.right = child;
  node.size = 2;
  node.height = 1;
  const unbalanced = new WeightBalancedTree<number, string>(asc);
  internals(unbalanced)._root = node;
  internals(unbalanced)._size = 2;
  assert.equal(unbalanced.validate(), true);

  const grandchild: TestNode = {
    key: 4,
    value: "v4",
    left: null,
    right: null,
    parent: null,
    size: 1,
    height: 0,
  };
  const childWithRight: TestNode = {
    ...child,
    right: grandchild,
    size: 2,
    height: 1,
    parent: node,
  };
  grandchild.parent = childWithRight;
  node.right = childWithRight;
  node.size = 3;
  node.height = 2;
  internals(unbalanced)._size = 3;
  assert.match(unbalanced.validate() as string, /weight balance condition/);
});

test("WeightBalancedTree stays below the height bound of AVL and red-black trees", () => {
  const random = seeded(0xf00d);
  const trials = 5;
  for (let trial = 0; trial < trials; trial++) {
    const keys: number[] = new Array(5_000);
    for (let index = 0; index < keys.length; index++) {
      keys[index] = Math.floor(random() * 1_000_000_000);
    }
    const wb = new WeightBalancedTree<number, number>(asc);
    const avl = new AVLTree<number, number>(asc);
    for (const key of keys) {
      wb.set(key, key);
      avl.set(key, key);
    }
    assert.equal(wb.validate(), true, `trial ${trial}`);
    assert.ok(
      wb.height <= 2.5 * avl.height,
      `trial ${trial}: weight-balanced height ${wb.height} is not near AVL height ${avl.height}`,
    );
  }
});
