import test from "node:test";
import assert from "node:assert/strict";
import {
  BitSet,
  BloomFilter,
  CountingBloomFilter,
  CuckooFilter,
  IntervalSet,
  PartitionedBloomFilter,
  QuickFind,
  QuickUnion,
  ScalableBloomFilter,
  SortedArraySet,
  UnionFind,
  WeightedUnionFind,
  mergeSortedRuns,
} from "../../src/index.ts";
import { ConcurrentModificationError } from "../../src/core/index.ts";

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test("SortedArraySet implements the set contract", () => {
  const set = new SortedArraySet<number>();
  assert.equal(set.add(3), true);
  assert.equal(set.add(1), true);
  assert.equal(set.add(2), true);
  assert.equal(set.add(2), false);
  assert.deepEqual(set.toArray(), [1, 2, 3]);
  assert.equal(set.min(), 1);
  assert.equal(set.max(), 3);
  assert.equal(set.at(1), 2);
  assert.equal(set.at(9), undefined);
  assert.equal(set.indexOf(2), 1);
  assert.equal(set.indexOf(9), -1);
  assert.equal(set.has(2), true);
  assert.equal(set.delete(2), true);
  assert.equal(set.delete(2), false);
  assert.deepEqual(set.toArray(), [1, 3]);
  assert.equal(set.validate(), true);
  assert.throws(() => set.add(undefined as never), TypeError);
  assert.throws(() => set.at(0.5), TypeError);

  const other = new SortedArraySet<number>();
  for (const value of [2, 3, 4, 4]) {
    other.add(value);
  }
  assert.deepEqual(set.union(other).toArray(), [1, 2, 3, 4]);
  assert.deepEqual(set.intersection(other).toArray(), [3]);
  assert.deepEqual(set.difference(other).toArray(), [1]);
  assert.deepEqual(set.symmetricDifference(other).toArray(), [1, 2, 4]);
  assert.equal(set.isSubsetOf([1, 2, 3, 4]), true);
  assert.equal(set.isSupersetOf([1, 3]), true);
  assert.equal(set.equals([3, 1]), true);
  assert.equal(set.equals([1, 2, 3]), false);

  const iterator = set[Symbol.iterator]();
  iterator.next();
  set.add(5);
  assert.throws(() => iterator.next(), ConcurrentModificationError);
});

test("SortedArraySet matches a reference Set", () => {
  const random = seeded(7);
  const set = new SortedArraySet<number>((a, b) => a - b);
  const reference = new Set<number>();
  for (let step = 0; step < 500; step++) {
    const value = Math.floor(random() * 100);
    const operation = random();
    if (operation < 0.55) {
      assert.equal(set.add(value), !reference.has(value));
      reference.add(value);
    } else if (operation < 0.75) {
      assert.equal(set.has(value), reference.has(value));
    } else {
      assert.equal(set.delete(value), reference.delete(value));
    }
    assert.equal(set.size, reference.size);
    assert.equal(set.validate(), true);
  }
  assert.deepEqual(set.toArray(), [...reference].sort((a, b) => a - b));
});

test("SortedArraySet honours custom comparators and serialization", () => {
  const descending = (a: number, b: number): number => b - a;
  const set = new SortedArraySet<number>(descending);
  for (const value of [1, 5, 3, 2, 4]) {
    set.add(value);
  }
  assert.deepEqual(set.toArray(), [5, 4, 3, 2, 1]);
  const restored = SortedArraySet.deserialize<number>(set.serialize(), descending);
  assert.deepEqual(restored.toArray(), [5, 4, 3, 2, 1]);
  assert.equal(restored.validate(), true);
  assert.throws(() => SortedArraySet.deserialize("not json"), TypeError);
  assert.throws(
    () =>
      SortedArraySet.deserialize({
        type: "SortedArraySet",
        version: 1,
        values: [undefined],
      }),
    TypeError,
  );
});

test("BitSet handles universe boundaries and set algebra", () => {
  const set = new BitSet(32);
  assert.equal(set.add(0), true);
  assert.equal(set.add(31), true);
  assert.equal(set.add(31), false);
  assert.equal(set.has(0), true);
  assert.equal(set.has(31), true);
  assert.equal(set.has(15), false);
  assert.throws(() => set.has(32), RangeError);
  assert.deepEqual(set.toArray(), [0, 31]);
  assert.equal(set.size, 2);
  assert.equal(set.validate(), true);
  assert.throws(() => set.add(32), RangeError);
  assert.throws(() => set.add(-1), RangeError);
  assert.throws(() => set.add(1.5), TypeError);
  assert.equal(set.delete(0), true);
  assert.equal(set.delete(0), false);
  assert.deepEqual(set.toArray(), [31]);

  const a = new BitSet(16);
  const b = new BitSet(16);
  for (const value of [1, 2, 3, 4]) {
    a.add(value);
  }
  for (const value of [3, 4, 5]) {
    b.add(value);
  }
  assert.deepEqual(a.union(b).toArray(), [1, 2, 3, 4, 5]);
  assert.deepEqual(a.intersection(b).toArray(), [3, 4]);
  assert.deepEqual(a.difference(b).toArray(), [1, 2]);
  assert.deepEqual(a.symmetricDifference(b).toArray(), [1, 2, 5]);
  assert.equal(a.isSubsetOf([1, 2, 3, 4, 5]), true);
  assert.equal(a.isSupersetOf([1, 2]), true);
  assert.equal(a.equals([4, 3, 2, 1]), true);
  assert.equal(a.equals([1, 2, 3]), false);
  assert.equal(a.isSupersetOf([99]), false);

  const restored = BitSet.deserialize(a.serialize());
  assert.deepEqual(restored.toArray(), a.toArray());
  assert.equal(restored.validate(), true);

  const empty = new BitSet(0);
  assert.equal(empty.size, 0);
  assert.equal(empty.validate(), true);
  assert.deepEqual(empty.toArray(), []);

  assert.throws(
    () => BitSet.deserialize({ type: "BitSet", version: 1, universe: 64, words: [1] }),
    TypeError,
  );
  assert.throws(() => BitSet.deserialize("not json"), TypeError);
});

test("IntervalSet merges, splits, and performs set algebra", () => {
  const set = new IntervalSet();
  assert.equal(set.addInterval(1, 5), true);
  assert.equal(set.addInterval(4, 8), true);
  assert.deepEqual(set.toArray(), [[1, 8]]);
  assert.equal(set.addInterval(9, 10), true);
  assert.deepEqual(set.toArray(), [[1, 10]]);
  assert.equal(set.addInterval(3, 5), false);
  assert.equal(set.hasValue(4), true);
  assert.equal(set.hasValue(11), false);
  assert.equal(set.containsInterval(2, 9), true);
  assert.equal(set.containsInterval(0, 9), false);
  assert.equal(set.removeInterval(4, 6), true);
  assert.deepEqual(set.toArray(), [[1, 3], [7, 10]]);
  assert.equal(set.removeInterval(100, 110), false);
  assert.equal(set.validate(), true);
  assert.throws(() => set.addInterval(5, 4), RangeError);
  assert.throws(() => set.addInterval(1.5, 2), TypeError);

  const a = new IntervalSet();
  a.addInterval(1, 5);
  a.addInterval(10, 20);
  const b = new IntervalSet();
  b.addInterval(3, 12);
  b.addInterval(18, 25);
  assert.deepEqual(a.union(b).toArray(), [[1, 25]]);
  assert.deepEqual(a.intersection(b).toArray(), [[3, 5], [10, 12], [18, 20]]);
  assert.deepEqual(a.difference(b).toArray(), [[1, 2], [13, 17]]);
  assert.deepEqual(a.symmetricDifference(b).toArray(), [[1, 2], [6, 9], [13, 17], [21, 25]]);
  assert.equal(a.isSubsetOf(b), false);
  assert.equal(a.equals(a.toArray()), true);
  assert.equal(a.has([1, 5]), true);
  assert.equal(a.delete([1, 5]), true);
  assert.deepEqual(a.toArray(), [[10, 20]]);

  const restored = IntervalSet.deserialize(b.serialize());
  assert.deepEqual(restored.toArray(), b.toArray());
  assert.equal(restored.validate(), true);
  assert.throws(
    () =>
      IntervalSet.deserialize({
        type: "IntervalSet",
        version: 1,
        values: [[1]],
      }),
    TypeError,
  );
});


interface DisjointVariant<E> {
  readonly setCount: number;
  makeSet(value: E): void;
  find(value: E): E;
  union(a: E, b: E): boolean;
  connected(a: E, b: E): boolean;
  sizeOf(value: E): number;
  validate(): true | string;
  serialize(): string;
}

const disjointVariants: Array<{
  name: string;
  create(): DisjointVariant<number>;
  deserialize(json: unknown): DisjointVariant<number>;
}> = [
  {
    name: "QuickFind",
    create: () => new QuickFind<number>(),
    deserialize: (json) => QuickFind.deserialize<number>(json),
  },
  {
    name: "QuickUnion",
    create: () => new QuickUnion<number>(),
    deserialize: (json) => QuickUnion.deserialize<number>(json),
  },
  {
    name: "WeightedUnionFind",
    create: () => new WeightedUnionFind<number>(),
    deserialize: (json) => WeightedUnionFind.deserialize<number>(json),
  },
];

for (const variant of disjointVariants) {
  test(`${variant.name} matches a naive disjoint-set model`, () => {
    const random = seeded(321);
    const forest = variant.create();
    const groups = new Map<number, Set<number>>();
    for (let value = 0; value < 60; value++) {
      forest.makeSet(value);
      groups.set(value, new Set([value]));
    }
    assert.equal(forest.setCount, 60);
    for (let step = 0; step < 300; step++) {
      const a = Math.floor(random() * 60);
      const b = Math.floor(random() * 60);
      if (random() < 0.5) {
        const groupA = groups.get(a)!;
        const groupB = groups.get(b)!;
        const expected = groupA !== groupB;
        assert.equal(forest.union(a, b), expected);
        if (expected) {
          for (const value of groupB) {
            groupA.add(value);
            groups.set(value, groupA);
          }
        }
      } else {
        assert.equal(
          forest.connected(a, b),
          groups.get(a) === groups.get(b),
        );
      }
      assert.equal(forest.sizeOf(a), groups.get(a)!.size);
      assert.equal(forest.validate(), true);
    }
    assert.throws(() => forest.find(999), RangeError);
    const restored = variant.deserialize(forest.serialize());
    assert.equal(restored.setCount, forest.setCount);
    for (let a = 0; a < 60; a++) {
      for (let b = 0; b < 60; b++) {
        assert.equal(restored.connected(a, b), forest.connected(a, b));
      }
    }
    assert.equal(restored.validate(), true);
  });
}

test("UnionFind matches a naive connected-component model", () => {
  const random = seeded(123);
  const forest = new UnionFind<number>();
  const groups = new Map<number, Set<number>>();
  for (let value = 0; value < 80; value++) {
    forest.makeSet(value);
    groups.set(value, new Set([value]));
  }
  assert.equal(forest.setCount, 80);
  for (let step = 0; step < 500; step++) {
    const a = Math.floor(random() * 80);
    const b = Math.floor(random() * 80);
    const operation = random();
    if (operation < 0.4) {
      const groupA = groups.get(a)!;
      const groupB = groups.get(b)!;
      const expected = groupA !== groupB;
      assert.equal(forest.union(a, b), expected);
      if (expected) {
        for (const value of groupB) {
          groupA.add(value);
          groups.set(value, groupA);
        }
      }
    } else {
      assert.equal(
        forest.connected(a, b),
        groups.get(a) === groups.get(b),
      );
      assert.equal(forest.sizeOf(a), groups.get(a)!.size);
      if (groups.get(a) === groups.get(b)) {
        assert.equal(forest.find(a), forest.find(b));
      }
    }
    assert.equal(forest.validate(), true);
  }
  assert.throws(() => forest.find(999), RangeError);
  assert.throws(() => forest.sizeOf(999), RangeError);

  const restored = UnionFind.deserialize<number>(forest.serialize());
  assert.equal(restored.setCount, forest.setCount);
  for (let a = 0; a < 80; a++) {
    for (let b = 0; b < 80; b++) {
      assert.equal(restored.connected(a, b), forest.connected(a, b));
    }
  }
  assert.equal(restored.validate(), true);
  assert.throws(
    () => UnionFind.deserialize({ type: "UnionFind", version: 1, sets: [1] }),
    TypeError,
  );
});

test("UnionFind keeps the forest shallow after path compression", () => {
  const forest = new UnionFind<number>();
  const count = 20000;
  for (let value = 0; value < count; value++) {
    forest.makeSet(value);
  }
  for (let value = 1; value < count; value++) {
    forest.union(value - 1, value);
  }
  for (let value = 0; value < count; value++) {
    forest.find(value);
  }
  const nodes = (forest as unknown as {
    _nodes: Map<number, { parent: number }>;
  })._nodes;
  let maxDepth = 0;
  for (const value of nodes.keys()) {
    let depth = 0;
    let current = value;
    while (nodes.get(current)!.parent !== current) {
      current = nodes.get(current)!.parent;
      depth++;
      if (depth > 4) {
        break;
      }
    }
    maxDepth = Math.max(maxDepth, depth);
  }
  assert.ok(maxDepth <= 2, `max depth ${maxDepth} exceeds inverse-Ackermann expectations`);
  assert.equal(forest.validate(), true);
});

test("mergeSortedRuns merges lazily and validates run order", () => {
  assert.deepEqual(
    [...mergeSortedRuns([[1, 3, 5], [2, 4, 6]], (a, b) => a - b)],
    [1, 2, 3, 4, 5, 6],
  );
  assert.deepEqual(
    [...mergeSortedRuns([[1, 1, 2], [1, 2, 3]], (a, b) => a - b, { unique: true })],
    [1, 2, 3],
  );
  assert.deepEqual(
    [...mergeSortedRuns([[], [1], []], (a, b) => a - b)],
    [1],
  );
  assert.deepEqual(
    [...mergeSortedRuns<number>([], (a, b) => a - b)],
    [],
  );

  const random = seeded(456);
  for (let trial = 0; trial < 50; trial++) {
    const runs: number[][] = [];
    const runCount = Math.floor(random() * 5);
    for (let run = 0; run < runCount; run++) {
      const length = Math.floor(random() * 10);
      const values: number[] = [];
      let current = Math.floor(random() * 10);
      for (let index = 0; index < length; index++) {
        current += Math.floor(random() * 4);
        values.push(current);
      }
      runs.push(values);
    }
    const expected = runs.flat().sort((a, b) => a - b);
    assert.deepEqual([...mergeSortedRuns(runs, (a, b) => a - b)], expected);
    assert.deepEqual(
      [...mergeSortedRuns(runs, (a, b) => a - b, { unique: true })],
      [...new Set(expected)],
    );
  }

  assert.throws(
    () => [...mergeSortedRuns([[3, 1]], (a, b) => a - b)],
    RangeError,
  );
});

test("BloomFilter has no false negatives and a bounded false-positive rate", () => {
  const filter = new BloomFilter({ bits: 16384, hashes: 7, seed: 42 });
  const inserted: string[] = [];
  for (let value = 0; value < 1000; value++) {
    const key = `inserted-${value}`;
    inserted.push(key);
    filter.add(key);
  }
  for (const key of inserted) {
    assert.equal(filter.has(key), true);
  }
  let falsePositives = 0;
  const probes = 3000;
  for (let value = 0; value < probes; value++) {
    if (filter.has(`absent-${value}`)) {
      falsePositives++;
    }
  }
  const measured = falsePositives / probes;
  assert.ok(measured <= filter.falsePositiveRate * 3 + 0.01);
  assert.equal(filter.validate(), true);

  const restored = BloomFilter.deserialize(filter.serialize());
  assert.equal(restored.size, filter.size);
  for (const key of inserted) {
    assert.equal(restored.has(key), true);
  }
  assert.equal(restored.validate(), true);
  filter.clear();
  assert.equal(filter.size, 0);
  assert.equal(filter.has(inserted[0]), false);
  assert.throws(() => filter.add(1 as never), TypeError);
  assert.throws(
    () =>
      BloomFilter.deserialize({
        type: "BloomFilter",
        version: 1,
        bits: 32,
        hashes: 2,
        seed: 1,
        size: 0,
        words: [],
      }),
    TypeError,
  );
});

test("CountingBloomFilter supports deletion of inserted values", () => {
  const filter = new CountingBloomFilter({ bits: 4096, hashes: 5, seed: 7 });
  const values = Array.from({ length: 300 }, (_, index) => `value-${index}`);
  for (const value of values) {
    filter.add(value);
  }
  for (const value of values) {
    assert.equal(filter.has(value), true);
  }
  for (let index = 0; index < 150; index++) {
    assert.equal(filter.delete(values[index]), true);
  }
  for (let index = 150; index < values.length; index++) {
    assert.equal(filter.has(values[index]), true);
  }
  assert.equal(filter.validate(), true);
  const restored = CountingBloomFilter.deserialize(filter.serialize());
  assert.equal(restored.size, filter.size);
  for (let index = 150; index < values.length; index++) {
    assert.equal(restored.has(values[index]), true);
  }
});

test("PartitionedBloomFilter has no false negatives", () => {
  const filter = new PartitionedBloomFilter({ bits: 8192, hashes: 6, seed: 9 });
  const values = Array.from({ length: 500 }, (_, index) => `p-${index}`);
  for (const value of values) {
    filter.add(value);
  }
  for (const value of values) {
    assert.equal(filter.has(value), true);
  }
  assert.equal(filter.validate(), true);
  const restored = PartitionedBloomFilter.deserialize(filter.serialize());
  for (const value of values) {
    assert.equal(restored.has(value), true);
  }
});

test("ScalableBloomFilter grows through several stages", () => {
  const filter = new ScalableBloomFilter({
    bits: 512,
    hashes: 4,
    seed: 11,
    capacity: 50,
    growthFactor: 2,
    tighteningRatio: 0.9,
  });
  const values = Array.from({ length: 600 }, (_, index) => `s-${index}`);
  for (const value of values) {
    filter.add(value);
  }
  assert.equal(filter.size, 600);
  assert.ok(filter.filterCount > 1);
  for (const value of values) {
    assert.equal(filter.has(value), true);
  }
  assert.equal(filter.validate(), true);
  assert.ok(filter.falsePositiveRate >= 0);
  assert.ok(filter.falsePositiveRate < 0.2);
  const restored = ScalableBloomFilter.deserialize(filter.serialize());
  assert.equal(restored.size, filter.size);
  assert.equal(restored.filterCount, filter.filterCount);
  for (const value of values) {
    assert.equal(restored.has(value), true);
  }
  assert.equal(restored.validate(), true);
});

test("CuckooFilter reports a full filter instead of growing without bound", () => {
  const filter = new CuckooFilter({ buckets: 1, bucketSize: 1, fingerprintBits: 8 });
  let added = 0;
  while (filter.add(`v${added}`)) {
    added++;
    if (added > 100) {
      break;
    }
  }
  assert.ok(added >= 1 && added <= 100);
  assert.equal(filter.size, added);
  assert.equal(filter.validate(), true);
  const restored = CuckooFilter.deserialize(filter.serialize());
  assert.equal(restored.size, filter.size);
  for (let index = 0; index < added; index++) {
    assert.equal(restored.has(`v${index}`), true);
  }
  assert.equal(restored.validate(), true);
});

test("CuckooFilter supports lookup and deletion", () => {
  const filter = new CuckooFilter({
    buckets: 256,
    bucketSize: 4,
    fingerprintBits: 10,
    seed: 13,
  });
  const values = Array.from({ length: 400 }, (_, index) => `c-${index}`);
  for (const value of values) {
    assert.equal(filter.add(value), true);
  }
  assert.equal(filter.size, 400);
  for (const value of values) {
    assert.equal(filter.has(value), true);
  }
  assert.equal(filter.validate(), true);
  for (let index = 0; index < 200; index++) {
    assert.equal(filter.delete(values[index]), true);
  }
  for (let index = 200; index < values.length; index++) {
    assert.equal(filter.has(values[index]), true);
  }
  let falsePositives = 0;
  for (let index = 0; index < 1000; index++) {
    if (filter.has(`missing-${index}`)) {
      falsePositives++;
    }
  }
  assert.ok(falsePositives / 1000 < 0.1);
  assert.equal(filter.validate(), true);

  const restored = CuckooFilter.deserialize(filter.serialize());
  assert.equal(restored.size, filter.size);
  for (let index = 200; index < values.length; index++) {
    assert.equal(restored.has(values[index]), true);
  }
  assert.equal(restored.validate(), true);
  filter.clear();
  assert.equal(filter.size, 0);
  assert.equal(filter.has(values[200]), false);
  assert.throws(() => filter.add(1 as never), TypeError);
  assert.throws(
    () =>
      CuckooFilter.deserialize({
        type: "CuckooFilter",
        version: 1,
        buckets: 16,
        bucketSize: 4,
        fingerprintBits: 8,
        maxKicks: 10,
        seed: 1,
        size: 0,
        entries: [[1]],
      }),
    TypeError,
  );
});

test("BitSet word-parallel algebra agrees with the element-wise path", () => {
  const universe = 1000;
  let state = 12345;
  const random = (): number => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state / 0x100000000;
  };
  const a = new BitSet(universe);
  const b = new BitSet(universe);
  for (let i = 0; i < universe; i++) {
    if (random() < 0.4) a.add(i);
    if (random() < 0.4) b.add(i);
  }
  const bValues = b.toArray();
  for (const op of ["union", "intersection", "difference", "symmetricDifference"] as const) {
    const fast = a[op](b);
    const slow = a[op](bValues);
    assert.deepEqual(fast.toArray(), slow.toArray(), op);
    assert.equal(fast.size, slow.size, `${op} size`);
    assert.equal(fast.validate(), true, op);
  }
  assert.equal(a.isSubsetOf(b), a.isSubsetOf(bValues));
  assert.equal(a.union(b).isSubsetOf(a.union(bValues)), true);
  assert.equal(a.intersection(b).isSubsetOf(a), true);
  assert.equal(a.equals(b), a.equals(bValues));
  assert.equal(a.equals(a.union(new BitSet(universe))), true);
  // A BitSet over another universe takes the element-wise path and still agrees.
  const c = new BitSet(2000);
  for (const value of bValues) c.add(value);
  assert.deepEqual(a.union(c).toArray(), a.union(b).toArray());
  assert.equal(a.isSubsetOf(c), a.isSubsetOf(b));
});

test("SortedArraySet merges accept unsorted iterables with duplicates", () => {
  const set = new SortedArraySet<number>();
  for (const value of [1, 3, 5, 7, 9]) set.add(value);
  const other = [9, 2, 2, 5, 11, 1, 11];
  assert.deepEqual(set.union(other).toArray(), [1, 2, 3, 5, 7, 9, 11]);
  assert.deepEqual(set.intersection(other).toArray(), [1, 5, 9]);
  assert.deepEqual(set.difference(other).toArray(), [3, 7]);
  assert.deepEqual(set.symmetricDifference(other).toArray(), [2, 3, 7, 11]);
  assert.equal(set.isSubsetOf([9, 7, 5, 3, 1, 0]), true);
  assert.equal(set.isSubsetOf([9, 7, 5, 3]), false);
  assert.equal(set.equals([9, 1, 7, 3, 5, 5]), true);
  assert.equal(set.equals([9, 1, 7, 3]), false);
  // Results are independent fresh sets; the inputs are untouched.
  const union = set.union(other);
  union.add(100);
  assert.equal(set.has(100), false);
  assert.deepEqual(other, [9, 2, 2, 5, 11, 1, 11]);
  assert.equal(union.validate(), true);
  // A SortedArraySet with a different comparator is re-sorted under this set's comparator.
  const descending = new SortedArraySet<number>((x, y) => y - x);
  for (const value of [4, 3, 2]) descending.add(value);
  assert.deepEqual(set.union(descending).toArray(), [1, 2, 3, 4, 5, 7, 9]);
  assert.deepEqual(descending.union(set).toArray(), [9, 7, 5, 4, 3, 2, 1]);
});
